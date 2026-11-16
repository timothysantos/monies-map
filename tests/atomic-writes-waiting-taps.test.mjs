// Waiting taps (DOMAIN.md "Waiting Tap"): every command is all-or-nothing.
// Holding a tap (its row and audit line), recording a second blank run,
// completing a tap with its entry (a second Shortcut run, the Shortcut's own
// answer, Entries' Save), Not a payment, the import commit that clears a tap
// and the rollback that brings it back: a failure at any statement leaves the
// database exactly as it was. Real local D1, demo household.
import assert from "node:assert/strict";
import test from "node:test";

import { holdWaitingTap, markWaitingTapNotAPayment } from "../src/domain/app-repository-waiting-taps.ts";
import {
  assertSameDatabase,
  createSeededTemplate,
  dumpDatabase,
  failingStatement,
  openSeededDatabase,
  rows
} from "./support/d1-workspace.mjs";
import { enableShortcut, TOKEN } from "./support/foreign-wallet.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const TAP_1 = "apple-pay-20261005120000000";
const TAP_2 = "apple-pay-20261005120031000";
const CREATE = `/api/shortcuts/entries/create?shortcut_token=${TOKEN}`;
const purchase = (overrides = {}) => ({
  date: "2026-10-05", description: "Periplus Bali", name: "UOB One", requestId: TAP_1, clientVersion: "apple-pay-api-2026-11-17-v8", amount: "", ...overrides
});

async function heldTap(t) {
  const opened = await openSeededDatabase(t, template);
  await enableShortcut(opened.db);
  const held = await opened.api(CREATE, purchase());
  assert.equal(held.status, 202, JSON.stringify(held.payload));
  const [tap] = await rows(opened.db, "SELECT id, account_id FROM waiting_taps");
  return { ...opened, tap };
}

for (const [what, pattern] of [["its row", /INSERT INTO waiting_taps/], ["its audit line", /INSERT INTO audit_events/]]) {
  test(`holding a tap: a failure on ${what} keeps nothing`, async (t) => {
    const { db } = await openSeededDatabase(t, template);
    const [{ id: accountId }] = await rows(db, "SELECT id FROM accounts WHERE account_name = 'UOB One'");
    const before = await dumpDatabase(db);
    const faulty = failingStatement(db, pattern);
    await assert.rejects(
      holdWaitingTap(faulty.db, { requestId: TAP_1, personId: "person-tim", accountId, merchant: "Periplus Bali", tapDate: "2026-10-05" }),
      /injected_failure_missing_table/
    );
    assert.equal(faulty.state.fired, true);
    assertSameDatabase(await dumpDatabase(db), before);
  });
}

for (const [what, pattern] of [["the tap's second run", /UPDATE waiting_taps SET second_run_at/], ["its audit line", /INSERT INTO audit_events/]]) {
  test(`a second blank run: a failure on ${what} records nothing`, async (t) => {
    const { db, api } = await heldTap(t);
    const before = await dumpDatabase(db);
    const faulty = failingStatement(db, pattern);
    const second = await api(CREATE, purchase({ requestId: TAP_2 }), { database: faulty.db });
    assert.equal(faulty.state.fired, true);
    assert.equal(second.status, 500);
    assertSameDatabase(await dumpDatabase(db), before);
  });
}

const completionFailures = [
  ["the entry", /INSERT INTO transactions/, 0],
  ["the entry's audit line", /INSERT INTO audit_events/, 0],
  ["the tap's completion", /UPDATE waiting_taps\s+SET status = 'completed'/, 0],
  ["the completion's audit line", /INSERT INTO audit_events/, 1],
  ["the month refresh marker", /monthly_snapshot_refreshes/, 0]
];

for (const [what, pattern, skip] of completionFailures) {
  test(`tap 2 completing a held tap: a failure on ${what} saves no entry and the tap still waits`, async (t) => {
    const { db, api } = await heldTap(t);
    const before = await dumpDatabase(db);
    const faulty = failingStatement(db, pattern, { skip });
    const second = await api(CREATE, purchase({ requestId: TAP_2, amount: "22.94" }), { database: faulty.db });
    assert.equal(faulty.state.fired, true);
    assert.notEqual(second.status, 200);
    assertSameDatabase(await dumpDatabase(db), before);
  });

  test(`Entries' Save: a failure on ${what} saves no entry and the tap still waits`, async (t) => {
    const { db, api, tap } = await heldTap(t);
    const before = await dumpDatabase(db);
    const faulty = failingStatement(db, pattern, { skip });
    const saved = await api("/api/waiting-taps/complete", { tapId: tap.id, amount: "22.94", currency: "SGD" }, { database: faulty.db });
    assert.equal(faulty.state.fired, true);
    assert.notEqual(saved.status, 200);
    assertSameDatabase(await dumpDatabase(db), before);
  });
}

test("the Shortcut's own answer: a failure on the tap's completion saves no entry", async (t) => {
  const { db, api } = await heldTap(t);
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /UPDATE waiting_taps\s+SET status = 'completed'/);
  const answered = await api(CREATE, purchase({ amount: "22.94" }), { database: faulty.db });
  assert.equal(faulty.state.fired, true);
  assert.equal(answered.status, 500);
  assertSameDatabase(await dumpDatabase(db), before);
});

for (const [what, pattern] of [["the tap", /UPDATE waiting_taps SET status = \?/], ["its audit line", /INSERT INTO audit_events/]]) {
  test(`Not a payment: a failure on ${what} leaves the tap waiting`, async (t) => {
    const { db, tap } = await heldTap(t);
    const before = await dumpDatabase(db);
    const faulty = failingStatement(db, pattern);
    await assert.rejects(markWaitingTapNotAPayment(faulty.db, tap.id), /injected_failure_missing_table/);
    assert.equal(faulty.state.fired, true);
    assertSameDatabase(await dumpDatabase(db), before);
  });
}

const importBody = {
  sourceLabel: "UOB One activity", sourceType: "csv", parserKey: "generic_csv",
  rows: [{ rowId: "r1", rowIndex: 0, date: "2026-10-06", description: "PERIPLUS BALI", amountMinor: 2294, entryType: "expense", accountName: "UOB One", categoryName: "Other", ownershipType: "direct", ownerName: "Tim", splitBasisPoints: 10000, rawRow: {} }]
};

for (const [what, pattern] of [["clearing the tap", /UPDATE waiting_taps SET status = \?/], ["the clearing audit line", /INSERT INTO audit_events/]]) {
  test(`an import that clears a tap: a failure on ${what} imports nothing and the tap still waits`, async (t) => {
    const { db, api } = await heldTap(t);
    const before = await dumpDatabase(db);
    // The commit's own audit line comes first; the tap's is the second.
    const faulty = failingStatement(db, pattern, { skip: what === "the clearing audit line" ? 1 : 0 });
    const commit = await api("/api/imports/commit", importBody, { database: faulty.db });
    assert.equal(faulty.state.fired, true);
    assert.equal(commit.status, 400);
    assertSameDatabase(await dumpDatabase(db), before);
  });
}

test("rolling back an import that cleared a tap: a failure on reopening the tap rolls nothing back", async (t) => {
  const { db, api } = await heldTap(t);
  const commit = await api("/api/imports/commit", importBody);
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  assert.deepEqual(await rows(db, "SELECT status FROM waiting_taps"), [{ status: "bank_row" }]);
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /UPDATE waiting_taps SET status = 'waiting'/);
  const rollback = await api("/api/imports/rollback", { importId: commit.payload.importId }, { database: faulty.db });
  assert.equal(faulty.state.fired, true);
  assert.notEqual(rollback.status, 200);
  assertSameDatabase(await dumpDatabase(db), before);
});

for (const [what, pattern] of [["the tap", /SET status = 'expired'/], ["its audit line", /INSERT INTO audit_events/]]) {
  test(`putting away a week-old tap: a failure on ${what} changes nothing and the page still loads`, async (t) => {
    const { db, api } = await heldTap(t);
    await db.prepare("UPDATE waiting_taps SET received_at = ?").bind(new Date(Date.now() - 8 * 86_400_000).toISOString()).run();
    const before = await dumpDatabase(db);
    const faulty = failingStatement(db, pattern);
    const page = await api("/api/entries-page?view=household&month=2026-10", undefined, { database: faulty.db });
    assert.equal(faulty.state.fired, true);
    assert.deepEqual([page.status, page.payload.waitingTaps], [200, undefined]);
    assertSameDatabase(await dumpDatabase(db), before);
  });
}
