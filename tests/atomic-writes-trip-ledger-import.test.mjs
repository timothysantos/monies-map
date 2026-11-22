// Trip ledger import (docs/audits/trip-ledger-import.md) on a real local D1
// and the demo household: the apply step runs only the app's existing
// commands, each all-or-nothing; a failure inside one leaves that command's
// writes out and the next run carries on; a second run changes nothing; the
// undo takes the import back out. Also the Splits page's "Add expense"
// command, which the import uses for a purchase the other person paid, now
// commits in one batch. Every fixture is invented.
import assert from "node:assert/strict";
import test from "node:test";

import { createSplitExpenseRecord } from "../src/domain/app-repository-splits.ts";
import { applyTripLedgerPlan, undoTripLedgerImport } from "../src/domain/trip-ledger-apply.ts";
import { readTripLedgerExport } from "../src/domain/trip-ledger-match.ts";
import { DEFAULT_TRIP_LEDGER_CONFIG, buildTripLedgerPlan, hashTripLedgerPlan } from "../src/domain/trip-ledger-plan.ts";
import { loadTripLedgerSnapshot } from "../src/domain/trip-ledger-snapshot.ts";
import {
  assertSameDatabase,
  createSeededTemplate,
  dumpDatabase,
  failingStatement,
  openSeededDatabase,
  rows
} from "./support/d1-workspace.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const query = (db) => async (sql) => (await db.prepare(sql).all()).results;

// Day 1 is 2 March 2031: no demo entries are near it.
async function buildPlan(db) {
  const [owner] = await rows(db, "SELECT id, display_name FROM people WHERE household_id = 'household-1' AND role = 'owner'");
  const [partner] = await rows(db, "SELECT id, display_name FROM people WHERE household_id = 'household-1' AND role = 'partner'");
  const [card] = await rows(db, "SELECT id FROM accounts WHERE household_id = 'household-1' AND owner_person_id = ? AND account_kind = 'credit_card' AND is_active = 1 ORDER BY id LIMIT 1", owner.id);
  const raw = {
    expenses: [
      { id: "kiosk", day: 1, time: "09:10", merchant: "Station Kiosk", items: "Tea; rice ball", category: "Food", payer: "You", jpy: 650, sgd_cents: 540, status: "paid", owed_cents: 0, funding_card: "Test Card" },
      { id: "lunch", day: 1, time: "12:30", merchant: "Noodle House", items: "Set lunch x2", category: "Food", payer: "You", jpy: 3000, sgd_cents: 2490, status: "paid", owed_cents: 1245, funding_card: "Test Card" },
      { id: "jacket", day: 2, time: "15:00", merchant: "Outdoor Shop", items: "Rain jacket", category: "Fashion", payer: partner.display_name, jpy: 12000, sgd_cents: 9960, status: "estimated", owed_cents: 9960 },
      { id: "booking", day: 1, merchant: "Booking site", category: "Travel", payer: "You", jpy: null, sgd_cents: 40000, status: "pending", owed_cents: null, allocation_pending: 1, funding_card: "Test Card" },
      { id: "own-coffee", day: 2, merchant: "Cafe", category: "Food", payer: partner.display_name, jpy: 500, sgd_cents: 415, status: "estimated", owed_cents: 0 }
    ],
    items: []
  };
  const lines = readTripLedgerExport(raw, "2031-03-01");
  const snapshot = await loadTripLedgerSnapshot(query(db), { householdId: "household-1", from: "2031-01-01", to: "2031-03-10" });
  const plan = buildTripLedgerPlan({
    lines,
    snapshot,
    config: { ...DEFAULT_TRIP_LEDGER_CONFIG, tripName: "Kyushu trip" },
    answers: { wallets: { "Test Card": card.id } },
    dayZero: "2031-03-01",
    exportSha256: "cd".repeat(32)
  });
  return { plan, hash: await hashTripLedgerPlan(plan), owner, partner, card };
}

const importEntries = (db) => rows(db, "SELECT id, account_id, amount_minor, original_amount_minor, original_currency, external_reference, category_id, note FROM transactions WHERE external_reference LIKE 'trip-ledger:kyushu-trip:%' ORDER BY external_reference");
const activeImportSplits = (db) => rows(db, `
  SELECT split_expenses.description, split_expenses.total_amount_minor, split_expenses.payment_status, payer.role AS payer_role,
    (SELECT group_concat(people.role || ':' || split_expense_shares.amount_minor, ',') FROM split_expense_shares INNER JOIN people ON people.id = split_expense_shares.person_id WHERE split_expense_shares.split_expense_id = split_expenses.id) AS shares
  FROM split_expenses
  INNER JOIN people AS payer ON payer.id = split_expenses.payer_person_id
  INNER JOIN split_groups ON split_groups.id = split_expenses.split_group_id
  WHERE split_groups.group_name = 'Kyushu trip' AND split_expenses.deleted_at IS NULL
  ORDER BY split_expenses.description
`);

test("the plan holds the unsettled line and proposes only existing-command steps", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const { plan } = await buildPlan(db);
  assert.deepEqual(plan.steps.map((step) => step.kind), ["create_split_group", "create_trip", "create_entry", "create_entry", "create_split_expense", "put_on_trip"]);
  assert.deepEqual(plan.lines.map((line) => [line.lineId, line.outcome]), [["kiosk", "new"], ["lunch", "new"], ["jacket", "splits-only"], ["booking", "held"], ["own-coffee", "nothing"]]);
});

test("apply refuses without the plan's own hash, and a dry run writes nothing", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const { plan, hash } = await buildPlan(db);
  const before = await dumpDatabase(db);
  await assert.rejects(applyTripLedgerPlan(db, plan, { expectedHash: "0".repeat(64), apply: true }), /hash does not match/);
  await assert.rejects(applyTripLedgerPlan(db, { ...plan, steps: plan.steps.slice(1) }, { expectedHash: hash, apply: true }), /hash does not match/);
  const dry = await applyTripLedgerPlan(db, plan, { expectedHash: hash, apply: false });
  assert.deepEqual(dry.steps.map((step) => step.status), ["would-run", "would-run", "would-run", "would-run", "would-run", "would-run"]);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("a failure inside one step leaves that step out entirely; the next run finishes, a third changes nothing, and undo takes it back out", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const { plan, hash, card } = await buildPlan(db);
  const start = await dumpDatabase(db);

  // The shared lunch entry's split share fails inside its own batch.
  const faulty = failingStatement(db, /INSERT INTO split_expense_shares/);
  await assert.rejects(applyTripLedgerPlan(faulty.db, plan, { expectedHash: hash, apply: true }), /injected_failure_missing_table/);
  assert.equal(faulty.state.fired, true);
  // The kiosk entry (before it) is saved; the lunch entry and its split are not, not even in part.
  assert.deepEqual((await importEntries(db)).map((row) => row.external_reference), ["trip-ledger:kyushu-trip:kiosk"]);
  assert.deepEqual(await rows(db, "SELECT id FROM split_expenses WHERE description = 'Noodle House'"), []);
  assert.deepEqual(await rows(db, "SELECT split_expenses.id FROM split_expenses LEFT JOIN split_expense_shares ON split_expense_shares.split_expense_id = split_expenses.id WHERE split_expense_shares.id IS NULL"), []);

  const second = await applyTripLedgerPlan(db, plan, { expectedHash: hash, apply: true });
  assert.deepEqual(second.steps.map((step) => [step.kind, step.status]), [
    ["create_split_group", "already"],
    ["create_trip", "already"],
    ["create_entry", "already"],
    ["create_entry", "done"],
    ["create_split_expense", "done"],
    ["put_on_trip", "done"]
  ]);
  const entries = await importEntries(db);
  assert.deepEqual(entries.map((row) => [row.external_reference, row.account_id, row.amount_minor, row.original_amount_minor, row.original_currency]), [
    ["trip-ledger:kyushu-trip:kiosk", card.id, 540, 65_000, "JPY"],
    ["trip-ledger:kyushu-trip:lunch", card.id, 2490, 300_000, "JPY"]
  ]);
  assert.match(entries[1].note, /^12:30 local time · Set lunch x2\nPaid JPY 3,000\./);
  // Lunch: paid by the owner, the partner owes 12.45 (linked to its entry,
  // as the existing shared-entry command files it). Jacket: paid by the
  // partner, all the owner's, waiting for the partner's card statement.
  assert.deepEqual(await activeImportSplits(db), [
    { description: "Noodle House", total_amount_minor: 2490, payment_status: "certified", payer_role: "owner", shares: "owner:1245,partner:1245" },
    { description: "Outdoor Shop", total_amount_minor: 9960, payment_status: "awaiting_statement", payer_role: "partner", shares: "owner:9960,partner:0" }
  ]);
  const [trip] = await rows(db, "SELECT trip_events.id, trip_events.currency, trip_events.start_date, split_groups.group_name FROM trip_events LEFT JOIN split_groups ON split_groups.id = trip_events.split_group_id WHERE trip_events.name = 'Kyushu trip'");
  assert.deepEqual([trip.currency, trip.start_date, trip.group_name], ["JPY", "2031-03-02", "Kyushu trip"]);
  assert.equal((await rows(db, "SELECT count(*) AS n FROM trip_event_entries WHERE trip_event_id = ?", trip.id))[0].n, 2);
  // One record per step, under the import key, so it can be read back.
  const records = await rows(db, "SELECT action FROM audit_events WHERE entity_type = 'trip_ledger_import' AND entity_id = ? ORDER BY rowid", plan.importKey);
  assert.equal(records.filter((row) => row.action === "trip_ledger_step").length, 6);

  // Running it again changes nothing at all.
  const applied = await dumpDatabase(db);
  const third = await applyTripLedgerPlan(db, plan, { expectedHash: hash, apply: true });
  assert.ok(third.steps.every((step) => step.status === "already"), JSON.stringify(third.steps));
  assertSameDatabase(await dumpDatabase(db), applied);

  // Undo: entries deleted (with the split saved with them), the Splits
  // expense archived, the trip deleted; the empty group stays.
  const undone = await undoTripLedgerImport(db, plan.importKey, { apply: true });
  assert.deepEqual(undone.steps.map((step) => [step.kind, step.status]), [
    ["put_on_trip", "undone"],
    ["create_split_expense", "undone"],
    ["create_entry", "undone"],
    ["create_entry", "undone"],
    ["create_trip", "undone"],
    ["create_split_group", "kept"]
  ]);
  assert.deepEqual(await importEntries(db), []);
  assert.deepEqual(await activeImportSplits(db), []);
  assert.deepEqual(await rows(db, "SELECT id FROM trip_events WHERE name = 'Kyushu trip'"), []);
  // Money is back where it started: the same transactions and active splits.
  const activeSplitCount = async (dump) => dump.split_expenses.filter((row) => row.deleted_at === null).length;
  assert.equal(await activeSplitCount(await dumpDatabase(db)), await activeSplitCount(start));
  assert.equal((await dumpDatabase(db)).transactions.length, start.transactions.length);

  // A second undo has nothing left to do.
  const afterUndo = await dumpDatabase(db);
  const again = await undoTripLedgerImport(db, plan.importKey, { apply: true });
  assert.deepEqual(again.steps.map((step) => step.status), ["kept"]);
  assertSameDatabase(await dumpDatabase(db), afterUndo);
});

test("apply refuses to make an entry when one that could be the purchase appeared after the preview", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { plan, hash, card } = await buildPlan(db);
  const created = await api("/api/entries/create", {
    date: "2031-03-02", description: "STATION KIOSK", accountId: card.id, categoryName: "Groceries",
    amountMinor: 545, entryType: "expense", ownershipType: "direct"
  });
  assert.equal(created.status, 200, JSON.stringify(created.payload));
  const result = await applyTripLedgerPlan(db, plan, { expectedHash: hash, apply: true });
  const kiosk = result.steps.find((step) => step.stepId === "entry-kiosk");
  assert.equal(kiosk.status, "refused");
  assert.deepEqual((await importEntries(db)).map((row) => row.external_reference), ["trip-ledger:kyushu-trip:lunch"]);
});

// The Splits page's Add expense: a failure on any of its writes leaves the
// database as it was (it used to write the expense and shares one by one).
for (const pattern of [/INSERT INTO split_batches/, /INSERT INTO split_expenses/, /INSERT INTO split_expense_shares/]) {
  test(`split expense create: a failure on ${pattern.source} leaves the database as it was`, async (t) => {
    const { db } = await openSeededDatabase(t, template);
    await db.prepare("INSERT INTO split_groups (id, household_id, group_name, currency) VALUES ('split-group-fresh', 'household-1', 'Fresh group', 'SGD')").run();
    const [partner] = await rows(db, "SELECT display_name FROM people WHERE household_id = 'household-1' AND role = 'partner'");
    const before = await dumpDatabase(db);
    const faulty = failingStatement(db, pattern);
    await assert.rejects(createSplitExpenseRecord(faulty.db, {
      groupId: "split-group-fresh", date: "2031-03-03", description: "Ferry tickets", categoryName: "Travel",
      payerPersonName: partner.display_name, amountMinor: 6000, splitAmountMinor: 2000, paymentMethod: "card", paymentStatus: "awaiting_statement"
    }), /injected_failure_missing_table/);
    assert.equal(faulty.state.fired, true);
    assertSameDatabase(await dumpDatabase(db), before);
  });
}
