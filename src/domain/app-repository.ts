import {
  accounts as demoAccounts,
  buildMonthIncomeRows,
  buildSummaryMonthsByView,
  categories as defaultCategories,
  demoMonths,
  household as defaultHousehold,
  importBatches as demoImportBatches,
  monthEntries as demoMonthEntries,
  monthPlanRows as demoMonthPlanRows,
  type DemoSettings
} from "./demo-data";
import {
  buildImportRowHash,
  buildPlanDate,
  buildSnapshotRowsForScope,
  computeCheckpointLedgerBalanceMinor,
  getSignedLedgerAmountMinor,
  getMonthEndDate,
  inferMonthKeyFromPlanRow,
  mapAccountKind,
  nextMonthKey,
  normalizePlanMatchHint,
  normalizeStatementBalanceInputMinor,
  normalizeStatementDate,
  shiftPlanDate,
  slugify,
  sumVisibleExpenseMinor
} from "./app-repository-helpers";
import { getCurrentMonthKey } from "../lib/month";
import { backfillSplitBatches } from "./app-repository-split-batches";
import { ensureDefaultCategoryMatchRules, recordCategoryMatchSuggestion } from "./app-repository-category-match-rules";
import { recordAuditEvent } from "./app-repository-audit";
import { resolveAccountId, resolveCategoryId, resolvePersonId } from "./app-repository-lookups";
import { syncMonthlyPlanRowSplits, syncTransactionSplits } from "./app-repository-split-sync";
import { loadEntries } from "./app-repository-entries";
import { loadMonthIncomeRows, loadMonthPlanRows } from "./app-repository-months";
export {
  buildAccountCheckpointLedgerCsv,
  compareAccountCheckpointStatementRows,
  deleteAccountCheckpointRecord,
  saveAccountCheckpointRecord
} from "./app-repository-checkpoints";
export {
  deleteCategoryMatchRule,
  ignoreCategoryMatchRuleSuggestion,
  loadCategoryMatchRules,
  loadCategoryMatchRuleSuggestions,
  matchCategoryRule,
  saveCategoryMatchRule
} from "./app-repository-category-match-rules";
export {
  createCategoryRecord,
  deleteCategoryRecord,
  loadCategories,
  updateCategoryRecord
} from "./app-repository-categories";
export { loadEntries, loadEntriesForMonths, loadTransferMatchCandidates } from "./app-repository-entries";
export { buildImportPreview } from "./app-repository-import-preview";
export { loadImportBatches } from "./app-repository-import-history";
export {
  createReconciliationExceptionRecord,
  loadReconciliationExceptions,
  resolveReconciliationExceptionRecord
} from "./app-repository-reconciliation-exceptions";
export {
  loadMonthIncomeRows,
  loadMonthIncomeRowsForViews,
  loadMonthPlanRows,
  loadSummaryMonths,
  loadSummaryMonthsForScopes,
  loadTrackedMonths
} from "./app-repository-months";
export {
  createSplitExpenseFromEntryRecord,
  createSplitExpenseRecord,
  createSplitGroupRecord,
  createSplitSettlementRecord,
  deleteSplitExpenseRecord,
  deleteSplitSettlementRecord,
  linkSplitExpenseMatch,
  linkSplitSettlementMatch,
  loadSplitExpenses,
  loadSplitGroups,
  loadSplitMatchCandidates,
  loadSplitSettlements,
  updateSplitExpenseRecord,
  updateSplitSettlementRecord
} from "./app-repository-splits";
export {
  archiveAccountRecord,
  createAccountRecord,
  loadAccounts,
  loadAuditEvents,
  loadHousehold,
  loadUnresolvedTransfers,
  updateAccountRecord,
  updatePersonRecord
} from "./app-repository-settings";
import type {
  EntryDeepLinkContextDto,
  ImportPreviewRowDto,
  ImportPreviewStatementReconciliationDto,
  SplitActivityDto,
  SplitGroupPillDto,
  StatementCheckpointDraftDto,
} from "../types/dto";

const DEFAULT_HOUSEHOLD_ID = defaultHousehold.id;

const demoPeople = defaultHousehold.people;
const SEED_PERSON_IDS_BY_NAME = new Map(demoPeople.map((person) => [person.name, person.id]));
const DEMO_PRIMARY_PERSON_ID = demoPeople[0]?.id ?? "demo-primary";
const DEMO_PARTNER_PERSON_ID = demoPeople[1]?.id ?? "demo-partner";
const EMPTY_PRIMARY_PERSON_ID = "person-primary";
const EMPTY_PARTNER_PERSON_ID = "person-partner";

function findSeedAccountId(accountName?: string) {
  if (!accountName) {
    return null;
  }

  return demoAccounts.find((account) => account.name === accountName)?.id ?? null;
}

function findSeedCategoryId(categoryName?: string) {
  if (!categoryName) {
    return null;
  }

  return defaultCategories.find((category) => category.name === categoryName)?.id ?? null;
}

const SHARED_ACCOUNT_INSTITUTION = "DBS";
const EMPTY_STATE_PEOPLE = [
  { id: EMPTY_PRIMARY_PERSON_ID, name: "Primary", role: "owner" },
  { id: EMPTY_PARTNER_PERSON_ID, name: "Partner", role: "partner" }
];
const IMPORT_COMMIT_STATEMENT_CHUNK_SIZE = 90;
const OLD_SHOPPING_COLOR_HEX = "#D4B35D";
const SHOPPING_COLOR_HEX = "#D86B73";

function resolveSeededDemoTransactionDate(entryId: string, date: string) {
  if (!entryId.startsWith("txn-oct-")) {
    return date;
  }

  const currentMonthKey = getCurrentMonthKey();
  const [year, month] = currentMonthKey.split("-").map(Number);
  return shiftPlanDate(date, year, month) ?? date;
}

export async function ensureSeedData(db: D1Database, settings: DemoSettings) {
  await ensureDemoSchema(db);
  const existing = await db
    .prepare("SELECT COUNT(*) as count FROM households WHERE id = ?")
    .bind(DEFAULT_HOUSEHOLD_ID)
    .first<{ count: number }>();

  const categoryCount = await db
    .prepare("SELECT COUNT(*) as count FROM categories WHERE household_id = ?")
    .bind(DEFAULT_HOUSEHOLD_ID)
    .first<{ count: number }>();

  const snapshotCount = await db
    .prepare("SELECT COUNT(*) as count FROM monthly_snapshots WHERE household_id = ?")
    .bind(DEFAULT_HOUSEHOLD_ID)
    .first<{ count: number }>();

  const incomeRowCount = await db
    .prepare("SELECT COUNT(*) as count FROM monthly_plan_rows WHERE household_id = ? AND section_key = 'income'")
    .bind(DEFAULT_HOUSEHOLD_ID)
    .first<{ count: number }>();

  const alreadySeeded =
    (existing?.count ?? 0) > 0 &&
    (categoryCount?.count ?? 0) > 0 &&
    (snapshotCount?.count ?? 0) > 0 &&
    (incomeRowCount?.count ?? 0) > 0;

  if (alreadySeeded) {
    await ensureDefaultCategoryPalette(db);
    await ensureDefaultCategoryMatchRules(db);
  } else {
    await reseedDemoData(db, settings);
  }

  const demoBackfillChanged = await backfillDemoPlannedItemSeedData(db);
  if (demoBackfillChanged) {
    for (const month of demoMonths) {
      await recalculateMonthlySnapshots(db, month);
    }
  }
}

export async function ensureDemoSchema(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS monthly_plan_row_splits (
      id TEXT PRIMARY KEY,
      monthly_plan_row_id TEXT NOT NULL,
      person_id TEXT NOT NULL,
      ratio_basis_points INTEGER NOT NULL CHECK (
        ratio_basis_points BETWEEN 0 AND 10000
      ),
      amount_minor INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (monthly_plan_row_id) REFERENCES monthly_plan_rows(id) ON DELETE CASCADE,
      FOREIGN KEY (person_id) REFERENCES people(id)
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS monthly_plan_entry_links (
      id TEXT PRIMARY KEY,
      monthly_plan_row_id TEXT NOT NULL,
      transaction_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (monthly_plan_row_id) REFERENCES monthly_plan_rows(id) ON DELETE CASCADE,
      FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
      UNIQUE (monthly_plan_row_id, transaction_id)
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS monthly_plan_match_hints (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      person_id TEXT,
      category_id TEXT,
      account_id TEXT,
      label_normalized TEXT NOT NULL,
      description_pattern TEXT NOT NULL,
      amount_minor INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (household_id) REFERENCES households(id),
      FOREIGN KEY (person_id) REFERENCES people(id),
      FOREIGN KEY (category_id) REFERENCES categories(id),
      FOREIGN KEY (account_id) REFERENCES accounts(id),
      UNIQUE (household_id, person_id, category_id, account_id, label_normalized, description_pattern)
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS category_match_rules (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      pattern TEXT NOT NULL,
      category_id TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 100,
      is_active INTEGER NOT NULL DEFAULT 1,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (household_id) REFERENCES households(id),
      FOREIGN KEY (category_id) REFERENCES categories(id),
      UNIQUE (household_id, pattern)
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS category_match_rule_suggestions (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      pattern TEXT NOT NULL,
      category_id TEXT NOT NULL,
      source_count INTEGER NOT NULL DEFAULT 1,
      sample_descriptions_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'ignored')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (household_id) REFERENCES households(id),
      FOREIGN KEY (category_id) REFERENCES categories(id),
      UNIQUE (household_id, pattern, category_id)
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS login_identities (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      email TEXT NOT NULL COLLATE NOCASE,
      person_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (household_id) REFERENCES households(id),
      FOREIGN KEY (person_id) REFERENCES people(id),
      UNIQUE (household_id, provider, email)
    )
  `).run();

  const categoryColumns = await db
    .prepare("PRAGMA table_info(categories)")
    .all<{ name: string }>();

  const hasSlug = categoryColumns.results.some((column) => column.name === "slug");
  if (!hasSlug && categoryColumns.results.length > 0) {
    await db.prepare("ALTER TABLE categories ADD COLUMN slug TEXT").run();
  }

  const hasSortOrder = categoryColumns.results.some((column) => column.name === "sort_order");
  if (!hasSortOrder && categoryColumns.results.length > 0) {
    await db.prepare("ALTER TABLE categories ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0").run();
  }

  const hasIsSystem = categoryColumns.results.some((column) => column.name === "is_system");
  if (!hasIsSystem && categoryColumns.results.length > 0) {
    await db.prepare("ALTER TABLE categories ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0").run();
  }

  const hasReportingGroup = categoryColumns.results.some((column) => column.name === "reporting_group");
  if (!hasReportingGroup && categoryColumns.results.length > 0) {
    await db.prepare("ALTER TABLE categories ADD COLUMN reporting_group TEXT NOT NULL DEFAULT 'general'").run();
  }

  const hasIconKey = categoryColumns.results.some((column) => column.name === "icon_key");
  if (!hasIconKey && categoryColumns.results.length > 0) {
    await db.prepare("ALTER TABLE categories ADD COLUMN icon_key TEXT NOT NULL DEFAULT 'circle'").run();
  }

  const hasColorHex = categoryColumns.results.some((column) => column.name === "color_hex");
  if (!hasColorHex && categoryColumns.results.length > 0) {
    await db.prepare("ALTER TABLE categories ADD COLUMN color_hex TEXT NOT NULL DEFAULT '#6A7A73'").run();
  }

  const accountColumns = await db
    .prepare("PRAGMA table_info(accounts)")
    .all<{ name: string }>();

  const hasOpeningBalanceMinor = accountColumns.results.some((column) => column.name === "opening_balance_minor");
  if (!hasOpeningBalanceMinor && accountColumns.results.length > 0) {
    await db.prepare("ALTER TABLE accounts ADD COLUMN opening_balance_minor INTEGER NOT NULL DEFAULT 0").run();
  }

  const transactionColumns = await db
    .prepare("PRAGMA table_info(transactions)")
    .all<{ name: string }>();

  if (transactionColumns.results.length > 0 && !transactionColumns.results.some((column) => column.name === "bank_certification_status")) {
    await db.prepare("ALTER TABLE transactions ADD COLUMN bank_certification_status TEXT NOT NULL DEFAULT 'provisional'").run();
  }

  if (transactionColumns.results.length > 0 && !transactionColumns.results.some((column) => column.name === "statement_certified_import_id")) {
    await db.prepare("ALTER TABLE transactions ADD COLUMN statement_certified_import_id TEXT").run();
  }

  if (transactionColumns.results.length > 0 && !transactionColumns.results.some((column) => column.name === "statement_certified_import_row_id")) {
    await db.prepare("ALTER TABLE transactions ADD COLUMN statement_certified_import_row_id TEXT").run();
  }

  if (transactionColumns.results.length > 0 && !transactionColumns.results.some((column) => column.name === "statement_certified_at")) {
    await db.prepare("ALTER TABLE transactions ADD COLUMN statement_certified_at TEXT").run();
  }

  if (transactionColumns.results.length > 0 && !transactionColumns.results.some((column) => column.name === "transfer_review_dismissed_at")) {
    await db.prepare("ALTER TABLE transactions ADD COLUMN transfer_review_dismissed_at TEXT").run();
  }

  const peopleColumns = await db
    .prepare("PRAGMA table_info(people)")
    .all<{ name: string }>();

  const hasPeopleUpdatedAt = peopleColumns.results.some((column) => column.name === "updated_at");
  if (!hasPeopleUpdatedAt && peopleColumns.results.length > 0) {
    await db.prepare("ALTER TABLE people ADD COLUMN updated_at TEXT").run();
  }

  const loginIdentityColumns = await db
    .prepare("PRAGMA table_info(login_identities)")
    .all<{ name: string }>();

  const hasLoginIdentityUpdatedAt = loginIdentityColumns.results.some((column) => column.name === "updated_at");
  if (!hasLoginIdentityUpdatedAt && loginIdentityColumns.results.length > 0) {
    await db.prepare("ALTER TABLE login_identities ADD COLUMN updated_at TEXT").run();
  }

  await db
    .prepare(`
      CREATE TABLE IF NOT EXISTS account_balance_checkpoints (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        checkpoint_month TEXT NOT NULL,
        statement_start_date TEXT,
        statement_end_date TEXT,
        statement_balance_minor INTEGER NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (household_id) REFERENCES households(id),
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
        UNIQUE (account_id, checkpoint_month)
      )
    `)
    .run();

  await db
    .prepare(`
      CREATE TABLE IF NOT EXISTS statement_reconciliation_certificates (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        import_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        checkpoint_month TEXT NOT NULL,
        statement_start_date TEXT,
        statement_end_date TEXT,
        statement_row_count INTEGER NOT NULL DEFAULT 0,
        imported_row_count INTEGER NOT NULL DEFAULT 0,
        certified_existing_row_count INTEGER NOT NULL DEFAULT 0,
        already_covered_row_count INTEGER NOT NULL DEFAULT 0,
        needs_review_row_count INTEGER NOT NULL DEFAULT 0,
        debit_total_minor INTEGER NOT NULL DEFAULT 0,
        credit_total_minor INTEGER NOT NULL DEFAULT 0,
        net_total_minor INTEGER NOT NULL DEFAULT 0,
        statement_balance_minor INTEGER NOT NULL,
        projected_ledger_balance_minor INTEGER NOT NULL,
        delta_minor INTEGER NOT NULL,
        exception_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL CHECK (status IN ('certified', 'exception')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (household_id) REFERENCES households(id),
        FOREIGN KEY (import_id) REFERENCES imports(id) ON DELETE CASCADE,
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
      )
    `)
    .run();

  await db
    .prepare(`
      CREATE TABLE IF NOT EXISTS reconciliation_exceptions (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        account_id TEXT,
        transaction_id TEXT,
        checkpoint_month TEXT,
        kind TEXT NOT NULL CHECK (
          kind IN ('missing_bank_row', 'extra_ledger_row', 'duplicate', 'direction_mismatch', 'wrong_account', 'timing_difference', 'manual_review', 'adjustment_needed')
        ),
        severity TEXT NOT NULL DEFAULT 'review' CHECK (severity IN ('info', 'review', 'blocking')),
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
        title TEXT NOT NULL,
        note TEXT,
        resolution_note TEXT,
        resolved_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (household_id) REFERENCES households(id),
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL,
        FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL
      )
    `)
    .run();

  await db
    .prepare(`
      CREATE TABLE IF NOT EXISTS shortcut_request_nonces (
        nonce TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    .run();

  const checkpointColumns = await db
    .prepare("PRAGMA table_info(account_balance_checkpoints)")
    .all<{ name: string }>();

  const hasStatementStartDate = checkpointColumns.results.some((column) => column.name === "statement_start_date");
  if (!hasStatementStartDate && checkpointColumns.results.length > 0) {
    await db.prepare("ALTER TABLE account_balance_checkpoints ADD COLUMN statement_start_date TEXT").run();
  }

  const hasStatementEndDate = checkpointColumns.results.some((column) => column.name === "statement_end_date");
  if (!hasStatementEndDate && checkpointColumns.results.length > 0) {
    await db.prepare("ALTER TABLE account_balance_checkpoints ADD COLUMN statement_end_date TEXT").run();
  }

  await db
    .prepare(`
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        action TEXT NOT NULL,
        detail TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (household_id) REFERENCES households(id)
      )
    `)
    .run();

  await db
    .prepare(`
      CREATE TABLE IF NOT EXISTS split_groups (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        group_name TEXT NOT NULL,
        icon_key TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (household_id) REFERENCES households(id)
      )
    `)
    .run();

  await db
    .prepare(`
      CREATE TABLE IF NOT EXISTS split_batches (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        split_group_id TEXT,
        batch_name TEXT NOT NULL,
        opened_on TEXT NOT NULL,
        closed_on TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (household_id) REFERENCES households(id),
        FOREIGN KEY (split_group_id) REFERENCES split_groups(id)
      )
    `)
    .run();

  await db
    .prepare(`
      CREATE TABLE IF NOT EXISTS split_expenses (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        split_group_id TEXT,
        split_batch_id TEXT,
        payer_person_id TEXT NOT NULL,
        expense_date TEXT NOT NULL,
        description TEXT NOT NULL,
        category_id TEXT,
        total_amount_minor INTEGER NOT NULL,
        note TEXT,
        linked_transaction_id TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (household_id) REFERENCES households(id),
        FOREIGN KEY (split_group_id) REFERENCES split_groups(id),
        FOREIGN KEY (split_batch_id) REFERENCES split_batches(id),
        FOREIGN KEY (payer_person_id) REFERENCES people(id),
        FOREIGN KEY (category_id) REFERENCES categories(id),
        FOREIGN KEY (linked_transaction_id) REFERENCES transactions(id) ON DELETE SET NULL
      )
    `)
    .run();

  await db
    .prepare(`
      CREATE TABLE IF NOT EXISTS split_expense_shares (
        id TEXT PRIMARY KEY,
        split_expense_id TEXT NOT NULL,
        person_id TEXT NOT NULL,
        ratio_basis_points INTEGER NOT NULL CHECK (
          ratio_basis_points BETWEEN 0 AND 10000
        ),
        amount_minor INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (split_expense_id) REFERENCES split_expenses(id) ON DELETE CASCADE,
        FOREIGN KEY (person_id) REFERENCES people(id)
      )
    `)
    .run();

  await db
    .prepare(`
      CREATE TABLE IF NOT EXISTS split_settlements (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        split_group_id TEXT,
        split_batch_id TEXT,
        from_person_id TEXT NOT NULL,
        to_person_id TEXT NOT NULL,
        settlement_date TEXT NOT NULL,
        amount_minor INTEGER NOT NULL,
        note TEXT,
        linked_transaction_id TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (household_id) REFERENCES households(id),
        FOREIGN KEY (split_group_id) REFERENCES split_groups(id),
        FOREIGN KEY (split_batch_id) REFERENCES split_batches(id),
        FOREIGN KEY (from_person_id) REFERENCES people(id),
        FOREIGN KEY (to_person_id) REFERENCES people(id),
        FOREIGN KEY (linked_transaction_id) REFERENCES transactions(id) ON DELETE SET NULL
      )
    `)
    .run();

  const snapshotColumns = await db
    .prepare("PRAGMA table_info(monthly_snapshots)")
    .all<{ name: string }>();

  const hasEstimatedExpense = snapshotColumns.results.some((column) => column.name === "estimated_expense_minor");
  if (!hasEstimatedExpense && snapshotColumns.results.length > 0) {
    await db.prepare("ALTER TABLE monthly_snapshots ADD COLUMN estimated_expense_minor INTEGER NOT NULL DEFAULT 0").run();
  }

  const hasSavingsGoal = snapshotColumns.results.some((column) => column.name === "savings_goal_minor");
  if (!hasSavingsGoal && snapshotColumns.results.length > 0) {
    await db.prepare("ALTER TABLE monthly_snapshots ADD COLUMN savings_goal_minor INTEGER NOT NULL DEFAULT 0").run();
  }

  const splitExpenseColumns = await db.prepare("PRAGMA table_info(split_expenses)").all<{ name: string }>();
  if (splitExpenseColumns.results.length > 0 && !splitExpenseColumns.results.some((column) => column.name === "split_batch_id")) {
    await db.prepare("ALTER TABLE split_expenses ADD COLUMN split_batch_id TEXT").run();
  }

  const splitSettlementColumns = await db.prepare("PRAGMA table_info(split_settlements)").all<{ name: string }>();
  if (splitSettlementColumns.results.length > 0 && !splitSettlementColumns.results.some((column) => column.name === "split_batch_id")) {
    await db.prepare("ALTER TABLE split_settlements ADD COLUMN split_batch_id TEXT").run();
  }

  await ensureHotReadIndexes(db);
  await backfillSplitBatches(db);
}

async function ensureHotReadIndexes(db: D1Database) {
  const indexStatements = [
    "CREATE INDEX IF NOT EXISTS idx_imports_household_imported_at ON imports (household_id, imported_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_import_rows_import ON import_rows (import_id)",
    "CREATE INDEX IF NOT EXISTS idx_transactions_household_date ON transactions (household_id, transaction_date)",
    "CREATE INDEX IF NOT EXISTS idx_transactions_account_date ON transactions (account_id, transaction_date)",
    "CREATE INDEX IF NOT EXISTS idx_transactions_import ON transactions (import_id)",
    "CREATE INDEX IF NOT EXISTS idx_transactions_statement_certified_import ON transactions (statement_certified_import_id)",
    "CREATE INDEX IF NOT EXISTS idx_statement_reconciliation_certificates_import ON statement_reconciliation_certificates (import_id)",
    "CREATE INDEX IF NOT EXISTS idx_statement_reconciliation_certificates_account_period ON statement_reconciliation_certificates (account_id, statement_start_date, statement_end_date)",
    "CREATE INDEX IF NOT EXISTS idx_reconciliation_exceptions_household_status ON reconciliation_exceptions (household_id, status, updated_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_transactions_transfer_group ON transactions (transfer_group_id)",
    "CREATE INDEX IF NOT EXISTS idx_transaction_splits_transaction ON transaction_splits (transaction_id)",
    "CREATE INDEX IF NOT EXISTS idx_monthly_snapshots_household_month ON monthly_snapshots (household_id, year, month, person_scope)",
    "CREATE INDEX IF NOT EXISTS idx_monthly_snapshots_household_scope_month ON monthly_snapshots (household_id, person_scope, year, month)",
    "CREATE INDEX IF NOT EXISTS idx_monthly_plan_rows_household_month ON monthly_plan_rows (household_id, year, month, section_key)",
    "CREATE INDEX IF NOT EXISTS idx_split_expenses_household_date ON split_expenses (household_id, expense_date)",
    "CREATE INDEX IF NOT EXISTS idx_split_settlements_household_date ON split_settlements (household_id, settlement_date)",
    "CREATE INDEX IF NOT EXISTS idx_category_match_rules_household_active ON category_match_rules (household_id, is_active, priority)"
  ];

  await db.batch(indexStatements.map((statement) => db.prepare(statement)));
}

export async function reseedDemoData(db: D1Database, settings: DemoSettings) {
  await ensureDemoSchema(db);
  await clearDemoData(db);
  await seedDemoData(db, settings);
}

export async function seedEmptyStateReferenceData(db: D1Database) {
  await ensureDemoSchema(db);

  await db
    .prepare(`
      INSERT INTO households (id, name, base_currency)
      VALUES (?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `)
    .bind(defaultHousehold.id, defaultHousehold.name, defaultHousehold.baseCurrency)
    .run();

  const existingPeople = await loadSeedPeople(db);
  if (existingPeople.length) {
    await repairAccidentalEmptyStatePeople(db, existingPeople);
  } else {
    for (const person of EMPTY_STATE_PEOPLE) {
      await db
        .prepare(`
          INSERT INTO people (id, household_id, display_name, role)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO NOTHING
        `)
        .bind(person.id, defaultHousehold.id, person.name, person.role)
        .run();
    }
  }

  for (const category of defaultCategories) {
    await db
      .prepare(`
        INSERT INTO categories (
          id, household_id, name, slug, reporting_group,
          icon_key, color_hex, sort_order, is_system
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING
      `)
      .bind(
        category.id,
        defaultHousehold.id,
        category.name,
        category.slug,
        category.slug,
        category.iconKey,
        category.colorHex,
        category.sortOrder,
        category.isSystem ? 1 : 0
      )
      .run();
  }

  await ensureDefaultCategoryMatchRules(db);
  await ensureDefaultCategoryPalette(db);
}

async function ensureDefaultCategoryPalette(db: D1Database) {
  await db
    .prepare(`
      UPDATE categories
      SET color_hex = CASE
        WHEN id = 'cat-shopping' THEN ?
        WHEN id = 'cat-healthcare' THEN ?
        ELSE color_hex
      END
      WHERE household_id = ?
        AND (
          (id = 'cat-shopping' AND color_hex = ?)
          OR (id = 'cat-healthcare' AND color_hex = ?)
        )
    `)
    .bind(
      SHOPPING_COLOR_HEX,
      OLD_SHOPPING_COLOR_HEX,
      DEFAULT_HOUSEHOLD_ID,
      OLD_SHOPPING_COLOR_HEX,
      SHOPPING_COLOR_HEX
    )
    .run();
}

async function loadSeedPeople(db: D1Database) {
  const people = await db
    .prepare(`
      SELECT id, display_name
      FROM people
      WHERE household_id = ?
      ORDER BY created_at
    `)
    .bind(defaultHousehold.id)
    .all<{ id: string; display_name: string }>();

  return people.results;
}

async function repairAccidentalEmptyStatePeople(
  db: D1Database,
  existingPeople: { id: string; display_name: string }[]
) {
  const accidentalIds = new Set(EMPTY_STATE_PEOPLE.map((person) => person.id));
  const canonicalPeople = existingPeople.filter((person) => !accidentalIds.has(person.id));
  const accidentalPeople = existingPeople.filter((person) => accidentalIds.has(person.id));

  if (canonicalPeople.length < 2 || !accidentalPeople.length) {
    return;
  }

  const replacements = new Map([
    [EMPTY_PRIMARY_PERSON_ID, canonicalPeople[0].id],
    [EMPTY_PARTNER_PERSON_ID, canonicalPeople[1].id]
  ]);

  for (const accidentalPerson of accidentalPeople) {
    const replacementPersonId = replacements.get(accidentalPerson.id);
    if (!replacementPersonId) {
      continue;
    }

    await reassignPersonReferences(db, accidentalPerson.id, replacementPersonId);
    await db
      .prepare("DELETE FROM people WHERE household_id = ? AND id = ?")
      .bind(defaultHousehold.id, accidentalPerson.id)
      .run();
  }
}

async function reassignPersonReferences(db: D1Database, fromPersonId: string, toPersonId: string) {
  await db.prepare("UPDATE accounts SET owner_person_id = ? WHERE household_id = ? AND owner_person_id = ?").bind(toPersonId, defaultHousehold.id, fromPersonId).run();
  await db.prepare("UPDATE imports SET imported_by_person_id = ? WHERE household_id = ? AND imported_by_person_id = ?").bind(toPersonId, defaultHousehold.id, fromPersonId).run();
  await db.prepare("UPDATE transactions SET owner_person_id = ? WHERE household_id = ? AND owner_person_id = ?").bind(toPersonId, defaultHousehold.id, fromPersonId).run();
  await db.prepare("UPDATE split_expenses SET payer_person_id = ? WHERE household_id = ? AND payer_person_id = ?").bind(toPersonId, defaultHousehold.id, fromPersonId).run();
  await db.prepare("UPDATE split_settlements SET from_person_id = ? WHERE household_id = ? AND from_person_id = ?").bind(toPersonId, defaultHousehold.id, fromPersonId).run();
  await db.prepare("UPDATE split_settlements SET to_person_id = ? WHERE household_id = ? AND to_person_id = ?").bind(toPersonId, defaultHousehold.id, fromPersonId).run();
  await db.prepare("UPDATE monthly_notes SET created_by_person_id = ? WHERE household_id = ? AND created_by_person_id = ?").bind(toPersonId, defaultHousehold.id, fromPersonId).run();
  await db.prepare("UPDATE monthly_budgets SET person_id = ? WHERE household_id = ? AND person_id = ?").bind(toPersonId, defaultHousehold.id, fromPersonId).run();
  await db.prepare("UPDATE monthly_plan_rows SET person_id = ? WHERE household_id = ? AND person_id = ?").bind(toPersonId, defaultHousehold.id, fromPersonId).run();
  await db.prepare("UPDATE monthly_plan_match_hints SET person_id = ? WHERE household_id = ? AND person_id = ?").bind(toPersonId, defaultHousehold.id, fromPersonId).run();
  await db
    .prepare(`
      UPDATE transaction_splits
      SET person_id = ?
      WHERE person_id = ?
        AND transaction_id IN (
          SELECT id FROM transactions WHERE household_id = ?
        )
    `)
    .bind(toPersonId, fromPersonId, defaultHousehold.id)
    .run();
  await db
    .prepare(`
      UPDATE split_expense_shares
      SET person_id = ?
      WHERE person_id = ?
        AND split_expense_id IN (
          SELECT id FROM split_expenses WHERE household_id = ?
        )
    `)
    .bind(toPersonId, fromPersonId, defaultHousehold.id)
    .run();
  await db
    .prepare(`
      UPDATE monthly_plan_row_splits
      SET person_id = ?
      WHERE person_id = ?
        AND monthly_plan_row_id IN (
          SELECT id FROM monthly_plan_rows WHERE household_id = ?
        )
    `)
    .bind(toPersonId, fromPersonId, defaultHousehold.id)
    .run();
}

export async function clearDemoData(db: D1Database) {
  await db.prepare("PRAGMA defer_foreign_keys = ON").run();
  const deletions = [
    "DELETE FROM split_expense_shares",
    "DELETE FROM split_expenses",
    "DELETE FROM split_settlements",
    "DELETE FROM split_batches",
    "DELETE FROM split_groups",
    "DELETE FROM transaction_splits",
    "DELETE FROM monthly_plan_entry_links",
    "DELETE FROM monthly_plan_match_hints",
    "DELETE FROM transactions",
    "DELETE FROM monthly_plan_row_splits",
    "DELETE FROM monthly_plan_rows",
    "DELETE FROM monthly_budgets",
    "DELETE FROM monthly_notes",
    "DELETE FROM monthly_snapshots",
    "DELETE FROM statement_reconciliation_certificates",
    "DELETE FROM import_rows",
    "DELETE FROM imports",
    "DELETE FROM account_balance_checkpoints",
    "DELETE FROM audit_events",
    "DELETE FROM category_match_rule_suggestions",
    "DELETE FROM category_match_rules",
    "DELETE FROM login_identities",
    "DELETE FROM transfer_groups",
    "DELETE FROM categories",
    "DELETE FROM accounts",
    "DELETE FROM institutions",
    "DELETE FROM people",
    "DELETE FROM households"
  ];

  for (const statement of deletions) {
    await db.prepare(statement).run();
  }
  await db.prepare("PRAGMA defer_foreign_keys = OFF").run();
}

async function seedDemoData(db: D1Database, settings: DemoSettings) {
  await db
    .prepare("INSERT INTO households (id, name, base_currency) VALUES (?, ?, ?)")
    .bind(defaultHousehold.id, defaultHousehold.name, defaultHousehold.baseCurrency)
    .run();

  for (const person of defaultHousehold.people) {
    await db
      .prepare("INSERT INTO people (id, household_id, display_name, role) VALUES (?, ?, ?, ?)")
      .bind(person.id, defaultHousehold.id, person.name, person.id === DEMO_PRIMARY_PERSON_ID ? "owner" : "partner")
      .run();
  }

  const institutionNames = Array.from(new Set([
    ...demoAccounts.map((account) => account.institution),
    SHARED_ACCOUNT_INSTITUTION
  ]));
  const institutionIds = new Map<string, string>();

  for (const name of institutionNames) {
    const id = `inst-${slugify(name)}`;
    institutionIds.set(name, id);
    await db
      .prepare("INSERT INTO institutions (id, household_id, name) VALUES (?, ?, ?)")
      .bind(id, defaultHousehold.id, name)
      .run();
  }

  for (const account of demoAccounts) {
    const ownerPersonId = SEED_PERSON_IDS_BY_NAME.get(account.ownerLabel) ?? null;
    await db
      .prepare(`
        INSERT INTO accounts (
          id, household_id, institution_id, owner_person_id,
          account_name, account_kind, currency, is_joint
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        account.id,
        defaultHousehold.id,
        institutionIds.get(account.institution),
        ownerPersonId,
        account.name,
        mapAccountKind(account.kind),
        account.currency,
        account.isJoint ? 1 : 0
      )
      .run();
  }

  for (const category of defaultCategories) {
    await db
      .prepare(`
        INSERT INTO categories (
          id, household_id, name, slug, reporting_group,
          icon_key, color_hex, sort_order, is_system
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        category.id,
        defaultHousehold.id,
        category.name,
        category.slug,
        category.slug,
        category.iconKey,
        category.colorHex,
        category.sortOrder,
        category.isSystem ? 1 : 0
      )
      .run();
  }

  await ensureDefaultCategoryMatchRules(db);

  for (const item of demoImportBatches) {
    await db
      .prepare(`
        INSERT INTO imports (
          id, household_id, source_type, source_label, imported_at, status, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        item.id,
        defaultHousehold.id,
        item.sourceType,
        item.sourceLabel,
        item.importedAt,
        item.status,
        item.note ?? null
      )
      .run();
  }

  const transferGroupIdByTransactionId = new Map<string, string>();
  const transferEntries = demoMonthEntries.filter((entry) => entry.entryType === "transfer" && entry.linkedTransfer);
  if (transferEntries.length > 0) {
    const seen = new Set<string>();
    for (const entry of transferEntries) {
      const linkedId = entry.linkedTransfer?.transactionId;
      if (!linkedId || seen.has(entry.id) || seen.has(linkedId)) {
        continue;
      }

      const groupId = `tg-${entry.id}-${linkedId}`;
      transferGroupIdByTransactionId.set(entry.id, groupId);
      transferGroupIdByTransactionId.set(linkedId, groupId);
      seen.add(entry.id);
      seen.add(linkedId);

      await db
        .prepare("INSERT INTO transfer_groups (id, household_id, note, matched_confidence) VALUES (?, ?, ?, ?)")
        .bind(groupId, defaultHousehold.id, "Demo seeded transfer pair", 1)
        .run();
    }
  }

  for (const row of demoMonthPlanRows) {
    const monthKey = inferMonthKeyFromPlanRow(row.id);
    const [planYear, planMonth] = monthKey.split("-").map(Number);
    const planDate = buildPlanDate(monthKey, row.dayLabel);
    await db
      .prepare(`
        INSERT INTO monthly_plan_rows (
          id, household_id, year, month, person_id, ownership_type,
          section_key, category_id, label, plan_date, account_id,
          planned_amount_minor, actual_amount_minor, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        row.id,
        defaultHousehold.id,
        planYear,
        planMonth,
        row.ownerName ? SEED_PERSON_IDS_BY_NAME.get(row.ownerName) ?? null : null,
        row.ownershipType,
        row.section,
        findSeedCategoryId(row.categoryName),
        row.label,
        planDate,
        findSeedAccountId(row.accountName),
        row.plannedMinor,
        row.actualMinor,
        row.note ?? null
      )
      .run();

    for (const split of row.splits) {
      await db
        .prepare(`
          INSERT INTO monthly_plan_row_splits (
            id, monthly_plan_row_id, person_id, ratio_basis_points, amount_minor
          ) VALUES (?, ?, ?, ?, ?)
        `)
        .bind(
          `${row.id}-${split.personId}`,
          row.id,
          split.personId,
          split.ratioBasisPoints,
          split.amountMinor
        )
        .run();
    }
  }

  for (const monthKey of demoMonths) {
    const [year, month] = monthKey.split("-").map(Number);
    const seededIncomeRows = [
      ...buildMonthIncomeRows(DEMO_PRIMARY_PERSON_ID, settings.salaryPerPersonMinor).map((row) => ({
        ...row,
        id: `seed-${monthKey}-${DEMO_PRIMARY_PERSON_ID}-${row.id}`,
        personId: DEMO_PRIMARY_PERSON_ID
      })),
      ...buildMonthIncomeRows(DEMO_PARTNER_PERSON_ID, settings.salaryPerPersonMinor).map((row) => ({
        ...row,
        id: `seed-${monthKey}-${DEMO_PARTNER_PERSON_ID}-${row.id}`,
        personId: DEMO_PARTNER_PERSON_ID
      }))
    ];

    for (const row of seededIncomeRows) {
      await db
        .prepare(`
          INSERT INTO monthly_plan_rows (
            id, household_id, year, month, person_id, ownership_type,
            section_key, category_id, label, plan_date, account_id,
            planned_amount_minor, actual_amount_minor, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          row.id,
          defaultHousehold.id,
          year,
          month,
          row.personId,
          "direct",
          "income",
          findSeedCategoryId(row.categoryName),
          row.label,
          null,
          null,
          row.plannedMinor,
          row.actualMinor,
          row.note ?? null
        )
        .run();
    }
  }

  const summaryMonthsByView = buildSummaryMonthsByView(settings.salaryPerPersonMinor);
  for (const [personScope, months] of Object.entries(summaryMonthsByView)) {
    for (const month of months) {
      const [year, monthNumber] = month.month.split("-").map(Number);
      await db
        .prepare(`
        INSERT INTO monthly_snapshots (
          id, household_id, year, month, person_scope,
          total_income_minor, estimated_expense_minor, total_expense_minor,
          savings_goal_minor, total_net_minor, total_shared_minor, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          `snapshot-${personScope}-${month.month}`,
          defaultHousehold.id,
          year,
          monthNumber,
          personScope,
          month.plannedIncomeMinor,
          month.estimatedExpensesMinor,
          month.realExpensesMinor,
          month.savingsGoalMinor,
          month.realDiffMinor,
          0,
          month.note
        )
        .run();
    }
  }

  for (const entry of demoMonthEntries) {
    const directOwnerId = entry.ownerName ? SEED_PERSON_IDS_BY_NAME.get(entry.ownerName) ?? null : null;
    await db
      .prepare(`
        INSERT INTO transactions (
          id, household_id, account_id, transfer_group_id, transaction_date,
          description, amount_minor, currency, entry_type, transfer_direction,
          category_id, ownership_type, owner_person_id, offsets_category, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        entry.id,
        defaultHousehold.id,
        findSeedAccountId(entry.accountName),
        transferGroupIdByTransactionId.get(entry.id) ?? null,
        resolveSeededDemoTransactionDate(entry.id, entry.date),
        entry.description,
        entry.amountMinor,
        "SGD",
        entry.entryType,
        entry.transferDirection ?? null,
        findSeedCategoryId(entry.categoryName),
        entry.ownershipType,
        directOwnerId,
        entry.offsetsCategory ? 1 : 0,
        entry.note ?? null
      )
      .run();

    for (const split of entry.splits) {
      await db
        .prepare(`
          INSERT INTO transaction_splits (
            id, transaction_id, person_id, ratio_basis_points, amount_minor
          ) VALUES (?, ?, ?, ?, ?)
        `)
        .bind(
          `${entry.id}-${split.personId}`,
          entry.id,
          split.personId,
          split.ratioBasisPoints,
          split.amountMinor
        )
      .run();
    }
  }

  await seedDemoSplitData(db);

  for (const month of demoMonths) {
    await recalculateMonthlySnapshots(db, month);
  }
}

async function backfillDemoPlannedItemSeedData(db: D1Database) {
  let changed = false;

  for (const entry of demoMonthEntries) {
    const existingTransaction = await db
      .prepare("SELECT id, transaction_date FROM transactions WHERE id = ?")
      .bind(entry.id)
      .first<{ id: string; transaction_date: string }>();
    const seededDate = resolveSeededDemoTransactionDate(entry.id, entry.date);
    if (!existingTransaction) {
      const directOwnerId = entry.ownerName ? SEED_PERSON_IDS_BY_NAME.get(entry.ownerName) ?? null : null;
      await db
        .prepare(`
          INSERT INTO transactions (
            id, household_id, account_id, transfer_group_id, transaction_date,
            description, amount_minor, currency, entry_type, transfer_direction,
            category_id, ownership_type, owner_person_id, offsets_category, note
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          entry.id,
          defaultHousehold.id,
          findSeedAccountId(entry.accountName),
          null,
          seededDate,
          entry.description,
          entry.amountMinor,
          "SGD",
          entry.entryType,
          entry.transferDirection ?? null,
          findSeedCategoryId(entry.categoryName),
          entry.ownershipType,
          directOwnerId,
          entry.offsetsCategory ? 1 : 0,
          entry.note ?? null
        )
        .run();

      for (const split of entry.splits) {
        await db
          .prepare(`
            INSERT INTO transaction_splits (
              id, transaction_id, person_id, ratio_basis_points, amount_minor
            ) VALUES (?, ?, ?, ?, ?)
          `)
          .bind(
            `${entry.id}-${split.personId}`,
            entry.id,
            split.personId,
            split.ratioBasisPoints,
            split.amountMinor
          )
          .run();
      }

      changed = true;
    } else if (existingTransaction.transaction_date !== seededDate) {
      await db
        .prepare("UPDATE transactions SET transaction_date = ? WHERE id = ?")
        .bind(seededDate, entry.id)
        .run();
      changed = true;
    }
  }

  for (const row of demoMonthPlanRows) {
    for (const entryId of row.linkedEntryIds ?? []) {
      const existingLink = await db
        .prepare(`
          SELECT id
          FROM monthly_plan_entry_links
          WHERE monthly_plan_row_id = ? AND transaction_id = ?
        `)
        .bind(row.id, entryId)
        .first<{ id: string }>();
      if (existingLink) {
        continue;
      }

      const transactionExists = await db
        .prepare("SELECT id FROM transactions WHERE id = ?")
        .bind(entryId)
        .first<{ id: string }>();
      if (!transactionExists) {
        continue;
      }

      await db
        .prepare(`
          INSERT INTO monthly_plan_entry_links (
            id, monthly_plan_row_id, transaction_id
          ) VALUES (?, ?, ?)
        `)
        .bind(`${row.id}-${entryId}`, row.id, entryId)
        .run();

      changed = true;
    }
  }

  return changed;
}

async function seedDemoSplitData(db: D1Database) {
  const groupSeeds = [
    { id: "split-group-baby-river", name: "Baby River", iconKey: "heart-pulse", sortOrder: 1 },
    { id: "split-group-okaeri", name: "Okaeri", iconKey: "house", sortOrder: 2 }
  ];

  for (const group of groupSeeds) {
    await db
      .prepare(`
        INSERT INTO split_groups (
          id, household_id, group_name, icon_key, sort_order
        ) VALUES (?, ?, ?, ?, ?)
      `)
      .bind(group.id, DEFAULT_HOUSEHOLD_ID, group.name, group.iconKey, group.sortOrder)
      .run();
  }

  const batchSeeds = [
    {
      id: "split-batch-okaeri-closed",
      groupId: "split-group-okaeri",
      name: "Okaeri settled batch",
      openedOn: "2025-10-03",
      closedOn: "2025-10-22"
    },
    {
      id: "split-batch-baby-river-open",
      groupId: "split-group-baby-river",
      name: "Baby River current batch",
      openedOn: "2025-10-12",
      closedOn: null
    },
    {
      id: "split-batch-none-open",
      groupId: null,
      name: "Non-group current batch",
      openedOn: "2025-10-06",
      closedOn: null
    }
  ];

  for (const batch of batchSeeds) {
    await db
      .prepare(`
        INSERT INTO split_batches (
          id, household_id, split_group_id, batch_name, opened_on, closed_on
        ) VALUES (?, ?, ?, ?, ?, ?)
      `)
      .bind(batch.id, DEFAULT_HOUSEHOLD_ID, batch.groupId, batch.name, batch.openedOn, batch.closedOn)
      .run();
  }

  const importedTransactionSeeds = [
    {
      id: "txn-import-split-pantry-match",
      importId: "import-2025-10-citi",
      accountName: "Citi Rewards",
      date: "2025-10-18",
      description: "Pantry restock imported from Citi",
      categoryName: "Groceries",
      entryType: "expense",
      ownershipType: "direct",
      ownerName: "Joyce",
      amountMinor: 18640,
      note: "Imported card row awaiting a split match."
    },
    {
      id: "txn-import-split-baby-river-linked",
      importId: "import-2025-10-uob",
      accountName: "UOB Lady's",
      date: "2025-10-12",
      description: "Baby River family support import",
      categoryName: "Family & Personal",
      entryType: "expense",
      ownershipType: "shared",
      amountMinor: 23407,
      splitBasisPoints: 5000,
      note: "Imported row already linked to the split expense."
    },
    {
      id: "txn-import-split-settlement-match",
      importId: "import-2025-10-uob",
      accountName: "UOB Savings",
      date: "2025-10-18",
      description: "Joyce paynow settle up",
      categoryName: "Transfer",
      entryType: "transfer",
      transferDirection: "in",
      ownershipType: "direct",
      ownerName: "Tim",
      amountMinor: 4580,
      note: "Imported transfer waiting to be linked to a split settlement."
    }
  ];

  for (const transaction of importedTransactionSeeds) {
    const directOwnerId = transaction.ownerName ? SEED_PERSON_IDS_BY_NAME.get(transaction.ownerName) ?? null : null;
    await db
      .prepare(`
        INSERT INTO transactions (
          id, household_id, import_id, account_id, transaction_date,
          description, amount_minor, currency, entry_type, transfer_direction,
          category_id, ownership_type, owner_person_id, offsets_category, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        transaction.id,
        DEFAULT_HOUSEHOLD_ID,
        transaction.importId,
        findSeedAccountId(transaction.accountName),
        transaction.date,
        transaction.description,
        transaction.amountMinor,
        "SGD",
        transaction.entryType,
        transaction.transferDirection ?? null,
        findSeedCategoryId(transaction.categoryName),
        transaction.ownershipType,
        directOwnerId,
        0,
        transaction.note ?? null
      )
      .run();

    await syncTransactionSplits(db, {
      transactionId: transaction.id,
      ownershipType: transaction.ownershipType,
      amountMinor: transaction.amountMinor,
      ownerName: transaction.ownershipType === "direct" ? transaction.ownerName : undefined,
      splitBasisPoints: transaction.ownershipType === "shared" ? transaction.splitBasisPoints : undefined
    });
  }

  const expenseSeeds = [
    {
      id: "split-expense-okaeri-dining",
      groupId: "split-group-okaeri",
      batchId: "split-batch-okaeri-closed",
      payerPersonId: DEMO_PRIMARY_PERSON_ID,
      date: "2025-10-03",
      description: "October dining",
      categoryName: "Food & Drinks",
      totalAmountMinor: 71319,
      note: "Manual split record before CSV was imported."
    },
    {
      id: "split-expense-baby-river-family",
      groupId: "split-group-baby-river",
      batchId: "split-batch-baby-river-open",
      payerPersonId: DEMO_PARTNER_PERSON_ID,
      date: "2025-10-12",
      description: "Family support",
      categoryName: "Family & Personal",
      totalAmountMinor: 23407,
      note: "Family spending tracked outside the bank import flow.",
      linkedTransactionId: "txn-import-split-baby-river-linked"
    },
    {
      id: "split-expense-nongroup-groceries",
      groupId: null,
      batchId: "split-batch-none-open",
      payerPersonId: DEMO_PARTNER_PERSON_ID,
      date: "2025-10-06",
      description: "October groceries",
      categoryName: "Groceries",
      totalAmountMinor: 24251,
      note: "Shared expense tracked without a named group."
    },
    {
      id: "split-expense-nongroup-pantry-match",
      groupId: null,
      batchId: "split-batch-none-open",
      payerPersonId: DEMO_PARTNER_PERSON_ID,
      date: "2025-10-18",
      description: "Pantry restock",
      categoryName: "Groceries",
      totalAmountMinor: 18640,
      note: "Tracked in splits before the imported grocery charge was reviewed."
    }
  ];

  for (const expense of expenseSeeds) {
    await db
      .prepare(`
        INSERT INTO split_expenses (
          id, household_id, split_group_id, split_batch_id, payer_person_id, expense_date,
          description, category_id, total_amount_minor, note, linked_transaction_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        expense.id,
        DEFAULT_HOUSEHOLD_ID,
        expense.groupId,
        expense.batchId,
        expense.payerPersonId,
        expense.date,
        expense.description,
        findSeedCategoryId(expense.categoryName),
        expense.totalAmountMinor,
        expense.note,
        expense.linkedTransactionId ?? null
      )
      .run();

    const primaryShare = Math.floor(expense.totalAmountMinor / 2);
    const secondaryShare = expense.totalAmountMinor - primaryShare;
    const shareRows = [
      { personId: DEMO_PRIMARY_PERSON_ID, amountMinor: primaryShare },
      { personId: DEMO_PARTNER_PERSON_ID, amountMinor: secondaryShare }
    ];

    for (const share of shareRows) {
      await db
        .prepare(`
          INSERT INTO split_expense_shares (
            id, split_expense_id, person_id, ratio_basis_points, amount_minor
          ) VALUES (?, ?, ?, ?, ?)
        `)
        .bind(
          `${expense.id}-${share.personId}`,
          expense.id,
          share.personId,
          share.personId === DEMO_PRIMARY_PERSON_ID ? 5000 : 5000,
          share.amountMinor
        )
        .run();
    }
  }

  const settlementSeeds = [
    {
      id: "split-settlement-okaeri",
      groupId: "split-group-okaeri",
      batchId: "split-batch-okaeri-closed",
      fromPersonId: DEMO_PARTNER_PERSON_ID,
      toPersonId: DEMO_PRIMARY_PERSON_ID,
      date: "2025-10-22",
      amountMinor: 93150,
      note: "Manual settle-up recorded before bank transfer was linked."
    },
    {
      id: "split-settlement-nongroup-transfer-match",
      groupId: null,
      batchId: "split-batch-none-open",
      fromPersonId: DEMO_PARTNER_PERSON_ID,
      toPersonId: DEMO_PRIMARY_PERSON_ID,
      date: "2025-10-18",
      amountMinor: 4580,
      note: "Cash float settle-up waiting for the imported transfer row."
    }
  ];

  for (const settlement of settlementSeeds) {
    await db
      .prepare(`
        INSERT INTO split_settlements (
          id, household_id, split_group_id, split_batch_id, from_person_id, to_person_id,
          settlement_date, amount_minor, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        settlement.id,
        DEFAULT_HOUSEHOLD_ID,
        settlement.groupId,
        settlement.batchId,
        settlement.fromPersonId,
        settlement.toPersonId,
        settlement.date,
        settlement.amountMinor,
        settlement.note
      )
      .run();
  }
}

export async function duplicateMonthPlan(db: D1Database, sourceMonth: string) {
  const targetMonth = nextMonthKey(sourceMonth);
  const [sourceYear, sourceMonthNumber] = sourceMonth.split("-").map(Number);
  const [targetYear, targetMonthNumber] = targetMonth.split("-").map(Number);

  const existingTarget = await db
    .prepare(`
      SELECT COUNT(*) as count
      FROM monthly_plan_rows
      WHERE household_id = ? AND year = ? AND month = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, targetYear, targetMonthNumber)
    .first<{ count: number }>();

  if ((existingTarget?.count ?? 0) > 0) {
    return { targetMonth, created: false };
  }

  const rows = await db
    .prepare(`
      SELECT
        id, person_id, ownership_type, section_key, category_id, label,
        plan_date, account_id, planned_amount_minor, notes
      FROM monthly_plan_rows
      WHERE household_id = ? AND year = ? AND month = ?
      ORDER BY created_at
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, sourceYear, sourceMonthNumber)
    .all<{
      id: string;
      person_id: string | null;
      ownership_type: "direct" | "shared";
      section_key: "income" | "planned_items" | "budget_buckets";
      category_id: string | null;
      label: string;
      plan_date: string | null;
      account_id: string | null;
      planned_amount_minor: number;
      notes: string | null;
    }>();

  const rowIds = rows.results.map((row) => row.id);
  const splitMap = new Map<string, { person_id: string; ratio_basis_points: number }[]>();
  if (rowIds.length) {
    const placeholders = rowIds.map(() => "?").join(", ");
    const splits = await db
      .prepare(`
        SELECT monthly_plan_row_id, person_id, ratio_basis_points
        FROM monthly_plan_row_splits
        WHERE monthly_plan_row_id IN (${placeholders})
        ORDER BY created_at
      `)
      .bind(...rowIds)
      .all<{
        monthly_plan_row_id: string;
        person_id: string;
        ratio_basis_points: number;
      }>();

    for (const split of splits.results) {
      const current = splitMap.get(split.monthly_plan_row_id) ?? [];
      current.push(split);
      splitMap.set(split.monthly_plan_row_id, current);
    }
  }

  const idMap = new Map<string, string>();

  for (const row of rows.results) {
    const nextId = `${row.id}-dup-${targetMonth}`;
    idMap.set(row.id, nextId);
    await db
      .prepare(`
        INSERT INTO monthly_plan_rows (
          id, household_id, year, month, person_id, ownership_type,
          section_key, category_id, label, plan_date, account_id,
          planned_amount_minor, actual_amount_minor, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        nextId,
        DEFAULT_HOUSEHOLD_ID,
        targetYear,
        targetMonthNumber,
        row.person_id,
        row.ownership_type,
        row.section_key,
        row.category_id,
        row.label,
        shiftPlanDate(row.plan_date, targetYear, targetMonthNumber),
        row.account_id,
        row.planned_amount_minor,
        0,
        row.notes
      )
      .run();

    for (const split of splitMap.get(row.id) ?? []) {
      await db
        .prepare(`
          INSERT INTO monthly_plan_row_splits (
            id, monthly_plan_row_id, person_id, ratio_basis_points, amount_minor
          ) VALUES (?, ?, ?, ?, ?)
        `)
        .bind(
          `${nextId}-${split.person_id}`,
          nextId,
          split.person_id,
          split.ratio_basis_points,
          0
        )
        .run();
    }
  }

  const personScopes = await loadPersonScopes(db);
  for (const personScope of personScopes) {
    const incomeRows = await loadMonthIncomeRows(db, personScope, targetMonth);
    const planRows = await loadMonthPlanRows(db, targetMonth);
    const visibleRows = buildSnapshotRowsForScope(planRows, personScope);
    const plannedExpenseMinor = visibleRows.reduce((sum, row) => sum + row.plannedMinor, 0);
    const incomeMinor = incomeRows.reduce((sum, row) => sum + row.plannedMinor, 0);
    const savingsGoalMinor = visibleRows.filter((row) => row.label === "Savings").reduce((sum, row) => sum + row.plannedMinor, 0);

    await db
      .prepare(`
        INSERT INTO monthly_snapshots (
          id, household_id, year, month, person_scope,
          total_income_minor, estimated_expense_minor, total_expense_minor,
          savings_goal_minor, total_net_minor, total_shared_minor, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        `snapshot-${personScope}-${targetMonth}`,
        DEFAULT_HOUSEHOLD_ID,
        targetYear,
        targetMonthNumber,
        personScope,
        incomeMinor,
        plannedExpenseMinor,
        0,
        savingsGoalMinor,
        incomeMinor - plannedExpenseMinor,
        0,
        `Created from ${sourceMonth} planning template.`
      )
      .run();
  }

  return { targetMonth, created: true };
}

export async function resetMonthPlan(db: D1Database, month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  await clearMonthData(db, month, year, monthNumber);

  const personScopes = await loadPersonScopes(db);
  for (const personScope of personScopes) {
    await db
      .prepare(`
        INSERT INTO monthly_snapshots (
          id, household_id, year, month, person_scope,
          total_income_minor, estimated_expense_minor, total_expense_minor,
          savings_goal_minor, total_net_minor, total_shared_minor, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          total_income_minor = excluded.total_income_minor,
          estimated_expense_minor = excluded.estimated_expense_minor,
          total_expense_minor = excluded.total_expense_minor,
          savings_goal_minor = excluded.savings_goal_minor,
          total_net_minor = excluded.total_net_minor,
          total_shared_minor = excluded.total_shared_minor,
          note = excluded.note
      `)
      .bind(
        `snapshot-${personScope}-${month}`,
        DEFAULT_HOUSEHOLD_ID,
        year,
        monthNumber,
        personScope,
        0,
        0,
        0,
        0,
        0,
        0,
        "Month reset to empty."
      )
      .run();
  }

  return { month, reset: true };
}

export async function deleteMonthPlan(db: D1Database, month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  await clearMonthData(db, month, year, monthNumber);

  await db
    .prepare(`
      DELETE FROM monthly_snapshots
      WHERE household_id = ?
        AND year = ?
        AND month = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, year, monthNumber)
    .run();

  return { month, deleted: true };
}

async function assertUnlockedBankFactsForEntryUpdate(
  db: D1Database,
  input: {
    transactionId: string;
    current: {
      account_id: string;
      transaction_date: string;
      description: string;
      amount_minor: number;
      entry_type: "expense" | "income" | "transfer";
      transfer_direction: "in" | "out" | null;
      bank_certification_status: "provisional" | "statement_certified";
    };
    next: {
      accountId: string;
      date: string;
      description: string;
      amountMinor: number;
      entryType: "expense" | "income" | "transfer";
      transferDirection: "in" | "out" | null;
    };
  }
) {
  if (input.current.bank_certification_status !== "statement_certified") {
    return;
  }

  const bankFactsChanged = input.current.account_id !== input.next.accountId
    || input.current.transaction_date !== input.next.date
    || input.current.description !== input.next.description
    || Number(input.current.amount_minor) !== Number(input.next.amountMinor)
    || input.current.entry_type !== input.next.entryType
    || (input.current.transfer_direction ?? null) !== (input.next.transferDirection ?? null);

  if (!bankFactsChanged) {
    return;
  }

  const lockedCheckpoint = await findClosedStatementCheckpointForTransaction(db, {
    accountId: input.current.account_id,
    transactionDate: input.current.transaction_date
  });

  if (!lockedCheckpoint) {
    return;
  }

  throw new Error(
    `This entry's bank facts are locked by the ${lockedCheckpoint.checkpoint_month} statement certificate. Change category, note, ownership, or splits here; use a replacement statement or adjustment for bank-fact corrections.`
  );
}

async function findClosedStatementCheckpointForTransaction(
  db: D1Database,
  input: {
    accountId: string;
    transactionDate: string;
  }
) {
  return db
    .prepare(`
      SELECT checkpoint_month, statement_start_date, statement_end_date
      FROM account_balance_checkpoints
      WHERE household_id = ?
        AND account_id = ?
        AND COALESCE(statement_start_date, checkpoint_month || '-01') <= ?
        AND COALESCE(statement_end_date, date(checkpoint_month || '-01', '+1 month', '-1 day')) >= ?
      ORDER BY statement_end_date DESC, checkpoint_month DESC
      LIMIT 1
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, input.accountId, input.transactionDate, input.transactionDate)
    .first<{ checkpoint_month: string; statement_start_date: string | null; statement_end_date: string | null }>();
}

export async function updateEntryRecord(
  db: D1Database,
  input: {
    entryId: string;
    date: string;
    description: string;
    accountId?: string;
    accountName?: string;
    categoryName: string;
    amountMinor?: number;
    entryType?: "expense" | "income" | "transfer";
    transferDirection?: "in" | "out";
    ownershipType: "direct" | "shared";
    ownerName?: string;
    offsetsCategory?: boolean;
    note?: string;
    splitBasisPoints?: number;
  }
) {
  const account = input.accountId
    ? await db
      .prepare("SELECT id, account_name FROM accounts WHERE household_id = ? AND id = ?")
      .bind(DEFAULT_HOUSEHOLD_ID, input.accountId)
      .first<{ id: string; account_name: string }>()
    : await db
      .prepare("SELECT id, account_name FROM accounts WHERE household_id = ? AND account_name = ?")
      .bind(DEFAULT_HOUSEHOLD_ID, input.accountName ?? "")
      .first<{ id: string; account_name: string }>();

  if (!account) {
    throw new Error(`Unknown account: ${input.accountName ?? input.accountId ?? "Unassigned"}`);
  }

  const category = await db
    .prepare("SELECT id FROM categories WHERE household_id = ? AND name = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, input.categoryName)
    .first<{ id: string }>();

  if (!category) {
    throw new Error(`Unknown category: ${input.categoryName}`);
  }

  let ownerPersonId: string | null = null;
  if (input.ownershipType === "direct") {
    const owner = await db
      .prepare("SELECT id FROM people WHERE household_id = ? AND display_name = ?")
      .bind(DEFAULT_HOUSEHOLD_ID, input.ownerName ?? "")
      .first<{ id: string }>();

    if (!owner) {
      throw new Error(`Unknown owner: ${input.ownerName ?? ""}`);
    }

    ownerPersonId = owner.id;
  }

  const transaction = await db
    .prepare(`
      SELECT
        transactions.amount_minor,
        transactions.account_id,
        transactions.transaction_date,
        transactions.transfer_group_id,
        transactions.transfer_direction,
        transactions.entry_type,
        transactions.description,
        transactions.bank_certification_status,
        categories.name AS category_name
      FROM transactions
      LEFT JOIN categories ON categories.id = transactions.category_id
      WHERE transactions.id = ? AND transactions.household_id = ?
    `)
    .bind(input.entryId, DEFAULT_HOUSEHOLD_ID)
    .first<{
      amount_minor: number;
      account_id: string;
      transaction_date: string;
      transfer_group_id: string | null;
      transfer_direction: "in" | "out" | null;
      entry_type: "expense" | "income" | "transfer";
      description: string;
      bank_certification_status: "provisional" | "statement_certified";
      category_name: string | null;
    }>();

  if (!transaction) {
    throw new Error(`Unknown entry: ${input.entryId}`);
  }

  const resolvedAmountMinor = typeof input.amountMinor === "number" && input.amountMinor > 0
    ? input.amountMinor
    : Number(transaction.amount_minor);
  const resolvedEntryType = input.entryType ?? transaction.entry_type;
  const resolvedTransferDirection = resolvedEntryType === "transfer"
    ? (input.transferDirection ?? transaction.transfer_direction ?? "out")
    : null;

  await assertUnlockedBankFactsForEntryUpdate(db, {
    transactionId: input.entryId,
    current: transaction,
    next: {
      accountId: account.id,
      date: input.date,
      description: input.description,
      amountMinor: resolvedAmountMinor,
      entryType: resolvedEntryType,
      transferDirection: resolvedTransferDirection
    }
  });

  await db
    .prepare(`
      UPDATE transactions
      SET
        transaction_date = ?,
        description = ?,
        account_id = ?,
        amount_minor = ?,
        entry_type = ?,
        transfer_direction = ?,
        transfer_group_id = ?,
        category_id = ?,
        ownership_type = ?,
        owner_person_id = ?,
        offsets_category = ?,
        note = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND household_id = ?
    `)
    .bind(
      input.date,
      input.description,
      account.id,
      resolvedAmountMinor,
      resolvedEntryType,
      resolvedTransferDirection,
      resolvedEntryType === "transfer" ? transaction.transfer_group_id : null,
      category.id,
      input.ownershipType,
      ownerPersonId,
      input.offsetsCategory ? 1 : 0,
      input.note ?? null,
      input.entryId,
      DEFAULT_HOUSEHOLD_ID
    )
    .run();

  if (resolvedEntryType !== "transfer" && transaction.transfer_group_id) {
    await db
      .prepare("UPDATE transactions SET transfer_group_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE household_id = ? AND transfer_group_id = ?")
      .bind(DEFAULT_HOUSEHOLD_ID, transaction.transfer_group_id)
      .run();
    await db
      .prepare("DELETE FROM transfer_groups WHERE household_id = ? AND id = ?")
      .bind(DEFAULT_HOUSEHOLD_ID, transaction.transfer_group_id)
      .run();
  }

  await db.prepare("DELETE FROM transaction_splits WHERE transaction_id = ?").bind(input.entryId).run();

  if (input.ownershipType === "direct" && ownerPersonId && input.ownerName) {
    await db
      .prepare(`
        INSERT INTO transaction_splits (
          id, transaction_id, person_id, ratio_basis_points, amount_minor
        ) VALUES (?, ?, ?, ?, ?)
      `)
      .bind(
        `${input.entryId}-split-direct`,
        input.entryId,
        ownerPersonId,
        10000,
        resolvedAmountMinor
      )
      .run();
  }

  if (input.ownershipType === "shared") {
    const people = await db
      .prepare("SELECT id FROM people WHERE household_id = ? ORDER BY created_at LIMIT 2")
      .bind(DEFAULT_HOUSEHOLD_ID)
      .all<{ id: string }>();

    const [firstPerson, secondPerson] = people.results;
    if (!firstPerson || !secondPerson) {
      throw new Error("Shared entries require two people");
    }

    const firstBasisPoints = Math.max(0, Math.min(10000, input.splitBasisPoints ?? 5000));
    const secondBasisPoints = 10000 - firstBasisPoints;
    const firstAmount = Math.round((resolvedAmountMinor * firstBasisPoints) / 10000);
    const secondAmount = resolvedAmountMinor - firstAmount;

    await db
      .prepare(`
        INSERT INTO transaction_splits (
          id, transaction_id, person_id, ratio_basis_points, amount_minor
        ) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)
      `)
      .bind(
        `${input.entryId}-split-1`,
        input.entryId,
        firstPerson.id,
        firstBasisPoints,
        firstAmount,
        `${input.entryId}-split-2`,
        input.entryId,
        secondPerson.id,
        secondBasisPoints,
        secondAmount
      )
      .run();
  }

  const previousMonth = transaction.transaction_date.slice(0, 7);
  const nextMonth = input.date.slice(0, 7);
  await recalculateMonthlySnapshots(db, previousMonth);
  if (nextMonth !== previousMonth) {
    await recalculateMonthlySnapshots(db, nextMonth);
  }

  await recordAuditEvent(db, {
    entityType: "transaction",
    entityId: input.entryId,
    action: "entry_updated",
    detail: `Updated entry ${input.description} on ${input.date} in ${account.account_name}.`
  });

  if (transaction.category_name && transaction.category_name !== input.categoryName) {
    await recordCategoryMatchSuggestion(db, {
      description: input.description || transaction.description,
      categoryName: input.categoryName
    });
  }

  return { entryId: input.entryId, updated: true };
}

export async function updateEntryClassificationRecord(
  db: D1Database,
  input: {
    entryId: string;
    entryType: "expense" | "income" | "transfer";
    transferDirection?: "in" | "out";
    categoryName: string;
  }
) {
  const transaction = await db
    .prepare(`
      SELECT
        transactions.account_id,
        transactions.amount_minor,
        transactions.transfer_group_id,
        transactions.entry_type,
        transactions.transfer_direction,
        transactions.description,
        transactions.transaction_date,
        transactions.bank_certification_status,
        categories.name AS category_name
      FROM transactions
      LEFT JOIN categories ON categories.id = transactions.category_id
      WHERE transactions.id = ? AND transactions.household_id = ?
    `)
    .bind(input.entryId, DEFAULT_HOUSEHOLD_ID)
    .first<{
      account_id: string;
      amount_minor: number;
      transfer_group_id: string | null;
      entry_type: "expense" | "income" | "transfer";
      transfer_direction: "in" | "out" | null;
      description: string;
      transaction_date: string;
      bank_certification_status: "provisional" | "statement_certified";
      category_name: string | null;
    }>();

  if (!transaction) {
    throw new Error(`Unknown entry: ${input.entryId}`);
  }

  const category = await db
    .prepare("SELECT id FROM categories WHERE household_id = ? AND name = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, input.categoryName)
    .first<{ id: string }>();

  if (!category) {
    throw new Error(`Unknown category: ${input.categoryName}`);
  }

  const nextTransferDirection = input.entryType === "transfer" ? (input.transferDirection ?? "out") : null;
  const nextTransferGroupId = input.entryType === "transfer" ? transaction.transfer_group_id : null;

  await assertUnlockedBankFactsForEntryUpdate(db, {
    transactionId: input.entryId,
    current: transaction,
    next: {
      accountId: transaction.account_id,
      date: transaction.transaction_date,
      description: transaction.description,
      amountMinor: Number(transaction.amount_minor),
      entryType: input.entryType,
      transferDirection: nextTransferDirection
    }
  });

  await db
    .prepare(`
      UPDATE transactions
      SET
        entry_type = ?,
        transfer_direction = ?,
        transfer_group_id = ?,
        category_id = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND household_id = ?
    `)
    .bind(input.entryType, nextTransferDirection, nextTransferGroupId, category.id, input.entryId, DEFAULT_HOUSEHOLD_ID)
    .run();

  if (input.entryType !== "transfer" && transaction.transfer_group_id) {
    await db
      .prepare("UPDATE transactions SET transfer_group_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE household_id = ? AND transfer_group_id = ?")
      .bind(DEFAULT_HOUSEHOLD_ID, transaction.transfer_group_id)
      .run();
    await db
      .prepare("DELETE FROM transfer_groups WHERE household_id = ? AND id = ?")
      .bind(DEFAULT_HOUSEHOLD_ID, transaction.transfer_group_id)
      .run();
  }

  await recalculateMonthlySnapshots(db, transaction.transaction_date.slice(0, 7));
  await recordAuditEvent(db, {
    entityType: "transaction",
    entityId: input.entryId,
    action: "entry_classification_updated",
    detail: `Updated entry classification for ${transaction.description} on ${transaction.transaction_date}.`
  });

  if (transaction.category_name && transaction.category_name !== input.categoryName) {
    await recordCategoryMatchSuggestion(db, {
      description: transaction.description,
      categoryName: input.categoryName
    });
  }

  return { entryId: input.entryId, updated: true };
}

export async function createEntryRecord(
  db: D1Database,
  input: {
    date: string;
    description: string;
    accountId?: string;
    accountName?: string;
    categoryName: string;
    amountMinor: number;
    entryType: "expense" | "income" | "transfer";
    transferDirection?: "in" | "out";
    ownershipType: "direct" | "shared";
    ownerName?: string;
    offsetsCategory?: boolean;
    note?: string;
    splitBasisPoints?: number;
  }
) {
  if (typeof input.amountMinor !== "number" || input.amountMinor <= 0) {
    throw new Error("Amount must be greater than zero");
  }

  const accountId = input.accountId ?? await resolveAccountId(db, input.accountName);
  if (!accountId) {
    throw new Error(`Unknown account: ${input.accountName ?? "Unassigned"}`);
  }
  const accountName = input.accountName ?? await loadAccountName(db, accountId);
  const categoryName = input.entryType === "transfer" ? "Transfer" : input.categoryName;
  const categoryId = await resolveCategoryId(db, categoryName);
  const ownerPersonId = input.ownershipType === "direct"
    ? await resolvePersonId(db, input.ownerName)
    : null;
  const entryId = `txn-${crypto.randomUUID()}`;

  await db
    .prepare(`
      INSERT INTO transactions (
        id, household_id, account_id, transaction_date,
        description, amount_minor, currency, entry_type, transfer_direction,
        category_id, ownership_type, owner_person_id, offsets_category, note
      ) VALUES (?, ?, ?, ?, ?, ?, 'SGD', ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      entryId,
      DEFAULT_HOUSEHOLD_ID,
      accountId,
      input.date,
      input.description,
      input.amountMinor,
      input.entryType,
      input.entryType === "transfer" ? (input.transferDirection ?? "out") : null,
      categoryId,
      input.ownershipType,
      ownerPersonId,
      input.offsetsCategory ? 1 : 0,
      input.note ?? null
    )
    .run();

  await syncTransactionSplits(db, {
    transactionId: entryId,
    ownershipType: input.ownershipType,
    amountMinor: input.amountMinor,
    ownerName: input.ownershipType === "direct" ? input.ownerName : undefined,
    splitBasisPoints: input.ownershipType === "shared" ? input.splitBasisPoints : undefined
  });

  await recalculateMonthlySnapshots(db, input.date.slice(0, 7));

  await recordAuditEvent(db, {
    entityType: "transaction",
    entityId: entryId,
    action: "entry_created",
    detail: `Created ${input.entryType} entry ${input.description} on ${input.date} in ${accountName}.`
  });

  return { entryId, created: true };
}

export async function locateEntryDeepLinkContext(
  db: D1Database,
  entryId: string
): Promise<EntryDeepLinkContextDto | null> {
  const row = await db
    .prepare(`
      SELECT
        transactions.id,
        transactions.transaction_date,
        transactions.account_id,
        accounts.account_name
      FROM transactions
      INNER JOIN accounts ON accounts.id = transactions.account_id
      WHERE transactions.household_id = ?
        AND transactions.id = ?
      LIMIT 1
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, entryId)
    .first<{
      id: string;
      transaction_date: string;
      account_id: string;
      account_name: string;
    }>();

  if (!row) {
    return null;
  }

  return {
    entryId: row.id,
    month: row.transaction_date.slice(0, 7),
    accountId: row.account_id,
    accountName: row.account_name,
    viewId: "household"
  };
}

async function loadAccountName(db: D1Database, accountId: string | null) {
  if (!accountId) {
    return "Unassigned";
  }

  const account = await db
    .prepare("SELECT account_name FROM accounts WHERE household_id = ? AND id = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, accountId)
    .first<{ account_name: string }>();

  return account?.account_name ?? "Unassigned";
}

export async function linkTransferPair(
  db: D1Database,
  input: {
    fromEntryId: string;
    toEntryId: string;
  }
) {
  if (input.fromEntryId === input.toEntryId) {
    throw new Error("Transfer pair requires two different entries");
  }

  const [fromEntry, toEntry] = await Promise.all([
    db
      .prepare(`
        SELECT id, household_id, amount_minor, transfer_group_id, transaction_date
        FROM transactions
        WHERE id = ? AND household_id = ?
      `)
      .bind(input.fromEntryId, DEFAULT_HOUSEHOLD_ID)
      .first<{ id: string; household_id: string; amount_minor: number; transfer_group_id: string | null; transaction_date: string }>(),
    db
      .prepare(`
        SELECT id, household_id, amount_minor, transfer_group_id, transaction_date
        FROM transactions
        WHERE id = ? AND household_id = ?
      `)
      .bind(input.toEntryId, DEFAULT_HOUSEHOLD_ID)
      .first<{ id: string; household_id: string; amount_minor: number; transfer_group_id: string | null; transaction_date: string }>()
  ]);

  if (!fromEntry || !toEntry) {
    throw new Error("Transfer entries not found");
  }

  if (fromEntry.amount_minor !== toEntry.amount_minor) {
    throw new Error("Transfer matches require an exact amount match");
  }

  const transferCategory = await db
    .prepare("SELECT id FROM categories WHERE household_id = ? AND name = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, "Transfer")
    .first<{ id: string }>();

  if (!transferCategory) {
    throw new Error("Transfer category not found");
  }

  const staleGroupIds = [fromEntry.transfer_group_id, toEntry.transfer_group_id].filter(Boolean);
  for (const groupId of staleGroupIds) {
    await db
      .prepare("UPDATE transactions SET transfer_group_id = NULL WHERE household_id = ? AND transfer_group_id = ?")
      .bind(DEFAULT_HOUSEHOLD_ID, groupId)
      .run();
    await db
      .prepare("DELETE FROM transfer_groups WHERE household_id = ? AND id = ?")
      .bind(DEFAULT_HOUSEHOLD_ID, groupId)
      .run();
  }

  const groupId = `tg-${crypto.randomUUID()}`;
  await db
    .prepare("INSERT INTO transfer_groups (id, household_id, note, matched_confidence) VALUES (?, ?, ?, ?)")
    .bind(groupId, DEFAULT_HOUSEHOLD_ID, "Linked from entries editor", 1)
    .run();

  await Promise.all([
    db
      .prepare(`
        UPDATE transactions
        SET
          transfer_group_id = ?,
          entry_type = 'transfer',
          transfer_direction = 'out',
          category_id = ?,
          offsets_category = 0,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND household_id = ?
      `)
      .bind(groupId, transferCategory.id, input.fromEntryId, DEFAULT_HOUSEHOLD_ID)
      .run(),
    db
      .prepare(`
        UPDATE transactions
        SET
          transfer_group_id = ?,
          entry_type = 'transfer',
          transfer_direction = 'in',
          category_id = ?,
          offsets_category = 0,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND household_id = ?
      `)
      .bind(groupId, transferCategory.id, input.toEntryId, DEFAULT_HOUSEHOLD_ID)
      .run()
  ]);

  const months = new Set([fromEntry.transaction_date.slice(0, 7), toEntry.transaction_date.slice(0, 7)]);
  for (const month of months) {
    await recalculateMonthlySnapshots(db, month);
  }

  await recordAuditEvent(db, {
    entityType: "transfer_group",
    entityId: groupId,
    action: "transfer_linked",
    detail: `Linked transfer pair ${input.fromEntryId} -> ${input.toEntryId}.`
  });

  return { groupId, linked: true };
}

export async function settleTransferPair(
  db: D1Database,
  input: {
    entryId: string;
    counterpartEntryId?: string;
    currentCategoryName: string;
    counterpartCategoryName?: string;
  }
) {
  const [currentEntry, counterpartFromInput] = await Promise.all([
    db
      .prepare(`
        SELECT id, household_id, transfer_group_id, transfer_direction, transaction_date
        FROM transactions
        WHERE id = ? AND household_id = ?
      `)
      .bind(input.entryId, DEFAULT_HOUSEHOLD_ID)
      .first<{ id: string; household_id: string; transfer_group_id: string | null; transfer_direction: "in" | "out" | null; transaction_date: string }>(),
    input.counterpartEntryId
      ? db
          .prepare(`
            SELECT id, household_id, transfer_group_id, transfer_direction, transaction_date
            FROM transactions
            WHERE id = ? AND household_id = ?
          `)
          .bind(input.counterpartEntryId, DEFAULT_HOUSEHOLD_ID)
          .first<{ id: string; household_id: string; transfer_group_id: string | null; transfer_direction: "in" | "out" | null; transaction_date: string }>()
      : Promise.resolve(null)
  ]);

  if (!currentEntry) {
    throw new Error("Transfer entry not found");
  }

  let counterpartEntry = counterpartFromInput;
  if (!counterpartEntry && currentEntry.transfer_group_id) {
    counterpartEntry = await db
      .prepare(`
        SELECT id, household_id, transfer_group_id, transfer_direction, transaction_date
        FROM transactions
        WHERE household_id = ? AND transfer_group_id = ? AND id != ?
        LIMIT 1
      `)
      .bind(DEFAULT_HOUSEHOLD_ID, currentEntry.transfer_group_id, currentEntry.id)
      .first<{ id: string; household_id: string; transfer_group_id: string | null; transfer_direction: "in" | "out" | null; transaction_date: string }>();
  }

  const currentCategory = await db
    .prepare("SELECT id FROM categories WHERE household_id = ? AND name = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, input.currentCategoryName)
    .first<{ id: string }>();

  if (!currentCategory) {
    throw new Error(`Unknown category: ${input.currentCategoryName}`);
  }

  let counterpartCategoryId: string | null = null;
  if (counterpartEntry) {
    const counterpartCategory = await db
      .prepare("SELECT id FROM categories WHERE household_id = ? AND name = ?")
      .bind(DEFAULT_HOUSEHOLD_ID, input.counterpartCategoryName ?? "Other")
      .first<{ id: string }>();

    if (!counterpartCategory) {
      throw new Error(`Unknown counterpart category: ${input.counterpartCategoryName ?? "Other"}`);
    }

    counterpartCategoryId = counterpartCategory.id;
  }

  await db
    .prepare(`
      UPDATE transactions
      SET
        entry_type = ?,
        transfer_direction = NULL,
        transfer_group_id = NULL,
        category_id = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND household_id = ?
    `)
    .bind(
      currentEntry.transfer_direction === "in" ? "income" : "expense",
      currentCategory.id,
      currentEntry.id,
      DEFAULT_HOUSEHOLD_ID
    )
    .run();

  if (counterpartEntry && counterpartCategoryId) {
    await db
      .prepare(`
        UPDATE transactions
        SET
          entry_type = ?,
          transfer_direction = NULL,
          transfer_group_id = NULL,
          category_id = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND household_id = ?
      `)
      .bind(
        counterpartEntry.transfer_direction === "in" ? "income" : "expense",
        counterpartCategoryId,
        counterpartEntry.id,
        DEFAULT_HOUSEHOLD_ID
      )
      .run();
  }

  const groupIds = new Set([currentEntry.transfer_group_id, counterpartEntry?.transfer_group_id].filter(Boolean));
  for (const groupId of groupIds) {
    await db
      .prepare("DELETE FROM transfer_groups WHERE household_id = ? AND id = ?")
      .bind(DEFAULT_HOUSEHOLD_ID, groupId)
      .run();
  }

  const months = new Set([currentEntry.transaction_date.slice(0, 7), counterpartEntry?.transaction_date?.slice(0, 7)].filter(Boolean));
  for (const month of months) {
    await recalculateMonthlySnapshots(db, month);
  }

  await recordAuditEvent(db, {
    entityType: "transfer_group",
    entityId: currentEntry.transfer_group_id ?? currentEntry.id,
    action: "transfer_settled",
    detail: `Broke transfer pair and converted ${currentEntry.id}${counterpartEntry ? ` and ${counterpartEntry.id}` : ""} into regular categories.`
  });

  return { settled: true };
}

export async function updateMonthlySnapshotNote(
  db: D1Database,
  input: {
    month: string;
    personScope: string;
    note: string;
  }
) {
  const [year, monthNumber] = input.month.split("-").map(Number);
  const existing = await db
    .prepare(`
      SELECT id
      FROM monthly_snapshots
      WHERE household_id = ? AND year = ? AND month = ? AND person_scope = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, year, monthNumber, input.personScope)
    .first<{ id: string }>();

  if (existing) {
    await db
      .prepare(`
        UPDATE monthly_snapshots
        SET note = ?
        WHERE household_id = ? AND year = ? AND month = ? AND person_scope = ?
      `)
      .bind(input.note, DEFAULT_HOUSEHOLD_ID, year, monthNumber, input.personScope)
      .run();

    return { month: input.month, personScope: input.personScope, updated: true };
  }

  await db
    .prepare(`
      INSERT INTO monthly_snapshots (
        id, household_id, year, month, person_scope,
        total_income_minor, estimated_expense_minor, total_expense_minor,
        savings_goal_minor, total_net_minor, total_shared_minor, note
      ) VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, ?)
    `)
    .bind(
      `snapshot-${input.personScope}-${input.month}`,
      DEFAULT_HOUSEHOLD_ID,
      year,
      monthNumber,
      input.personScope,
      input.note
    )
    .run();

  return { month: input.month, personScope: input.personScope, updated: true };
}

export async function saveMonthPlanRow(
  db: D1Database,
  input: {
    rowId: string;
    month: string;
    sectionKey: "income" | "planned_items" | "budget_buckets";
    categoryName: string;
    label: string;
    planDate?: string | null;
    accountName?: string | null;
    plannedMinor: number;
    note?: string | null;
    ownershipType: "direct" | "shared";
    ownerName?: string;
    splitBasisPoints?: number;
  }
) {
  const [year, monthNumber] = input.month.split("-").map(Number);
  const categoryId = await resolveCategoryId(db, input.categoryName);
  const accountId = await resolveAccountId(db, input.accountName ?? undefined);
  const personId = input.ownershipType === "direct"
    ? await resolvePersonId(db, input.ownerName)
    : null;

  const existing = await db
    .prepare(`
      SELECT actual_amount_minor
      FROM monthly_plan_rows
      WHERE household_id = ? AND id = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, input.rowId)
    .first<{ actual_amount_minor: number }>();

  if (existing) {
    await db
      .prepare(`
        UPDATE monthly_plan_rows
        SET
          year = ?,
          month = ?,
          person_id = ?,
          ownership_type = ?,
          section_key = ?,
          category_id = ?,
          label = ?,
          plan_date = ?,
          account_id = ?,
          planned_amount_minor = ?,
          notes = ?
        WHERE household_id = ? AND id = ?
      `)
      .bind(
        year,
        monthNumber,
        personId,
        input.ownershipType,
        input.sectionKey,
        categoryId,
        input.label,
        input.sectionKey === "planned_items" ? (input.planDate ?? null) : null,
        input.sectionKey === "planned_items" ? accountId : null,
        input.plannedMinor,
        input.note ?? null,
        DEFAULT_HOUSEHOLD_ID,
        input.rowId
      )
      .run();
  } else {
    await db
      .prepare(`
        INSERT INTO monthly_plan_rows (
          id, household_id, year, month, person_id, ownership_type,
          section_key, category_id, label, plan_date, account_id,
          planned_amount_minor, actual_amount_minor, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        input.rowId,
        DEFAULT_HOUSEHOLD_ID,
        year,
        monthNumber,
        personId,
        input.ownershipType,
        input.sectionKey,
        categoryId,
        input.label,
        input.sectionKey === "planned_items" ? (input.planDate ?? null) : null,
        input.sectionKey === "planned_items" ? accountId : null,
        input.plannedMinor,
        0,
        input.note ?? null
      )
      .run();
  }

  await syncMonthlyPlanRowSplits(db, {
    rowId: input.rowId,
    ownershipType: input.ownershipType,
    plannedMinor: input.plannedMinor,
    ownerName: input.ownerName,
    splitBasisPoints: input.splitBasisPoints
  });

  await recalculateMonthlySnapshots(db, input.month);
  return { rowId: input.rowId, updated: true, created: !existing };
}

export async function saveMonthPlanEntryLinks(
  db: D1Database,
  input: {
    rowId: string;
    month: string;
    transactionIds: string[];
  }
) {
  const row = await db
    .prepare(`
      SELECT
        monthly_plan_rows.section_key,
        monthly_plan_rows.person_id,
        monthly_plan_rows.category_id,
        monthly_plan_rows.account_id,
        monthly_plan_rows.label
      FROM monthly_plan_rows
      WHERE household_id = ? AND id = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, input.rowId)
    .first<{
      section_key: "income" | "planned_items" | "budget_buckets";
      person_id: string | null;
      category_id: string | null;
      account_id: string | null;
      label: string;
    }>();

  if (!row || row.section_key !== "planned_items") {
    throw new Error("Only planned items can be linked to entries.");
  }

  const uniqueTransactionIds = [...new Set(input.transactionIds.filter(Boolean))];

  if (uniqueTransactionIds.length) {
    const placeholders = uniqueTransactionIds.map(() => "?").join(", ");
    const validTransactions = await db
      .prepare(`
        SELECT id
        FROM transactions
        WHERE household_id = ?
          AND entry_type = 'expense'
          AND id IN (${placeholders})
      `)
      .bind(DEFAULT_HOUSEHOLD_ID, ...uniqueTransactionIds)
      .all<{ id: string }>();
    const validIds = new Set(validTransactions.results.map((transaction) => transaction.id));
    const invalid = uniqueTransactionIds.find((transactionId) => !validIds.has(transactionId));
    if (invalid) {
      throw new Error("One or more selected entries cannot be linked.");
    }
  }

  const linkedTransactions = uniqueTransactionIds.length
    ? await db
        .prepare(`
          SELECT
            transactions.id,
            transactions.description,
            transactions.amount_minor,
            transactions.account_id,
            transactions.category_id
          FROM transactions
          WHERE transactions.household_id = ?
            AND transactions.id IN (${uniqueTransactionIds.map(() => "?").join(", ")})
        `)
        .bind(DEFAULT_HOUSEHOLD_ID, ...uniqueTransactionIds)
        .all<{
          id: string;
          description: string;
          amount_minor: number;
          account_id: string | null;
          category_id: string | null;
        }>()
    : { results: [] as Array<{ id: string; description: string; amount_minor: number; account_id: string | null; category_id: string | null }> };

  await db.prepare("DELETE FROM monthly_plan_entry_links WHERE monthly_plan_row_id = ?").bind(input.rowId).run();

  for (const transactionId of uniqueTransactionIds) {
    await db
      .prepare(`
        INSERT INTO monthly_plan_entry_links (
          id, monthly_plan_row_id, transaction_id
        ) VALUES (?, ?, ?)
      `)
      .bind(`mple-${input.rowId}-${transactionId}`, input.rowId, transactionId)
      .run();
  }

  const labelNormalized = normalizePlanMatchHint(row.label);
  for (const transaction of linkedTransactions.results) {
    const descriptionPattern = normalizePlanMatchHint(transaction.description);
    if (!descriptionPattern) {
      continue;
    }

    await db
      .prepare(`
        INSERT INTO monthly_plan_match_hints (
          id, household_id, person_id, category_id, account_id,
          label_normalized, description_pattern, amount_minor
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id)
        DO UPDATE SET amount_minor = excluded.amount_minor, updated_at = CURRENT_TIMESTAMP
      `)
      .bind(
        `mpmh-${slugify([row.person_id ?? "household", row.category_id ?? "any-category", transaction.account_id ?? "any-account", labelNormalized, descriptionPattern].join("-"))}`,
        DEFAULT_HOUSEHOLD_ID,
        row.person_id,
        transaction.category_id ?? row.category_id,
        transaction.account_id ?? row.account_id,
        labelNormalized,
        descriptionPattern,
        transaction.amount_minor
      )
      .run();
  }

  await recalculateMonthlySnapshots(db, input.month);
  return { rowId: input.rowId, linkedEntryCount: uniqueTransactionIds.length };
}

export async function deleteMonthPlanRow(
  db: D1Database,
  input: {
    rowId: string;
    month: string;
  }
) {
  await db
    .prepare("DELETE FROM monthly_plan_entry_links WHERE monthly_plan_row_id = ?")
    .bind(input.rowId)
    .run();

  await db
    .prepare("DELETE FROM monthly_plan_row_splits WHERE monthly_plan_row_id = ?")
    .bind(input.rowId)
    .run();

  await db
    .prepare("DELETE FROM monthly_plan_rows WHERE household_id = ? AND id = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, input.rowId)
    .run();

  await recalculateMonthlySnapshots(db, input.month);
  return { rowId: input.rowId, deleted: true };
}

async function clearMonthData(db: D1Database, month: string, year: number, monthNumber: number) {
  await db
    .prepare(`
      UPDATE split_expenses
      SET linked_transaction_id = NULL
      WHERE household_id = ?
        AND linked_transaction_id IN (
          SELECT id
          FROM transactions
          WHERE household_id = ?
            AND transaction_date >= ?
            AND transaction_date < ?
        )
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, DEFAULT_HOUSEHOLD_ID, `${month}-01`, nextMonthKey(month) + "-01")
    .run();

  await db
    .prepare(`
      UPDATE split_settlements
      SET linked_transaction_id = NULL
      WHERE household_id = ?
        AND linked_transaction_id IN (
          SELECT id
          FROM transactions
          WHERE household_id = ?
            AND transaction_date >= ?
            AND transaction_date < ?
        )
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, DEFAULT_HOUSEHOLD_ID, `${month}-01`, nextMonthKey(month) + "-01")
    .run();

  await db
    .prepare(`
      DELETE FROM monthly_plan_entry_links
      WHERE transaction_id IN (
        SELECT id
        FROM transactions
        WHERE household_id = ?
          AND transaction_date >= ?
          AND transaction_date < ?
      )
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, `${month}-01`, nextMonthKey(month) + "-01")
    .run();

  await db
    .prepare(`
      DELETE FROM transaction_splits
      WHERE transaction_id IN (
        SELECT id
        FROM transactions
        WHERE household_id = ?
          AND transaction_date >= ?
          AND transaction_date < ?
      )
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, `${month}-01`, nextMonthKey(month) + "-01")
    .run();

  await db
    .prepare(`
      DELETE FROM transactions
      WHERE household_id = ?
        AND transaction_date >= ?
        AND transaction_date < ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, `${month}-01`, nextMonthKey(month) + "-01")
    .run();

  await db
    .prepare(`
      DELETE FROM monthly_plan_entry_links
      WHERE monthly_plan_row_id IN (
        SELECT id
        FROM monthly_plan_rows
        WHERE household_id = ?
          AND year = ?
          AND month = ?
      )
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, year, monthNumber)
    .run();

  await db
    .prepare(`
      DELETE FROM monthly_plan_row_splits
      WHERE monthly_plan_row_id IN (
        SELECT id
        FROM monthly_plan_rows
        WHERE household_id = ?
          AND year = ?
          AND month = ?
      )
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, year, monthNumber)
    .run();

  await db
    .prepare(`
      DELETE FROM monthly_plan_rows
      WHERE household_id = ?
        AND year = ?
        AND month = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, year, monthNumber)
    .run();
}

export async function commitImportBatch(
  db: D1Database,
  input: {
    sourceLabel: string;
    sourceType?: "csv" | "pdf" | "manual";
    parserKey?: string;
    rows: ImportPreviewRowDto[];
    statementControlRows?: ImportPreviewRowDto[];
    statementReconciliations?: ImportPreviewStatementReconciliationDto[];
    statementCheckpoints?: StatementCheckpointDraftDto[];
    note?: string;
  }
) {
  const importId = `import-${crypto.randomUUID()}`;
  const monthsToRecalculate = new Set<string>();
  const isOfficialStatementImport = input.sourceType === "pdf";

  await db
    .prepare(`
      INSERT INTO imports (
        id, household_id, source_type, source_label, parser_key, imported_at, status, note
      ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'draft', ?)
    `)
    .bind(importId, DEFAULT_HOUSEHOLD_ID, input.sourceType ?? "csv", input.sourceLabel, input.parserKey ?? "generic_csv", input.note ?? null)
    .run();

  try {
    const [accountRows, categoryRows, personRows] = await Promise.all([
      db
        .prepare("SELECT id, account_name, account_kind, opening_balance_minor FROM accounts WHERE household_id = ?")
        .bind(DEFAULT_HOUSEHOLD_ID)
        .all<{ id: string; account_name: string; account_kind: string; opening_balance_minor: number }>(),
      db
        .prepare("SELECT id, name FROM categories WHERE household_id = ?")
        .bind(DEFAULT_HOUSEHOLD_ID)
        .all<{ id: string; name: string }>(),
      db
        .prepare("SELECT id, display_name FROM people WHERE household_id = ? ORDER BY created_at")
        .bind(DEFAULT_HOUSEHOLD_ID)
        .all<{ id: string; display_name: string }>()
    ]);
    const accountsById = new Map(accountRows.results.map((account) => [account.id, account]));
    const accountRowsByName = new Map<string, typeof accountRows.results>();
    for (const account of accountRows.results) {
      const current = accountRowsByName.get(account.account_name) ?? [];
      current.push(account);
      accountRowsByName.set(account.account_name, current);
    }
    const categoryIdsByName = new Map(categoryRows.results.map((category) => [category.name, category.id]));
    const personIdsByName = new Map(personRows.results.map((person) => [person.display_name, person.id]));
    const [firstPerson, secondPerson] = personRows.results;
    const statements: D1PreparedStatement[] = [];

    for (const row of input.rows) {
      const rowId = `import-row-${crypto.randomUUID()}`;
      const transactionId = `txn-${crypto.randomUUID()}`;
      const account = resolveImportAccount(accountsById, accountRowsByName, row.accountId, row.accountName);
      const accountId = account?.id ?? null;

      if (!accountId) {
        throw new Error(`Unknown account: ${row.accountName ?? "Unassigned"}`);
      }

      const categoryName = row.entryType === "transfer" ? "Transfer" : row.categoryName;
      const categoryId = categoryName ? categoryIdsByName.get(categoryName) : null;
      if (!categoryId) {
        throw new Error(`Unknown category: ${categoryName ?? "Unassigned"}`);
      }

      const directOwnerId = row.ownershipType === "direct" ? personIdsByName.get(row.ownerName ?? "") : null;
      if (row.ownershipType === "direct" && !directOwnerId) {
        throw new Error(`Unknown owner: ${row.ownerName ?? "Unassigned"}`);
      }

      const certificationTarget = isOfficialStatementImport && row.statementCertificationTargetTransactionId
        ? await db
          .prepare(`
            SELECT id, transaction_date
            FROM transactions
            WHERE household_id = ?
              AND id = ?
              AND account_id = ?
              AND bank_certification_status = 'provisional'
          `)
          .bind(DEFAULT_HOUSEHOLD_ID, row.statementCertificationTargetTransactionId, accountId)
          .first<{ id: string; transaction_date: string }>()
        : null;

      if (isOfficialStatementImport && row.statementCertificationTargetTransactionId && !certificationTarget) {
        throw new Error("Statement certification target is no longer available. Refresh the import preview and try again.");
      }

      statements.push(
        db
          .prepare(`
            INSERT INTO import_rows (
              id, import_id, row_index, assigned_account_id, raw_row_json, normalized_hash, status
            ) VALUES (?, ?, ?, ?, ?, ?, 'imported')
          `)
          .bind(
            rowId,
            importId,
            row.rowIndex,
            accountId,
            JSON.stringify(row.rawRow),
            buildImportRowHash(row)
          )
      );

      if (certificationTarget) {
        statements.push(
          db
            .prepare(`
              UPDATE transactions
              SET transaction_date = ?,
                description = ?,
                amount_minor = ?,
                entry_type = ?,
                transfer_direction = ?,
                bank_certification_status = 'statement_certified',
                statement_certified_import_id = ?,
                statement_certified_import_row_id = ?,
                statement_certified_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
              WHERE household_id = ?
                AND id = ?
                AND account_id = ?
                AND bank_certification_status = 'provisional'
            `)
            .bind(
              row.date,
              row.description,
              row.amountMinor,
              row.entryType,
              row.transferDirection ?? null,
              importId,
              rowId,
              DEFAULT_HOUSEHOLD_ID,
              certificationTarget.id,
              accountId
            )
        );
        monthsToRecalculate.add(certificationTarget.transaction_date.slice(0, 7));
        monthsToRecalculate.add(row.date.slice(0, 7));
        continue;
      }

      statements.push(
        db
          .prepare(`
            INSERT INTO transactions (
              id, household_id, import_id, import_row_id, account_id, transaction_date,
              description, amount_minor, currency, entry_type, transfer_direction,
              category_id, ownership_type, owner_person_id, offsets_category, note,
              bank_certification_status, statement_certified_import_id, statement_certified_import_row_id, statement_certified_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SGD', ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
          `)
          .bind(
            transactionId,
            DEFAULT_HOUSEHOLD_ID,
            importId,
            rowId,
            accountId,
            row.date,
            row.description,
            row.amountMinor,
            row.entryType,
            row.transferDirection ?? null,
            categoryId,
            row.ownershipType,
            directOwnerId ?? null,
            row.note ?? null,
            isOfficialStatementImport ? "statement_certified" : "provisional",
            isOfficialStatementImport ? importId : null,
            isOfficialStatementImport ? rowId : null,
            isOfficialStatementImport ? new Date().toISOString() : null
          )
      );

      if (row.ownershipType === "direct") {
        statements.push(
          db
            .prepare(`
              INSERT INTO transaction_splits (
                id, transaction_id, person_id, ratio_basis_points, amount_minor
              ) VALUES (?, ?, ?, ?, ?)
            `)
            .bind(`${transactionId}-split-direct`, transactionId, directOwnerId, 10000, row.amountMinor)
        );
      } else {
        if (!firstPerson || !secondPerson) {
          throw new Error("Shared entries require two people");
        }
        const firstBasisPoints = Math.max(0, Math.min(10000, row.splitBasisPoints ?? 5000));
        const secondBasisPoints = 10000 - firstBasisPoints;
        const firstAmount = Math.round((row.amountMinor * firstBasisPoints) / 10000);
        const secondAmount = row.amountMinor - firstAmount;
        statements.push(
          db
            .prepare(`
              INSERT INTO transaction_splits (
                id, transaction_id, person_id, ratio_basis_points, amount_minor
              ) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)
            `)
            .bind(
              `${transactionId}-split-1`,
              transactionId,
              firstPerson.id,
              firstBasisPoints,
              firstAmount,
              `${transactionId}-split-2`,
              transactionId,
              secondPerson.id,
              secondBasisPoints,
              secondAmount
            )
        );
      }

      monthsToRecalculate.add(row.date.slice(0, 7));
    }

    for (const checkpoint of input.statementCheckpoints ?? []) {
      const account = resolveImportAccount(accountsById, accountRowsByName, checkpoint.accountId, checkpoint.accountName);
      if (!account) {
        throw new Error(`Unknown checkpoint account: ${checkpoint.accountName}`);
      }
      if (!checkpoint.checkpointMonth || !Number.isFinite(checkpoint.statementBalanceMinor)) {
        throw new Error(`Invalid statement checkpoint for ${checkpoint.accountName}`);
      }

      statements.push(
        db
          .prepare(`
            INSERT INTO account_balance_checkpoints (
              id, household_id, account_id, checkpoint_month, statement_start_date, statement_end_date, statement_balance_minor, note
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(account_id, checkpoint_month) DO UPDATE SET
              statement_start_date = excluded.statement_start_date,
              statement_end_date = excluded.statement_end_date,
              statement_balance_minor = excluded.statement_balance_minor,
              note = excluded.note,
              updated_at = CURRENT_TIMESTAMP
          `)
          .bind(
            `checkpoint-${crypto.randomUUID()}`,
            DEFAULT_HOUSEHOLD_ID,
            account.id,
            checkpoint.checkpointMonth,
            normalizeStatementDate(checkpoint.statementStartDate),
            normalizeStatementDate(checkpoint.statementEndDate),
            normalizeStatementBalanceInputMinor(
              Math.round(checkpoint.statementBalanceMinor),
              account.account_kind
            ),
            checkpoint.note ?? null
          )
      );
    }

    for (let index = 0; index < statements.length; index += IMPORT_COMMIT_STATEMENT_CHUNK_SIZE) {
      await db.batch(statements.slice(index, index + IMPORT_COMMIT_STATEMENT_CHUNK_SIZE));
    }

    if (isOfficialStatementImport && input.statementCheckpoints?.length) {
      await saveStatementReconciliationCertificates(db, {
        importId,
        checkpoints: input.statementCheckpoints,
        committedRows: input.rows,
        statementControlRows: input.statementControlRows ?? input.rows,
        statementReconciliations: input.statementReconciliations ?? [],
        accountsById,
        accountRowsByName
      });
    }

    await db
      .prepare("UPDATE imports SET status = 'completed' WHERE household_id = ? AND id = ?")
      .bind(DEFAULT_HOUSEHOLD_ID, importId)
      .run();

    for (const month of monthsToRecalculate) {
      await recalculateMonthlySnapshots(db, month);
    }
  } catch (error) {
    await cleanupImportBatchRows(db, importId);
    await db
      .prepare("UPDATE imports SET status = 'rolled_back' WHERE household_id = ? AND id = ?")
      .bind(DEFAULT_HOUSEHOLD_ID, importId)
      .run();
    throw error;
  }

  await recordAuditEvent(db, {
    entityType: "import",
    entityId: importId,
    action: "import_committed",
    detail: `Committed import ${input.sourceLabel} with ${input.rows.length} row${input.rows.length === 1 ? "" : "s"}.`
  });

  return { importId, created: true, importedRows: input.rows.length };
}

async function saveStatementReconciliationCertificates(
  db: D1Database,
  input: {
    importId: string;
    checkpoints: StatementCheckpointDraftDto[];
    committedRows: ImportPreviewRowDto[];
    statementControlRows: ImportPreviewRowDto[];
    statementReconciliations: ImportPreviewStatementReconciliationDto[];
    accountsById: Map<string, { id: string; account_name: string; account_kind: string; opening_balance_minor: number }>;
    accountRowsByName: Map<string, { id: string; account_name: string; account_kind: string; opening_balance_minor: number }[]>;
  }
) {
  const ledgerRows = await db
    .prepare(`
      SELECT account_id, transaction_date, entry_type, transfer_direction, amount_minor
      FROM transactions
      WHERE household_id = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID)
    .all<{
      account_id: string;
      transaction_date: string;
      entry_type: "expense" | "income" | "transfer";
      transfer_direction: "in" | "out" | null;
      amount_minor: number;
    }>();

  const statements: D1PreparedStatement[] = [];
  for (const checkpoint of input.checkpoints) {
    const account = resolveImportAccount(input.accountsById, input.accountRowsByName, checkpoint.accountId, checkpoint.accountName);
    if (!account) {
      throw new Error(`Unknown checkpoint account: ${checkpoint.accountName}`);
    }

    const statementStartDate = normalizeStatementDate(checkpoint.statementStartDate);
    const statementEndDate = normalizeStatementDate(checkpoint.statementEndDate) ?? getMonthEndDate(checkpoint.checkpointMonth);
    const statementBalanceMinor = normalizeStatementBalanceInputMinor(
      Math.round(checkpoint.statementBalanceMinor),
      account.account_kind
    );
    const controlRows = input.statementControlRows.filter((row) => {
      const rowAccount = resolveImportAccount(input.accountsById, input.accountRowsByName, row.accountId, row.accountName);
      return rowAccount?.id === account.id
        && (!statementStartDate || row.date >= statementStartDate)
        && row.date <= statementEndDate;
    });
    const committedRows = input.committedRows.filter((row) => {
      const rowAccount = resolveImportAccount(input.accountsById, input.accountRowsByName, row.accountId, row.accountName);
      return rowAccount?.id === account.id
        && (!statementStartDate || row.date >= statementStartDate)
        && row.date <= statementEndDate;
    });
    const totals = controlRows.reduce((summary, row) => {
      const signedMinor = getSignedLedgerAmountMinor({
        entry_type: row.entryType,
        transfer_direction: row.transferDirection ?? null,
        amount_minor: row.amountMinor
      });
      if (signedMinor < 0) {
        summary.debitTotalMinor += Math.abs(signedMinor);
      } else {
        summary.creditTotalMinor += signedMinor;
      }
      summary.netTotalMinor += signedMinor;
      return summary;
    }, { debitTotalMinor: 0, creditTotalMinor: 0, netTotalMinor: 0 });

    const previewReconciliation = input.statementReconciliations.find((item) => (
      item.checkpointMonth === checkpoint.checkpointMonth
      && (
        (item.accountId && item.accountId === account.id)
        || (!item.accountId && item.accountName === account.account_name)
      )
    ));
    const computedProjectedLedgerBalanceMinor = computeCheckpointLedgerBalanceMinor({
      openingBalanceMinor: Number(account.opening_balance_minor ?? 0),
      checkpoint: {
        account_id: account.id,
        checkpoint_month: checkpoint.checkpointMonth,
        statement_start_date: statementStartDate,
        statement_end_date: statementEndDate
      },
      rows: ledgerRows.results
    });
    const projectedLedgerBalanceMinor = typeof previewReconciliation?.projectedLedgerBalanceMinor === "number"
      ? previewReconciliation.projectedLedgerBalanceMinor
      : computedProjectedLedgerBalanceMinor;
    const deltaMinor = typeof previewReconciliation?.deltaMinor === "number"
      ? previewReconciliation.deltaMinor
      : projectedLedgerBalanceMinor - statementBalanceMinor;
    const needsReviewRowCount = controlRows.filter((row) => row.commitStatus === "needs_review").length;
    const reconciliationExceptionCount = previewReconciliation?.status && previewReconciliation.status !== "matched" ? 1 : 0;
    const exceptionCount = needsReviewRowCount + reconciliationExceptionCount;

    statements.push(
      db
        .prepare(`
          INSERT INTO statement_reconciliation_certificates (
            id, household_id, import_id, account_id, checkpoint_month,
            statement_start_date, statement_end_date, statement_row_count,
            imported_row_count, certified_existing_row_count, already_covered_row_count,
            needs_review_row_count, debit_total_minor, credit_total_minor,
            net_total_minor, statement_balance_minor, projected_ledger_balance_minor,
            delta_minor, exception_count, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          `statement-cert-${crypto.randomUUID()}`,
          DEFAULT_HOUSEHOLD_ID,
          input.importId,
          account.id,
          checkpoint.checkpointMonth,
          statementStartDate,
          statementEndDate,
          controlRows.length,
          committedRows.filter((row) => !row.statementCertificationTargetTransactionId).length,
          committedRows.filter((row) => row.statementCertificationTargetTransactionId).length,
          controlRows.filter((row) => row.commitStatus === "skipped").length,
          needsReviewRowCount,
          totals.debitTotalMinor,
          totals.creditTotalMinor,
          totals.netTotalMinor,
          statementBalanceMinor,
          projectedLedgerBalanceMinor,
          deltaMinor,
          exceptionCount,
          exceptionCount === 0 ? "certified" : "exception"
        )
    );
  }

  if (statements.length) {
    await db.batch(statements);
  }
}

function resolveImportAccount(
  accountsById: Map<string, { id: string; account_name: string; account_kind: string; opening_balance_minor?: number }>,
  accountRowsByName: Map<string, { id: string; account_name: string; account_kind: string; opening_balance_minor?: number }[]>,
  accountId?: string,
  accountName?: string
) {
  if (accountId) {
    return accountsById.get(accountId);
  }

  if (!accountName) {
    return undefined;
  }

  const nameMatches = accountRowsByName.get(accountName) ?? [];
  return nameMatches.length === 1 ? nameMatches[0] : undefined;
}

export async function rollbackImportBatch(
  db: D1Database,
  input: {
    importId: string;
  }
) {
  const importRecord = await db
    .prepare(`
      SELECT source_type, status
      FROM imports
      WHERE household_id = ? AND id = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, input.importId)
    .first<{ source_type: "csv" | "pdf" | "manual"; status: string }>();

  if (!importRecord) {
    throw new Error("Import batch not found.");
  }

  const protectedStatementRows = await db
    .prepare(`
      SELECT COUNT(*) AS row_count
      FROM transactions
      WHERE household_id = ?
        AND bank_certification_status = 'statement_certified'
        AND statement_certified_import_id = ?
        AND (import_id IS NULL OR import_id != ?)
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, input.importId, input.importId)
    .first<{ row_count: number }>();

  if (importRecord.source_type === "pdf" && Number(protectedStatementRows?.row_count ?? 0) > 0) {
    throw new Error("This PDF statement import certified pre-existing ledger rows and cannot be rolled back. Correct it with a replacement statement or manual adjustment.");
  }

  const laterStatementRows = await db
    .prepare(`
      SELECT COUNT(*) AS row_count
      FROM statement_reconciliation_certificates current_certificate
      WHERE current_certificate.household_id = ?
        AND current_certificate.import_id = ?
        AND EXISTS (
          SELECT 1
          FROM statement_reconciliation_certificates later_certificate
          WHERE later_certificate.household_id = current_certificate.household_id
            AND later_certificate.account_id = current_certificate.account_id
            AND later_certificate.checkpoint_month > current_certificate.checkpoint_month
        )
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, input.importId)
    .first<{ row_count: number }>();

  if (importRecord.source_type === "pdf" && Number(laterStatementRows?.row_count ?? 0) > 0) {
    throw new Error("This PDF statement import has a later statement for the same account. Roll back newer statements first, or use a replacement statement or manual adjustment.");
  }

  const transactionMonths = await db
    .prepare(`
      SELECT DISTINCT transaction_date
      FROM transactions
      WHERE household_id = ? AND import_id = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, input.importId)
    .all<{ transaction_date: string }>();

  await cleanupImportBatchRows(db, input.importId);

  await db
    .prepare("UPDATE imports SET status = 'rolled_back' WHERE household_id = ? AND id = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, input.importId)
    .run();

  const affectedMonths = Array.from(new Set(transactionMonths.results.map((row) => row.transaction_date.slice(0, 7))));
  for (const month of affectedMonths) {
    await recalculateMonthlySnapshots(db, month);
  }

  await recordAuditEvent(db, {
    entityType: "import",
    entityId: input.importId,
    action: "import_rolled_back",
    detail: `Rolled back import ${input.importId}.`
  });

  return { importId: input.importId, rolledBack: true };
}

async function cleanupImportBatchRows(db: D1Database, importId: string) {
  await cleanupStatementImportMetadata(db, importId);

  await db
    .prepare(`
      UPDATE split_expenses
      SET linked_transaction_id = NULL
      WHERE household_id = ?
        AND linked_transaction_id IN (
          SELECT id FROM transactions WHERE household_id = ? AND import_id = ?
        )
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, DEFAULT_HOUSEHOLD_ID, importId)
    .run();

  await db
    .prepare(`
      UPDATE split_settlements
      SET linked_transaction_id = NULL
      WHERE household_id = ?
        AND linked_transaction_id IN (
          SELECT id FROM transactions WHERE household_id = ? AND import_id = ?
        )
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, DEFAULT_HOUSEHOLD_ID, importId)
    .run();

  await db
    .prepare(`
      DELETE FROM transaction_splits
      WHERE transaction_id IN (
        SELECT id FROM transactions WHERE household_id = ? AND import_id = ?
      )
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, importId)
    .run();

  await db
    .prepare("DELETE FROM transactions WHERE household_id = ? AND import_id = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, importId)
    .run();

  await db
    .prepare(`
      DELETE FROM import_rows
      WHERE import_id IN (
        SELECT id FROM imports WHERE household_id = ? AND id = ?
      )
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, importId)
    .run();
}

async function cleanupStatementImportMetadata(db: D1Database, importId: string) {
  const certificates = await db
    .prepare(`
      SELECT
        account_id,
        checkpoint_month,
        statement_start_date,
        statement_end_date,
        statement_balance_minor
      FROM statement_reconciliation_certificates
      WHERE household_id = ? AND import_id = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, importId)
    .all<{
      account_id: string;
      checkpoint_month: string;
      statement_start_date: string | null;
      statement_end_date: string | null;
      statement_balance_minor: number;
    }>();

  for (const certificate of certificates.results) {
    await db
      .prepare(`
        DELETE FROM account_balance_checkpoints
        WHERE household_id = ?
          AND account_id = ?
          AND checkpoint_month = ?
          AND COALESCE(statement_start_date, '') = COALESCE(?, '')
          AND COALESCE(statement_end_date, '') = COALESCE(?, '')
          AND statement_balance_minor = ?
      `)
      .bind(
        DEFAULT_HOUSEHOLD_ID,
        certificate.account_id,
        certificate.checkpoint_month,
        certificate.statement_start_date,
        certificate.statement_end_date,
        certificate.statement_balance_minor
      )
      .run();
  }

  await db
    .prepare("DELETE FROM statement_reconciliation_certificates WHERE household_id = ? AND import_id = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, importId)
    .run();
}

async function recalculateMonthlySnapshots(db: D1Database, month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const [planRows, entries, existingSnapshots] = await Promise.all([
    loadMonthPlanRows(db, month),
    loadEntries(db, month),
    db
      .prepare(`
        SELECT person_scope, note
        FROM monthly_snapshots
        WHERE household_id = ? AND year = ? AND month = ?
      `)
      .bind(DEFAULT_HOUSEHOLD_ID, year, monthNumber)
      .all<{ person_scope: string; note: string | null }>()
  ]);

  const notesByScope = new Map(existingSnapshots.results.map((row) => [row.person_scope, row.note ?? ""]));
  const scopes = await Promise.all((await loadPersonScopes(db)).map(async (personScope) => ({
    key: personScope,
    incomeRows: await loadMonthIncomeRows(db, personScope, month)
  })));

  for (const scope of scopes) {
    const visibleRows = buildSnapshotRowsForScope(planRows, scope.key);
    const visibleEntryCount = scope.key === "household"
      ? entries.length
      : entries.filter((entry) => entry.splits.some((split) => split.personId === scope.key)).length;
    const plannedExpenseMinor = visibleRows.reduce((sum, row) => sum + row.plannedMinor, 0);
    const actualExpenseMinor = sumVisibleExpenseMinor(entries, scope.key);
    const savingsGoalMinor = visibleRows
      .filter((row) => row.label === "Savings")
      .reduce((sum, row) => sum + row.plannedMinor, 0);
    const incomeMinor = scope.incomeRows.reduce((sum, row) => sum + row.plannedMinor, 0);
    const sharedMinor = visibleRows
      .filter((row) => row.ownershipType === "shared")
      .reduce((sum, row) => sum + row.plannedMinor, 0);
    const preservedNote = notesByScope.get(scope.key) ?? null;

    if (!visibleRows.length && !visibleEntryCount && !scope.incomeRows.length && !preservedNote) {
      await db
        .prepare("DELETE FROM monthly_snapshots WHERE household_id = ? AND year = ? AND month = ? AND person_scope = ?")
        .bind(DEFAULT_HOUSEHOLD_ID, year, monthNumber, scope.key)
        .run();
      continue;
    }

    await db
      .prepare(`
        INSERT INTO monthly_snapshots (
          id, household_id, year, month, person_scope,
          total_income_minor, estimated_expense_minor, total_expense_minor,
          savings_goal_minor, total_net_minor, total_shared_minor, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          total_income_minor = excluded.total_income_minor,
          estimated_expense_minor = excluded.estimated_expense_minor,
          total_expense_minor = excluded.total_expense_minor,
          savings_goal_minor = excluded.savings_goal_minor,
          total_net_minor = excluded.total_net_minor,
          total_shared_minor = excluded.total_shared_minor,
          note = excluded.note
      `)
      .bind(
        `snapshot-${scope.key}-${month}`,
        DEFAULT_HOUSEHOLD_ID,
        year,
        monthNumber,
        scope.key,
        incomeMinor,
        plannedExpenseMinor,
        actualExpenseMinor,
        savingsGoalMinor,
        incomeMinor - actualExpenseMinor,
        sharedMinor,
        preservedNote
      )
      .run();
  }
}

async function loadPersonScopes(db: D1Database) {
  const people = await db
    .prepare(`
      SELECT id
      FROM people
      WHERE household_id = ?
      ORDER BY created_at
    `)
    .bind(DEFAULT_HOUSEHOLD_ID)
    .all<{ id: string }>();

  return ["household", ...people.results.map((person) => person.id)];
}

export async function resolveLoginIdentityPersonId(db: D1Database, email?: string | null) {
  if (!email?.trim()) {
    return undefined;
  }

  await ensureDemoSchema(db);
  const identity = await db
    .prepare(`
      SELECT person_id
      FROM login_identities
      WHERE household_id = ? AND provider = ? AND email = ?
      LIMIT 1
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, "cloudflare_access", email.trim().toLowerCase())
    .first<{ person_id: string }>();

  return identity?.person_id;
}

export async function findSuggestedLoginPersonId(db: D1Database) {
  await ensureDemoSchema(db);
  const person = await db
    .prepare(`
      SELECT people.id
      FROM people
      LEFT JOIN login_identities
        ON login_identities.household_id = people.household_id
       AND login_identities.person_id = people.id
      WHERE people.household_id = ? AND login_identities.id IS NULL
      ORDER BY people.created_at
      LIMIT 1
    `)
    .bind(DEFAULT_HOUSEHOLD_ID)
    .first<{ id: string }>();

  if (person?.id) {
    return person.id;
  }

  const fallback = await db
    .prepare(`
      SELECT id
      FROM people
      WHERE household_id = ?
      ORDER BY created_at
      LIMIT 1
    `)
    .bind(DEFAULT_HOUSEHOLD_ID)
    .first<{ id: string }>();

  return fallback?.id;
}

export async function registerLoginIdentity(db: D1Database, input: { email: string; personId: string; name?: string }) {
  const email = input.email.trim().toLowerCase();
  if (!email) {
    throw new Error("Missing login email");
  }

  await ensureDemoSchema(db);

  const person = await db
    .prepare("SELECT id FROM people WHERE household_id = ? AND id = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, input.personId)
    .first<{ id: string }>();
  if (!person) {
    throw new Error("Unknown household profile");
  }

  if (input.name?.trim()) {
    await db
      .prepare("UPDATE people SET display_name = ?, updated_at = CURRENT_TIMESTAMP WHERE household_id = ? AND id = ?")
      .bind(input.name.trim(), DEFAULT_HOUSEHOLD_ID, input.personId)
      .run();
  }

  await db
    .prepare(`
      INSERT INTO login_identities (
        id, household_id, provider, email, person_id
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(household_id, provider, email) DO UPDATE SET
        person_id = excluded.person_id,
        updated_at = CURRENT_TIMESTAMP
    `)
    .bind(`login-cloudflare-${slugify(email)}`, DEFAULT_HOUSEHOLD_ID, "cloudflare_access", email, input.personId)
    .run();

  return { personId: input.personId };
}

export async function unregisterLoginIdentity(db: D1Database, email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    throw new Error("Missing login email");
  }

  await ensureDemoSchema(db);
  await db
    .prepare(`
      DELETE FROM login_identities
      WHERE household_id = ? AND provider = ? AND email = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, "cloudflare_access", normalizedEmail)
    .run();

  return { unregistered: true };
}
