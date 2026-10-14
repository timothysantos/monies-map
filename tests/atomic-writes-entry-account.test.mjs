// Moving an entry to another card (POST /api/entries/update-account, Ask's
// card suggestion): only the card changes, the move is all-or-nothing (the
// change, its audit event and the month refresh markers commit in one
// db.batch()), and what must not move is refused. Real local D1, demo
// household.
import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSameDatabase,
  createEntry,
  createSeededTemplate,
  dumpDatabase,
  failingStatement,
  openSeededDatabase,
  rows
} from "./support/d1-workspace.mjs";
import { updateEntryAccountRecord } from "../src/domain/app-repository-entry-account.ts";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

async function ids(db) {
  const all = await rows(db, "SELECT id, account_name FROM accounts");
  const byName = (name) => all.find((row) => row.account_name === name).id;
  return { uobOne: byName("UOB One"), citi: byName("Citi Rewards"), savings: byName("UOB Savings") };
}

const entryRow = (db, entryId) => rows(db, "SELECT account_id, owner_person_id, transaction_date, amount_minor, note, category_id, currency FROM transactions WHERE id = ?", entryId).then((result) => result[0]);

test("a move changes only the card and keeps the entry's owner, note, amount, date and category", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const card = await ids(db);
  const entryId = await createEntry(api, { description: "Grab Ride", amountMinor: 1250, date: "2026-10-03", note: "airport", offsetsCategory: true });
  const before = await entryRow(db, entryId);

  const { status, payload } = await api("/api/entries/update-account", { entryId, accountId: card.citi });

  assert.deepEqual([status, payload], [200, { ok: true, entryId, updated: true }]);
  assert.deepEqual(await entryRow(db, entryId), { ...before, account_id: card.citi });
  const [offsets] = await rows(db, "SELECT offsets_category FROM transactions WHERE id = ?", entryId);
  assert.equal(offsets.offsets_category, 1, "a field the general update would have reset");
  const [audit] = await rows(db, "SELECT action, detail FROM audit_events WHERE entity_id = ? ORDER BY rowid DESC LIMIT 1", entryId);
  assert.deepEqual(audit, { action: "entry_account_updated", detail: "Moved Grab Ride on 2026-10-03 from UOB One to Citi Rewards." });
});

test("an entry with no owner keeps the owner of the card it leaves", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const card = await ids(db);
  const entryId = await createEntry(api, { description: "Kopi", amountMinor: 300, date: "2026-10-03", ownerName: undefined });
  await db.prepare("UPDATE transactions SET owner_person_id = NULL WHERE id = ?").bind(entryId).run();

  await api("/api/entries/update-account", { entryId, accountId: card.citi });

  assert.equal((await entryRow(db, entryId)).owner_person_id, "person-tim", "the UOB One owner, not Citi Rewards' owner");
});

test("the same card is a no-op, and a missing entry or card is refused", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const card = await ids(db);
  const entryId = await createEntry(api, { description: "Grab Ride", amountMinor: 1250, date: "2026-10-03" });
  const before = await dumpDatabase(db);

  assert.deepEqual((await api("/api/entries/update-account", { entryId, accountId: card.uobOne })).payload, { ok: true, entryId, updated: false });
  assert.equal((await api("/api/entries/update-account", { entryId: "txn-missing", accountId: card.citi })).payload.error, "Entry not found.");
  assert.equal((await api("/api/entries/update-account", { entryId, accountId: "acct-missing" })).payload.error, "Choose an active card.");
  assert.equal((await api("/api/entries/update-account", { entryId })).status, 400);
  assertSameDatabase(await dumpDatabase(db), before);

  await db.prepare("UPDATE accounts SET is_active = 0 WHERE id = ?").bind(card.citi).run();
  assert.equal((await api("/api/entries/update-account", { entryId, accountId: card.citi })).payload.error, "Choose an active card.");
});

test("a certified entry, an entry on Splits, a transfer and another currency stay where they are", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const card = await ids(db);
  const move = (entryId) => api("/api/entries/update-account", { entryId, accountId: card.citi });

  const certified = await createEntry(api, { description: "Certified", amountMinor: 500, date: "2026-10-03" });
  await db.prepare("UPDATE transactions SET bank_certification_status = 'statement_certified' WHERE id = ?").bind(certified).run();
  assert.match((await move(certified)).payload.error, /statement has already confirmed/);

  const shared = await createEntry(api, { description: "Dinner", amountMinor: 8000, date: "2026-10-03" });
  const added = await api("/api/splits/expenses/from-entry", { entryId: shared, splitGroupId: null });
  assert.equal(added.status, 200, JSON.stringify(added.payload));
  assert.match((await move(shared)).payload.error, /off Splits/);

  const transfer = await createEntry(api, { description: "Move money", entryType: "transfer", categoryName: "Transfer", amountMinor: 1000, date: "2026-10-03" });
  assert.match((await move(transfer)).payload.error, /Only an expense/);

  const usd = await createEntry(api, { description: "Dollars", amountMinor: 700, date: "2026-10-03" });
  await db.prepare("UPDATE transactions SET currency = 'USD' WHERE id = ?").bind(usd).run();
  assert.match((await move(usd)).payload.error, /not USD|in SGD, not USD/);
  assert.equal((await entryRow(db, usd)).account_id, card.uobOne);
});

for (const [label, pattern] of [["audit event", /INSERT INTO audit_events/], ["entry", /UPDATE transactions/], ["month refresh marker", /INSERT INTO monthly_snapshot_refresh|monthly_snapshot_refresh/]]) {
  test(`a move that fails on its ${label} changes nothing`, async (t) => {
    const { db, api } = await openSeededDatabase(t, template);
    const card = await ids(db);
    const entryId = await createEntry(api, { description: "Grab Ride", amountMinor: 1250, date: "2026-10-03" });
    const before = await dumpDatabase(db);
    const faulty = failingStatement(db, pattern);

    await assert.rejects(updateEntryAccountRecord(faulty.db, { entryId, accountId: card.citi }), /injected_failure_missing_table/);

    assert.equal(faulty.state.fired, true, `no statement matched ${pattern}`);
    assertSameDatabase(await dumpDatabase(db), before);
  });
}
