// Imports and statement certification: persistence commands are all-or-nothing. Each scenario runs against a real
// local D1 (Miniflare) seeded with the demo household. A success case pins
// the concrete rows a command writes; a failure case makes one statement
// fail partway through the command and proves the database is byte-for-byte
// what it was before (no partial rows).
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

const IMPORT_CSV = [
  "date,description,amount,account,category,note",
  "2026-05-18,ATOMIC IMPORT FIRST,-12.34,UOB One,Groceries,atomic",
  "2026-05-19,ATOMIC IMPORT SECOND,-56.78,UOB One,Groceries,atomic"
].join("\n");

async function previewCsvImport(api) {
  const { status, payload } = await api("/api/imports/preview", {
    sourceLabel: "Atomic CSV",
    sourceType: "csv",
    csv: IMPORT_CSV,
    ownershipType: "direct",
    ownerName: "Tim"
  });
  assert.equal(status, 200, JSON.stringify(payload));
  return {
    sourceLabel: "Atomic CSV",
    sourceType: "csv",
    parserKey: "generic_csv",
    rows: payload.preview.previewRows
  };
}

// ---------------------------------------------------------------- imports

test("an import commit writes the batch, its rows and the month totals together", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await recalculateMonthlySnapshots(db, "2026-05");
  const [householdBefore] = (await snapshotTotals(db, "2026-05")).filter((row) => row.person_scope === "household");
  const commitBody = await previewCsvImport(api);

  const { status, payload } = await api("/api/imports/commit", commitBody);

  assert.equal(status, 200, JSON.stringify(payload));
  assert.equal(payload.created, true);
  assert.equal(payload.importedRows, 2);
  assert.deepEqual(await rows(db, "SELECT source_label, status FROM imports WHERE id = ?", payload.importId), [
    { source_label: "Atomic CSV", status: "completed" }
  ]);
  assert.deepEqual(await rows(db, `
    SELECT transaction_date, description, amount_minor, entry_type, bank_certification_status
    FROM transactions WHERE import_id = ? ORDER BY transaction_date
  `, payload.importId), [
    { transaction_date: "2026-05-18", description: "ATOMIC IMPORT FIRST", amount_minor: 1234, entry_type: "expense", bank_certification_status: "provisional" },
    { transaction_date: "2026-05-19", description: "ATOMIC IMPORT SECOND", amount_minor: 5678, entry_type: "expense", bank_certification_status: "provisional" }
  ]);
  assert.deepEqual(await rows(db, "SELECT row_index, status FROM import_rows WHERE import_id = ? ORDER BY row_index", payload.importId), [
    { row_index: 1, status: "imported" },
    { row_index: 2, status: "imported" }
  ]);
  const [householdAfter] = (await snapshotTotals(db, "2026-05")).filter((row) => row.person_scope === "household");
  assert.equal(householdAfter.total_expense_minor, householdBefore.total_expense_minor + 1234 + 5678);
  assert.deepEqual(await rows(db, "SELECT action FROM audit_events WHERE entity_id = ?", payload.importId), [{ action: "import_committed" }]);
  assert.deepEqual(await rows(db, "SELECT month_key FROM monthly_snapshot_refreshes"), []);

  const repeat = await api("/api/imports/commit", commitBody);
  assert.equal(repeat.payload.created, false);
  assert.equal((await rows(db, "SELECT id FROM transactions WHERE import_id = ?", payload.importId)).length, 2);
});

test("an import commit that fails on its second row leaves no import, rows or ledger entries", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const commitBody = await previewCsvImport(api);
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /INSERT INTO transactions/, { skip: 1 });

  const { status, payload } = await api("/api/imports/commit", commitBody, { database: faulty.db });

  assert.equal(faulty.state.fired, true);
  assert.equal(status, 400);
  assert.match(payload.error, /injected_failure_missing_table/);
  assertSameDatabase(await dumpDatabase(db), before);

  // The same file can be committed afterwards.
  const retry = await api("/api/imports/commit", commitBody);
  assert.equal(retry.payload.created, true);
  assert.equal((await rows(db, "SELECT id FROM transactions WHERE import_id = ?", retry.payload.importId)).length, 2);
});

test("a failed month-total refresh after an import is recorded and repaired on the next summary read", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await recalculateMonthlySnapshots(db, "2026-05");
  const totalsBefore = await snapshotTotals(db, "2026-05");
  const commitBody = await previewCsvImport(api);
  const faulty = failingStatement(db, /INSERT INTO monthly_snapshots/);

  const { status, payload } = await api("/api/imports/commit", commitBody, { database: faulty.db });

  // The ledger write is committed and reported as such; only the derived
  // month totals are stale, and that is recorded durably.
  assert.equal(faulty.state.fired, true);
  assert.equal(status, 200, JSON.stringify(payload));
  assert.equal((await rows(db, "SELECT id FROM transactions WHERE import_id = ?", payload.importId)).length, 2);
  assert.deepEqual(await snapshotTotals(db, "2026-05"), totalsBefore);
  assert.deepEqual(await rows(db, "SELECT month_key FROM monthly_snapshot_refreshes"), [{ month_key: "2026-05" }]);

  const summary = await api("/api/summary-page?view=household&month=2026-05&scope=direct_plus_shared");
  assert.equal(summary.status, 200);
  const [household] = (await snapshotTotals(db, "2026-05")).filter((row) => row.person_scope === "household");
  const [householdBefore] = totalsBefore.filter((row) => row.person_scope === "household");
  assert.equal(household.total_expense_minor, householdBefore.total_expense_minor + 1234 + 5678);
  assert.deepEqual(await rows(db, "SELECT month_key FROM monthly_snapshot_refreshes"), []);
});

test("an import rollback removes the batch rows and restores the month totals", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await recalculateMonthlySnapshots(db, "2026-05");
  const totalsBefore = await snapshotTotals(db, "2026-05");
  const commit = await api("/api/imports/commit", await previewCsvImport(api));

  const { status, payload } = await api("/api/imports/rollback", { importId: commit.payload.importId });

  assert.equal(status, 200, JSON.stringify(payload));
  assert.deepEqual(payload, { ok: true, importId: commit.payload.importId, rolledBack: true });
  assert.deepEqual(await rows(db, "SELECT status FROM imports WHERE id = ?", commit.payload.importId), [{ status: "rolled_back" }]);
  assert.deepEqual(await rows(db, "SELECT id FROM transactions WHERE import_id = ?", commit.payload.importId), []);
  assert.deepEqual(await rows(db, "SELECT id FROM import_rows WHERE import_id = ?", commit.payload.importId), []);
  assert.deepEqual(await snapshotTotals(db, "2026-05"), totalsBefore);
  assert.deepEqual(await rows(db, "SELECT action FROM audit_events WHERE entity_id = ? ORDER BY rowid", commit.payload.importId), [
    { action: "import_committed" },
    { action: "import_rolled_back" }
  ]);
});

test("rolling back an import twice is rejected and changes nothing", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const commit = await api("/api/imports/commit", await previewCsvImport(api));
  await api("/api/imports/rollback", { importId: commit.payload.importId });
  const afterFirstRollback = await dumpDatabase(db);

  const { status, payload } = await api("/api/imports/rollback", { importId: commit.payload.importId });

  assert.equal(status, 409);
  assert.equal(payload.ok, false);
  assert.match(payload.error, /already been rolled back/);
  assertSameDatabase(await dumpDatabase(db), afterFirstRollback);
});

test("an import rollback that fails partway leaves the import and its rows in place", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const commit = await api("/api/imports/commit", await previewCsvImport(api));
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /DELETE FROM import_rows/);

  const { status } = await api("/api/imports/rollback", { importId: commit.payload.importId }, { database: faulty.db });

  assert.equal(faulty.state.fired, true);
  assert.equal(status, 500);
  assertSameDatabase(await dumpDatabase(db), before);
});

// An import above the single-batch limit (500 statements, about 245 CSV
// rows) is staged: the draft and its new rows first, then one final batch.
const BULK_ROW_COUNT = 300;

async function previewBulkCsvImport(api) {
  const lines = ["date,description,amount,account,category,note"];
  for (let index = 1; index <= BULK_ROW_COUNT; index += 1) {
    const day = String(1 + (index % 28)).padStart(2, "0");
    lines.push(`2026-05-${day},ATOMIC BULK ROW ${String(index).padStart(3, "0")},-${index}.01,UOB One,Groceries,bulk`);
  }
  const { status, payload } = await api("/api/imports/preview", {
    sourceLabel: "Atomic bulk CSV",
    sourceType: "csv",
    csv: lines.join("\n"),
    ownershipType: "direct",
    ownerName: "Tim"
  });
  assert.equal(status, 200, JSON.stringify(payload));
  assert.equal(payload.preview.previewRows.length, BULK_ROW_COUNT);
  return { sourceLabel: "Atomic bulk CSV", sourceType: "csv", parserKey: "generic_csv", rows: payload.preview.previewRows };
}

test("a staged bulk import commits every row and completes", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const commitBody = await previewBulkCsvImport(api);

  const { status, payload } = await api("/api/imports/commit", commitBody);

  assert.equal(status, 200, JSON.stringify(payload));
  assert.equal(payload.importedRows, BULK_ROW_COUNT);
  assert.deepEqual(await rows(db, "SELECT status FROM imports WHERE id = ?", payload.importId), [{ status: "completed" }]);
  assert.deepEqual(await rows(db, "SELECT COUNT(*) AS count, SUM(amount_minor) AS total FROM transactions WHERE import_id = ?", payload.importId), [
    // 1.01 + 2.01 + ... + 300.01
    { count: BULK_ROW_COUNT, total: (BULK_ROW_COUNT * (BULK_ROW_COUNT + 1) / 2) * 100 + BULK_ROW_COUNT }
  ]);
  assert.equal((await rows(db, "SELECT id FROM import_rows WHERE import_id = ?", payload.importId)).length, BULK_ROW_COUNT);
  assert.deepEqual(await rows(db, "SELECT month_key FROM monthly_snapshot_refreshes"), []);
});

test("a staged bulk import that fails in a later chunk or the final batch leaves nothing", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const commitBody = await previewBulkCsvImport(api);
  const before = await dumpDatabase(db);

  for (const [pattern, skip] of [[/INSERT INTO transactions/, 200], [/UPDATE imports SET status = 'completed'/, 0]]) {
    const faulty = failingStatement(db, pattern, { skip });
    const { status } = await api("/api/imports/commit", commitBody, { database: faulty.db });
    assert.equal(faulty.state.fired, true, String(pattern));
    assert.equal(status, 400);
    assertSameDatabase(await dumpDatabase(db), before);
  }
});

test("a staged bulk import whose final batch lands but reports an error keeps the committed import", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const commitBody = await previewBulkCsvImport(api);
  let dropped = false;
  const flaky = new Proxy(db, {
    get(target, property) {
      if (property === "batch") {
        return async (statements) => {
          const result = await target.batch(statements);
          if (!dropped && statements.some((statement) => /SET status = 'completed'/.test(statementSql(statement)))) {
            dropped = true;
            throw new Error("Network connection lost after commit");
          }
          return result;
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });

  const { status, payload } = await api("/api/imports/commit", commitBody, { database: flaky });

  assert.equal(dropped, true);
  assert.equal(status, 400);
  assert.match(payload.error, /Network connection lost/);
  const [committed] = await rows(db, "SELECT id, status FROM imports WHERE source_label = 'Atomic bulk CSV'");
  assert.equal(committed.status, "completed");
  assert.equal((await rows(db, "SELECT id FROM transactions WHERE import_id = ?", committed.id)).length, BULK_ROW_COUNT);
  const retry = await api("/api/imports/commit", commitBody);
  assert.equal(retry.payload.created, false);
});

test("a second commit of the same bulk file that loses the race removes none of the first commit's rows", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const commitBody = await previewBulkCsvImport(api);
  const first = await api("/api/imports/commit", commitBody);
  assert.equal(first.payload.created, true);
  const before = await dumpDatabase(db);
  // The second request checked for the import before the first created it.
  const late = new Proxy(db, {
    get(target, property) {
      if (property === "prepare") {
        return (sql) => /SELECT status FROM imports WHERE household_id = \? AND id = \?/.test(sql)
          ? target.prepare("SELECT status FROM imports WHERE household_id = ? AND id = ? AND 0")
          : target.prepare(sql);
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });

  const second = await api("/api/imports/commit", commitBody, { database: late });

  assert.equal(second.status, 400);
  assert.match(second.payload.error, /UNIQUE constraint failed: imports\.id/);
  assertSameDatabase(await dumpDatabase(db), before);
});

// ------------------------------------------------- statement certification

async function prepareStatementImport(api) {
  const created = await api("/api/accounts/create", {
    name: "Atomic Card",
    institution: "Synthetic Test Bank",
    kind: "credit_card",
    openingBalanceMinor: 0,
    currency: "SGD",
    ownerPersonId: "",
    isJoint: false
  });
  assert.equal(created.status, 200, JSON.stringify(created.payload));
  const accountId = created.payload.accountId;
  const manualEntryId = await createEntry(api, {
    date: "2026-04-16",
    description: "OPENAI OPENAI.COM US",
    amountMinor: 734,
    accountId,
    accountName: "Atomic Card",
    categoryName: "Other"
  });
  const statementCheckpoints = [{
    accountId,
    accountName: "Atomic Card",
    detectedAccountName: "Atomic Card",
    checkpointMonth: "2026-05",
    statementStartDate: "2026-04-13",
    statementEndDate: "2026-05-12",
    statementBalanceMinor: 734,
    note: "Atomic checkpoint"
  }];
  const preview = await api("/api/imports/preview", {
    sourceLabel: "Atomic statement",
    sourceType: "pdf",
    rows: [{
      date: "2026-04-17",
      description: "OPENAI OPENAI.COM USD 5.58",
      expense: "7.34",
      accountId,
      account: "Atomic Card",
      category: "Other",
      note: "txn date: 2026-04-16"
    }],
    defaultAccountName: "Atomic Card",
    ownershipType: "direct",
    ownerName: "Tim",
    statementCheckpoints
  });
  assert.equal(preview.status, 200, JSON.stringify(preview.payload));
  const previewRows = preview.payload.preview.previewRows;
  assert.equal(previewRows[0].reconciliationTargetTransactionId, manualEntryId);
  return {
    accountId,
    manualEntryId,
    commitBody: {
      sourceLabel: "Atomic statement",
      sourceType: "pdf",
      parserKey: "uob_credit_card_pdf",
      rows: previewRows.filter((row) => row.commitStatus === "included"),
      statementCheckpoints,
      statementControlRows: previewRows,
      statementReconciliations: preview.payload.preview.statementReconciliations
    }
  };
}

test("a statement import certifies the matched entry, saves the checkpoint and certificate, and rolls back cleanly", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { accountId, manualEntryId, commitBody } = await prepareStatementImport(api);
  const manualBefore = await rows(db, "SELECT transaction_date, post_date, description, amount_minor, import_id FROM transactions WHERE id = ?", manualEntryId);

  const commit = await api("/api/imports/commit", commitBody);

  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  const importId = commit.payload.importId;
  assert.deepEqual(await rows(db, `
    SELECT transaction_date, post_date, description, amount_minor, bank_certification_status, statement_certified_import_id
    FROM transactions WHERE id = ?
  `, manualEntryId), [{
    transaction_date: "2026-04-16",
    post_date: "2026-04-17",
    description: "OPENAI OPENAI.COM USD 5.58",
    amount_minor: 734,
    bank_certification_status: "statement_certified",
    statement_certified_import_id: importId
  }]);
  assert.deepEqual(await rows(db, "SELECT checkpoint_month, statement_start_date, statement_end_date, statement_balance_minor FROM account_balance_checkpoints WHERE account_id = ?", accountId), [
    { checkpoint_month: "2026-05", statement_start_date: "2026-04-13", statement_end_date: "2026-05-12", statement_balance_minor: -734 }
  ]);
  assert.deepEqual(await rows(db, `
    SELECT checkpoint_month, statement_row_count, imported_row_count, certified_existing_row_count, delta_minor, status
    FROM statement_reconciliation_certificates WHERE import_id = ?
  `, importId), [
    { checkpoint_month: "2026-05", statement_row_count: 1, imported_row_count: 0, certified_existing_row_count: 1, delta_minor: 0, status: "certified" }
  ]);

  const rollback = await api("/api/imports/rollback", { importId });

  assert.equal(rollback.status, 200, JSON.stringify(rollback.payload));
  assert.deepEqual(await rows(db, "SELECT transaction_date, post_date, description, amount_minor, import_id FROM transactions WHERE id = ?", manualEntryId), manualBefore);
  assert.deepEqual(await rows(db, "SELECT bank_certification_status FROM transactions WHERE id = ?", manualEntryId), [{ bank_certification_status: "provisional" }]);
  assert.deepEqual(await rows(db, "SELECT id FROM account_balance_checkpoints WHERE account_id = ?", accountId), []);
  assert.deepEqual(await rows(db, "SELECT id FROM statement_reconciliation_certificates WHERE import_id = ?", importId), []);
});

test("a statement certificate without preview figures computes the balance from the ledger after the commit", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { commitBody } = await prepareStatementImport(api);
  const reconciliations = commitBody.statementReconciliations.map(({ projectedLedgerBalanceMinor, deltaMinor, ...rest }) => rest);

  const commit = await api("/api/imports/commit", { ...commitBody, statementReconciliations: reconciliations });

  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  // The certified row's cleared date (2026-04-17) falls in the statement
  // period, so the ledger balance is the -7.34 card charge: no difference.
  assert.deepEqual(await rows(db, "SELECT statement_balance_minor, projected_ledger_balance_minor, delta_minor FROM statement_reconciliation_certificates WHERE import_id = ?", commit.payload.importId), [
    { statement_balance_minor: -734, projected_ledger_balance_minor: -734, delta_minor: 0 }
  ]);
});

test("a statement import that fails while saving its certificate certifies nothing", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { commitBody } = await prepareStatementImport(api);
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /INSERT INTO statement_reconciliation_certificates/);

  const { status } = await api("/api/imports/commit", commitBody, { database: faulty.db });

  assert.equal(faulty.state.fired, true);
  assert.equal(status, 400);
  assertSameDatabase(await dumpDatabase(db), before);
});
