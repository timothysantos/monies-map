// Split write consistency: one ledger entry never gets two active split
// records, even when two writes race. Real local D1 (Miniflare) seeded with
// the demo household.
import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSameDatabase,
  createEntry,
  createSeededTemplate,
  dumpDatabase,
  failingStatement,
  openSeededDatabase,
  rows,
  snapshotTotals,
  statementSql
} from "./support/d1-workspace.mjs";
import { recalculateMonthlySnapshots } from "../src/domain/app-repository-snapshots.ts";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const MONTH = "2026-05";
const DATE = "2026-05-16";

function scopeTotal(totals, scope) {
  return totals.find((row) => row.person_scope === scope)?.total_expense_minor;
}

// The stored month totals must be what a full recalculation gives.
async function assertTotalsFresh(db, month = MONTH) {
  const stored = await snapshotTotals(db, month);
  assert.deepEqual(await rows(db, "SELECT month_key FROM monthly_snapshot_refreshes"), []);
  await recalculateMonthlySnapshots(db, month);
  assert.deepEqual(stored, await snapshotTotals(db, month), "stored month totals are stale");
  return stored;
}

async function addToSplits(api, entryId) {
  const split = await api("/api/splits/expenses/from-entry", { entryId, splitGroupId: null });
  assert.equal(split.status, 200, JSON.stringify(split.payload));
  return split.payload.splitExpenseId;
}

async function activeSplitsOf(db, entryId) {
  return rows(db, "SELECT id FROM split_expenses WHERE linked_transaction_id = ? AND deleted_at IS NULL ORDER BY id", entryId);
}

async function splitAndShares(db, splitExpenseId) {
  const [split] = await rows(db, "SELECT total_amount_minor, home_amount_minor, linked_transaction_id, deleted_at IS NOT NULL AS archived FROM split_expenses WHERE id = ?", splitExpenseId);
  const shares = await rows(db, "SELECT person_id, ratio_basis_points, amount_minor FROM split_expense_shares WHERE split_expense_id = ? ORDER BY person_id", splitExpenseId);
  return { split, shares };
}

// Holds every db.batch() whose statements match `pattern` until `count` of
// them are waiting, then lets them all run. Two requests that each read,
// check and then commit therefore both finish their checks before either
// commits: the race a pre-batch check cannot see. D1 still runs the batches
// one at a time, as production does.
function raceAtBatch(db, pattern, count = 2) {
  const waiting = [];
  const state = { held: 0 };
  const wrapper = new Proxy(db, {
    get(target, property) {
      if (property === "batch") {
        return async (statements) => {
          if (statements.some((statement) => pattern.test(statementSql(statement))) && state.held < count) {
            state.held += 1;
            await new Promise((resolve) => {
              waiting.push(resolve);
              if (waiting.length === count) waiting.splice(0).forEach((release) => release());
            });
          }
          return target.batch(statements);
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  return { db: wrapper, state };
}

// --- 1. One active split record per ledger entry ---------------------------

test("two simultaneous Add to splits of one entry leave exactly one split; the other is told it is already linked", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const entryId = await createEntry(api, { date: DATE, description: "Race add", amountMinor: 6_000 });
  const racing = raceAtBatch(db, /INSERT INTO split_expenses/);

  const results = await Promise.all([
    api("/api/splits/expenses/from-entry", { entryId, splitGroupId: null }, { database: racing.db }),
    api("/api/splits/expenses/from-entry", { entryId, splitGroupId: null }, { database: racing.db })
  ]);

  assert.equal(racing.state.held, 2, "both requests passed their checks before either committed");
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 400], JSON.stringify(results.map((result) => result.payload)));
  const loser = results.find((result) => result.status !== 200);
  assert.equal(loser.payload.error, "This entry is already linked to a split expense.");
  const winner = results.find((result) => result.status === 200);
  assert.deepEqual(await activeSplitsOf(db, entryId), [{ id: winner.payload.splitExpenseId }]);
  assert.deepEqual(await rows(db, "SELECT COUNT(*) AS count FROM split_expenses WHERE linked_transaction_id = ?", entryId), [{ count: 1 }]);
  // The loser's whole batch rolled back: no orphan shares.
  assert.deepEqual(await rows(db, "SELECT COUNT(*) AS count FROM split_expense_shares WHERE split_expense_id NOT IN (SELECT id FROM split_expenses)"), [{ count: 0 }]);
  assert.equal((await splitAndShares(db, winner.payload.splitExpenseId)).shares.length, 2);
  await assertTotalsFresh(db);
});

// An imported expense that no split record holds yet.
async function unlinkedImportedExpense(db) {
  const [row] = await rows(db, `
    SELECT transactions.id, transactions.transaction_date, transactions.amount_minor
    FROM transactions INNER JOIN imports ON imports.id = transactions.import_id
    WHERE imports.status = 'completed' AND transactions.entry_type = 'expense'
      AND NOT EXISTS (SELECT 1 FROM split_expenses WHERE linked_transaction_id = transactions.id)
    ORDER BY transactions.transaction_date, transactions.id
    LIMIT 1
  `);
  assert.ok(row, "the demo seed has an unlinked imported expense");
  return row;
}

async function createSplitFor(api, transaction, description) {
  const created = await api("/api/splits/expenses/create", {
    groupId: null,
    date: transaction.transaction_date,
    description,
    categoryName: "Groceries",
    payerPersonName: "Tim",
    amountMinor: Math.abs(transaction.amount_minor),
    splitBasisPoints: 5_000,
    paymentMethod: "bank",
    paymentStatus: "recorded"
  });
  assert.equal(created.status, 200, JSON.stringify(created.payload));
  return created.payload.splitExpenseId;
}

test("two splits matched to one imported entry at the same time: one match wins, the other is refused", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const transaction = await unlinkedImportedExpense(db);
  const firstId = await createSplitFor(api, transaction, "Race match first");
  const secondId = await createSplitFor(api, transaction, "Race match second");
  const racing = raceAtBatch(db, /UPDATE split_expenses SET linked_transaction_id/);

  const results = await Promise.all([
    api("/api/splits/matches/link-expense", { splitExpenseId: firstId, transactionId: transaction.id }, { database: racing.db }),
    api("/api/splits/matches/link-expense", { splitExpenseId: secondId, transactionId: transaction.id }, { database: racing.db })
  ]);

  assert.equal(racing.state.held, 2);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 400], JSON.stringify(results.map((result) => result.payload)));
  const loserIndex = results.findIndex((result) => result.status !== 200);
  assert.equal(results[loserIndex].payload.error, "This ledger row is already linked to another split record.");
  const winnerId = loserIndex === 0 ? secondId : firstId;
  const loserId = loserIndex === 0 ? firstId : secondId;
  assert.deepEqual(await activeSplitsOf(db, transaction.id), [{ id: winnerId }]);
  // The refused split is untouched: still unlinked and awaiting a match.
  assert.deepEqual(await rows(db, "SELECT linked_transaction_id, payment_status FROM split_expenses WHERE id = ?", loserId), [{ linked_transaction_id: null, payment_status: "recorded" }]);
  await assertTotalsFresh(db, transaction.transaction_date.slice(0, 7));
});

// An entry with two archived splits, each still carrying the ledger link.
async function entryWithTwoArchivedSplits(api) {
  const entryId = await createEntry(api, { date: DATE, description: "Race restore", amountMinor: 6_000 });
  const firstId = await addToSplits(api, entryId);
  assert.equal((await api("/api/splits/expenses/delete", { splitExpenseId: firstId })).status, 200);
  const secondId = await addToSplits(api, entryId);
  assert.equal((await api("/api/splits/expenses/delete", { splitExpenseId: secondId })).status, 200);
  return { entryId, firstId, secondId };
}

test("restoring two archived splits of one entry at the same time brings back only one", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { entryId, firstId, secondId } = await entryWithTwoArchivedSplits(api);
  const racing = raceAtBatch(db, /SET deleted_at = NULL/);

  const results = await Promise.all([
    api("/api/splits/activity-history/restore", { recordKind: "expense", recordId: firstId }, { database: racing.db }),
    api("/api/splits/activity-history/restore", { recordKind: "expense", recordId: secondId }, { database: racing.db })
  ]);

  assert.equal(racing.state.held, 2);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 400], JSON.stringify(results.map((result) => result.payload)));
  const loserIndex = results.findIndex((result) => result.status !== 200);
  assert.equal(results[loserIndex].payload.error, "Its entry is now linked to another split. Delete that split first to restore this one.");
  const winnerId = loserIndex === 0 ? secondId : firstId;
  assert.deepEqual(await activeSplitsOf(db, entryId), [{ id: winnerId }]);
  // Only the winner recorded a restore in activity history.
  assert.deepEqual(await rows(db, "SELECT record_id FROM split_activity_history WHERE action = 'restored'"), [{ record_id: winnerId }]);
  await assertTotalsFresh(db);
});

test("a restore racing Add to splits of the same entry leaves one active split", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const entryId = await createEntry(api, { date: DATE, description: "Race restore and add", amountMinor: 6_000 });
  const archivedId = await addToSplits(api, entryId);
  assert.equal((await api("/api/splits/expenses/delete", { splitExpenseId: archivedId })).status, 200);
  const racing = raceAtBatch(db, /INSERT INTO split_expenses|SET deleted_at = NULL/);

  const [restore, add] = await Promise.all([
    api("/api/splits/activity-history/restore", { recordKind: "expense", recordId: archivedId }, { database: racing.db }),
    api("/api/splits/expenses/from-entry", { entryId, splitGroupId: null }, { database: racing.db })
  ]);

  assert.equal(racing.state.held, 2);
  assert.deepEqual([restore.status, add.status].sort(), [200, 400], JSON.stringify([restore.payload, add.payload]));
  assert.equal((await activeSplitsOf(db, entryId)).length, 1);
  if (restore.status === 200) {
    assert.equal(add.payload.error, "This entry is already linked to a split expense.");
  } else {
    assert.equal(restore.payload.error, "Its entry is now linked to another split. Delete that split first to restore this one.");
  }
  await assertTotalsFresh(db);
});

test("the database itself holds one active split per ledger row but allows archived and unlinked ones", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const entryId = await createEntry(api, { date: DATE, description: "Index rule", amountMinor: 6_000 });
  const splitExpenseId = await addToSplits(api, entryId);
  const insert = (id, linkedTransactionId, deletedAt = null) => db.prepare(`
    INSERT INTO split_expenses (id, household_id, payer_person_id, expense_date, description, total_amount_minor, linked_transaction_id, deleted_at)
    VALUES (?, 'household-1', 'person-tim', ?, 'Index rule copy', 6000, ?, ?)
  `).bind(id, DATE, linkedTransactionId, deletedAt).run();

  await assert.rejects(insert("index-rule-active", entryId), /UNIQUE constraint failed: split_expenses\.linked_transaction_id/);
  await insert("index-rule-archived", entryId, "2026-05-17 00:00:00");
  await insert("index-rule-unlinked-1", null);
  await insert("index-rule-unlinked-2", null);
  assert.deepEqual(await activeSplitsOf(db, entryId), [{ id: splitExpenseId }]);
  // Settle-ups follow the same rule.
  const [transfer] = await rows(db, "SELECT id FROM transactions WHERE entry_type = 'transfer' LIMIT 1");
  const settle = (id) => db.prepare(`
    INSERT INTO split_settlements (id, household_id, from_person_id, to_person_id, settlement_date, amount_minor, linked_transaction_id)
    VALUES (?, 'household-1', 'person-joyce', 'person-tim', ?, 1000, ?)
  `).bind(id, DATE, transfer.id).run();
  await settle("index-rule-settle-1");
  await assert.rejects(settle("index-rule-settle-2"), /UNIQUE constraint failed: split_settlements\.linked_transaction_id/);
});

test("the runtime schema adds the one-active-split indexes to a database that lacks them", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await db.prepare("DROP INDEX IF EXISTS idx_split_expenses_active_linked_transaction").run();
  await db.prepare("DROP INDEX IF EXISTS idx_split_settlements_active_linked_transaction").run();

  assert.equal((await api("/api/reference-data")).status, 200);

  assert.deepEqual(
    (await rows(db, "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE '%active_linked_transaction' ORDER BY name")).map((row) => row.name),
    ["idx_split_expenses_active_linked_transaction", "idx_split_settlements_active_linked_transaction"]
  );
});

test("a database that already holds two active splits of one entry still loads; the index waits and the checks still refuse a third", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const entryId = await createEntry(api, { date: DATE, description: "Legacy duplicate", amountMinor: 6_000 });
  const splitExpenseId = await addToSplits(api, entryId);
  await db.prepare("DROP INDEX idx_split_expenses_active_linked_transaction").run();
  await db.prepare(`
    INSERT INTO split_expenses (id, household_id, payer_person_id, expense_date, description, total_amount_minor, linked_transaction_id)
    VALUES ('legacy-duplicate', 'household-1', 'person-tim', ?, 'Legacy duplicate', 6000, ?)
  `).bind(DATE, entryId).run();
  // A fresh isolate runs the schema checks again against this database.
  const { default: worker } = await import("../src/index.ts");
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  t.after(() => { console.warn = originalWarn; });
  const freshDb = new Proxy(db, { get: (target, property) => { const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value; } });

  const response = await worker.fetch(new Request("http://127.0.0.1/api/reference-data"), { DB: freshDb, ...template.config.vars });

  assert.equal(response.status, 200);
  assert.deepEqual(await rows(db, "SELECT name FROM sqlite_master WHERE name = 'idx_split_expenses_active_linked_transaction'"), []);
  assert.ok(warnings.some((line) => line.includes("idx_split_expenses_active_linked_transaction")), warnings.join("\n"));
  assert.deepEqual((await activeSplitsOf(db, entryId)).map((row) => row.id).sort(), ["legacy-duplicate", splitExpenseId].sort());
  const refused = await api("/api/splits/expenses/from-entry", { entryId, splitGroupId: null });
  assert.equal(refused.status, 400);
  assert.equal(refused.payload.error, "This entry is already linked to a split expense.");
});
