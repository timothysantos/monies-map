// Rolling back a current-activity import that promoted a manual entry puts
// that entry back as a Manual provisional entry, as it was before the
// promotion. Real local D1 (Miniflare) seeded with the demo household.
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
  snapshotTotals
} from "./support/d1-workspace.mjs";
import { recalculateMonthlySnapshots } from "../src/domain/app-repository-snapshots.ts";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

// Every stored column of an entry except updated_at, which a restore sets
// to the time of the rollback.
const ENTRY_COLUMNS = `
  id, household_id, import_id, import_row_id, account_id, transfer_group_id,
  transaction_date, post_date, description, amount_minor, currency, entry_type,
  transfer_direction, category_id, owner_person_id, offsets_category, note,
  bank_certification_status, statement_certified_import_id,
  statement_certified_import_row_id, statement_certified_at,
  statement_certified_previous_import_id, statement_certified_previous_import_row_id,
  statement_certified_previous_transaction_date, statement_certified_previous_post_date,
  statement_certified_previous_description, statement_certified_previous_amount_minor,
  statement_certified_previous_entry_type, statement_certified_previous_transfer_direction,
  created_at
`;

function entryRow(db, entryId) {
  return rows(db, `SELECT ${ENTRY_COLUMNS} FROM transactions WHERE id = ?`, entryId);
}

// A manual expense and a CSV whose first row promotes it (same account and
// amount, one day later, similar description) and whose second row is new.
async function prepareManualPromotion(api, { accountName = "UOB One", accountId, categoryName = "Groceries" } = {}) {
  const manualEntryId = await createEntry(api, {
    date: "2026-05-18",
    description: "FAIRPRICE FINEST",
    amountMinor: 4321,
    note: "weekly shop",
    accountName,
    ...(accountId ? { accountId } : {}),
    categoryName
  });
  const csv = [
    "date,description,amount,account,category,note",
    `2026-05-19,FAIRPRICE FINEST SINGAPORE,-43.21,${accountName},${categoryName},`,
    `2026-05-20,PROMOTION TEST NEW ROW,-9.99,${accountName},${categoryName},`
  ].join("\n");
  const { status, payload } = await api("/api/imports/preview", {
    sourceLabel: "Promotion CSV",
    sourceType: "csv",
    csv,
    ownershipType: "direct",
    ownerName: "Tim"
  });
  assert.equal(status, 200, JSON.stringify(payload));
  const previewRows = payload.preview.previewRows;
  assert.equal(previewRows[0].reconciliationTargetTransactionId, manualEntryId, "the first CSV row promotes the manual entry");
  assert.equal(previewRows[1].reconciliationTargetTransactionId, undefined);
  return {
    manualEntryId,
    commitBody: { sourceLabel: "Promotion CSV", sourceType: "csv", parserKey: "generic_csv", rows: previewRows }
  };
}

async function commitPromotion(api, db, options) {
  const { manualEntryId, commitBody } = await prepareManualPromotion(api, options);
  const manualBefore = await entryRow(db, manualEntryId);
  const commit = await api("/api/imports/commit", commitBody);
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  const importId = commit.payload.importId;
  // The promotion itself is unchanged: the entry now carries the bank facts.
  assert.deepEqual(await rows(db, "SELECT import_id, post_date, description, amount_minor FROM transactions WHERE id = ?", manualEntryId), [
    { import_id: importId, post_date: "2026-05-19", description: "FAIRPRICE FINEST SINGAPORE", amount_minor: 4321 }
  ]);
  return { manualEntryId, manualBefore, importId };
}

test("rolling back a CSV import puts the promoted manual entry back exactly as it was", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await recalculateMonthlySnapshots(db, "2026-05");
  const { manualEntryId, commitBody } = await prepareManualPromotion(api);
  const manualBefore = await entryRow(db, manualEntryId);
  assert.equal(manualBefore[0].import_id, null);
  assert.equal(manualBefore[0].post_date, null);
  const [{ updated_at: updatedAtBefore }] = await rows(db, "SELECT updated_at FROM transactions WHERE id = ?", manualEntryId);
  const totalsBefore = await snapshotTotals(db, "2026-05");

  const commit = await api("/api/imports/commit", commitBody);
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  const importId = commit.payload.importId;
  assert.equal((await rows(db, "SELECT id FROM transactions WHERE import_id = ?", importId)).length, 2);
  // The promoting import row keeps the manual entry's pre-promotion bank
  // facts; the row that created a new entry has none.
  const importRows = await rows(db, "SELECT row_index, promoted_entry_snapshot_json FROM import_rows WHERE import_id = ? ORDER BY row_index", importId);
  assert.deepEqual(importRows.map((row) => row.row_index), [1, 2]);
  assert.deepEqual(JSON.parse(importRows[0].promoted_entry_snapshot_json), {
    transaction: {
      id: manualEntryId,
      import_id: null,
      import_row_id: null,
      post_date: null,
      description: "FAIRPRICE FINEST",
      amount_minor: 4321,
      entry_type: "expense",
      transfer_direction: null,
      updated_at: updatedAtBefore
    }
  });
  assert.equal(importRows[1].promoted_entry_snapshot_json, null);

  const rollback = await api("/api/imports/rollback", { importId });

  assert.equal(rollback.status, 200, JSON.stringify(rollback.payload));
  assert.deepEqual(await entryRow(db, manualEntryId), manualBefore);
  assert.deepEqual(await rows(db, "SELECT id FROM transactions WHERE import_id = ?", importId), []);
  assert.deepEqual(await rows(db, "SELECT id FROM transactions WHERE description = 'PROMOTION TEST NEW ROW'"), []);
  assert.deepEqual(await rows(db, "SELECT id FROM import_rows WHERE import_id = ?", importId), []);
  assert.deepEqual(await rows(db, "SELECT status FROM imports WHERE id = ?", importId), [{ status: "rolled_back" }]);
  assert.deepEqual(await snapshotTotals(db, "2026-05"), totalsBefore);
  assert.deepEqual(await rows(db, "SELECT month_key FROM monthly_snapshot_refreshes"), []);

  // The Entries page shows it as a manual entry again.
  const entriesPage = await api("/api/entries-page?view=household&month=2026-05&scope=direct_plus_shared");
  assert.equal(entriesPage.status, 200);
  const entry = findEntry(entriesPage.payload, manualEntryId);
  assert.equal(entry?.description, "FAIRPRICE FINEST");
  assert.equal(entry?.amountMinor, 4321);
  assert.equal(entry?.bankCertificationStatus, "manual_provisional");
});

function findEntry(payload, entryId) {
  const found = [];
  const visit = (value) => {
    if (!value || typeof value !== "object") {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value.id === entryId && "description" in value) {
      found.push(value);
      return;
    }
    Object.values(value).forEach(visit);
  };
  visit(payload);
  return found[0];
}

test("a rollback keeps annotations made after the promotion and restores the bank facts", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { manualEntryId, manualBefore, importId } = await commitPromotion(api, db);

  const note = await api("/api/entries/update-note", { entryId: manualEntryId, note: "edited after import" });
  assert.equal(note.status, 200, JSON.stringify(note.payload));
  const category = await api("/api/entries/update-category", { entryId: manualEntryId, categoryName: "Food & Drinks" });
  assert.equal(category.status, 200, JSON.stringify(category.payload));
  const split = await api("/api/splits/expenses/from-entry", { entryId: manualEntryId });
  assert.equal(split.status, 200, JSON.stringify(split.payload));
  const annotated = await entryRow(db, manualEntryId);
  const splitLinks = await rows(db, "SELECT id FROM split_expenses WHERE linked_transaction_id = ?", manualEntryId);
  assert.equal(splitLinks.length, 1);

  const rollback = await api("/api/imports/rollback", { importId });

  assert.equal(rollback.status, 200, JSON.stringify(rollback.payload));
  const [restored] = await entryRow(db, manualEntryId);
  assert.deepEqual(restored, {
    ...manualBefore[0],
    category_id: annotated[0].category_id,
    note: "edited after import"
  });
  assert.notEqual(restored.category_id, manualBefore[0].category_id);
  assert.deepEqual(await rows(db, "SELECT id FROM split_expenses WHERE linked_transaction_id = ?", manualEntryId), splitLinks);
});

test("a rollback after the user deleted the promoted entry succeeds and restores nothing", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await recalculateMonthlySnapshots(db, "2026-05");
  const { manualEntryId, importId } = await commitPromotion(api, db);
  const deleted = await api("/api/entries/delete", { entryId: manualEntryId });
  assert.equal(deleted.status, 200, JSON.stringify(deleted.payload));

  const rollback = await api("/api/imports/rollback", { importId });

  assert.equal(rollback.status, 200, JSON.stringify(rollback.payload));
  assert.deepEqual(await entryRow(db, manualEntryId), []);
  assert.deepEqual(await rows(db, "SELECT id FROM transactions WHERE import_id = ?", importId), []);
  assert.deepEqual(await rows(db, "SELECT status FROM imports WHERE id = ?", importId), [{ status: "rolled_back" }]);
  assert.deepEqual(await rows(db, "SELECT month_key FROM monthly_snapshot_refreshes"), []);
});

test("rolling back a promoting import twice is rejected and changes nothing", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { manualEntryId, manualBefore, importId } = await commitPromotion(api, db);
  await api("/api/imports/rollback", { importId });
  assert.deepEqual(await entryRow(db, manualEntryId), manualBefore);
  const afterFirstRollback = await dumpDatabase(db);

  const { status, payload } = await api("/api/imports/rollback", { importId });

  assert.equal(status, 409);
  assert.match(payload.error, /already been rolled back/);
  assertSameDatabase(await dumpDatabase(db), afterFirstRollback);
});

test("a rollback that fails partway leaves the promoted entry and the import untouched", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { importId } = await commitPromotion(api, db);
  const before = await dumpDatabase(db);
  // The last write of the rollback's batch, after the restore and the
  // deletes have run inside it.
  const faulty = failingStatement(db, /UPDATE imports SET status = 'rolled_back'/);

  const { status } = await api("/api/imports/rollback", { importId }, { database: faulty.db });

  assert.equal(faulty.state.fired, true);
  assert.equal(status, 500);
  assertSameDatabase(await dumpDatabase(db), before);

  const retry = await api("/api/imports/rollback", { importId });
  assert.equal(retry.status, 200, JSON.stringify(retry.payload));
});

test("a promoting commit that fails leaves the manual entry and no promotion snapshot", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { commitBody } = await prepareManualPromotion(api);
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /UPDATE imports\s+SET status = 'completed'/);

  const { status } = await api("/api/imports/commit", commitBody, { database: faulty.db });

  assert.equal(faulty.state.fired, true);
  assert.equal(status, 400);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("an import committed before promotion snapshots existed keeps the promoted entry as a manual entry", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { manualEntryId, manualBefore, importId } = await commitPromotion(api, db);
  // A legacy import: no snapshot, and the entry predates the import.
  await db.prepare("UPDATE import_rows SET promoted_entry_snapshot_json = NULL WHERE import_id = ?").bind(importId).run();
  await db.prepare("UPDATE transactions SET created_at = '2026-01-01 00:00:00' WHERE id = ?").bind(manualEntryId).run();

  const rollback = await api("/api/imports/rollback", { importId });

  assert.equal(rollback.status, 200, JSON.stringify(rollback.payload));
  // Best effort: the original description and posted date are unknown, so
  // the entry keeps the imported bank facts but is manual again.
  assert.deepEqual(await entryRow(db, manualEntryId), [{
    ...manualBefore[0],
    post_date: "2026-05-19",
    description: "FAIRPRICE FINEST SINGAPORE",
    created_at: "2026-01-01 00:00:00"
  }]);
  assert.deepEqual(await rows(db, "SELECT id FROM transactions WHERE import_id = ?", importId), []);
});

// ------------------------------------------ promoted, then statement certified

async function createCardAccount(api) {
  const created = await api("/api/accounts/create", {
    name: "Promotion Card",
    institution: "Synthetic Test Bank",
    kind: "credit_card",
    openingBalanceMinor: 0,
    currency: "SGD",
    ownerPersonId: "",
    isJoint: false
  });
  assert.equal(created.status, 200, JSON.stringify(created.payload));
  return created.payload.accountId;
}

async function certifyWithStatement(api, db, accountId, manualEntryId) {
  const statementCheckpoints = [{
    accountId,
    accountName: "Promotion Card",
    detectedAccountName: "Promotion Card",
    checkpointMonth: "2026-06",
    statementStartDate: "2026-05-13",
    statementEndDate: "2026-06-12",
    statementBalanceMinor: 4321 + 999,
    note: "Promotion checkpoint"
  }];
  const preview = await api("/api/imports/preview", {
    sourceLabel: "Promotion statement",
    sourceType: "pdf",
    rows: [
      { date: "2026-05-19", description: "FAIRPRICE FINEST SINGAPORE SG", expense: "43.21", accountId, account: "Promotion Card", category: "Groceries" },
      { date: "2026-05-20", description: "PROMOTION TEST NEW ROW", expense: "9.99", accountId, account: "Promotion Card", category: "Groceries" }
    ],
    defaultAccountName: "Promotion Card",
    ownershipType: "direct",
    ownerName: "Tim",
    statementCheckpoints
  });
  assert.equal(preview.status, 200, JSON.stringify(preview.payload));
  const previewRows = preview.payload.preview.previewRows;
  assert.equal(previewRows[0].reconciliationTargetTransactionId, manualEntryId, "the statement certifies the promoted entry");
  const commit = await api("/api/imports/commit", {
    sourceLabel: "Promotion statement",
    sourceType: "pdf",
    parserKey: "uob_credit_card_pdf",
    rows: previewRows.filter((row) => row.commitStatus === "included"),
    statementCheckpoints,
    statementControlRows: previewRows,
    statementReconciliations: preview.payload.preview.statementReconciliations
  });
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  const statementImportId = commit.payload.importId;
  assert.deepEqual(await rows(db, "SELECT bank_certification_status, statement_certified_import_id, description FROM transactions WHERE id = ?", manualEntryId), [
    { bank_certification_status: "statement_certified", statement_certified_import_id: statementImportId, description: "FAIRPRICE FINEST SINGAPORE SG" }
  ]);
  return statementImportId;
}

test("rolling back the CSV after a statement certified the promoted entry keeps it certified, as a manual entry underneath", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const accountId = await createCardAccount(api);
  const { manualEntryId, manualBefore, importId } = await commitPromotion(api, db, { accountName: "Promotion Card", accountId });
  const statementImportId = await certifyWithStatement(api, db, accountId, manualEntryId);
  const certified = await entryRow(db, manualEntryId);

  const rollback = await api("/api/imports/rollback", { importId });

  // CSV imports stay rollbackable. The statement is still the authority for
  // the bank facts, so the entry keeps them and stays certified; it no longer
  // belongs to the rolled-back CSV, and its pre-certification state is now
  // the manual entry.
  assert.equal(rollback.status, 200, JSON.stringify(rollback.payload));
  assert.deepEqual(await entryRow(db, manualEntryId), [{
    ...certified[0],
    import_id: null,
    import_row_id: null,
    statement_certified_previous_import_id: null,
    statement_certified_previous_import_row_id: null,
    statement_certified_previous_post_date: null,
    statement_certified_previous_description: "FAIRPRICE FINEST",
    statement_certified_previous_amount_minor: 4321,
    statement_certified_previous_entry_type: "expense",
    statement_certified_previous_transfer_direction: null
  }]);

  // Rolling back the statement afterwards gives the original manual entry.
  const statementRollback = await api("/api/imports/rollback", { importId: statementImportId });
  assert.equal(statementRollback.status, 200, JSON.stringify(statementRollback.payload));
  assert.deepEqual(await entryRow(db, manualEntryId), manualBefore);
});
