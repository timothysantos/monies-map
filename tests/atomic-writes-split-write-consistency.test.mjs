// Split write consistency: one ledger entry never gets two active split
// records, even when two writes race; an import rollback keeps a linked
// split on its entry's restored amount; and a split share edit (in Splits or
// through a Shared owner save) refreshes the stored person month totals in
// its own write. Real local D1 (Miniflare) seeded with the demo household.
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
const LOCKED = "split_settlement_locked";

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

// --- 2. Import rollback keeps a linked split on its entry's amount ---------

// A manual 43.21 expense added to splits (50/50), then promoted by a CSV row
// of the same amount, then corrected to 50.00 in Entries (the split follows).
async function promotedLinkedEntry(api, db, { correctedAmountMinor = 5_000 } = {}) {
  const manualEntryId = await createEntry(api, { date: "2026-05-18", description: "FAIRPRICE FINEST", amountMinor: 4_321, note: "weekly shop" });
  const splitExpenseId = await addToSplits(api, manualEntryId);
  const csv = [
    "date,description,amount,account,category,note",
    "2026-05-19,FAIRPRICE FINEST SINGAPORE,-43.21,UOB One,Groceries,"
  ].join("\n");
  const preview = await api("/api/imports/preview", { sourceLabel: "Promotion CSV", sourceType: "csv", csv, ownershipType: "direct", ownerName: "Tim" });
  assert.equal(preview.status, 200, JSON.stringify(preview.payload));
  assert.equal(preview.payload.preview.previewRows[0].reconciliationTargetTransactionId, manualEntryId);
  const commit = await api("/api/imports/commit", { sourceLabel: "Promotion CSV", sourceType: "csv", parserKey: "generic_csv", rows: preview.payload.preview.previewRows });
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  if (correctedAmountMinor !== 4_321) {
    const edit = await api("/api/entries/update", {
      entryId: manualEntryId,
      date: "2026-05-18",
      description: "FAIRPRICE FINEST SINGAPORE",
      accountName: "UOB One",
      categoryName: "Groceries",
      amountMinor: correctedAmountMinor,
      entryType: "expense",
      ownershipType: "direct",
      ownerName: "Tim",
      note: "weekly shop"
    });
    assert.equal(edit.status, 200, JSON.stringify(edit.payload));
  }
  assert.equal((await splitAndShares(db, splitExpenseId)).split.total_amount_minor, correctedAmountMinor);
  return { manualEntryId, splitExpenseId, importId: commit.payload.importId };
}

test("rolling back an import that restores a promoted entry's amount moves its linked split to that amount", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { manualEntryId, splitExpenseId, importId } = await promotedLinkedEntry(api, db);
  assert.deepEqual((await splitAndShares(db, splitExpenseId)).shares.map((share) => share.amount_minor), [2_500, 2_500]);

  const rollback = await api("/api/imports/rollback", { importId });

  assert.equal(rollback.status, 200, JSON.stringify(rollback.payload));
  assert.deepEqual(await rows(db, "SELECT amount_minor, import_id FROM transactions WHERE id = ?", manualEntryId), [{ amount_minor: 4_321, import_id: null }]);
  // Same rule as an entry amount edit: the stored 50/50 basis, floor for the
  // first share person (Tim, the owner), remainder for the second.
  assert.deepEqual(await splitAndShares(db, splitExpenseId), {
    split: { total_amount_minor: 4_321, home_amount_minor: 4_321, linked_transaction_id: manualEntryId, archived: 0 },
    shares: [
      { person_id: "person-joyce", ratio_basis_points: 5_000, amount_minor: 2_161 },
      { person_id: "person-tim", ratio_basis_points: 5_000, amount_minor: 2_160 }
    ]
  });
  const timRow = (await api(`/api/entries-page?view=person-tim&month=${MONTH}`)).payload.monthPage.entries.find((entry) => entry.id === manualEntryId);
  assert.equal(timRow.totalAmountMinor, 4_321);
  assert.equal(timRow.amountMinor, 2_160);
  const activity = (await api(`/api/splits-page?view=person-tim&month=${MONTH}`)).payload.splitsPage.activity.find((item) => item.id === splitExpenseId);
  assert.equal(activity.totalAmountMinor, 4_321);
  await assertTotalsFresh(db);
});

test("a rollback whose promoted entry keeps its amount leaves the linked split alone", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { splitExpenseId, importId } = await promotedLinkedEntry(api, db, { correctedAmountMinor: 4_321 });
  // An explicitly assigned odd cent must survive: a rollback that does not
  // change the amount does not rebalance the shares.
  const shareEdit = await api("/api/splits/expenses/update", {
    splitExpenseId, groupId: null, date: "2026-05-18", description: "FAIRPRICE FINEST", categoryName: "Groceries",
    payerPersonName: "Tim", amountMinor: 4_321, splitAmountMinor: 2_161, homeAmountMinor: 4_321, paymentMethod: "bank", paymentStatus: "certified"
  });
  assert.equal(shareEdit.status, 200, JSON.stringify(shareEdit.payload));
  const before = await splitAndShares(db, splitExpenseId);

  const rollback = await api("/api/imports/rollback", { importId });

  assert.equal(rollback.status, 200, JSON.stringify(rollback.payload));
  assert.deepEqual(await splitAndShares(db, splitExpenseId), before);
});

test("a rollback that would move a split in an active settlement is refused as a whole until the simplification is undone", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { manualEntryId, splitExpenseId, importId } = await promotedLinkedEntry(api, db);
  const checkpoint = await api("/api/splits/checkpoints/create", { viewerPersonId: "person-tim", date: "2026-05-20", currency: "SGD" });
  assert.equal(checkpoint.status, 200, JSON.stringify(checkpoint.payload));
  const before = await dumpDatabase(db);

  const refused = await api("/api/imports/rollback", { importId });

  assert.equal(refused.status, 409, JSON.stringify(refused.payload));
  assert.equal(refused.payload.code, LOCKED);
  assert.equal(refused.payload.checkpointId, checkpoint.payload.checkpointId);
  assert.match(refused.payload.error, /Rolling back this import would change the amount and shares of a split expense in the simplified settlement of 2026-05-20/);
  assert.match(refused.payload.error, /Undo the simplification first/);
  assertSameDatabase(await dumpDatabase(db), before);

  assert.equal((await api("/api/splits/checkpoints/reopen", { checkpointId: checkpoint.payload.checkpointId })).status, 200);
  const rollback = await api("/api/imports/rollback", { importId });
  assert.equal(rollback.status, 200, JSON.stringify(rollback.payload));
  assert.deepEqual(await rows(db, "SELECT amount_minor FROM transactions WHERE id = ?", manualEntryId), [{ amount_minor: 4_321 }]);
  assert.equal((await splitAndShares(db, splitExpenseId)).split.total_amount_minor, 4_321);
});

test("a settled split whose entry keeps its amount does not block the rollback", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { manualEntryId, splitExpenseId, importId } = await promotedLinkedEntry(api, db, { correctedAmountMinor: 4_321 });
  const checkpoint = await api("/api/splits/checkpoints/create", { viewerPersonId: "person-tim", date: "2026-05-20", currency: "SGD" });
  assert.equal(checkpoint.status, 200, JSON.stringify(checkpoint.payload));
  const before = await splitAndShares(db, splitExpenseId);

  const rollback = await api("/api/imports/rollback", { importId });

  assert.equal(rollback.status, 200, JSON.stringify(rollback.payload));
  assert.deepEqual(await rows(db, "SELECT import_id FROM transactions WHERE id = ?", manualEntryId), [{ import_id: null }]);
  assert.deepEqual(await splitAndShares(db, splitExpenseId), before);
});

test("a rollback that fails while moving the linked split's shares changes nothing", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { importId } = await promotedLinkedEntry(api, db);
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /UPDATE split_expense_shares/);

  const rollback = await api("/api/imports/rollback", { importId }, { database: faulty.db });

  assert.equal(faulty.state.fired, true);
  assert.notEqual(rollback.status, 200);
  assertSameDatabase(await dumpDatabase(db), before);
});

// --- 3. Share edits refresh the stored person month totals -----------------

function splitsEdit(splitExpenseId, overrides = {}) {
  return {
    splitExpenseId,
    groupId: null,
    date: DATE,
    description: "Share edit",
    categoryName: "Groceries",
    payerPersonName: "Tim",
    amountMinor: 6_000,
    homeAmountMinor: 6_000,
    paymentMethod: "bank",
    paymentStatus: "certified",
    ...overrides
  };
}

test("a Splits share edit on a linked split moves each person's stored month total in the same write", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const entryId = await createEntry(api, { date: DATE, description: "Share edit", amountMinor: 6_000 });
  const splitExpenseId = await addToSplits(api, entryId);
  const before = await assertTotalsFresh(db);

  // Tim now carries 80% (48.00) instead of half.
  const update = await api("/api/splits/expenses/update", splitsEdit(splitExpenseId, { splitBasisPoints: 8_000 }));

  assert.equal(update.status, 200, JSON.stringify(update.payload));
  const after = await assertTotalsFresh(db);
  assert.equal(scopeTotal(after, "person-tim") - scopeTotal(before, "person-tim"), 1_800);
  assert.equal(scopeTotal(after, "person-joyce") - scopeTotal(before, "person-joyce"), -1_800);
  assert.equal(scopeTotal(after, "household"), scopeTotal(before, "household"));
});

test("a Splits share edit on an unlinked split writes no month refresh and leaves month totals alone", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const created = await api("/api/splits/expenses/create", splitsEdit(undefined, { splitExpenseId: undefined, splitBasisPoints: 5_000, paymentMethod: "cash", paymentStatus: "recorded" }));
  assert.equal(created.status, 200, JSON.stringify(created.payload));
  await recalculateMonthlySnapshots(db, MONTH);
  const before = await snapshotTotals(db, MONTH);
  const markerWrites = failingStatement(db, /INSERT INTO monthly_snapshot_refreshes/);

  const update = await api("/api/splits/expenses/update", splitsEdit(created.payload.splitExpenseId, { splitBasisPoints: 8_000, paymentMethod: "cash", paymentStatus: "recorded" }), { database: markerWrites.db });

  assert.equal(update.status, 200, JSON.stringify(update.payload));
  assert.equal(markerWrites.state.fired, false, "no month refresh for a split no entry counts");
  assert.deepEqual(await snapshotTotals(db, MONTH), before);
});

test("a linked Splits share edit that fails on its month refresh marker changes nothing", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const entryId = await createEntry(api, { date: DATE, description: "Share edit atomic", amountMinor: 6_000 });
  const splitExpenseId = await addToSplits(api, entryId);
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /INSERT INTO monthly_snapshot_refreshes/);

  const update = await api("/api/splits/expenses/update", splitsEdit(splitExpenseId, { splitBasisPoints: 8_000 }), { database: faulty.db });

  assert.equal(faulty.state.fired, true);
  assert.notEqual(update.status, 200);
  assertSameDatabase(await dumpDatabase(db), before);
});

function sharedSave(entryId, overrides = {}) {
  return {
    entryId,
    date: DATE,
    description: "Shared owner save",
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 6_000,
    entryType: "expense",
    ownershipType: "shared",
    splitBasisPoints: 8_000,
    note: "",
    ...overrides
  };
}

test("a Shared owner entry save rewrites the split and the stored month totals in the same write", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const entryId = await createEntry(api, { date: DATE, description: "Shared owner save", amountMinor: 6_000 });
  const splitExpenseId = await addToSplits(api, entryId);
  const before = await assertTotalsFresh(db);

  const update = await api("/api/entries/update", sharedSave(entryId));

  assert.equal(update.status, 200, JSON.stringify(update.payload));
  // The first share person (Tim, the owner) takes the 80% basis.
  assert.deepEqual((await splitAndShares(db, splitExpenseId)).shares.map((share) => [share.person_id, share.amount_minor]), [["person-joyce", 1_200], ["person-tim", 4_800]]);
  const after = await assertTotalsFresh(db);
  assert.equal(scopeTotal(after, "person-tim") - scopeTotal(before, "person-tim"), 1_800);
  assert.equal(scopeTotal(after, "person-joyce") - scopeTotal(before, "person-joyce"), -1_800);
});

test("creating an entry as Shared links its split and stores fresh month totals in the same write", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await recalculateMonthlySnapshots(db, MONTH);
  const before = await snapshotTotals(db, MONTH);

  const created = await api("/api/entries/create", { date: DATE, description: "Shared owner create", accountName: "UOB One", categoryName: "Groceries", amountMinor: 6_000, entryType: "expense", ownershipType: "shared", splitBasisPoints: 5_000 });

  assert.equal(created.status, 200, JSON.stringify(created.payload));
  assert.equal((await activeSplitsOf(db, created.payload.entryId)).length, 1);
  const after = await assertTotalsFresh(db);
  assert.equal(scopeTotal(after, "person-tim") - scopeTotal(before, "person-tim"), 3_000);
  assert.equal(scopeTotal(after, "person-joyce") - scopeTotal(before, "person-joyce"), 3_000);
});

test("a Shared owner save that fails while writing the split's shares saves neither the entry nor the split", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const entryId = await createEntry(api, { date: DATE, description: "Shared owner atomic", amountMinor: 6_000 });
  await addToSplits(api, entryId);
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /INSERT INTO split_expense_shares/);

  const update = await api("/api/entries/update", sharedSave(entryId, { description: "Shared owner atomic renamed", amountMinor: 7_000 }), { database: faulty.db });

  assert.equal(faulty.state.fired, true);
  assert.notEqual(update.status, 200);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("a Shared owner save on a joint account with no payer is refused before anything is written", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const [joint] = await rows(db, "SELECT account_name FROM accounts WHERE owner_person_id IS NULL AND is_joint = 1 LIMIT 1");
  assert.ok(joint, "the demo seed has a joint account");
  const entryId = await createEntry(api, { date: DATE, description: "Joint no payer", amountMinor: 6_000, accountName: joint.account_name, ownerName: undefined });
  const before = await dumpDatabase(db);

  const update = await api("/api/entries/update", sharedSave(entryId, { accountName: joint.account_name, description: "Joint no payer renamed" }));

  assert.equal(update.status, 400, JSON.stringify(update.payload));
  assert.match(update.payload.error, /does not have a clear payer/);
  assertSameDatabase(await dumpDatabase(db), before);
});
