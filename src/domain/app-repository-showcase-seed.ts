// Showcase demo seed: replaces every household table with the showcase
// dataset (demo-showcase-data.ts) in one all-or-nothing D1 batch, then
// refreshes the months' snapshots. Used only by the demo worker when
// `DEMO_DATASET` is "showcase"; the default demo seed in
// app-repository-seed.ts is untouched.
//
// D1 allows 100 bound parameters per statement and 1,000 queries per Worker
// invocation. The dataset is about 1,300 rows of fixed, code-generated data,
// so rows are written as escaped SQL literals in multi-row INSERTs of at most
// SHOWCASE_MAX_STATEMENT_BYTES each. That keeps the whole reseed to a few
// dozen statements in a single batch (one transaction) with no user input
// anywhere in the SQL.

import { ensureDemoSchema } from "./app-repository-schema";
import { buildMonthlySnapshotRefreshMarkers, refreshMonthlySnapshots } from "./app-repository-snapshots";
import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import { isoDateInAppTimeZone } from "../lib/app-calendar";
import {
  buildShowcaseDataset,
  daysInMonth,
  SHOWCASE_ACCOUNTS,
  SHOWCASE_CATEGORIES,
  SHOWCASE_CATEGORY_RULES,
  SHOWCASE_INSTITUTIONS,
  SHOWCASE_PEOPLE,
  SHOWCASE_SPLIT_GROUPS,
  type ShowcaseDataset
} from "./demo-showcase-data";

// D1's limit is 100,000 bytes per statement; stay well below it.
export const SHOWCASE_MAX_STATEMENT_BYTES = 90_000;

const HOUSEHOLD_NAME = "Monie's Map";

// Children before parents. The same tables clearDemoData clears, plus
// reconciliation_exceptions, which points at accounts and ledger entries.
const SHOWCASE_CLEAR_TABLES = [
  "reconciliation_exceptions",
  "split_activity_history",
  "split_settlement_checkpoint_items",
  "split_settlement_checkpoint_matches",
  "split_settlement_checkpoints",
  "split_expense_shares",
  "split_expenses",
  "split_settlements",
  "split_batches",
  "split_groups",
  "monthly_plan_entry_links",
  "monthly_plan_match_hints",
  "transactions",
  "monthly_plan_row_splits",
  "monthly_plan_rows",
  "monthly_budgets",
  "monthly_notes",
  "monthly_snapshots",
  "monthly_snapshot_refreshes",
  "statement_reconciliation_certificates",
  "statement_chain_breaks",
  "import_statement_fixes",
  "statement_corrections",
  "import_rows",
  "imports",
  "account_balance_checkpoints",
  "app_error_diagnostics",
  "audit_events",
  "category_match_rule_issue_ignores",
  "category_match_rule_suggestions",
  "category_match_rules",
  "login_identities",
  "transfer_groups",
  "categories",
  "accounts",
  "institutions",
  "people",
  "households"
];

type SqlValue = string | number | boolean | null;

// A SQL literal for fixed seed data. Strings are single-quote escaped;
// numbers must be finite. Never pass request input here.
function sqlLiteral(value: SqlValue) {
  if (value === null) {
    return "NULL";
  }
  if (typeof value === "boolean") {
    return value ? "1" : "0";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Showcase seed value is not a finite number: ${value}`);
    }
    return String(value);
  }
  return `'${value.replace(/'/g, "''")}'`;
}

const encoder = new TextEncoder();

// Multi-row INSERTs for one table, each under the statement size limit.
export function buildShowcaseInsertSql(table: string, columns: string[], rows: SqlValue[][]) {
  const head = `INSERT INTO ${table} (${columns.join(", ")}) VALUES `;
  const statements: string[] = [];
  let tuples: string[] = [];
  let size = encoder.encode(head).length;
  for (const row of rows) {
    if (row.length !== columns.length) {
      throw new Error(`Showcase ${table} row has ${row.length} values for ${columns.length} columns.`);
    }
    const tuple = `(${row.map(sqlLiteral).join(", ")})`;
    const tupleSize = encoder.encode(tuple).length + 2;
    if (tuples.length && size + tupleSize > SHOWCASE_MAX_STATEMENT_BYTES) {
      statements.push(head + tuples.join(", "));
      tuples = [];
      size = encoder.encode(head).length;
    }
    tuples.push(tuple);
    size += tupleSize;
  }
  if (tuples.length) {
    statements.push(head + tuples.join(", "));
  }
  return statements;
}

// Every INSERT of the showcase, in foreign-key order.
export function buildShowcaseInsertSqlStatements(dataset: ShowcaseDataset) {
  const H = DEFAULT_HOUSEHOLD_ID;
  const tables: Array<[string, string[], SqlValue[][]]> = [
    ["households", ["id", "name", "base_currency"], [[H, HOUSEHOLD_NAME, "SGD"]]],
    ["people", ["id", "household_id", "display_name", "role", "created_at"],
      SHOWCASE_PEOPLE.map((person, index) => [person.id, H, person.name, person.role, dataset.peopleCreatedAt[index]])],
    ["institutions", ["id", "household_id", "name", "country_code"],
      SHOWCASE_INSTITUTIONS.map((institution) => [institution.id, H, institution.name, "SG"])],
    ["accounts", ["id", "household_id", "institution_id", "owner_person_id", "account_name", "account_kind", "currency", "opening_balance_minor", "is_joint"],
      SHOWCASE_ACCOUNTS.map((account) => [account.id, H, account.institutionId, account.ownerPersonId, account.name, account.kind, "SGD", account.openingBalanceMinor, account.isJoint])],
    ["categories", ["id", "household_id", "name", "slug", "reporting_group", "icon_key", "color_hex", "sort_order", "is_system"],
      SHOWCASE_CATEGORIES.map((category) => [category.id, H, category.name, category.slug, category.slug, category.iconKey, category.colorHex, category.sortOrder, category.isSystem])],
    ["category_match_rules", ["id", "household_id", "pattern", "category_id", "priority", "is_active", "note"],
      SHOWCASE_CATEGORY_RULES.map((rule) => [rule.id, H, rule.pattern, rule.categoryId, rule.priority, 1, rule.note])],
    ["category_match_rule_suggestions", ["id", "household_id", "pattern", "category_id", "source_count", "sample_descriptions_json", "status"],
      dataset.ruleSuggestions.map((item) => [item.id, H, item.pattern, item.categoryId, item.sourceCount, item.sampleDescriptionsJson, "pending"])],
    ["imports", ["id", "household_id", "source_type", "source_label", "parser_key", "imported_at", "status", "note"],
      dataset.imports.map((item) => [item.id, H, item.sourceType, item.sourceLabel, item.parserKey, item.importedAt, item.status, item.note])],
    ["import_rows", ["id", "import_id", "row_index", "assigned_account_id", "raw_row_json", "normalized_hash", "status", "created_at"],
      dataset.importRows.map((row) => {
        const importedAt = dataset.imports.find((item) => item.id === row.importId)?.importedAt ?? null;
        return [row.id, row.importId, row.rowIndex, row.accountId, row.rawRowJson, row.normalizedHash, "imported", importedAt];
      })],
    ["transfer_groups", ["id", "household_id", "note", "matched_confidence"],
      dataset.transferGroups.map((group) => [group.id, H, group.note, 1])],
    ["transactions", [
      "id", "household_id", "import_id", "import_row_id", "account_id", "transfer_group_id", "transaction_date", "post_date",
      "description", "amount_minor", "currency", "entry_type", "transfer_direction", "category_id", "owner_person_id",
      "offsets_category", "note", "bank_certification_status", "statement_certified_import_id",
      "statement_certified_import_row_id", "statement_certified_at", "created_at", "updated_at"
    ], dataset.transactions.map((row) => [
      row.id, H, row.importId, row.importRowId, row.accountId, row.transferGroupId, row.date, row.postDate,
      row.description, row.amountMinor, "SGD", row.entryType, row.transferDirection, row.categoryId, row.ownerPersonId,
      row.offsetsCategory, row.note, row.certified ? "statement_certified" : "provisional", row.certified ? row.importId : null,
      row.certified ? row.importRowId : null, row.certified ? row.createdAt : null, row.createdAt, row.createdAt
    ])],
    ["reconciliation_exceptions", ["id", "household_id", "account_id", "checkpoint_month", "kind", "severity", "status", "title", "note", "created_at", "updated_at"],
      dataset.reconciliationExceptions.map((item) => [item.id, H, item.accountId, item.month, item.kind, "review", "open", item.title, item.note, item.createdAt, item.createdAt])],
    ["account_balance_checkpoints", ["id", "household_id", "account_id", "checkpoint_month", "statement_start_date", "statement_end_date", "statement_balance_minor", "note"],
      dataset.checkpoints.map((item) => [item.id, H, item.accountId, item.month, item.startDate, item.endDate, item.statementBalanceMinor, item.note])],
    ["statement_reconciliation_certificates", [
      "id", "household_id", "import_id", "account_id", "checkpoint_month", "statement_start_date", "statement_end_date",
      "statement_row_count", "imported_row_count", "certified_existing_row_count", "already_covered_row_count",
      "needs_review_row_count", "debit_total_minor", "credit_total_minor", "net_total_minor", "statement_balance_minor",
      "projected_ledger_balance_minor", "delta_minor", "exception_count", "status", "created_at"
    ], dataset.certificates.map((item) => [
      item.id, H, item.importId, item.accountId, item.month, item.startDate, item.endDate,
      item.statementRowCount, item.importedRowCount, 0, 0,
      item.needsReviewRowCount, item.debitTotalMinor, item.creditTotalMinor, item.netTotalMinor, item.statementBalanceMinor,
      item.projectedLedgerBalanceMinor, item.deltaMinor, item.exceptionCount, item.status, item.createdAt
    ])],
    ["monthly_plan_rows", [
      "id", "household_id", "year", "month", "person_id", "ownership_type", "section_key", "category_id", "label",
      "plan_date", "account_id", "planned_amount_minor", "actual_amount_minor", "notes", "created_at", "updated_at"
    ], dataset.planRows.map((row) => {
      const [year, monthNumber] = row.month.split("-").map(Number);
      return [row.id, H, year, monthNumber, row.personId, row.ownershipType, row.section, row.categoryId, row.label,
        row.planDate, row.accountId, row.plannedMinor, 0, row.notes, row.createdAt, row.createdAt];
    })],
    ["monthly_plan_entry_links", ["id", "monthly_plan_row_id", "transaction_id", "created_at"],
      dataset.planLinks.map((link) => [link.id, link.planRowId, link.transactionId, link.createdAt])],
    // Month notes live on the snapshot rows; the refresh after the batch
    // fills in the totals and keeps the notes.
    ["monthly_snapshots", ["id", "household_id", "year", "month", "person_scope", "note"],
      dataset.snapshotNotes.map((item) => {
        const [year, monthNumber] = item.month.split("-").map(Number);
        return [item.id, H, year, monthNumber, item.personScope, item.note];
      })],
    ["split_groups", ["id", "household_id", "group_name", "currency", "expense_source", "icon_key", "sort_order"],
      SHOWCASE_SPLIT_GROUPS.map((group) => [group.id, H, group.name, group.currency, "mixed", group.iconKey, group.sortOrder])],
    ["split_batches", ["id", "household_id", "split_group_id", "batch_name", "opened_on", "closed_on", "created_at"],
      dataset.splitBatches.map((batch) => [batch.id, H, batch.groupId, batch.name, batch.openedOn, batch.closedOn, batch.createdAt])],
    ["split_expenses", [
      "id", "household_id", "split_group_id", "split_batch_id", "payer_person_id", "expense_date", "description", "category_id",
      "total_amount_minor", "currency", "home_amount_minor", "fx_rate_basis_points", "payment_method", "payment_status",
      "deleted_at", "note", "linked_transaction_id", "created_at"
    ], dataset.splitExpenses.map((item) => [
      item.id, H, item.groupId, item.batchId, item.payerPersonId, item.date, item.description, item.categoryId,
      item.totalAmountMinor, item.currency, item.homeAmountMinor, item.fxRateBasisPoints, item.paymentMethod, item.paymentStatus,
      item.deletedAt, item.note, item.linkedTransactionId, item.createdAt
    ])],
    ["split_expense_shares", ["id", "split_expense_id", "person_id", "ratio_basis_points", "amount_minor", "created_at"],
      dataset.splitExpenses.flatMap((item) => item.shares.map((share) => [share.id, share.splitExpenseId, share.personId, share.ratioBasisPoints, share.amountMinor, share.createdAt]))],
    ["split_settlements", [
      "id", "household_id", "split_group_id", "split_batch_id", "from_person_id", "to_person_id", "settlement_date",
      "amount_minor", "currency", "payment_method", "payment_status", "note", "linked_transaction_id", "created_at"
    ], dataset.splitSettlements.map((item) => [
      item.id, H, item.groupId, item.batchId, item.fromPersonId, item.toPersonId, item.date,
      item.amountMinor, item.currency, item.paymentMethod, item.paymentStatus, item.note, item.linkedTransactionId, item.createdAt
    ])],
    ["split_settlement_checkpoints", ["id", "household_id", "from_person_id", "to_person_id", "amount_minor", "currency", "settlement_date", "status", "note", "created_at", "updated_at"],
      dataset.settlementCheckpoints.map((item) => [item.id, H, item.fromPersonId, item.toPersonId, item.amountMinor, item.currency, item.settlementDate, item.status, item.note, item.createdAt, item.createdAt])],
    ["split_settlement_checkpoint_items", ["id", "checkpoint_id", "record_kind", "record_id", "created_at"],
      dataset.settlementCheckpoints.flatMap((checkpoint) => checkpoint.items.map((item) => [item.id, checkpoint.id, item.recordKind, item.recordId, checkpoint.createdAt]))],
    ["split_activity_history", ["id", "household_id", "record_kind", "record_id", "action", "group_id", "group_name", "description", "amount_minor", "currency", "occurred_at"],
      dataset.splitHistory.map((item) => [item.id, H, item.recordKind, item.recordId, item.action, item.groupId, item.groupName, item.description, item.amountMinor, item.currency, item.occurredAt])]
  ];

  return tables.flatMap(([table, columns, rows]) => (rows.length ? buildShowcaseInsertSql(table, columns, rows) : []));
}

export function buildShowcaseSeedStatements(db: D1Database, dataset: ShowcaseDataset, extraStatements: D1PreparedStatement[] = []) {
  return [
    ...SHOWCASE_CLEAR_TABLES.map((table) => db.prepare(`DELETE FROM ${table}`)),
    ...buildShowcaseInsertSqlStatements(dataset).map((sql) => db.prepare(sql)),
    ...buildMonthlySnapshotRefreshMarkers(db, dataset.months),
    ...extraStatements
  ];
}

// The seed month and the last day with activity. An explicit seed month
// (tests, DEMO_SEED_MONTH) is seeded in full so it is deterministic; the
// current month is cut at today, so the demo never shows tomorrow's entries.
export function resolveShowcaseSeedWindow(seedMonth?: string, now = new Date()) {
  if (seedMonth) {
    return { seedMonth, cutoffDay: daysInMonth(seedMonth) };
  }
  const today = isoDateInAppTimeZone(now);
  return { seedMonth: today.slice(0, 7), cutoffDay: Number(today.slice(8, 10)) };
}

// Replaces the household with the showcase in one batch (with any extra
// statements, such as the demo settings that record the dataset), then
// refreshes every showcase month's snapshots.
export async function reseedShowcaseData(
  db: D1Database,
  options: { seedMonth?: string; now?: Date; extraStatements?: D1PreparedStatement[] } = {}
) {
  await ensureDemoSchema(db);
  const dataset = buildShowcaseDataset(resolveShowcaseSeedWindow(options.seedMonth, options.now));
  await db.batch(buildShowcaseSeedStatements(db, dataset, options.extraStatements ?? []));
  await refreshMonthlySnapshots(db, dataset.months);
  return dataset;
}

// A cold start over a showcase database: true when the showcase's own rows
// are all present, so nothing needs reseeding.
export async function isShowcaseSeeded(db: D1Database) {
  const row = await db
    .prepare(`
      SELECT
        (SELECT COUNT(*) FROM people WHERE household_id = ? AND id = ?) AS people,
        (SELECT COUNT(*) FROM monthly_plan_rows WHERE household_id = ? AND section_key = 'income') AS income_rows,
        (SELECT COUNT(*) FROM monthly_snapshots WHERE household_id = ?) AS snapshots
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, SHOWCASE_PEOPLE[0].id, DEFAULT_HOUSEHOLD_ID, DEFAULT_HOUSEHOLD_ID)
    .first<{ people: number; income_rows: number; snapshots: number }>();
  return Number(row?.people ?? 0) > 0 && Number(row?.income_rows ?? 0) > 0 && Number(row?.snapshots ?? 0) > 0;
}
