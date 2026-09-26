// Split integrity follow-ups: a travel split keeps its own currency and total
// on a Shared owner save (and the settlement lock compares those facts); a
// match, restore or delete whose check went stale by the time its batch runs
// is refused as a whole; new split record ids cannot collide; and a statement
// rollback that re-links a split keeps it on the re-created entry's amount.
// Real local D1 (Miniflare) seeded with the demo household.
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

const LOCKED = "split_settlement_locked";

// The stored month totals must be what a full recalculation gives.
async function assertTotalsFresh(db, month) {
  const stored = await snapshotTotals(db, month);
  assert.deepEqual(await rows(db, "SELECT month_key FROM monthly_snapshot_refreshes"), []);
  await recalculateMonthlySnapshots(db, month);
  assert.deepEqual(stored, await snapshotTotals(db, month), "stored month totals are stale");
  return stored;
}

async function splitRow(db, splitExpenseId) {
  const [split] = await rows(db, `
    SELECT currency, total_amount_minor, home_amount_minor, fx_rate_basis_points, linked_transaction_id,
      split_group_id, deleted_at IS NOT NULL AS archived
    FROM split_expenses WHERE id = ?
  `, splitExpenseId);
  return split;
}

async function sharesOf(db, splitExpenseId) {
  return rows(db, "SELECT person_id, ratio_basis_points, amount_minor FROM split_expense_shares WHERE split_expense_id = ? ORDER BY person_id", splitExpenseId);
}

// Holds every db.batch() whose statements match `pattern` until `count` of
// them are waiting, then lets them all run, so two requests both finish
// their checks before either commits. D1 still runs the batches one at a
// time, as production does.
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

// Expenses imported by a CSV into Tim's UOB One (Tim owns the account, so a
// Shared owner save keeps him as the payer). `specs` are [date, description,
// amount in minor units]; the descriptions are unique, so nothing is promoted.
async function importedExpenses(api, db, specs, label = "Integrity rows") {
  const csv = [
    "date,description,amount,account,category,note",
    ...specs.map(([date, description, amountMinor]) => `${date},${description},-${(amountMinor / 100).toFixed(2)},UOB One,Groceries,`)
  ].join("\n");
  const preview = await api("/api/imports/preview", { sourceLabel: label, sourceType: "csv", csv, ownershipType: "direct", ownerName: "Tim" });
  assert.equal(preview.status, 200, JSON.stringify(preview.payload));
  const commit = await api("/api/imports/commit", { sourceLabel: label, sourceType: "csv", parserKey: "generic_csv", rows: preview.payload.preview.previewRows });
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  const found = await rows(db, `
    SELECT transactions.id, transactions.transaction_date, transactions.description, transactions.amount_minor,
      transactions.currency, transactions.note, accounts.account_name, categories.name AS category_name
    FROM transactions
    INNER JOIN accounts ON accounts.id = transactions.account_id
    INNER JOIN categories ON categories.id = transactions.category_id
    WHERE transactions.import_id = ?
    ORDER BY transactions.transaction_date, transactions.id
  `, commit.payload.importId);
  assert.equal(found.length, specs.length);
  return found;
}

async function createSplitGroup(api, name, currency) {
  const created = await api("/api/splits/groups/create", { name, currency });
  assert.equal(created.status, 200, JSON.stringify(created.payload));
  return created.payload.groupId;
}

// --- 1. A travel split keeps its own currency and total ---------------------

// A JPY 10,000 card split (awaiting its statement) matched to an SGD card
// row, as a trip expense is recorded in Splits and later found on the bank
// statement. Its date and payer are the entry's, so a Shared owner save that
// keeps the basis changes none of its settlement facts.
async function travelSplit(api, db, { groupId = null } = {}) {
  const [entry] = await importedExpenses(api, db, [["2026-05-14", "INTEGRITY TOKYO DINNER CARD", 9_000]]);
  const created = await api("/api/splits/expenses/create", {
    groupId,
    date: entry.transaction_date,
    description: "Tokyo dinner",
    categoryName: "Food & Drinks",
    payerPersonName: "Tim",
    amountMinor: 10_000,
    currency: "JPY",
    splitBasisPoints: 5_000,
    paymentMethod: "card",
    paymentStatus: "awaiting_statement"
  });
  assert.equal(created.status, 200, JSON.stringify(created.payload));
  const splitExpenseId = created.payload.splitExpenseId;
  const match = await api("/api/splits/matches/link-expense", { splitExpenseId, transactionId: entry.id });
  assert.equal(match.status, 200, JSON.stringify(match.payload));
  const homeAmountMinor = Math.abs(entry.amount_minor);
  assert.deepEqual(await splitRow(db, splitExpenseId), {
    currency: "JPY",
    total_amount_minor: 10_000,
    home_amount_minor: homeAmountMinor,
    fx_rate_basis_points: Math.round((homeAmountMinor * 10_000) / 10_000),
    linked_transaction_id: entry.id,
    split_group_id: groupId,
    archived: 0
  });
  return { entry, splitExpenseId };
}

// The body the entry editor sends for a Shared owner save of `entry`.
function sharedSave(entry, overrides = {}) {
  return {
    entryId: entry.id,
    date: entry.transaction_date,
    description: entry.description,
    accountName: entry.account_name,
    categoryName: entry.category_name,
    amountMinor: Math.abs(entry.amount_minor),
    entryType: "expense",
    ownershipType: "shared",
    splitBasisPoints: 5_000,
    note: entry.note ?? "",
    ...overrides
  };
}

async function simplifyJpy(api, date) {
  const checkpoint = await api("/api/splits/checkpoints/create", { viewerPersonId: "person-tim", date, currency: "JPY" });
  assert.equal(checkpoint.status, 200, JSON.stringify(checkpoint.payload));
  return checkpoint.payload.checkpointId;
}

test("an unchanged Shared owner save of a settled travel split is allowed and keeps the split's currency, total and shares", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const groupId = await createSplitGroup(api, "Tokyo trip", "JPY");
  const { entry, splitExpenseId } = await travelSplit(api, db, { groupId });
  const checkpointId = await simplifyJpy(api, entry.transaction_date);
  const splitBefore = await splitRow(db, splitExpenseId);
  const sharesBefore = await sharesOf(db, splitExpenseId);
  assert.deepEqual(sharesBefore.map((share) => share.amount_minor), [5_000, 5_000]);

  const save = await api("/api/entries/update", sharedSave(entry));

  assert.equal(save.status, 200, JSON.stringify(save.payload));
  assert.deepEqual(await splitRow(db, splitExpenseId), splitBefore);
  assert.deepEqual(await sharesOf(db, splitExpenseId), sharesBefore);
  // The simplification still holds the split.
  assert.deepEqual(await rows(db, "SELECT status FROM split_settlement_checkpoints WHERE id = ?", checkpointId), [{ status: "open" }]);
  await assertTotalsFresh(db, entry.transaction_date.slice(0, 7));
});

test("a Shared owner save that would change a settled travel split's shares is still refused as a whole", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { entry } = await travelSplit(api, db);
  const checkpointId = await simplifyJpy(api, entry.transaction_date);
  const before = await dumpDatabase(db);

  const save = await api("/api/entries/update", sharedSave(entry, { splitBasisPoints: 7_000 }));

  assert.equal(save.status, 409, JSON.stringify(save.payload));
  assert.equal(save.payload.code, LOCKED);
  assert.equal(save.payload.checkpointId, checkpointId);
  assert.match(save.payload.error, /saving would change the split's shares\./);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("after Undo simplification a Shared owner save moves only the travel split's home amount and FX rate; its shares follow the basis in JPY", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { entry, splitExpenseId } = await travelSplit(api, db);
  const checkpointId = await simplifyJpy(api, entry.transaction_date);
  assert.equal((await api("/api/splits/checkpoints/reopen", { checkpointId })).status, 200);
  const newHomeAmountMinor = Math.abs(entry.amount_minor) + 300;

  const save = await api("/api/entries/update", sharedSave(entry, { amountMinor: newHomeAmountMinor, splitBasisPoints: 7_000 }));

  assert.equal(save.status, 200, JSON.stringify(save.payload));
  assert.deepEqual(await rows(db, "SELECT amount_minor FROM transactions WHERE id = ?", entry.id), [{ amount_minor: newHomeAmountMinor }]);
  assert.deepEqual(await splitRow(db, splitExpenseId), {
    currency: "JPY",
    total_amount_minor: 10_000,
    home_amount_minor: newHomeAmountMinor,
    fx_rate_basis_points: Math.round((newHomeAmountMinor * 10_000) / 10_000),
    linked_transaction_id: entry.id,
    split_group_id: null,
    archived: 0
  });
  // 70% of the JPY 10,000 for the first share person (Tim, the owner).
  assert.deepEqual(await sharesOf(db, splitExpenseId), [
    { person_id: "person-joyce", ratio_basis_points: 3_000, amount_minor: 3_000 },
    { person_id: "person-tim", ratio_basis_points: 7_000, amount_minor: 7_000 }
  ]);
  const activity = (await api(`/api/splits-page?view=person-tim&month=${entry.transaction_date.slice(0, 7)}`)).payload.splitsPage.activity.find((item) => item.id === splitExpenseId);
  assert.equal(activity.currency, "JPY");
  assert.equal(activity.totalAmountMinor, 10_000);
  await assertTotalsFresh(db, entry.transaction_date.slice(0, 7));
});

test("a Shared owner save of a travel split in its JPY group is not refused for the group's currency", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const groupId = await createSplitGroup(api, "Osaka trip", "JPY");
  const { entry, splitExpenseId } = await travelSplit(api, db, { groupId });

  const save = await api("/api/entries/update", sharedSave(entry, { splitBasisPoints: 6_000 }));

  assert.equal(save.status, 200, JSON.stringify(save.payload));
  const split = await splitRow(db, splitExpenseId);
  assert.equal(split.currency, "JPY");
  assert.equal(split.total_amount_minor, 10_000);
  assert.equal(split.split_group_id, groupId);
  assert.deepEqual((await sharesOf(db, splitExpenseId)).map((share) => share.amount_minor), [4_000, 6_000]);
});

// --- 3. Matching one split to two entries at once --------------------------

test("one split matched to two different entries at the same time: the second is refused and changes nothing", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const [first, second] = await importedExpenses(api, db, [["2026-05-12", "INTEGRITY DOUBLE MATCH MAY", 4_200], ["2026-06-03", "INTEGRITY DOUBLE MATCH JUNE", 4_200]]);
  const created = await api("/api/splits/expenses/create", {
    groupId: null, date: first.transaction_date, description: "Double match", categoryName: "Groceries",
    payerPersonName: "Tim", amountMinor: Math.abs(first.amount_minor), splitBasisPoints: 5_000, paymentMethod: "bank", paymentStatus: "recorded"
  });
  assert.equal(created.status, 200, JSON.stringify(created.payload));
  const splitExpenseId = created.payload.splitExpenseId;
  const months = [first, second].map((entry) => entry.transaction_date.slice(0, 7));
  for (const month of months) await recalculateMonthlySnapshots(db, month);
  const snapshotRows = (month) => rows(db, "SELECT * FROM monthly_snapshots WHERE year = ? AND month = ? ORDER BY person_scope", Number(month.slice(0, 4)), Number(month.slice(5, 7)));
  const monthsBefore = await Promise.all(months.map(snapshotRows));
  const racing = raceAtBatch(db, /UPDATE split_expenses SET linked_transaction_id/);

  const results = await Promise.all([first, second].map((entry) => (
    api("/api/splits/matches/link-expense", { splitExpenseId, transactionId: entry.id }, { database: racing.db })
  )));

  assert.equal(racing.state.held, 2, "both matches passed their checks before either committed");
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 400], JSON.stringify(results.map((result) => result.payload)));
  const loserIndex = results.findIndex((result) => result.status !== 200);
  assert.equal(results[loserIndex].payload.error, "This split expense is unavailable or already linked.");
  const winner = loserIndex === 0 ? second : first;
  assert.equal((await splitRow(db, splitExpenseId)).linked_transaction_id, winner.id);
  // The refused match wrote no month refresh for its entry's month.
  assert.deepEqual(await rows(db, "SELECT month_key FROM monthly_snapshot_refreshes"), []);
  assert.deepEqual(await snapshotRows(months[loserIndex]), monthsBefore[loserIndex]);
  await assertTotalsFresh(db, months[1 - loserIndex]);
});

test("one settle-up matched to two different transfers at the same time: the second is refused", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  // Two imported rows reclassified as incoming transfers.
  const transfers = await importedExpenses(api, db, [["2026-05-12", "INTEGRITY PAYNOW ONE", 4_580], ["2026-05-13", "INTEGRITY PAYNOW TWO", 4_580]]);
  for (const transfer of transfers) {
    const reclassify = await api("/api/entries/update", {
      entryId: transfer.id, date: transfer.transaction_date, description: transfer.description, accountName: transfer.account_name,
      categoryName: "Transfer", amountMinor: transfer.amount_minor, entryType: "transfer", transferDirection: "in",
      ownershipType: "direct", ownerName: "Tim", note: ""
    });
    assert.equal(reclassify.status, 200, JSON.stringify(reclassify.payload));
  }
  const created = await api("/api/splits/settlements/create", {
    groupId: null, date: transfers[0].transaction_date, fromPersonName: "Joyce", toPersonName: "Tim",
    amountMinor: Math.abs(transfers[0].amount_minor), paymentMethod: "bank", paymentStatus: "recorded"
  });
  assert.equal(created.status, 200, JSON.stringify(created.payload));
  const settlementId = created.payload.settlementId;
  const racing = raceAtBatch(db, /UPDATE split_settlements SET linked_transaction_id/);

  const results = await Promise.all(transfers.map((transfer) => (
    api("/api/splits/matches/link-settlement", { settlementId, transactionId: transfer.id }, { database: racing.db })
  )));

  assert.equal(racing.state.held, 2);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 400], JSON.stringify(results.map((result) => result.payload)));
  const loserIndex = results.findIndex((result) => result.status !== 200);
  assert.equal(results[loserIndex].payload.error, "This settle-up is unavailable or already linked.");
  assert.deepEqual(await rows(db, "SELECT linked_transaction_id FROM split_settlements WHERE id = ?", settlementId), [{ linked_transaction_id: transfers[1 - loserIndex].id }]);
});

test("matching a split that is already linked is refused and changes nothing", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const [first, second] = await importedExpenses(api, db, [["2026-05-12", "INTEGRITY SECOND MATCH ONE", 4_200], ["2026-05-13", "INTEGRITY SECOND MATCH TWO", 4_200]]);
  const created = await api("/api/splits/expenses/create", {
    groupId: null, date: first.transaction_date, description: "Second match", categoryName: "Groceries",
    payerPersonName: "Tim", amountMinor: Math.abs(first.amount_minor), splitBasisPoints: 5_000, paymentMethod: "bank", paymentStatus: "recorded"
  });
  const splitExpenseId = created.payload.splitExpenseId;
  assert.equal((await api("/api/splits/matches/link-expense", { splitExpenseId, transactionId: first.id })).status, 200);
  const before = await dumpDatabase(db);

  const refused = await api("/api/splits/matches/link-expense", { splitExpenseId, transactionId: second.id });

  assert.equal(refused.status, 400);
  assert.equal(refused.payload.error, "This split expense is unavailable or already linked.");
  assertSameDatabase(await dumpDatabase(db), before);
});

// --- 4. Restore and delete record history once -----------------------------

async function archivedLinkedSplit(api) {
  const entryId = await createEntry(api, { date: "2026-05-16", description: "Restore once", amountMinor: 6_000 });
  const split = await api("/api/splits/expenses/from-entry", { entryId, splitGroupId: null });
  assert.equal(split.status, 200, JSON.stringify(split.payload));
  const splitExpenseId = split.payload.splitExpenseId;
  assert.equal((await api("/api/splits/expenses/delete", { splitExpenseId })).status, 200);
  return { entryId, splitExpenseId };
}

test("two restores of the same split at the same time bring it back once and record one restore", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { entryId, splitExpenseId } = await archivedLinkedSplit(api);
  const racing = raceAtBatch(db, /SET deleted_at = NULL/);

  const results = await Promise.all([1, 2].map(() => (
    api("/api/splits/activity-history/restore", { recordKind: "expense", recordId: splitExpenseId }, { database: racing.db })
  )));

  assert.equal(racing.state.held, 2, "both restores passed their checks before either committed");
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 400], JSON.stringify(results.map((result) => result.payload)));
  assert.equal(results.find((result) => result.status !== 200).payload.error, "This split is already active.");
  assert.deepEqual(await rows(db, "SELECT action FROM split_activity_history WHERE record_id = ? ORDER BY rowid", splitExpenseId), [{ action: "deleted" }, { action: "restored" }]);
  assert.deepEqual(await rows(db, "SELECT id FROM split_expenses WHERE linked_transaction_id = ? AND deleted_at IS NULL", entryId), [{ id: splitExpenseId }]);
  await assertTotalsFresh(db, "2026-05");
});

test("two deletes of the same split at the same time archive it once and record one delete", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const entryId = await createEntry(api, { date: "2026-05-16", description: "Delete once", amountMinor: 6_000 });
  const splitExpenseId = (await api("/api/splits/expenses/from-entry", { entryId, splitGroupId: null })).payload.splitExpenseId;
  const racing = raceAtBatch(db, /SET deleted_at = CURRENT_TIMESTAMP/);

  const results = await Promise.all([1, 2].map(() => (
    api("/api/splits/expenses/delete", { splitExpenseId }, { database: racing.db })
  )));

  assert.equal(racing.state.held, 2);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 400], JSON.stringify(results.map((result) => result.payload)));
  assert.equal(results.find((result) => result.status !== 200).payload.error, "This split is already in activity history.");
  assert.deepEqual(await rows(db, "SELECT action FROM split_activity_history WHERE record_id = ?", splitExpenseId), [{ action: "deleted" }]);
});

test("restoring a split that is already active is refused and changes nothing", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { splitExpenseId } = await archivedLinkedSplit(api);
  assert.equal((await api("/api/splits/activity-history/restore", { recordKind: "expense", recordId: splitExpenseId })).status, 200);
  const before = await dumpDatabase(db);

  const refused = await api("/api/splits/activity-history/restore", { recordKind: "expense", recordId: splitExpenseId });

  assert.equal(refused.status, 400);
  assert.equal(refused.payload.error, "This split is already active.");
  assertSameDatabase(await dumpDatabase(db), before);
});

test("a restore that fails for another reason is not reported as already active and changes nothing", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { splitExpenseId } = await archivedLinkedSplit(api);
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /INSERT INTO split_activity_history/);

  const restore = await api("/api/splits/activity-history/restore", { recordKind: "expense", recordId: splitExpenseId }, { database: faulty.db });

  assert.equal(faulty.state.fired, true);
  assert.notEqual(restore.status, 200);
  assert.notEqual(restore.payload.error, "This split is already active.");
  assertSameDatabase(await dumpDatabase(db), before);
});

// --- 5. New split record ids cannot collide ---------------------------------

// Runs `work` with the clock stopped, so every id built from Date.now() in it
// shares one millisecond, as two requests can in production.
async function inOneMillisecond(t, work) {
  const realNow = Date.now;
  const frozen = realNow();
  Date.now = () => frozen;
  t.after(() => { Date.now = realNow; });
  try {
    return await work();
  } finally {
    Date.now = realNow;
  }
}

test("split records created in the same millisecond get distinct ids", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const firstEntry = await createEntry(api, { date: "2026-05-16", description: "Same ms one", amountMinor: 6_000 });
  const secondEntry = await createEntry(api, { date: "2026-05-16", description: "Same ms two", amountMinor: 4_000 });
  const expense = (description) => ({
    groupId: null, date: "2026-05-16", description, categoryName: "Groceries", payerPersonName: "Tim",
    amountMinor: 2_000, splitBasisPoints: 5_000, paymentMethod: "cash", paymentStatus: "recorded"
  });
  const settle = { groupId: null, date: "2026-05-16", fromPersonName: "Joyce", toPersonName: "Tim", amountMinor: 500, paymentMethod: "cash", paymentStatus: "recorded" };

  const results = await inOneMillisecond(t, async () => [
    await api("/api/splits/expenses/from-entry", { entryId: firstEntry, splitGroupId: null }),
    await api("/api/splits/expenses/from-entry", { entryId: secondEntry, splitGroupId: null }),
    await api("/api/splits/expenses/create", expense("Same ms cash one")),
    await api("/api/splits/expenses/create", expense("Same ms cash two")),
    await api("/api/splits/settlements/create", settle),
    await api("/api/splits/settlements/create", settle),
    await api("/api/splits/groups/create", { name: "Same ms group", currency: "SGD" }),
    await api("/api/splits/groups/create", { name: "Same ms group", currency: "SGD" })
  ]);

  assert.deepEqual(results.map((result) => result.status), [200, 200, 200, 200, 200, 200, 200, 200], JSON.stringify(results.map((result) => result.payload)));
  const expenseIds = results.slice(0, 4).map((result) => result.payload.splitExpenseId);
  const settlementIds = results.slice(4, 6).map((result) => result.payload.settlementId);
  const groupIds = results.slice(6).map((result) => result.payload.groupId);
  for (const ids of [expenseIds, settlementIds, groupIds]) assert.equal(new Set(ids).size, ids.length, ids.join(", "));
  for (const id of expenseIds) assert.match(id, /^split-expense-\d{13}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  for (const id of settlementIds) assert.match(id, /^split-settlement-\d{13}-[0-9a-f-]{36}$/);
  // Each split keeps its own two shares.
  for (const id of expenseIds) assert.equal((await sharesOf(db, id)).length, 2);
  assert.deepEqual((await rows(db, "SELECT linked_transaction_id FROM split_expenses WHERE id IN (?, ?) ORDER BY linked_transaction_id", expenseIds[0], expenseIds[1])).map((row) => row.linked_transaction_id), [firstEntry, secondEntry].sort());
});

test("two Shared owner creates and two simplifications in the same millisecond get distinct ids", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const shared = (description) => ({ date: "2026-05-16", description, accountName: "UOB One", categoryName: "Groceries", amountMinor: 6_000, entryType: "expense", ownershipType: "shared", splitBasisPoints: 5_000 });
  const cash = { groupId: null, date: "2026-05-16", description: "Checkpoint cash", categoryName: "Groceries", payerPersonName: "Tim", amountMinor: 2_000, splitBasisPoints: 5_000, currency: "JPY", paymentMethod: "cash", paymentStatus: "recorded" };
  assert.equal((await api("/api/splits/expenses/create", cash)).status, 200);

  const results = await inOneMillisecond(t, async () => [
    await api("/api/entries/create", shared("Same ms shared one")),
    await api("/api/entries/create", shared("Same ms shared two")),
    await api("/api/splits/checkpoints/create", { viewerPersonId: "person-tim", date: "2026-05-16", currency: "SGD" }),
    await api("/api/splits/checkpoints/create", { viewerPersonId: "person-tim", date: "2026-05-16", currency: "JPY" })
  ]);

  assert.deepEqual(results.map((result) => result.status), [200, 200, 200, 200], JSON.stringify(results.map((result) => result.payload)));
  const splitIds = await rows(db, "SELECT id FROM split_expenses WHERE linked_transaction_id IN (?, ?)", results[0].payload.entryId, results[1].payload.entryId);
  assert.equal(new Set(splitIds.map((row) => row.id)).size, 2);
  assert.notEqual(results[2].payload.checkpointId, results[3].payload.checkpointId);
});

test("existing split ids stay valid: a seeded split and an old epoch id can still be edited, deleted and restored", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const legacyId = "split-expense-1790296211654";
  const entryId = await createEntry(api, { date: "2026-05-16", description: "Legacy id", amountMinor: 6_000 });
  const created = (await api("/api/splits/expenses/from-entry", { entryId, splitGroupId: null })).payload.splitExpenseId;
  // Rename the new split to an id of the old shape, shares included.
  await db.batch([
    db.prepare("PRAGMA defer_foreign_keys = ON"),
    db.prepare("UPDATE split_expenses SET id = ? WHERE id = ?").bind(legacyId, created),
    db.prepare("UPDATE split_expense_shares SET split_expense_id = ?, id = replace(id, ?, ?) WHERE split_expense_id = ?").bind(legacyId, created, legacyId, created)
  ]);

  for (const splitExpenseId of [legacyId, "split-expense-nongroup-groceries"]) {
    assert.equal((await api("/api/splits/expenses/delete", { splitExpenseId })).status, 200, splitExpenseId);
    const restore = await api("/api/splits/activity-history/restore", { recordKind: "expense", recordId: splitExpenseId });
    assert.equal(restore.status, 200, JSON.stringify(restore.payload));
    assert.equal((await splitRow(db, splitExpenseId)).archived, 0);
  }
  const edit = await api("/api/entries/update", {
    entryId, date: "2026-05-16", description: "Legacy id", accountName: "UOB One", categoryName: "Groceries",
    amountMinor: 8_000, entryType: "expense", ownershipType: "direct", ownerName: "Tim", note: ""
  });
  assert.equal(edit.status, 200, JSON.stringify(edit.payload));
  assert.equal((await splitRow(db, legacyId)).total_amount_minor, 8_000);
  assert.deepEqual((await sharesOf(db, legacyId)).map((share) => share.amount_minor), [4_000, 4_000]);
});

// --- 6. A statement rollback keeps a re-linked split on its entry ----------

async function createCardAccount(api) {
  const created = await api("/api/accounts/create", {
    name: "Integrity Card", institution: "Synthetic Test Bank", kind: "credit_card",
    openingBalanceMinor: 0, currency: "SGD", ownerPersonId: "", isJoint: false
  });
  assert.equal(created.status, 200, JSON.stringify(created.payload));
  return created.payload.accountId;
}

// A CSV of two card rows; the 43.21 row is added to splits (50/50). A PDF
// statement that leaves both rows out supersedes (deletes) them, which
// unlinks the split.
async function supersededLinkedEntry(api, db) {
  const accountId = await createCardAccount(api);
  const csv = [
    "date,description,amount,account,category,note",
    "2026-05-19,FAIRPRICE FINEST SINGAPORE,-43.21,Integrity Card,Groceries,",
    "2026-05-20,INTEGRITY SECOND ROW,-9.99,Integrity Card,Groceries,"
  ].join("\n");
  const preview = await api("/api/imports/preview", { sourceLabel: "Integrity CSV", sourceType: "csv", csv, ownershipType: "direct", ownerName: "Tim" });
  assert.equal(preview.status, 200, JSON.stringify(preview.payload));
  const commit = await api("/api/imports/commit", { sourceLabel: "Integrity CSV", sourceType: "csv", parserKey: "generic_csv", rows: preview.payload.preview.previewRows });
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  const [entry] = await rows(db, "SELECT id FROM transactions WHERE import_id = ? AND amount_minor = 4321", commit.payload.importId);
  const split = await api("/api/splits/expenses/from-entry", { entryId: entry.id, splitGroupId: null });
  assert.equal(split.status, 200, JSON.stringify(split.payload));
  const splitExpenseId = split.payload.splitExpenseId;

  const statementCheckpoints = [{
    accountId, accountName: "Integrity Card", detectedAccountName: "Integrity Card", checkpointMonth: "2026-06",
    statementStartDate: "2026-05-13", statementEndDate: "2026-06-12", statementBalanceMinor: 500, note: "Integrity checkpoint"
  }];
  const statementPreview = await api("/api/imports/preview", {
    sourceLabel: "Integrity statement", sourceType: "pdf",
    rows: [{ date: "2026-05-25", description: "STATEMENT ONLY ROW", expense: "5.00", accountId, account: "Integrity Card", category: "Groceries" }],
    defaultAccountName: "Integrity Card", ownershipType: "direct", ownerName: "Tim", statementCheckpoints
  });
  assert.equal(statementPreview.status, 200, JSON.stringify(statementPreview.payload));
  const reconciliations = statementPreview.payload.preview.statementReconciliations;
  const supersededIds = reconciliations.flatMap((reconciliation) => reconciliation.supersededLedgerRows ?? []).map((row) => row.transactionId);
  assert.ok(supersededIds.includes(entry.id), "the statement supersedes the linked entry");
  const previewRows = statementPreview.payload.preview.previewRows;
  const statementCommit = await api("/api/imports/commit", {
    sourceLabel: "Integrity statement", sourceType: "pdf", parserKey: "uob_credit_card_pdf",
    rows: previewRows.filter((row) => row.commitStatus === "included"),
    statementCheckpoints, statementControlRows: previewRows, statementReconciliations: reconciliations
  });
  assert.equal(statementCommit.status, 200, JSON.stringify(statementCommit.payload));
  assert.deepEqual(await rows(db, "SELECT id FROM transactions WHERE id = ?", entry.id), []);
  assert.equal((await splitRow(db, splitExpenseId)).linked_transaction_id, null);
  return { entryId: entry.id, splitExpenseId, statementImportId: statementCommit.payload.importId };
}

// A Splits edit of the (now unlinked) split.
function splitEdit(splitExpenseId, overrides = {}) {
  return {
    splitExpenseId, groupId: null, date: "2026-05-19", description: "FAIRPRICE FINEST SINGAPORE", categoryName: "Groceries",
    payerPersonName: "Tim", amountMinor: 5_000, splitBasisPoints: 5_000, paymentMethod: "card", paymentStatus: "certified",
    ...overrides
  };
}

test("rolling back a statement re-links its superseded entry's split on the re-created entry's amount", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { entryId, splitExpenseId, statementImportId } = await supersededLinkedEntry(api, db);
  const edit = await api("/api/splits/expenses/update", splitEdit(splitExpenseId));
  assert.equal(edit.status, 200, JSON.stringify(edit.payload));
  assert.equal((await splitRow(db, splitExpenseId)).total_amount_minor, 5_000);

  const rollback = await api("/api/imports/rollback", { importId: statementImportId });

  assert.equal(rollback.status, 200, JSON.stringify(rollback.payload));
  assert.deepEqual(await rows(db, "SELECT amount_minor FROM transactions WHERE id = ?", entryId), [{ amount_minor: 4_321 }]);
  // Same rule as an entry amount edit: the stored 50/50 basis, floor for the
  // first share person (Tim, the owner), remainder for the second.
  const split = await splitRow(db, splitExpenseId);
  assert.equal(split.linked_transaction_id, entryId);
  assert.equal(split.total_amount_minor, 4_321);
  assert.equal(split.home_amount_minor, 4_321);
  assert.deepEqual(await sharesOf(db, splitExpenseId), [
    { person_id: "person-joyce", ratio_basis_points: 5_000, amount_minor: 2_161 },
    { person_id: "person-tim", ratio_basis_points: 5_000, amount_minor: 2_160 }
  ]);
  const timRow = (await api("/api/entries-page?view=person-tim&month=2026-05")).payload.monthPage.entries.find((entry) => entry.id === entryId);
  assert.equal(timRow.totalAmountMinor, 4_321);
  assert.equal(timRow.amountMinor, 2_160);
  await assertTotalsFresh(db, "2026-05");
});

test("a statement rollback whose re-linked split already matches the entry leaves its shares alone", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { splitExpenseId, statementImportId } = await supersededLinkedEntry(api, db);
  // An explicitly assigned odd cent must survive the re-link.
  const edit = await api("/api/splits/expenses/update", splitEdit(splitExpenseId, { amountMinor: 4_321, splitAmountMinor: 2_161 }));
  assert.equal(edit.status, 200, JSON.stringify(edit.payload));
  const sharesBefore = await sharesOf(db, splitExpenseId);

  const rollback = await api("/api/imports/rollback", { importId: statementImportId });

  assert.equal(rollback.status, 200, JSON.stringify(rollback.payload));
  assert.deepEqual(await sharesOf(db, splitExpenseId), sharesBefore);
  assert.equal((await splitRow(db, splitExpenseId)).total_amount_minor, 4_321);
});

test("a statement rollback that would move a settled re-linked split is refused as a whole until the simplification is undone", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { entryId, splitExpenseId, statementImportId } = await supersededLinkedEntry(api, db);
  assert.equal((await api("/api/splits/expenses/update", splitEdit(splitExpenseId))).status, 200);
  const checkpoint = await api("/api/splits/checkpoints/create", { viewerPersonId: "person-tim", date: "2026-05-26", currency: "SGD" });
  assert.equal(checkpoint.status, 200, JSON.stringify(checkpoint.payload));
  const before = await dumpDatabase(db);

  const refused = await api("/api/imports/rollback", { importId: statementImportId });

  assert.equal(refused.status, 409, JSON.stringify(refused.payload));
  assert.equal(refused.payload.code, LOCKED);
  assert.equal(refused.payload.checkpointId, checkpoint.payload.checkpointId);
  assert.match(refused.payload.error, /Rolling back this import would change the amount and shares of a split expense in the simplified settlement of 2026-05-26/);
  assertSameDatabase(await dumpDatabase(db), before);

  assert.equal((await api("/api/splits/checkpoints/reopen", { checkpointId: checkpoint.payload.checkpointId })).status, 200);
  const rollback = await api("/api/imports/rollback", { importId: statementImportId });
  assert.equal(rollback.status, 200, JSON.stringify(rollback.payload));
  const split = await splitRow(db, splitExpenseId);
  assert.equal(split.linked_transaction_id, entryId);
  assert.equal(split.total_amount_minor, 4_321);
});

test("a statement rollback does not take a split that was matched to another entry since", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { entryId, splitExpenseId, statementImportId } = await supersededLinkedEntry(api, db);
  const [other] = await importedExpenses(api, db, [["2026-05-21", "INTEGRITY OTHER MATCH", 5_000]]);
  const match = await api("/api/splits/matches/link-expense", { splitExpenseId, transactionId: other.id });
  assert.equal(match.status, 200, JSON.stringify(match.payload));
  const splitBefore = await splitRow(db, splitExpenseId);
  const sharesBefore = await sharesOf(db, splitExpenseId);

  const rollback = await api("/api/imports/rollback", { importId: statementImportId });

  assert.equal(rollback.status, 200, JSON.stringify(rollback.payload));
  // The entry comes back without a split; the split stays with the entry
  // the person matched it to.
  assert.deepEqual(await rows(db, "SELECT amount_minor FROM transactions WHERE id = ?", entryId), [{ amount_minor: 4_321 }]);
  assert.deepEqual(await splitRow(db, splitExpenseId), splitBefore);
  assert.deepEqual(await sharesOf(db, splitExpenseId), sharesBefore);
  assert.equal(splitBefore.linked_transaction_id, other.id);
});

test("a statement rollback that fails while moving the re-linked split's shares changes nothing", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { splitExpenseId, statementImportId } = await supersededLinkedEntry(api, db);
  assert.equal((await api("/api/splits/expenses/update", splitEdit(splitExpenseId))).status, 200);
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /UPDATE split_expense_shares/);

  const rollback = await api("/api/imports/rollback", { importId: statementImportId }, { database: faulty.db });

  assert.equal(faulty.state.fired, true);
  assert.notEqual(rollback.status, 200);
  assertSameDatabase(await dumpDatabase(db), before);
});
