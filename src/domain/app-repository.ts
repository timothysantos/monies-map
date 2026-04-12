import {
  accounts as demoAccounts,
  buildMonthIncomeRows,
  buildSummaryMonthsByView,
  categories as demoCategories,
  demoMonths,
  household as demoHousehold,
  importBatches as demoImportBatches,
  monthEntries as demoMonthEntries,
  monthPlanRows as demoMonthPlanRows,
  type DemoSettings
} from "./demo-data";
import type {
  AccountDto,
  CategoryDto,
  EntryDto,
  EntrySplitDto,
  HouseholdDto,
  ImportBatchDto,
  ImportPreviewDto,
  ImportPreviewRowDto,
  LinkedTransferDto,
  MonthIncomeRowDto,
  MonthPlanRowDto,
  SplitActivityDto,
  SplitExpenseDto,
  SplitGroupPillDto,
  SplitMatchCandidateDto,
  SplitSettlementDto,
  SummaryMonthDto
} from "../types/dto";

const DEMO_HOUSEHOLD_ID = demoHousehold.id;

const PERSON_IDS: Record<string, string> = {
  Tim: "person-tim",
  Joyce: "person-joyce"
};

const SHARED_ACCOUNT_INSTITUTION = "DBS";
const EMPTY_STATE_PEOPLE = [
  { id: "person-tim", name: "Primary" },
  { id: "person-joyce", name: "Partner" }
];
const IMPORT_COMMIT_STATEMENT_CHUNK_SIZE = 90;

export async function ensureSeedData(db: D1Database, settings: DemoSettings) {
  await ensureDemoSchema(db);
  const existing = await db
    .prepare("SELECT COUNT(*) as count FROM households WHERE id = ?")
    .bind(DEMO_HOUSEHOLD_ID)
    .first<{ count: number }>();

  const categoryCount = await db
    .prepare("SELECT COUNT(*) as count FROM categories WHERE household_id = ?")
    .bind(DEMO_HOUSEHOLD_ID)
    .first<{ count: number }>();

  const snapshotCount = await db
    .prepare("SELECT COUNT(*) as count FROM monthly_snapshots WHERE household_id = ?")
    .bind(DEMO_HOUSEHOLD_ID)
    .first<{ count: number }>();

  const incomeRowCount = await db
    .prepare("SELECT COUNT(*) as count FROM monthly_plan_rows WHERE household_id = ? AND section_key = 'income'")
    .bind(DEMO_HOUSEHOLD_ID)
    .first<{ count: number }>();

  if (
    (existing?.count ?? 0) > 0 &&
    (categoryCount?.count ?? 0) > 0 &&
    (snapshotCount?.count ?? 0) > 0 &&
    (incomeRowCount?.count ?? 0) > 0
  ) {
    for (const month of demoMonths) {
      await recalculateMonthlySnapshots(db, month);
    }
    return;
  }

  await reseedDemoData(db, settings);
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
        FOREIGN KEY (linked_transaction_id) REFERENCES transactions(id)
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
        FOREIGN KEY (linked_transaction_id) REFERENCES transactions(id)
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

  await backfillSplitBatches(db);
}

export async function reseedDemoData(db: D1Database, settings: DemoSettings) {
  await ensureDemoSchema(db);
  await clearDemoData(db);
  await seedDemoData(db, settings);
}

export async function seedEmptyStateReferenceData(db: D1Database) {
  await ensureDemoSchema(db);

  await db
    .prepare("INSERT INTO households (id, name, base_currency) VALUES (?, ?, ?)")
    .bind(demoHousehold.id, demoHousehold.name, demoHousehold.baseCurrency)
    .run();

  for (const person of EMPTY_STATE_PEOPLE) {
    await db
      .prepare("INSERT INTO people (id, household_id, display_name, role) VALUES (?, ?, ?, ?)")
      .bind(person.id, demoHousehold.id, person.name, person.id === "person-tim" ? "owner" : "partner")
      .run();
  }

  for (const category of demoCategories) {
    await db
      .prepare(`
        INSERT INTO categories (
          id, household_id, name, slug, reporting_group,
          icon_key, color_hex, sort_order, is_system
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        category.id,
        demoHousehold.id,
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
    "DELETE FROM import_rows",
    "DELETE FROM imports",
    "DELETE FROM account_balance_checkpoints",
    "DELETE FROM audit_events",
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
    .bind(demoHousehold.id, demoHousehold.name, demoHousehold.baseCurrency)
    .run();

  for (const person of demoHousehold.people) {
    await db
      .prepare("INSERT INTO people (id, household_id, display_name, role) VALUES (?, ?, ?, ?)")
      .bind(person.id, demoHousehold.id, person.name, person.id === "person-tim" ? "owner" : "partner")
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
      .bind(id, demoHousehold.id, name)
      .run();
  }

  for (const account of demoAccounts) {
    const ownerPersonId = PERSON_IDS[account.ownerLabel] ?? null;
    await db
      .prepare(`
        INSERT INTO accounts (
          id, household_id, institution_id, owner_person_id,
          account_name, account_kind, currency, is_joint
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        account.id,
        demoHousehold.id,
        institutionIds.get(account.institution),
        ownerPersonId,
        account.name,
        mapAccountKind(account.kind),
        account.currency,
        account.isJoint ? 1 : 0
      )
      .run();
  }

  for (const category of demoCategories) {
    await db
      .prepare(`
        INSERT INTO categories (
          id, household_id, name, slug, reporting_group,
          icon_key, color_hex, sort_order, is_system
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        category.id,
        demoHousehold.id,
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

  for (const item of demoImportBatches) {
    await db
      .prepare(`
        INSERT INTO imports (
          id, household_id, source_type, source_label, imported_at, status, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        item.id,
        demoHousehold.id,
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
        .bind(groupId, demoHousehold.id, "Demo seeded transfer pair", 1)
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
        demoHousehold.id,
        planYear,
        planMonth,
        row.ownerName ? PERSON_IDS[row.ownerName] ?? null : null,
        row.ownershipType,
        row.section,
        findCategoryId(row.categoryName),
        row.label,
        planDate,
        findAccountId(row.accountName),
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
      ...buildMonthIncomeRows("person-tim", settings.salaryPerPersonMinor).map((row) => ({
        ...row,
        id: `seed-${monthKey}-person-tim-${row.id}`,
        personId: "person-tim"
      })),
      ...buildMonthIncomeRows("person-joyce", settings.salaryPerPersonMinor).map((row) => ({
        ...row,
        id: `seed-${monthKey}-person-joyce-${row.id}`,
        personId: "person-joyce"
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
          demoHousehold.id,
          year,
          month,
          row.personId,
          "direct",
          "income",
          findCategoryId(row.categoryName),
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
          demoHousehold.id,
          year,
          monthNumber,
          personScope,
          month.incomeMinor,
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
    const directOwnerId = entry.ownerName ? PERSON_IDS[entry.ownerName] ?? null : null;
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
        demoHousehold.id,
        findAccountId(entry.accountName),
        transferGroupIdByTransactionId.get(entry.id) ?? null,
        entry.date,
        entry.description,
        entry.amountMinor,
        "SGD",
        entry.entryType,
        entry.transferDirection ?? null,
        findCategoryId(entry.categoryName),
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

async function seedDemoSplitData(db: D1Database) {
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
      .bind(batch.id, DEMO_HOUSEHOLD_ID, batch.groupId, batch.name, batch.openedOn, batch.closedOn)
      .run();
  }

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
      .bind(group.id, DEMO_HOUSEHOLD_ID, group.name, group.iconKey, group.sortOrder)
      .run();
  }

  const expenseSeeds = [
    {
      id: "split-expense-okaeri-dining",
      groupId: "split-group-okaeri",
      batchId: "split-batch-okaeri-closed",
      payerPersonId: "person-tim",
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
      payerPersonId: "person-joyce",
      date: "2025-10-12",
      description: "Family support",
      categoryName: "Family & Personal",
      totalAmountMinor: 23407,
      note: "Family spending tracked outside the bank import flow."
    },
    {
      id: "split-expense-nongroup-groceries",
      groupId: null,
      batchId: "split-batch-none-open",
      payerPersonId: "person-joyce",
      date: "2025-10-06",
      description: "October groceries",
      categoryName: "Groceries",
      totalAmountMinor: 24251,
      note: "Shared expense tracked without a named group."
    }
  ];

  for (const expense of expenseSeeds) {
    await db
      .prepare(`
        INSERT INTO split_expenses (
          id, household_id, split_group_id, split_batch_id, payer_person_id, expense_date,
          description, category_id, total_amount_minor, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        expense.id,
        DEMO_HOUSEHOLD_ID,
        expense.groupId,
        expense.batchId,
        expense.payerPersonId,
        expense.date,
        expense.description,
        findCategoryId(expense.categoryName),
        expense.totalAmountMinor,
        expense.note
      )
      .run();

    const primaryShare = Math.floor(expense.totalAmountMinor / 2);
    const secondaryShare = expense.totalAmountMinor - primaryShare;
    const shareRows = [
      { personId: "person-tim", amountMinor: primaryShare },
      { personId: "person-joyce", amountMinor: secondaryShare }
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
          share.personId === "person-tim" ? 5000 : 5000,
          share.amountMinor
        )
        .run();
    }
  }

  await db
    .prepare(`
      INSERT INTO split_settlements (
        id, household_id, split_group_id, split_batch_id, from_person_id, to_person_id,
        settlement_date, amount_minor, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      "split-settlement-okaeri",
      DEMO_HOUSEHOLD_ID,
      "split-group-okaeri",
      "split-batch-okaeri-closed",
      "person-joyce",
      "person-tim",
      "2025-10-22",
      93150,
      "Manual settle-up recorded before bank transfer was linked."
    )
    .run();
}

function splitBatchName(groupName?: string | null, closed = false) {
  const base = groupName ?? "Non-group expenses";
  return closed ? `${base} settled batch` : `${base} current batch`;
}

async function getSplitGroupName(db: D1Database, groupId?: string | null) {
  if (!groupId) {
    return "Non-group expenses";
  }

  const row = await db
    .prepare("SELECT group_name FROM split_groups WHERE household_id = ? AND id = ?")
    .bind(DEMO_HOUSEHOLD_ID, groupId)
    .first<{ group_name: string }>();
  return row?.group_name ?? "Non-group expenses";
}

async function createSplitBatch(
  db: D1Database,
  input: { groupId?: string | null; openedOn: string; closedOn?: string | null }
) {
  const id = `split-batch-${slugify(input.groupId ?? "none")}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const groupName = await getSplitGroupName(db, input.groupId);
  await db
    .prepare(`
      INSERT INTO split_batches (
        id, household_id, split_group_id, batch_name, opened_on, closed_on
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)
    .bind(
      id,
      DEMO_HOUSEHOLD_ID,
      input.groupId ?? null,
      splitBatchName(groupName, Boolean(input.closedOn)),
      input.openedOn,
      input.closedOn ?? null
    )
    .run();
  return id;
}

async function getOrCreateActiveSplitBatch(
  db: D1Database,
  input: { groupId?: string | null; date: string }
) {
  const active = await db
    .prepare(`
      SELECT id
      FROM split_batches
      WHERE household_id = ?
        AND (split_group_id IS ? OR split_group_id = ?)
        AND closed_on IS NULL
      ORDER BY opened_on DESC, created_at DESC
      LIMIT 1
    `)
    .bind(DEMO_HOUSEHOLD_ID, input.groupId ?? null, input.groupId ?? null)
    .first<{ id: string }>();

  if (active?.id) {
    return active.id;
  }

  return createSplitBatch(db, { groupId: input.groupId, openedOn: input.date, closedOn: null });
}

async function closeSplitBatch(
  db: D1Database,
  input: { batchId: string; closedOn: string }
) {
  const currentBatch = await db
    .prepare(`
      SELECT split_group_id
      FROM split_batches
      WHERE id = ? AND household_id = ?
    `)
    .bind(input.batchId, DEMO_HOUSEHOLD_ID)
    .first<{ split_group_id: string | null }>();
  const groupName = await getSplitGroupName(db, currentBatch?.split_group_id ?? null);
  await db
    .prepare(`
      UPDATE split_batches
      SET closed_on = COALESCE(closed_on, ?),
          batch_name = CASE
            WHEN closed_on IS NULL THEN ?
            ELSE batch_name
          END
      WHERE id = ? AND household_id = ?
    `)
    .bind(input.closedOn, splitBatchName(groupName, true), input.batchId, DEMO_HOUSEHOLD_ID)
    .run();
}

async function backfillSplitBatches(db: D1Database) {
  const unassignedExpenseCount = await db
    .prepare("SELECT COUNT(*) AS count FROM split_expenses WHERE household_id = ? AND split_batch_id IS NULL")
    .bind(DEMO_HOUSEHOLD_ID)
    .first<{ count: number }>();
  const unassignedSettlementCount = await db
    .prepare("SELECT COUNT(*) AS count FROM split_settlements WHERE household_id = ? AND split_batch_id IS NULL")
    .bind(DEMO_HOUSEHOLD_ID)
    .first<{ count: number }>();

  if ((unassignedExpenseCount?.count ?? 0) === 0 && (unassignedSettlementCount?.count ?? 0) === 0) {
    return;
  }

  const rows = await db
    .prepare(`
      SELECT split_group_id, expense_date AS activity_date, 'expense' AS kind
      FROM split_expenses
      WHERE household_id = ? AND split_batch_id IS NULL
      UNION ALL
      SELECT split_group_id, settlement_date AS activity_date, 'settlement' AS kind
      FROM split_settlements
      WHERE household_id = ? AND split_batch_id IS NULL
      ORDER BY activity_date ASC
    `)
    .bind(DEMO_HOUSEHOLD_ID, DEMO_HOUSEHOLD_ID)
    .all<{ split_group_id: string | null; activity_date: string; kind: "expense" | "settlement" }>();

  const grouped = new Map<string, { groupId: string | null; dates: string[]; latestSettlementDate?: string; latestExpenseDate?: string }>();
  for (const row of rows.results) {
    const key = row.split_group_id ?? "split-group-none";
    const current = grouped.get(key) ?? { groupId: row.split_group_id ?? null, dates: [] };
    current.dates.push(row.activity_date);
    if (row.kind === "settlement" && (!current.latestSettlementDate || row.activity_date > current.latestSettlementDate)) {
      current.latestSettlementDate = row.activity_date;
    }
    if (row.kind === "expense" && (!current.latestExpenseDate || row.activity_date > current.latestExpenseDate)) {
      current.latestExpenseDate = row.activity_date;
    }
    grouped.set(key, current);
  }

  for (const current of grouped.values()) {
    const shouldClose = Boolean(current.latestSettlementDate)
      && (!current.latestExpenseDate || current.latestExpenseDate <= current.latestSettlementDate);
    const batchId = await createSplitBatch(db, {
      groupId: current.groupId,
      openedOn: current.dates[0],
      closedOn: shouldClose ? current.latestSettlementDate ?? current.dates[current.dates.length - 1] : null
    });

    await db
      .prepare("UPDATE split_expenses SET split_batch_id = ? WHERE household_id = ? AND split_batch_id IS NULL AND split_group_id IS ?")
      .bind(batchId, DEMO_HOUSEHOLD_ID, current.groupId)
      .run();
    await db
      .prepare("UPDATE split_settlements SET split_batch_id = ? WHERE household_id = ? AND split_batch_id IS NULL AND split_group_id IS ?")
      .bind(batchId, DEMO_HOUSEHOLD_ID, current.groupId)
      .run();
  }
}

export async function loadSummaryMonths(db: D1Database, personScope: string): Promise<SummaryMonthDto[]> {
  const result = await db
    .prepare(`
      SELECT year, month, total_income_minor, total_expense_minor, note
      , estimated_expense_minor, savings_goal_minor
      FROM monthly_snapshots
      WHERE household_id = ? AND person_scope = ?
      ORDER BY year DESC, month DESC
    `)
    .bind(DEMO_HOUSEHOLD_ID, personScope)
    .all<{
      year: number;
      month: number;
      total_income_minor: number;
      estimated_expense_minor: number;
      total_expense_minor: number;
      savings_goal_minor: number;
      note: string | null;
    }>();

  return result.results
    .map((row) => ({
      month: `${row.year}-${String(row.month).padStart(2, "0")}`,
      incomeMinor: row.total_income_minor,
      estimatedExpensesMinor: row.estimated_expense_minor,
      realExpensesMinor: row.total_expense_minor,
      savingsGoalMinor: row.savings_goal_minor,
      realizedSavingsMinor: row.total_income_minor - row.total_expense_minor,
      estimatedDiffMinor: row.total_income_minor - row.estimated_expense_minor,
      realDiffMinor: row.total_income_minor - row.total_expense_minor,
      note: row.note ?? "Month tracked close to plan overall."
    }))
    .sort((left, right) => left.month.localeCompare(right.month));
}

export async function loadTrackedMonths(db: D1Database): Promise<string[]> {
  const result = await db
    .prepare(`
      SELECT DISTINCT month_key
      FROM (
        SELECT substr(transaction_date, 1, 7) AS month_key
        FROM transactions
        WHERE household_id = ?

        UNION

        SELECT printf('%04d-%02d', year, month) AS month_key
        FROM monthly_snapshots
        WHERE household_id = ?

        UNION

        SELECT printf('%04d-%02d', year, month) AS month_key
        FROM monthly_plan_rows
        WHERE household_id = ?
      )
      WHERE month_key IS NOT NULL AND month_key != ''
      ORDER BY month_key
    `)
    .bind(DEMO_HOUSEHOLD_ID, DEMO_HOUSEHOLD_ID, DEMO_HOUSEHOLD_ID)
    .all<{ month_key: string }>();

  return result.results.map((row) => row.month_key);
}

export async function loadMonthIncomeRows(
  db: D1Database,
  selectedPersonId: string,
  month = "2025-10"
): Promise<MonthIncomeRowDto[]> {
  const [year, monthNumber] = month.split("-").map(Number);
  const query = selectedPersonId === "household"
    ? `
      SELECT
        monthly_plan_rows.id,
        monthly_plan_rows.person_id,
        monthly_plan_rows.category_id,
        monthly_plan_rows.label,
        monthly_plan_rows.planned_amount_minor,
        monthly_plan_rows.actual_amount_minor,
        monthly_plan_rows.notes,
        categories.name AS category_name,
        people.display_name AS owner_name
      FROM monthly_plan_rows
      LEFT JOIN categories ON categories.id = monthly_plan_rows.category_id
      LEFT JOIN people ON people.id = monthly_plan_rows.person_id
      WHERE monthly_plan_rows.household_id = ?
        AND monthly_plan_rows.year = ?
        AND monthly_plan_rows.month = ?
        AND monthly_plan_rows.section_key = 'income'
      ORDER BY monthly_plan_rows.created_at
    `
    : `
      SELECT
        monthly_plan_rows.id,
        monthly_plan_rows.person_id,
        monthly_plan_rows.category_id,
        monthly_plan_rows.label,
        monthly_plan_rows.planned_amount_minor,
        monthly_plan_rows.actual_amount_minor,
        monthly_plan_rows.notes,
        categories.name AS category_name,
        people.display_name AS owner_name
      FROM monthly_plan_rows
      LEFT JOIN categories ON categories.id = monthly_plan_rows.category_id
      LEFT JOIN people ON people.id = monthly_plan_rows.person_id
      WHERE monthly_plan_rows.household_id = ?
        AND monthly_plan_rows.year = ?
        AND monthly_plan_rows.month = ?
        AND monthly_plan_rows.section_key = 'income'
        AND monthly_plan_rows.person_id = ?
      ORDER BY monthly_plan_rows.created_at
    `;

  const statement = db.prepare(query);
  const result = selectedPersonId === "household"
    ? await statement.bind(DEMO_HOUSEHOLD_ID, year, monthNumber).all<{
        id: string;
        person_id: string | null;
        category_id: string | null;
        label: string;
        planned_amount_minor: number;
        actual_amount_minor: number;
        notes: string | null;
        category_name: string | null;
        owner_name: string | null;
      }>()
    : await statement.bind(DEMO_HOUSEHOLD_ID, year, monthNumber, selectedPersonId).all<{
        id: string;
        person_id: string | null;
        category_id: string | null;
        label: string;
        planned_amount_minor: number;
        actual_amount_minor: number;
        notes: string | null;
        category_name: string | null;
        owner_name: string | null;
      }>();

  return result.results.map((row) => ({
    id: row.id,
    categoryId: row.category_id ?? undefined,
    categoryName: row.category_name ?? "Income",
    label: selectedPersonId === "household" && row.owner_name ? `${row.owner_name} ${row.label.toLowerCase()}` : row.label,
    plannedMinor: row.planned_amount_minor,
    actualMinor: row.actual_amount_minor,
    personId: row.person_id ?? undefined,
    ownerName: row.owner_name ?? undefined,
    note: row.notes ?? undefined,
    isDerived: false,
    sourceRowIds: [row.id]
  }));
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
    .bind(DEMO_HOUSEHOLD_ID, targetYear, targetMonthNumber)
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
    .bind(DEMO_HOUSEHOLD_ID, sourceYear, sourceMonthNumber)
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
        DEMO_HOUSEHOLD_ID,
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

  const personScopes = ["household", "person-tim", "person-joyce"];
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
        DEMO_HOUSEHOLD_ID,
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

  const personScopes = ["household", "person-tim", "person-joyce"];
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
        DEMO_HOUSEHOLD_ID,
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
    .bind(DEMO_HOUSEHOLD_ID, year, monthNumber)
    .run();

  return { month, deleted: true };
}

export async function updateEntryRecord(
  db: D1Database,
  input: {
    entryId: string;
    date: string;
    description: string;
    accountName: string;
    categoryName: string;
    amountMinor?: number;
    entryType?: "expense" | "income" | "transfer";
    transferDirection?: "in" | "out";
    ownershipType: "direct" | "shared";
    ownerName?: string;
    note?: string;
    splitBasisPoints?: number;
  }
) {
  const account = await db
    .prepare("SELECT id FROM accounts WHERE household_id = ? AND account_name = ?")
    .bind(DEMO_HOUSEHOLD_ID, input.accountName)
    .first<{ id: string }>();

  if (!account) {
    throw new Error(`Unknown account: ${input.accountName}`);
  }

  const category = await db
    .prepare("SELECT id FROM categories WHERE household_id = ? AND name = ?")
    .bind(DEMO_HOUSEHOLD_ID, input.categoryName)
    .first<{ id: string }>();

  if (!category) {
    throw new Error(`Unknown category: ${input.categoryName}`);
  }

  let ownerPersonId: string | null = null;
  if (input.ownershipType === "direct") {
    const owner = await db
      .prepare("SELECT id FROM people WHERE household_id = ? AND display_name = ?")
      .bind(DEMO_HOUSEHOLD_ID, input.ownerName ?? "")
      .first<{ id: string }>();

    if (!owner) {
      throw new Error(`Unknown owner: ${input.ownerName ?? ""}`);
    }

    ownerPersonId = owner.id;
  }

  const transaction = await db
    .prepare("SELECT amount_minor, transaction_date, transfer_group_id, transfer_direction, entry_type FROM transactions WHERE id = ? AND household_id = ?")
    .bind(input.entryId, DEMO_HOUSEHOLD_ID)
    .first<{ amount_minor: number; transaction_date: string; transfer_group_id: string | null; transfer_direction: "in" | "out" | null; entry_type: "expense" | "income" | "transfer" }>();

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
      input.note ?? null,
      input.entryId,
      DEMO_HOUSEHOLD_ID
    )
    .run();

  if (resolvedEntryType !== "transfer" && transaction.transfer_group_id) {
    await db
      .prepare("UPDATE transactions SET transfer_group_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE household_id = ? AND transfer_group_id = ?")
      .bind(DEMO_HOUSEHOLD_ID, transaction.transfer_group_id)
      .run();
    await db
      .prepare("DELETE FROM transfer_groups WHERE household_id = ? AND id = ?")
      .bind(DEMO_HOUSEHOLD_ID, transaction.transfer_group_id)
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
      .bind(DEMO_HOUSEHOLD_ID)
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
    detail: `Updated entry ${input.description} on ${input.date} in ${input.accountName}.`
  });

  return { entryId: input.entryId, updated: true };
}

export async function createEntryRecord(
  db: D1Database,
  input: {
    date: string;
    description: string;
    accountName: string;
    categoryName: string;
    amountMinor: number;
    entryType: "expense" | "income" | "transfer";
    transferDirection?: "in" | "out";
    ownershipType: "direct" | "shared";
    ownerName?: string;
    note?: string;
    splitBasisPoints?: number;
  }
) {
  if (typeof input.amountMinor !== "number" || input.amountMinor <= 0) {
    throw new Error("Amount must be greater than zero");
  }

  const accountId = await resolveAccountId(db, input.accountName);
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
      ) VALUES (?, ?, ?, ?, ?, ?, 'SGD', ?, ?, ?, ?, ?, 0, ?)
    `)
    .bind(
      entryId,
      DEMO_HOUSEHOLD_ID,
      accountId,
      input.date,
      input.description,
      input.amountMinor,
      input.entryType,
      input.entryType === "transfer" ? (input.transferDirection ?? "out") : null,
      categoryId,
      input.ownershipType,
      ownerPersonId,
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
    detail: `Created ${input.entryType} entry ${input.description} on ${input.date} in ${input.accountName}.`
  });

  return { entryId, created: true };
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
      .bind(input.fromEntryId, DEMO_HOUSEHOLD_ID)
      .first<{ id: string; household_id: string; amount_minor: number; transfer_group_id: string | null; transaction_date: string }>(),
    db
      .prepare(`
        SELECT id, household_id, amount_minor, transfer_group_id, transaction_date
        FROM transactions
        WHERE id = ? AND household_id = ?
      `)
      .bind(input.toEntryId, DEMO_HOUSEHOLD_ID)
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
    .bind(DEMO_HOUSEHOLD_ID, "Transfer")
    .first<{ id: string }>();

  if (!transferCategory) {
    throw new Error("Transfer category not found");
  }

  const staleGroupIds = [fromEntry.transfer_group_id, toEntry.transfer_group_id].filter(Boolean);
  for (const groupId of staleGroupIds) {
    await db
      .prepare("UPDATE transactions SET transfer_group_id = NULL WHERE household_id = ? AND transfer_group_id = ?")
      .bind(DEMO_HOUSEHOLD_ID, groupId)
      .run();
    await db
      .prepare("DELETE FROM transfer_groups WHERE household_id = ? AND id = ?")
      .bind(DEMO_HOUSEHOLD_ID, groupId)
      .run();
  }

  const groupId = `tg-${crypto.randomUUID()}`;
  await db
    .prepare("INSERT INTO transfer_groups (id, household_id, note, matched_confidence) VALUES (?, ?, ?, ?)")
    .bind(groupId, DEMO_HOUSEHOLD_ID, "Linked from entries editor", 1)
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
      .bind(groupId, transferCategory.id, input.fromEntryId, DEMO_HOUSEHOLD_ID)
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
      .bind(groupId, transferCategory.id, input.toEntryId, DEMO_HOUSEHOLD_ID)
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
      .bind(input.entryId, DEMO_HOUSEHOLD_ID)
      .first<{ id: string; household_id: string; transfer_group_id: string | null; transfer_direction: "in" | "out" | null; transaction_date: string }>(),
    input.counterpartEntryId
      ? db
          .prepare(`
            SELECT id, household_id, transfer_group_id, transfer_direction, transaction_date
            FROM transactions
            WHERE id = ? AND household_id = ?
          `)
          .bind(input.counterpartEntryId, DEMO_HOUSEHOLD_ID)
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
      .bind(DEMO_HOUSEHOLD_ID, currentEntry.transfer_group_id, currentEntry.id)
      .first<{ id: string; household_id: string; transfer_group_id: string | null; transfer_direction: "in" | "out" | null; transaction_date: string }>();
  }

  const currentCategory = await db
    .prepare("SELECT id FROM categories WHERE household_id = ? AND name = ?")
    .bind(DEMO_HOUSEHOLD_ID, input.currentCategoryName)
    .first<{ id: string }>();

  if (!currentCategory) {
    throw new Error(`Unknown category: ${input.currentCategoryName}`);
  }

  let counterpartCategoryId: string | null = null;
  if (counterpartEntry) {
    const counterpartCategory = await db
      .prepare("SELECT id FROM categories WHERE household_id = ? AND name = ?")
      .bind(DEMO_HOUSEHOLD_ID, input.counterpartCategoryName ?? "Other")
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
      DEMO_HOUSEHOLD_ID
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
        DEMO_HOUSEHOLD_ID
      )
      .run();
  }

  const groupIds = new Set([currentEntry.transfer_group_id, counterpartEntry?.transfer_group_id].filter(Boolean));
  for (const groupId of groupIds) {
    await db
      .prepare("DELETE FROM transfer_groups WHERE household_id = ? AND id = ?")
      .bind(DEMO_HOUSEHOLD_ID, groupId)
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

export async function updateCategoryRecord(
  db: D1Database,
  input: {
    categoryId: string;
    name?: string;
    slug?: string;
    iconKey?: string;
    colorHex?: string;
  }
) {
  const existing = await db
    .prepare(`
      SELECT name, slug, icon_key, color_hex
      FROM categories
      WHERE household_id = ? AND id = ?
    `)
    .bind(DEMO_HOUSEHOLD_ID, input.categoryId)
    .first<{ name: string; slug: string; icon_key: string; color_hex: string }>();

  if (!existing) {
    throw new Error(`Unknown category: ${input.categoryId}`);
  }

  const name = input.name?.trim() || existing.name;
  const slug = input.slug?.trim() || slugify(name);
  const iconKey = input.iconKey ?? existing.icon_key;
  const colorHex = input.colorHex ?? existing.color_hex;

  await db
    .prepare(`
      UPDATE categories
      SET name = ?, slug = ?, icon_key = ?, color_hex = ?
      WHERE household_id = ? AND id = ?
    `)
    .bind(name, slug, iconKey, colorHex, DEMO_HOUSEHOLD_ID, input.categoryId)
    .run();

  return { categoryId: input.categoryId, updated: true };
}

export async function createCategoryRecord(
  db: D1Database,
  input: {
    name: string;
    slug?: string;
    iconKey?: string;
    colorHex?: string;
  }
) {
  const name = input.name.trim();
  const slug = input.slug?.trim() || slugify(name);
  const iconKey = input.iconKey ?? "receipt";
  const colorHex = input.colorHex ?? "#6A7A73";

  const existing = await db
    .prepare(`
      SELECT id
      FROM categories
      WHERE household_id = ? AND (slug = ? OR lower(name) = lower(?))
    `)
    .bind(DEMO_HOUSEHOLD_ID, slug, name)
    .first<{ id: string }>();

  if (existing) {
    throw new Error(`Category already exists: ${name}`);
  }

  const sortOrderResult = await db
    .prepare("SELECT COALESCE(MAX(sort_order), 0) AS max_sort_order FROM categories WHERE household_id = ?")
    .bind(DEMO_HOUSEHOLD_ID)
    .first<{ max_sort_order: number }>();

  const categoryId = `cat-${slug}-${crypto.randomUUID().slice(0, 8)}`;
  await db
    .prepare(`
      INSERT INTO categories (
        id, household_id, name, slug, reporting_group,
        icon_key, color_hex, sort_order, is_system
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
    `)
    .bind(
      categoryId,
      DEMO_HOUSEHOLD_ID,
      name,
      slug,
      slug,
      iconKey,
      colorHex,
      (sortOrderResult?.max_sort_order ?? 0) + 10
    )
    .run();

  await recordAuditEvent(db, {
    entityType: "category",
    entityId: categoryId,
    action: "category_created",
    detail: `Created category ${name}.`
  });

  return { categoryId, created: true };
}

export async function deleteCategoryRecord(
  db: D1Database,
  input: {
    categoryId: string;
  }
) {
  const existing = await db
    .prepare(`
      SELECT id, name
      FROM categories
      WHERE household_id = ? AND id = ?
    `)
    .bind(DEMO_HOUSEHOLD_ID, input.categoryId)
    .first<{ id: string; name: string }>();

  if (!existing) {
    throw new Error(`Unknown category: ${input.categoryId}`);
  }

  const references = await Promise.all([
    db.prepare("SELECT id FROM transactions WHERE household_id = ? AND category_id = ? LIMIT 1")
      .bind(DEMO_HOUSEHOLD_ID, input.categoryId)
      .first<{ id: string }>(),
    db.prepare("SELECT id FROM monthly_plan_rows WHERE household_id = ? AND category_id = ? LIMIT 1")
      .bind(DEMO_HOUSEHOLD_ID, input.categoryId)
      .first<{ id: string }>(),
    db.prepare("SELECT id FROM monthly_budgets WHERE household_id = ? AND category_id = ? LIMIT 1")
      .bind(DEMO_HOUSEHOLD_ID, input.categoryId)
      .first<{ id: string }>()
  ]);

  if (references.some(Boolean)) {
    throw new Error(`Category is in use and cannot be deleted: ${existing.name}`);
  }

  await db
    .prepare("DELETE FROM categories WHERE household_id = ? AND id = ?")
    .bind(DEMO_HOUSEHOLD_ID, input.categoryId)
    .run();

  await recordAuditEvent(db, {
    entityType: "category",
    entityId: existing.id,
    action: "category_deleted",
    detail: `Deleted category ${existing.name}.`
  });

  return { categoryId: existing.id, deleted: true };
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
    .bind(DEMO_HOUSEHOLD_ID, year, monthNumber, input.personScope)
    .first<{ id: string }>();

  if (existing) {
    await db
      .prepare(`
        UPDATE monthly_snapshots
        SET note = ?
        WHERE household_id = ? AND year = ? AND month = ? AND person_scope = ?
      `)
      .bind(input.note, DEMO_HOUSEHOLD_ID, year, monthNumber, input.personScope)
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
      DEMO_HOUSEHOLD_ID,
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
    .bind(DEMO_HOUSEHOLD_ID, input.rowId)
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
        DEMO_HOUSEHOLD_ID,
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
        DEMO_HOUSEHOLD_ID,
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
    .bind(DEMO_HOUSEHOLD_ID, input.rowId)
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
      .bind(DEMO_HOUSEHOLD_ID, ...uniqueTransactionIds)
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
        .bind(DEMO_HOUSEHOLD_ID, ...uniqueTransactionIds)
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
        DEMO_HOUSEHOLD_ID,
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
    .bind(DEMO_HOUSEHOLD_ID, input.rowId)
    .run();

  await recalculateMonthlySnapshots(db, input.month);
  return { rowId: input.rowId, deleted: true };
}

async function clearMonthData(db: D1Database, month: string, year: number, monthNumber: number) {
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
    .bind(DEMO_HOUSEHOLD_ID, `${month}-01`, nextMonthKey(month) + "-01")
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
    .bind(DEMO_HOUSEHOLD_ID, `${month}-01`, nextMonthKey(month) + "-01")
    .run();

  await db
    .prepare(`
      DELETE FROM transactions
      WHERE household_id = ?
        AND transaction_date >= ?
        AND transaction_date < ?
    `)
    .bind(DEMO_HOUSEHOLD_ID, `${month}-01`, nextMonthKey(month) + "-01")
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
    .bind(DEMO_HOUSEHOLD_ID, year, monthNumber)
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
    .bind(DEMO_HOUSEHOLD_ID, year, monthNumber)
    .run();

  await db
    .prepare(`
      DELETE FROM monthly_plan_rows
      WHERE household_id = ?
        AND year = ?
        AND month = ?
    `)
    .bind(DEMO_HOUSEHOLD_ID, year, monthNumber)
    .run();
}

export async function loadHousehold(db: D1Database): Promise<HouseholdDto> {
  const household = await db
    .prepare("SELECT id, name, base_currency FROM households WHERE id = ?")
    .bind(DEMO_HOUSEHOLD_ID)
    .first<{ id: string; name: string; base_currency: string }>();

  const people = await db
    .prepare("SELECT id, display_name FROM people WHERE household_id = ? ORDER BY created_at")
    .bind(DEMO_HOUSEHOLD_ID)
    .all<{ id: string; display_name: string }>();

  return {
    id: household?.id ?? demoHousehold.id,
    name: household?.name ?? demoHousehold.name,
    baseCurrency: household?.base_currency ?? demoHousehold.baseCurrency,
    people: people.results.map((person) => ({ id: person.id, name: person.display_name }))
  };
}

export async function loadAccounts(db: D1Database): Promise<AccountDto[]> {
  const result = await db
    .prepare(`
      SELECT
        accounts.id,
        accounts.institution_id,
        accounts.owner_person_id,
        accounts.account_name,
        accounts.account_kind,
        accounts.currency,
        accounts.opening_balance_minor,
        accounts.is_joint,
        accounts.is_active,
        institutions.name AS institution_name,
        people.display_name AS owner_name
      FROM accounts
      INNER JOIN institutions ON institutions.id = accounts.institution_id
      LEFT JOIN people ON people.id = accounts.owner_person_id
      WHERE accounts.household_id = ?
      ORDER BY accounts.created_at
    `)
    .bind(DEMO_HOUSEHOLD_ID)
    .all<{
      id: string;
      institution_id: string;
      owner_person_id: string | null;
      account_name: string;
      account_kind: string;
      currency: string;
      opening_balance_minor: number;
      is_joint: number;
      is_active: number;
      institution_name: string;
      owner_name: string | null;
    }>();

  const transactionRows = await db
    .prepare(`
      SELECT
        transactions.account_id,
        transactions.transaction_date,
        transactions.entry_type,
        transactions.transfer_direction,
        transactions.amount_minor,
        transactions.transfer_group_id,
        imports.imported_at
      FROM transactions
      LEFT JOIN imports ON imports.id = transactions.import_id
      WHERE transactions.household_id = ?
        AND (transactions.import_id IS NULL OR imports.status = 'completed')
    `)
    .bind(DEMO_HOUSEHOLD_ID)
    .all<{
      account_id: string;
      transaction_date: string;
      entry_type: "expense" | "income" | "transfer";
      transfer_direction: "in" | "out" | null;
      amount_minor: number;
      transfer_group_id: string | null;
      imported_at: string | null;
    }>();

  const latestCheckpointRows = await db
    .prepare(`
      SELECT
        checkpoints.account_id,
        checkpoints.checkpoint_month,
        checkpoints.statement_start_date,
        checkpoints.statement_end_date,
        checkpoints.statement_balance_minor,
        checkpoints.note
      FROM account_balance_checkpoints AS checkpoints
      INNER JOIN (
        SELECT account_id, MAX(checkpoint_month) AS checkpoint_month
        FROM account_balance_checkpoints
        WHERE household_id = ?
        GROUP BY account_id
      ) AS latest
        ON latest.account_id = checkpoints.account_id
       AND latest.checkpoint_month = checkpoints.checkpoint_month
      WHERE checkpoints.household_id = ?
    `)
    .bind(DEMO_HOUSEHOLD_ID, DEMO_HOUSEHOLD_ID)
    .all<{
      account_id: string;
      checkpoint_month: string;
      statement_start_date: string | null;
      statement_end_date: string | null;
      statement_balance_minor: number;
      note: string | null;
    }>();

  const checkpointHistoryRows = await db
    .prepare(`
      SELECT
        account_id,
        checkpoint_month,
        statement_start_date,
        statement_end_date,
        statement_balance_minor,
        note
      FROM account_balance_checkpoints
      WHERE household_id = ?
      ORDER BY checkpoint_month DESC, created_at DESC
    `)
    .bind(DEMO_HOUSEHOLD_ID)
    .all<{
      account_id: string;
      checkpoint_month: string;
      statement_start_date: string | null;
      statement_end_date: string | null;
      statement_balance_minor: number;
      note: string | null;
    }>();

  const checkpointByAccountId = new Map(
    latestCheckpointRows.results.map((row) => [row.account_id, row])
  );

  const transferGroupSizes = new Map<string, number>();
  for (const row of transactionRows.results) {
    if (!row.transfer_group_id) {
      continue;
    }

    transferGroupSizes.set(row.transfer_group_id, (transferGroupSizes.get(row.transfer_group_id) ?? 0) + 1);
  }

  const balanceByAccountId = new Map<string, number>();
  const latestTransactionDateByAccountId = new Map<string, string>();
  const latestImportAtByAccountId = new Map<string, string>();
  const unresolvedTransferCountByAccountId = new Map<string, number>();
  const checkpointLedgerNetByAccountId = new Map<string, number>();
  const checkpointHistoryByAccountId = new Map<string, AccountDto["checkpointHistory"]>();
  const openingBalanceByAccountId = new Map(
    result.results.map((account) => [
      account.id,
      normalizeAccountOpeningBalanceMinor(Number(account.opening_balance_minor ?? 0), account.account_kind)
    ])
  );
  const accountKindByAccountId = new Map(
    result.results.map((account) => [account.id, account.account_kind])
  );

  for (const row of transactionRows.results) {
    const signedAmount = row.entry_type === "income" || (row.entry_type === "transfer" && row.transfer_direction === "in")
      ? Number(row.amount_minor)
      : -Number(row.amount_minor);
    balanceByAccountId.set(row.account_id, (balanceByAccountId.get(row.account_id) ?? 0) + signedAmount);

    const currentLatestDate = latestTransactionDateByAccountId.get(row.account_id);
    if (!currentLatestDate || row.transaction_date > currentLatestDate) {
      latestTransactionDateByAccountId.set(row.account_id, row.transaction_date);
    }

    if (row.imported_at) {
      const currentLatestImport = latestImportAtByAccountId.get(row.account_id);
      if (!currentLatestImport || row.imported_at > currentLatestImport) {
        latestImportAtByAccountId.set(row.account_id, row.imported_at);
      }
    }

    if (row.entry_type === "transfer" && (!row.transfer_group_id || (transferGroupSizes.get(row.transfer_group_id) ?? 0) < 2)) {
      unresolvedTransferCountByAccountId.set(
        row.account_id,
        (unresolvedTransferCountByAccountId.get(row.account_id) ?? 0) + 1
      );
    }
  }

  for (const checkpoint of latestCheckpointRows.results) {
    checkpointLedgerNetByAccountId.set(
      checkpoint.account_id,
      computeCheckpointLedgerBalanceMinor({
        openingBalanceMinor: openingBalanceByAccountId.get(checkpoint.account_id) ?? 0,
        checkpoint,
        rows: transactionRows.results
      })
    );
  }

  for (const checkpoint of checkpointHistoryRows.results) {
    const computedBalanceMinor = computeCheckpointLedgerBalanceMinor({
      openingBalanceMinor: openingBalanceByAccountId.get(checkpoint.account_id) ?? 0,
      checkpoint,
      rows: transactionRows.results
    });
    const statementBalanceMinor = normalizeStatementBalanceMinor(
      Number(checkpoint.statement_balance_minor ?? 0),
      accountKindByAccountId.get(checkpoint.account_id)
    );
    const currentHistory = checkpointHistoryByAccountId.get(checkpoint.account_id) ?? [];
    currentHistory.push({
      month: checkpoint.checkpoint_month,
      statementStartDate: checkpoint.statement_start_date ?? undefined,
      statementEndDate: checkpoint.statement_end_date ?? undefined,
      statementBalanceMinor,
      computedBalanceMinor,
      deltaMinor: computedBalanceMinor - statementBalanceMinor,
      note: checkpoint.note ?? undefined
    });
    checkpointHistoryByAccountId.set(checkpoint.account_id, currentHistory);
  }

  return result.results.map((row) => ({
    ...buildAccountHealth({
      accountId: row.id,
      openingBalanceMinor: normalizeAccountOpeningBalanceMinor(Number(row.opening_balance_minor ?? 0), row.account_kind),
      latestTransactionDate: latestTransactionDateByAccountId.get(row.id),
      latestImportAt: latestImportAtByAccountId.get(row.id),
      unresolvedTransferCount: unresolvedTransferCountByAccountId.get(row.id) ?? 0,
      currentLedgerBalanceMinor: normalizeAccountOpeningBalanceMinor(Number(row.opening_balance_minor ?? 0), row.account_kind) + (balanceByAccountId.get(row.id) ?? 0),
      checkpoint: checkpointByAccountId.get(row.id),
      accountKind: row.account_kind,
      checkpointLedgerNetMinor: checkpointLedgerNetByAccountId.get(row.id),
      checkpointHistory: checkpointHistoryByAccountId.get(row.id) ?? []
    }),
    id: row.id,
    institutionId: row.institution_id,
    ownerPersonId: row.owner_person_id ?? undefined,
    name: row.account_name,
    institution: row.institution_name,
    kind: row.account_kind,
    ownerLabel: row.owner_name ?? "Shared",
    currency: row.currency,
    isJoint: Boolean(row.is_joint),
    isActive: Boolean(row.is_active),
    openingBalanceMinor: Number(row.opening_balance_minor ?? 0)
  }));
}

function normalizeAccountOpeningBalanceMinor(value: number, accountKind?: string | null) {
  if (accountKind === "credit_card" && value > 0) {
    return -value;
  }

  return value;
}

function normalizeStatementBalanceMinor(value: number, accountKind?: string | null) {
  if (accountKind === "credit_card" && value > 0) {
    return -value;
  }

  return value;
}

function computeCheckpointLedgerBalanceMinor(input: {
  openingBalanceMinor: number;
  checkpoint: {
    account_id: string;
    checkpoint_month: string;
    statement_start_date: string | null;
    statement_end_date: string | null;
  };
  rows: {
    account_id: string;
    transaction_date: string;
    entry_type: "expense" | "income" | "transfer";
    transfer_direction: "in" | "out" | null;
    amount_minor: number;
  }[];
}) {
  const statementEndDate = input.checkpoint.statement_end_date ?? getMonthEndDate(input.checkpoint.checkpoint_month);
  let balanceMinor = input.openingBalanceMinor;

  for (const row of input.rows) {
    if (row.account_id !== input.checkpoint.account_id || row.transaction_date > statementEndDate) {
      continue;
    }

    // Statement-start rows are still part of the balance baseline, but the export
    // presents them separately from the statement-cycle movement.
    balanceMinor += getSignedLedgerAmountMinor(row);
  }

  return balanceMinor;
}

function getSignedLedgerAmountMinor(row: {
  entry_type: "expense" | "income" | "transfer";
  transfer_direction: "in" | "out" | null;
  amount_minor: number;
}) {
  return row.entry_type === "income" || (row.entry_type === "transfer" && row.transfer_direction === "in")
    ? Number(row.amount_minor)
    : -Number(row.amount_minor);
}

function buildAccountHealth(input: {
  accountId: string;
  openingBalanceMinor: number;
  currentLedgerBalanceMinor: number;
  latestTransactionDate?: string;
  latestImportAt?: string;
  unresolvedTransferCount: number;
  checkpoint?: {
    account_id: string;
    checkpoint_month: string;
    statement_start_date: string | null;
    statement_end_date: string | null;
    statement_balance_minor: number;
    note: string | null;
  };
  accountKind?: string;
  checkpointLedgerNetMinor?: number;
  checkpointHistory?: AccountDto["checkpointHistory"];
}) {
  const checkpointComputedBalanceMinor = input.checkpoint
    ? input.checkpointLedgerNetMinor ?? input.openingBalanceMinor
    : undefined;
  const checkpointDeltaMinor = input.checkpoint && checkpointComputedBalanceMinor != null
    ? checkpointComputedBalanceMinor - normalizeStatementBalanceMinor(
      Number(input.checkpoint.statement_balance_minor ?? 0),
      input.accountKind
    )
    : undefined;

  let reconciliationStatus: AccountDto["reconciliationStatus"];
  if (input.checkpoint) {
    reconciliationStatus = checkpointDeltaMinor === 0 ? "matched" : "mismatch";
  } else if (input.latestTransactionDate) {
    reconciliationStatus = "needs_checkpoint";
  }

  return {
    balanceMinor: input.currentLedgerBalanceMinor,
    latestTransactionDate: input.latestTransactionDate,
    latestImportAt: input.latestImportAt,
    unresolvedTransferCount: input.unresolvedTransferCount,
    latestCheckpointMonth: input.checkpoint?.checkpoint_month,
    latestCheckpointStartDate: input.checkpoint?.statement_start_date ?? undefined,
    latestCheckpointEndDate: input.checkpoint?.statement_end_date ?? undefined,
    latestCheckpointBalanceMinor: input.checkpoint ? normalizeStatementBalanceMinor(
      Number(input.checkpoint.statement_balance_minor ?? 0),
      input.accountKind
    ) : undefined,
    latestCheckpointComputedBalanceMinor: checkpointComputedBalanceMinor,
    latestCheckpointDeltaMinor: checkpointDeltaMinor,
    latestCheckpointNote: input.checkpoint?.note ?? undefined,
    reconciliationStatus,
    checkpointHistory: input.checkpointHistory ?? []
  };
}

async function findOrCreateInstitution(db: D1Database, name: string) {
  const trimmed = name.trim();
  const existing = await db
    .prepare(`
      SELECT id
      FROM institutions
      WHERE household_id = ? AND lower(name) = lower(?)
    `)
    .bind(DEMO_HOUSEHOLD_ID, trimmed)
    .first<{ id: string }>();

  if (existing) {
    return existing.id;
  }

  const id = `inst-${slugify(trimmed)}-${crypto.randomUUID().slice(0, 8)}`;
  await db
    .prepare(`
      INSERT INTO institutions (id, household_id, name)
      VALUES (?, ?, ?)
    `)
    .bind(id, DEMO_HOUSEHOLD_ID, trimmed)
    .run();

  return id;
}

export async function createAccountRecord(
  db: D1Database,
  input: {
    name: string;
    institution: string;
    kind: string;
    currency: string;
    openingBalanceMinor?: number;
    ownerPersonId?: string | null;
    isJoint?: boolean;
  }
) {
  const institutionId = await findOrCreateInstitution(db, input.institution);
  const accountId = `account-${slugify(input.name)}-${crypto.randomUUID().slice(0, 8)}`;
  const ownerPersonId = input.ownerPersonId?.trim() ? input.ownerPersonId : null;
  const isJoint = input.isJoint ?? !ownerPersonId;

  await db
    .prepare(`
      INSERT INTO accounts (
        id, household_id, institution_id, owner_person_id,
        account_name, account_kind, currency, opening_balance_minor, is_joint, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `)
    .bind(
      accountId,
      DEMO_HOUSEHOLD_ID,
      institutionId,
      ownerPersonId,
      input.name.trim(),
      input.kind,
      input.currency.trim() || "SGD",
      Math.round(input.openingBalanceMinor ?? 0),
      isJoint ? 1 : 0
    )
    .run();

  await recordAuditEvent(db, {
    entityType: "account",
    entityId: accountId,
    action: "account_created",
    detail: `Created account ${input.name.trim()} with opening balance ${formatMoneyMinor(input.openingBalanceMinor ?? 0)}.`
  });

  return { accountId, created: true };
}

export async function updateAccountRecord(
  db: D1Database,
  input: {
    accountId: string;
    name: string;
    institution: string;
    kind: string;
    currency: string;
    openingBalanceMinor?: number;
    ownerPersonId?: string | null;
    isJoint?: boolean;
  }
) {
  const existing = await db
    .prepare(`
      SELECT id, account_name, opening_balance_minor
      FROM accounts
      WHERE household_id = ? AND id = ?
    `)
    .bind(DEMO_HOUSEHOLD_ID, input.accountId)
    .first<{ id: string; account_name: string; opening_balance_minor: number }>();

  if (!existing) {
    throw new Error(`Unknown account: ${input.accountId}`);
  }

  const institutionId = await findOrCreateInstitution(db, input.institution);
  const ownerPersonId = input.ownerPersonId?.trim() ? input.ownerPersonId : null;
  const isJoint = input.isJoint ?? !ownerPersonId;

  await db
    .prepare(`
      UPDATE accounts
      SET institution_id = ?, owner_person_id = ?, account_name = ?, account_kind = ?, currency = ?, opening_balance_minor = ?, is_joint = ?
      WHERE household_id = ? AND id = ?
    `)
    .bind(
      institutionId,
      ownerPersonId,
      input.name.trim(),
      input.kind,
      input.currency.trim() || "SGD",
      Math.round(input.openingBalanceMinor ?? 0),
      isJoint ? 1 : 0,
      DEMO_HOUSEHOLD_ID,
      input.accountId
    )
    .run();

  await recordAuditEvent(db, {
    entityType: "account",
    entityId: input.accountId,
    action: "account_updated",
    detail: `Updated ${existing.account_name} -> ${input.name.trim()}; opening balance ${formatMoneyMinor(existing.opening_balance_minor)} -> ${formatMoneyMinor(input.openingBalanceMinor ?? 0)}.`
  });

  return { accountId: input.accountId, updated: true };
}

export async function updatePersonRecord(
  db: D1Database,
  input: {
    personId: string;
    name: string;
  }
) {
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    throw new Error("Person name is required.");
  }

  const existing = await db
    .prepare("SELECT id, display_name FROM people WHERE household_id = ? AND id = ?")
    .bind(DEMO_HOUSEHOLD_ID, input.personId)
    .first<{ id: string; display_name: string }>();

  if (!existing) {
    throw new Error(`Unknown person: ${input.personId}`);
  }

  await db
    .prepare(`
      UPDATE people
      SET display_name = ?
      WHERE household_id = ? AND id = ?
    `)
    .bind(trimmedName, DEMO_HOUSEHOLD_ID, input.personId)
    .run();

  await recordAuditEvent(db, {
    entityType: "person",
    entityId: input.personId,
    action: "person_updated",
    detail: `Updated person ${existing.display_name} -> ${trimmedName}.`
  });

  return { personId: input.personId, updated: true };
}

export async function archiveAccountRecord(
  db: D1Database,
  input: {
    accountId: string;
  }
) {
  const existing = await db
    .prepare("SELECT account_name FROM accounts WHERE household_id = ? AND id = ?")
    .bind(DEMO_HOUSEHOLD_ID, input.accountId)
    .first<{ account_name: string }>();

  await db
    .prepare(`
      UPDATE accounts
      SET is_active = 0
      WHERE household_id = ? AND id = ?
    `)
    .bind(DEMO_HOUSEHOLD_ID, input.accountId)
    .run();

  await recordAuditEvent(db, {
    entityType: "account",
    entityId: input.accountId,
    action: "account_archived",
    detail: `Archived account ${existing?.account_name ?? input.accountId}.`
  });

  return { accountId: input.accountId, archived: true };
}

async function recordAuditEvent(
  db: D1Database,
  input: {
    entityType: string;
    entityId: string;
    action: string;
    detail: string;
  }
) {
  await db
    .prepare(`
      INSERT INTO audit_events (id, household_id, entity_type, entity_id, action, detail)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .bind(
      `audit-${crypto.randomUUID()}`,
      DEMO_HOUSEHOLD_ID,
      input.entityType,
      input.entityId,
      input.action,
      input.detail
    )
    .run();
}

export async function saveAccountCheckpointRecord(
  db: D1Database,
  input: {
    accountId: string;
    checkpointMonth: string;
    statementStartDate?: string | null;
    statementEndDate?: string | null;
    statementBalanceMinor: number;
    note?: string;
  }
) {
  const account = await db
    .prepare(`
      SELECT id, account_kind
      FROM accounts
      WHERE household_id = ? AND id = ?
    `)
    .bind(DEMO_HOUSEHOLD_ID, input.accountId)
    .first<{ id: string; account_kind: string }>();

  const existingCheckpoint = await db
    .prepare(`
      SELECT statement_balance_minor
      FROM account_balance_checkpoints
      WHERE household_id = ? AND account_id = ? AND checkpoint_month = ?
    `)
    .bind(DEMO_HOUSEHOLD_ID, input.accountId, input.checkpointMonth)
    .first<{ statement_balance_minor: number }>();

  if (!account) {
    throw new Error(`Unknown account: ${input.accountId}`);
  }

  const checkpointId = `checkpoint-${input.accountId}-${input.checkpointMonth}`;
  const statementStartDate = normalizeStatementDate(input.statementStartDate);
  const statementEndDate = normalizeStatementDate(input.statementEndDate);
  const statementBalanceMinor = normalizeStatementBalanceMinor(
    Math.round(input.statementBalanceMinor),
    account.account_kind
  );
  await db
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
      checkpointId,
      DEMO_HOUSEHOLD_ID,
      input.accountId,
      input.checkpointMonth,
      statementStartDate,
      statementEndDate,
      statementBalanceMinor,
      input.note?.trim() || null
    )
    .run();

  await recordAuditEvent(db, {
    entityType: "account",
    entityId: input.accountId,
    action: "checkpoint_saved",
    detail: existingCheckpoint
      ? `Updated ${input.checkpointMonth} statement checkpoint ${formatMoneyMinor(existingCheckpoint.statement_balance_minor)} -> ${formatMoneyMinor(statementBalanceMinor)}.`
      : `Saved ${input.checkpointMonth} statement checkpoint at ${formatMoneyMinor(statementBalanceMinor)}.`
  });

  return { accountId: input.accountId, checkpointMonth: input.checkpointMonth, saved: true };
}

export async function deleteAccountCheckpointRecord(
  db: D1Database,
  input: {
    accountId: string;
    checkpointMonth: string;
  }
) {
  const existingCheckpoint = await db
    .prepare(`
      SELECT statement_balance_minor
      FROM account_balance_checkpoints
      WHERE household_id = ? AND account_id = ? AND checkpoint_month = ?
    `)
    .bind(DEMO_HOUSEHOLD_ID, input.accountId, input.checkpointMonth)
    .first<{ statement_balance_minor: number }>();

  if (!existingCheckpoint) {
    throw new Error(`Unknown checkpoint: ${input.accountId} ${input.checkpointMonth}`);
  }

  await db
    .prepare(`
      DELETE FROM account_balance_checkpoints
      WHERE household_id = ? AND account_id = ? AND checkpoint_month = ?
    `)
    .bind(DEMO_HOUSEHOLD_ID, input.accountId, input.checkpointMonth)
    .run();

  await recordAuditEvent(db, {
    entityType: "account",
    entityId: input.accountId,
    action: "checkpoint_deleted",
    detail: `Deleted ${input.checkpointMonth} statement checkpoint at ${formatMoneyMinor(existingCheckpoint.statement_balance_minor)}.`
  });

  return { accountId: input.accountId, checkpointMonth: input.checkpointMonth, deleted: true };
}

export async function buildAccountCheckpointLedgerCsv(
  db: D1Database,
  input: {
    accountId: string;
    checkpointMonth: string;
  }
) {
  const checkpoint = await db
    .prepare(`
      SELECT
        checkpoints.checkpoint_month,
        checkpoints.statement_start_date,
        checkpoints.statement_end_date,
        checkpoints.statement_balance_minor,
        accounts.account_name,
        accounts.account_kind,
        accounts.opening_balance_minor,
        institutions.name AS institution_name,
        people.display_name AS owner_name
      FROM account_balance_checkpoints AS checkpoints
      INNER JOIN accounts ON accounts.id = checkpoints.account_id
      INNER JOIN institutions ON institutions.id = accounts.institution_id
      LEFT JOIN people ON people.id = accounts.owner_person_id
      WHERE checkpoints.household_id = ?
        AND checkpoints.account_id = ?
        AND checkpoints.checkpoint_month = ?
    `)
    .bind(DEMO_HOUSEHOLD_ID, input.accountId, input.checkpointMonth)
    .first<{
      checkpoint_month: string;
      statement_start_date: string | null;
      statement_end_date: string | null;
      statement_balance_minor: number;
      account_name: string;
      account_kind: string;
      opening_balance_minor: number;
      institution_name: string;
      owner_name: string | null;
    }>();

  if (!checkpoint) {
    throw new Error(`Unknown checkpoint: ${input.accountId} ${input.checkpointMonth}`);
  }

  const statementStartDate = checkpoint.statement_start_date;
  const statementEndDate = checkpoint.statement_end_date ?? getMonthEndDate(checkpoint.checkpoint_month);
  const statementBalanceMinor = normalizeStatementBalanceMinor(
    Number(checkpoint.statement_balance_minor ?? 0),
    checkpoint.account_kind
  );
  const baselineRows = statementStartDate
    ? await db
      .prepare(`
        SELECT
          transactions.amount_minor,
          transactions.entry_type,
          transactions.transfer_direction
        FROM transactions
        LEFT JOIN imports ON imports.id = transactions.import_id
        WHERE transactions.household_id = ?
          AND transactions.account_id = ?
          AND transactions.transaction_date < ?
          AND (transactions.import_id IS NULL OR imports.status = 'completed')
      `)
      .bind(DEMO_HOUSEHOLD_ID, input.accountId, statementStartDate)
      .all<{
        amount_minor: number;
        entry_type: "expense" | "income" | "transfer";
        transfer_direction: "in" | "out" | null;
      }>()
    : { results: [] };
  const baselineBalanceMinor = normalizeAccountOpeningBalanceMinor(
    Number(checkpoint.opening_balance_minor ?? 0),
    checkpoint.account_kind
  ) + baselineRows.results.reduce(
    (total, row) => total + getSignedLedgerAmountMinor(row),
    0
  );
  const rows = await db
    .prepare(`
      SELECT
        transactions.id,
        transactions.transaction_date,
        transactions.description,
        transactions.amount_minor,
        transactions.currency,
        transactions.entry_type,
        transactions.transfer_direction,
        transactions.ownership_type,
        transactions.note,
        categories.name AS category_name,
        owner.display_name AS owner_name,
        imports.id AS import_id,
        imports.source_label,
        imports.imported_at
      FROM transactions
      LEFT JOIN categories ON categories.id = transactions.category_id
      LEFT JOIN people AS owner ON owner.id = transactions.owner_person_id
      LEFT JOIN imports ON imports.id = transactions.import_id
      WHERE transactions.household_id = ?
        AND transactions.account_id = ?
        AND transactions.transaction_date <= ?
        AND (? IS NULL OR transactions.transaction_date >= ?)
        AND (transactions.import_id IS NULL OR imports.status = 'completed')
      ORDER BY transactions.transaction_date, transactions.created_at
    `)
    .bind(DEMO_HOUSEHOLD_ID, input.accountId, statementEndDate, statementStartDate, statementStartDate)
    .all<{
      id: string;
      transaction_date: string;
      description: string;
      amount_minor: number;
      currency: string;
      entry_type: "expense" | "income" | "transfer";
      transfer_direction: "in" | "out" | null;
      ownership_type: "direct" | "shared";
      note: string | null;
      category_name: string | null;
      owner_name: string | null;
      import_id: string | null;
      source_label: string | null;
      imported_at: string | null;
    }>();

  const csvRows = [
    [
      "checkpoint_month",
      "statement_start_date",
      "statement_end_date",
      "statement_balance",
      "account",
      "institution",
      "account_owner",
      "date",
      "type",
      "transfer_direction",
      "description",
      "category",
      "ownership",
      "entry_owner",
      "amount",
      "signed_amount",
      "currency",
      "note",
      "import",
      "imported_at",
      "transaction_id"
    ],
    [
      checkpoint.checkpoint_month,
      checkpoint.statement_start_date ?? "",
      statementEndDate,
      formatMoneyCsvMinor(statementBalanceMinor),
      checkpoint.account_name,
      checkpoint.institution_name,
      checkpoint.owner_name ?? "",
      "",
      statementStartDate ? "statement_start_balance" : "opening_balance",
      "",
      statementStartDate ? "Ledger balance before statement start" : "Opening balance",
      "",
      "",
      "",
      formatMoneyCsvMinor(baselineBalanceMinor),
      formatMoneyCsvMinor(baselineBalanceMinor),
      "SGD",
      statementStartDate
        ? "Baseline includes opening balance and completed ledger rows before statement_start_date"
        : "Included before ledger rows",
      "",
      "",
      ""
    ],
    ...rows.results.map((row) => {
      const signedAmount = row.entry_type === "income" || (row.entry_type === "transfer" && row.transfer_direction === "in")
        ? Number(row.amount_minor)
        : -Number(row.amount_minor);
      return [
        checkpoint.checkpoint_month,
        checkpoint.statement_start_date ?? "",
        statementEndDate,
        formatMoneyCsvMinor(statementBalanceMinor),
        checkpoint.account_name,
        checkpoint.institution_name,
        checkpoint.owner_name ?? "",
        row.transaction_date,
        row.entry_type,
        row.transfer_direction ?? "",
        row.description,
        row.category_name ?? "",
        row.ownership_type,
        row.owner_name ?? "",
        formatMoneyCsvMinor(row.amount_minor),
        formatMoneyCsvMinor(signedAmount),
        row.currency,
        row.note ?? "",
        row.source_label ?? row.import_id ?? "",
        row.imported_at ?? "",
        row.id
      ];
    })
  ];

  const filenameAccount = checkpoint.account_name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "account";
  return {
    filename: `${filenameAccount}-${checkpoint.checkpoint_month}-checkpoint-ledger.csv`,
    csv: csvRows.map((row) => row.map(escapeCsvCell).join(",")).join("\n")
  };
}

export async function loadUnresolvedTransfers(db: D1Database) {
  const result = await db
    .prepare(`
      SELECT
        transactions.id,
        transactions.transaction_date,
        transactions.description,
        transactions.amount_minor,
        transactions.transfer_direction,
        accounts.account_name
      FROM transactions
      INNER JOIN accounts ON accounts.id = transactions.account_id
      LEFT JOIN imports ON imports.id = transactions.import_id
      LEFT JOIN (
        SELECT transfer_group_id, COUNT(*) AS pair_count
        FROM transactions
        WHERE household_id = ? AND transfer_group_id IS NOT NULL
        GROUP BY transfer_group_id
      ) AS grouped ON grouped.transfer_group_id = transactions.transfer_group_id
      WHERE transactions.household_id = ?
        AND transactions.entry_type = 'transfer'
        AND (transactions.import_id IS NULL OR imports.status = 'completed')
        AND (
          transactions.transfer_group_id IS NULL
          OR COALESCE(grouped.pair_count, 0) < 2
        )
      ORDER BY transactions.transaction_date DESC, transactions.created_at DESC
      LIMIT 8
    `)
    .bind(DEMO_HOUSEHOLD_ID, DEMO_HOUSEHOLD_ID)
    .all<{
      id: string;
      transaction_date: string;
      description: string;
      amount_minor: number;
      transfer_direction: "in" | "out" | null;
      account_name: string;
    }>();

  return result.results.map((row) => ({
    entryId: row.id,
    date: row.transaction_date,
    description: row.description,
    accountName: row.account_name,
    amountMinor: Number(row.amount_minor),
    transferDirection: row.transfer_direction ?? undefined
  }));
}

export async function loadAuditEvents(db: D1Database) {
  const result = await db
    .prepare(`
      SELECT id, entity_type, entity_id, action, detail, created_at
      FROM audit_events
      WHERE household_id = ?
      ORDER BY created_at DESC
      LIMIT 12
    `)
    .bind(DEMO_HOUSEHOLD_ID)
    .all<{ id: string; entity_type: string; entity_id: string; action: string; detail: string; created_at: string }>();

  return result.results.map((row) => ({
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    action: row.action,
    detail: row.detail,
    createdAt: row.created_at
  }));
}

export async function loadCategories(db: D1Database): Promise<CategoryDto[]> {
  const result = await db
    .prepare(`
      SELECT id, name, slug, icon_key, color_hex, sort_order, is_system
      FROM categories
      WHERE household_id = ?
      ORDER BY sort_order, name
    `)
    .bind(DEMO_HOUSEHOLD_ID)
    .all<{
      id: string;
      name: string;
      slug: string;
      icon_key: string;
      color_hex: string;
      sort_order: number;
      is_system: number;
    }>();

  return result.results.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug ?? slugify(row.name),
    iconKey: row.icon_key,
    colorHex: row.color_hex,
    sortOrder: row.sort_order,
    isSystem: Boolean(row.is_system)
  }));
}

export async function loadImportBatches(db: D1Database): Promise<ImportBatchDto[]> {
  const result = await db
    .prepare(`
      SELECT
        imports.id,
        imports.source_label,
        imports.source_type,
        imports.imported_at,
        imports.status,
        imports.note,
        COUNT(DISTINCT transactions.id) AS transaction_count,
        MIN(transactions.transaction_date) AS start_date,
        MAX(transactions.transaction_date) AS end_date
      FROM imports
      LEFT JOIN import_rows ON import_rows.import_id = imports.id
      LEFT JOIN transactions ON transactions.import_id = imports.id
      WHERE imports.household_id = ?
      GROUP BY imports.id, imports.source_label, imports.source_type, imports.imported_at, imports.status, imports.note
      ORDER BY imports.imported_at DESC
    `)
    .bind(DEMO_HOUSEHOLD_ID)
    .all<{
      id: string;
      source_label: string;
      source_type: "csv" | "pdf" | "manual";
      imported_at: string;
      status: "draft" | "completed" | "rolled_back";
      note: string | null;
      transaction_count: number;
      start_date: string | null;
      end_date: string | null;
    }>();

  const accountRows = await db
    .prepare(`
      SELECT DISTINCT imports.id AS import_id, accounts.id AS account_id, accounts.account_name
      FROM imports
      LEFT JOIN transactions ON transactions.import_id = imports.id
      LEFT JOIN accounts ON accounts.id = transactions.account_id
      WHERE imports.household_id = ?
    `)
    .bind(DEMO_HOUSEHOLD_ID)
    .all<{ import_id: string; account_id: string | null; account_name: string | null }>();

  const accountIdsByImportId = new Map<string, Set<string>>();
  const accountNamesByImportId = new Map<string, Set<string>>();
  for (const row of accountRows.results) {
    if (row.account_id) {
      const currentIds = accountIdsByImportId.get(row.import_id) ?? new Set<string>();
      currentIds.add(row.account_id);
      accountIdsByImportId.set(row.import_id, currentIds);
    }

    if (row.account_name) {
      const currentNames = accountNamesByImportId.get(row.import_id) ?? new Set<string>();
      currentNames.add(row.account_name);
      accountNamesByImportId.set(row.import_id, currentNames);
    }
  }

  return result.results.map((row) => {
    const rowAccountIds = accountIdsByImportId.get(row.id) ?? new Set<string>();
    const overlapImports = result.results
      .filter((candidate) => (
        candidate.id !== row.id
        && row.status === "completed"
        && candidate.status === "completed"
        && row.start_date
        && row.end_date
        && candidate.start_date
        && candidate.end_date
        && row.start_date <= candidate.end_date
        && row.end_date >= candidate.start_date
        && hasSetIntersection(rowAccountIds, accountIdsByImportId.get(candidate.id) ?? new Set<string>())
      ))
      .map((candidate) => ({
        id: candidate.id,
        sourceLabel: candidate.source_label,
        sourceType: candidate.source_type,
        importedAt: candidate.imported_at,
        status: candidate.status,
        transactionCount: Number(candidate.transaction_count ?? 0),
        startDate: candidate.start_date ?? undefined,
        endDate: candidate.end_date ?? undefined,
        accountNames: Array.from(accountNamesByImportId.get(candidate.id) ?? []).sort()
      }));

    return {
      id: row.id,
      sourceLabel: row.source_label,
      sourceType: row.source_type,
      importedAt: row.imported_at,
      status: row.status,
      transactionCount: Number(row.transaction_count ?? 0),
      startDate: row.start_date ?? undefined,
      endDate: row.end_date ?? undefined,
      accountNames: Array.from(accountNamesByImportId.get(row.id) ?? []).sort(),
      overlapImportCount: overlapImports.length,
      overlapImports,
      note: row.note ?? undefined
    };
  });
}

export async function buildImportPreview(
  db: D1Database,
  input: {
    sourceLabel: string;
    rows: Record<string, string>[];
    defaultAccountName?: string;
    ownershipType: "direct" | "shared";
    ownerName?: string;
    splitBasisPoints?: number;
  }
): Promise<ImportPreviewDto> {
  const accounts = await loadAccounts(db);
  const categories = await loadCategories(db);
  const existingHashes = await db
    .prepare(`
      SELECT normalized_hash
      FROM import_rows
      INNER JOIN imports ON imports.id = import_rows.import_id
      WHERE imports.household_id = ?
        AND imports.status = 'completed'
        AND import_rows.normalized_hash IS NOT NULL
    `)
    .bind(DEMO_HOUSEHOLD_ID)
    .all<{ normalized_hash: string }>();
  const existingTransactions = await db
    .prepare(`
      SELECT
        imports.id AS import_id,
        transactions.transaction_date,
        transactions.description,
        transactions.amount_minor,
        transactions.entry_type,
        accounts.account_name
      FROM transactions
      INNER JOIN imports ON imports.id = transactions.import_id
      INNER JOIN accounts ON accounts.id = transactions.account_id
      WHERE imports.household_id = ?
        AND imports.status = 'completed'
    `)
    .bind(DEMO_HOUSEHOLD_ID)
    .all<{
      import_id: string;
      transaction_date: string;
      description: string;
      amount_minor: number;
      entry_type: "expense" | "income" | "transfer";
      account_name: string;
    }>();
  const accountNames = new Set(accounts.map((account) => account.name));
  const categoryNames = new Set(categories.map((category) => category.name));
  const existingHashSet = new Set(existingHashes.results.map((row) => row.normalized_hash));
  const unknownAccounts = new Set<string>();
  const unknownCategories = new Set<string>();
  const previewRows: ImportPreviewRowDto[] = [];
  const validationErrors: string[] = [];
  let duplicateCandidateCount = 0;
  const duplicateCandidates = [];

  for (const [index, rawRow] of input.rows.entries()) {
    const normalized = normalizeImportRow(rawRow);
    if (normalized.errors.length) {
      validationErrors.push(`Row ${index + 1}: ${normalized.errors.join(", ")}`);
      continue;
    }
    const inferredAccountName = normalized.accountName ?? input.defaultAccountName;
    let inferredCategoryName = normalized.categoryName ?? "Other";

    if (normalized.entryType === "transfer") {
      inferredCategoryName = "Transfer";
    }

    if (inferredAccountName && !accountNames.has(inferredAccountName)) {
      unknownAccounts.add(inferredAccountName);
    }

    if (inferredCategoryName && !categoryNames.has(inferredCategoryName)) {
      unknownCategories.add(inferredCategoryName);
      inferredCategoryName = "Other";
    }

    const previewRow = {
      rowId: `preview-${index + 1}`,
      rowIndex: index + 1,
      date: normalized.date!,
      description: normalized.description,
      amountMinor: normalized.amountMinor!,
      entryType: normalized.entryType,
      transferDirection: normalized.transferDirection,
      accountId: accounts.find((account) => account.name === inferredAccountName)?.id,
      accountName: inferredAccountName,
      categoryName: inferredCategoryName,
      ownershipType: input.ownershipType,
      ownerName: input.ownershipType === "direct" ? input.ownerName : undefined,
      splitBasisPoints: input.ownershipType === "shared" ? Math.max(0, Math.min(10000, input.splitBasisPoints ?? 5000)) : 10000,
      note: normalized.note,
      rawRow
    };
    previewRows.push(previewRow);

    const isExactDuplicate = existingHashSet.has(buildImportRowHash(previewRow));
    const nearMatches = existingTransactions.results
      .filter((candidate) => {
        const sameAmount = Number(candidate.amount_minor) === Number(previewRow.amountMinor);
        if (!sameAmount) {
          return false;
        }

        const sameAccount = !previewRow.accountName || candidate.account_name === previewRow.accountName;
        if (!sameAccount) {
          return false;
        }

        const dayDistance = Math.abs(daysBetween(previewRow.date, candidate.transaction_date));
        const descriptionSimilarity = compareDescriptionSimilarity(previewRow.description, candidate.description);
        return isExactDuplicate || (dayDistance <= 3 && descriptionSimilarity >= 0.55);
      })
      .slice(0, 3);

    if (isExactDuplicate || nearMatches.length) {
      duplicateCandidateCount += 1;
    }

    for (const match of nearMatches) {
      if (duplicateCandidates.length >= 8) {
        break;
      }

      duplicateCandidates.push({
        existingImportId: match.import_id,
        date: match.transaction_date,
        description: match.description,
        amountMinor: Number(match.amount_minor),
        accountName: match.account_name,
        matchKind: isExactDuplicate ? "exact" : "near"
      });
    }
  }

  if (validationErrors.length) {
    throw new Error(`Import validation failed. ${validationErrors.join(" | ")}`);
  }

  return {
    sourceLabel: input.sourceLabel,
    parserKey: "generic_csv",
    importedRows: previewRows.length,
    previewRows,
    unknownAccounts: Array.from(unknownAccounts).sort(),
    unknownCategories: Array.from(unknownCategories).sort(),
    duplicateCandidateCount,
    overlappingImportCount: await countOverlappingImports(db, previewRows),
    startDate: previewRows.length ? previewRows.map((row) => row.date).sort()[0] : undefined,
    endDate: previewRows.length ? previewRows.map((row) => row.date).sort().at(-1) : undefined,
    accountNames: Array.from(new Set(previewRows.map((row) => row.accountName).filter(Boolean))).sort(),
    duplicateCandidates
  };
}

async function countOverlappingImports(db: D1Database, rows: ImportPreviewRowDto[]) {
  if (!rows.length) {
    return 0;
  }

  const dates = rows.map((row) => row.date).sort();
  const accountNames = Array.from(new Set(rows.map((row) => row.accountName).filter(Boolean)));
  if (!accountNames.length) {
    return 0;
  }

  const placeholders = accountNames.map(() => "?").join(", ");
  const overlapRows = await db
    .prepare(`
      SELECT COUNT(DISTINCT imports.id) AS overlap_count
      FROM imports
      INNER JOIN transactions ON transactions.import_id = imports.id
      INNER JOIN accounts ON accounts.id = transactions.account_id
      WHERE imports.household_id = ?
        AND imports.status = 'completed'
        AND accounts.account_name IN (${placeholders})
        AND transactions.transaction_date BETWEEN ? AND ?
    `)
    .bind(DEMO_HOUSEHOLD_ID, ...accountNames, dates[0], dates[dates.length - 1])
    .first<{ overlap_count: number | null }>();

  return Number(overlapRows?.overlap_count ?? 0);
}

export async function commitImportBatch(
  db: D1Database,
  input: {
    sourceLabel: string;
    rows: ImportPreviewRowDto[];
    note?: string;
  }
) {
  const importId = `import-${crypto.randomUUID()}`;
  const monthsToRecalculate = new Set<string>();

  await db
    .prepare(`
      INSERT INTO imports (
        id, household_id, source_type, source_label, parser_key, imported_at, status, note
      ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'draft', ?)
    `)
    .bind(importId, DEMO_HOUSEHOLD_ID, "csv", input.sourceLabel, "generic_csv", input.note ?? null)
    .run();

  try {
    const [accountRows, categoryRows, personRows] = await Promise.all([
      db
        .prepare("SELECT id, account_name FROM accounts WHERE household_id = ?")
        .bind(DEMO_HOUSEHOLD_ID)
        .all<{ id: string; account_name: string }>(),
      db
        .prepare("SELECT id, name FROM categories WHERE household_id = ?")
        .bind(DEMO_HOUSEHOLD_ID)
        .all<{ id: string; name: string }>(),
      db
        .prepare("SELECT id, display_name FROM people WHERE household_id = ? ORDER BY created_at")
        .bind(DEMO_HOUSEHOLD_ID)
        .all<{ id: string; display_name: string }>()
    ]);
    const accountIdsByName = new Map(accountRows.results.map((account) => [account.account_name, account.id]));
    const categoryIdsByName = new Map(categoryRows.results.map((category) => [category.name, category.id]));
    const personIdsByName = new Map(personRows.results.map((person) => [person.display_name, person.id]));
    const [firstPerson, secondPerson] = personRows.results;
    const statements: D1PreparedStatement[] = [];

    for (const row of input.rows) {
      const rowId = `import-row-${crypto.randomUUID()}`;
      const transactionId = `txn-${crypto.randomUUID()}`;
      const accountId = row.accountName ? accountIdsByName.get(row.accountName) : null;

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
          ),
        db
          .prepare(`
            INSERT INTO transactions (
              id, household_id, import_id, import_row_id, account_id, transaction_date,
              description, amount_minor, currency, entry_type, transfer_direction,
              category_id, ownership_type, owner_person_id, offsets_category, note
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SGD', ?, ?, ?, ?, ?, 0, ?)
          `)
          .bind(
            transactionId,
            DEMO_HOUSEHOLD_ID,
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
            row.note ?? null
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

    for (let index = 0; index < statements.length; index += IMPORT_COMMIT_STATEMENT_CHUNK_SIZE) {
      await db.batch(statements.slice(index, index + IMPORT_COMMIT_STATEMENT_CHUNK_SIZE));
    }

    await db
      .prepare("UPDATE imports SET status = 'completed' WHERE household_id = ? AND id = ?")
      .bind(DEMO_HOUSEHOLD_ID, importId)
      .run();

    for (const month of monthsToRecalculate) {
      await recalculateMonthlySnapshots(db, month);
    }
  } catch (error) {
    await cleanupImportBatchRows(db, importId);
    await db
      .prepare("UPDATE imports SET status = 'rolled_back' WHERE household_id = ? AND id = ?")
      .bind(DEMO_HOUSEHOLD_ID, importId)
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

export async function rollbackImportBatch(
  db: D1Database,
  input: {
    importId: string;
  }
) {
  const transactionMonths = await db
    .prepare(`
      SELECT DISTINCT transaction_date
      FROM transactions
      WHERE household_id = ? AND import_id = ?
    `)
    .bind(DEMO_HOUSEHOLD_ID, input.importId)
    .all<{ transaction_date: string }>();

  await cleanupImportBatchRows(db, input.importId);

  await db
    .prepare("UPDATE imports SET status = 'rolled_back' WHERE household_id = ? AND id = ?")
    .bind(DEMO_HOUSEHOLD_ID, input.importId)
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
  await db
    .prepare(`
      DELETE FROM transaction_splits
      WHERE transaction_id IN (
        SELECT id FROM transactions WHERE household_id = ? AND import_id = ?
      )
    `)
    .bind(DEMO_HOUSEHOLD_ID, importId)
    .run();

  await db
    .prepare("DELETE FROM transactions WHERE household_id = ? AND import_id = ?")
    .bind(DEMO_HOUSEHOLD_ID, importId)
    .run();

  await db
    .prepare(`
      DELETE FROM import_rows
      WHERE import_id IN (
        SELECT id FROM imports WHERE household_id = ? AND id = ?
      )
    `)
    .bind(DEMO_HOUSEHOLD_ID, importId)
    .run();
}

export async function loadMonthPlanRows(db: D1Database, month = "2025-10"): Promise<MonthPlanRowDto[]> {
  const [year, monthNumber] = month.split("-").map(Number);
  const rows = await db
    .prepare(`
      SELECT
        monthly_plan_rows.id,
        monthly_plan_rows.person_id,
        monthly_plan_rows.section_key,
        monthly_plan_rows.category_id,
        monthly_plan_rows.label,
        monthly_plan_rows.plan_date,
        monthly_plan_rows.planned_amount_minor,
        monthly_plan_rows.actual_amount_minor,
        monthly_plan_rows.notes,
        monthly_plan_rows.ownership_type,
        people.display_name AS owner_name,
        categories.name AS category_name,
        monthly_plan_rows.account_id,
        accounts.account_name AS account_name
      FROM monthly_plan_rows
      LEFT JOIN people ON people.id = monthly_plan_rows.person_id
      LEFT JOIN categories ON categories.id = monthly_plan_rows.category_id
      LEFT JOIN accounts ON accounts.id = monthly_plan_rows.account_id
      WHERE monthly_plan_rows.household_id = ? AND monthly_plan_rows.year = ? AND monthly_plan_rows.month = ?
      ORDER BY monthly_plan_rows.created_at
    `)
    .bind(DEMO_HOUSEHOLD_ID, year, monthNumber)
    .all<{
      id: string;
      person_id: string | null;
      section_key: "planned_items" | "budget_buckets" | "income";
      category_id: string | null;
      label: string;
      plan_date: string | null;
      planned_amount_minor: number;
      actual_amount_minor: number;
      notes: string | null;
      ownership_type: "direct" | "shared";
      owner_name: string | null;
      category_name: string | null;
      account_id: string | null;
      account_name: string | null;
    }>();

  const splits = await db
    .prepare(`
      SELECT
        monthly_plan_row_splits.monthly_plan_row_id,
        monthly_plan_row_splits.person_id,
        monthly_plan_row_splits.ratio_basis_points,
        monthly_plan_row_splits.amount_minor,
        people.display_name
      FROM monthly_plan_row_splits
      INNER JOIN people ON people.id = monthly_plan_row_splits.person_id
      INNER JOIN monthly_plan_rows ON monthly_plan_rows.id = monthly_plan_row_splits.monthly_plan_row_id
      WHERE monthly_plan_rows.household_id = ? AND monthly_plan_rows.year = ? AND monthly_plan_rows.month = ?
      ORDER BY monthly_plan_row_splits.created_at
    `)
    .bind(DEMO_HOUSEHOLD_ID, year, monthNumber)
    .all<{
      monthly_plan_row_id: string;
      person_id: string;
      ratio_basis_points: number;
      amount_minor: number;
      display_name: string;
    }>();

  const splitMap = groupSplits(splits.results, "monthly_plan_row_id");
  const linkedEntries = await db
    .prepare(`
      SELECT
        monthly_plan_entry_links.monthly_plan_row_id,
        monthly_plan_entry_links.transaction_id
      FROM monthly_plan_entry_links
      INNER JOIN monthly_plan_rows ON monthly_plan_rows.id = monthly_plan_entry_links.monthly_plan_row_id
      WHERE monthly_plan_rows.household_id = ? AND monthly_plan_rows.year = ? AND monthly_plan_rows.month = ?
      ORDER BY monthly_plan_entry_links.created_at
    `)
    .bind(DEMO_HOUSEHOLD_ID, year, monthNumber)
    .all<{
      monthly_plan_row_id: string;
      transaction_id: string;
    }>();
  const linkedEntryMap = linkedEntries.results.reduce((map, row) => {
    const current = map.get(row.monthly_plan_row_id) ?? [];
    current.push(row.transaction_id);
    map.set(row.monthly_plan_row_id, current);
    return map;
  }, new Map<string, string[]>());

  const matchHints = await db
    .prepare(`
      SELECT
        monthly_plan_match_hints.id,
        monthly_plan_match_hints.person_id,
        monthly_plan_match_hints.category_id,
        monthly_plan_match_hints.account_id,
        monthly_plan_match_hints.label_normalized,
        monthly_plan_match_hints.description_pattern,
        monthly_plan_match_hints.amount_minor,
        accounts.account_name,
        categories.name AS category_name
      FROM monthly_plan_match_hints
      LEFT JOIN accounts ON accounts.id = monthly_plan_match_hints.account_id
      LEFT JOIN categories ON categories.id = monthly_plan_match_hints.category_id
      WHERE monthly_plan_match_hints.household_id = ?
      ORDER BY monthly_plan_match_hints.updated_at DESC
    `)
    .bind(DEMO_HOUSEHOLD_ID)
    .all<{
      id: string;
      person_id: string | null;
      category_id: string | null;
      account_id: string | null;
      label_normalized: string;
      description_pattern: string;
      amount_minor: number | null;
      account_name: string | null;
      category_name: string | null;
    }>();

  return rows.results
    .filter((row) => row.section_key !== "income")
    .map((row) => {
      const linkedEntryIds = linkedEntryMap.get(row.id) ?? [];
      const labelNormalized = normalizePlanMatchHint(row.label);
      const planMatchHints = row.section_key === "planned_items"
        ? matchHints.results
            .filter((hint) => (
              hint.label_normalized === labelNormalized &&
              (!hint.person_id || !row.person_id || hint.person_id === row.person_id) &&
              (!hint.category_id || !row.category_id || hint.category_id === row.category_id) &&
              (!row.account_id || !hint.account_id || hint.account_id === row.account_id)
            ))
            .map((hint) => ({
              id: hint.id,
              descriptionPattern: hint.description_pattern,
              amountMinor: hint.amount_minor ?? undefined,
              accountName: hint.account_name ?? undefined,
              categoryName: hint.category_name ?? undefined
            }))
        : [];
      return {
        id: row.id,
        section: row.section_key === "budget_buckets" ? "budget_buckets" : "planned_items",
        categoryId: row.category_id ?? undefined,
        categoryName: row.category_name ?? "Other",
        label: row.label,
        planDate: row.plan_date ?? undefined,
        dayLabel: row.plan_date ? String(new Date(row.plan_date).getUTCDate()) : undefined,
        dayOfWeek: row.plan_date ? weekdayLabel(row.plan_date) : undefined,
        plannedMinor: row.planned_amount_minor,
        actualMinor: row.actual_amount_minor,
        accountId: row.account_id ?? undefined,
        accountName: row.account_name ?? undefined,
        note: row.notes ?? undefined,
        ownershipType: row.ownership_type,
        personId: row.person_id ?? undefined,
        ownerName: row.owner_name ?? undefined,
        linkedEntryIds,
        linkedEntryCount: linkedEntryIds.length,
        planMatchHints,
        isDerived: false,
        sourceRowIds: [row.id],
        splits: splitMap.get(row.id) ?? []
      };
    });
}

export async function loadEntries(db: D1Database, month = "2025-10"): Promise<EntryDto[]> {
  const [monthStart, nextMonth] = getMonthBounds(month);
  return loadEntriesForDateRange(db, monthStart, nextMonth);
}

export async function loadEntriesForMonths(db: D1Database, months: string[]): Promise<EntryDto[]> {
  if (!months.length) {
    return [];
  }

  const sortedMonths = [...months].sort();
  const [monthStart] = getMonthBounds(sortedMonths[0]);
  const [, monthEnd] = getMonthBounds(sortedMonths[sortedMonths.length - 1]);
  return loadEntriesForDateRange(db, monthStart, monthEnd);
}

async function loadEntriesForDateRange(db: D1Database, monthStart: string, nextMonth: string): Promise<EntryDto[]> {
  const entries = await db
    .prepare(`
      SELECT
        transactions.id,
        transactions.transaction_date,
        transactions.description,
        transactions.entry_type,
        transactions.transfer_direction,
        transactions.ownership_type,
        transactions.amount_minor,
        transactions.offsets_category,
        transactions.note,
        transactions.transfer_group_id,
        people.display_name AS owner_name,
        accounts.account_name AS account_name,
        categories.name AS category_name
      FROM transactions
      INNER JOIN accounts ON accounts.id = transactions.account_id
      LEFT JOIN people ON people.id = transactions.owner_person_id
      LEFT JOIN categories ON categories.id = transactions.category_id
      LEFT JOIN imports ON imports.id = transactions.import_id
      WHERE transactions.household_id = ?
        AND transactions.transaction_date >= ?
        AND transactions.transaction_date < ?
        AND (transactions.import_id IS NULL OR imports.status = 'completed')
      ORDER BY transactions.transaction_date, transactions.created_at
    `)
    .bind(DEMO_HOUSEHOLD_ID, monthStart, nextMonth)
    .all<{
      id: string;
      transaction_date: string;
      description: string;
      entry_type: "expense" | "income" | "transfer";
      transfer_direction: "in" | "out" | null;
      ownership_type: "direct" | "shared";
      amount_minor: number;
      offsets_category: number;
      note: string | null;
      transfer_group_id: string | null;
      owner_name: string | null;
      account_name: string;
      category_name: string | null;
    }>();

  const splits = await db
    .prepare(`
      SELECT
        transaction_splits.transaction_id,
        transaction_splits.person_id,
        transaction_splits.ratio_basis_points,
        transaction_splits.amount_minor,
        people.display_name
      FROM transaction_splits
      INNER JOIN people ON people.id = transaction_splits.person_id
      INNER JOIN transactions ON transactions.id = transaction_splits.transaction_id
      WHERE transactions.household_id = ?
        AND transactions.transaction_date >= ?
        AND transactions.transaction_date < ?
      ORDER BY transaction_splits.created_at
    `)
    .bind(DEMO_HOUSEHOLD_ID, monthStart, nextMonth)
    .all<{
      transaction_id: string;
      person_id: string;
      ratio_basis_points: number;
      amount_minor: number;
      display_name: string;
    }>();

  const splitMap = groupSplits(splits.results, "transaction_id");
  const entriesByTransferGroup = new Map<string, typeof entries.results>();

  for (const entry of entries.results) {
    if (!entry.transfer_group_id) {
      continue;
    }

    const current = entriesByTransferGroup.get(entry.transfer_group_id) ?? [];
    current.push(entry);
    entriesByTransferGroup.set(entry.transfer_group_id, current);
  }

  return entries.results.map((row) => {
    let linkedTransfer: LinkedTransferDto | undefined;
    if (row.transfer_group_id) {
      const siblings = entriesByTransferGroup.get(row.transfer_group_id) ?? [];
      const counterpart = siblings.find((candidate) => candidate.id !== row.id);
      if (counterpart) {
        linkedTransfer = {
          transactionId: counterpart.id,
          accountName: counterpart.account_name,
          amountMinor: counterpart.amount_minor,
          transactionDate: counterpart.transaction_date
        };
      }
    }

    return {
      id: row.id,
      date: row.transaction_date,
      description: row.description,
      accountName: row.account_name,
      categoryName: row.category_name ?? "Other",
      entryType: row.entry_type,
      transferDirection: row.transfer_direction ?? undefined,
      ownershipType: row.ownership_type,
      ownerName: row.owner_name ?? undefined,
      amountMinor: row.amount_minor,
      offsetsCategory: Boolean(row.offsets_category),
      note: row.note ?? undefined,
      linkedTransfer,
      splits: splitMap.get(row.id) ?? []
    };
  });
}

export async function loadSplitExpenses(db: D1Database, month = "2025-10"): Promise<SplitExpenseDto[]> {
  const expenses = await db
    .prepare(`
      SELECT
        split_expenses.id,
        split_expenses.split_group_id,
        split_expenses.split_batch_id,
        split_expenses.expense_date,
        split_expenses.description,
        split_expenses.total_amount_minor,
        split_expenses.note,
        split_expenses.linked_transaction_id,
        split_groups.group_name,
        split_batches.batch_name,
        split_batches.closed_on,
        payer.id AS payer_person_id,
        payer.display_name AS payer_person_name,
        categories.name AS category_name,
        transactions.description AS linked_transaction_description
      FROM split_expenses
      LEFT JOIN split_groups ON split_groups.id = split_expenses.split_group_id
      LEFT JOIN split_batches ON split_batches.id = split_expenses.split_batch_id
      INNER JOIN people AS payer ON payer.id = split_expenses.payer_person_id
      LEFT JOIN categories ON categories.id = split_expenses.category_id
      LEFT JOIN transactions ON transactions.id = split_expenses.linked_transaction_id
      WHERE split_expenses.household_id = ?
      ORDER BY split_expenses.expense_date DESC, split_expenses.created_at DESC
    `)
    .bind(DEMO_HOUSEHOLD_ID)
    .all<{
      id: string;
      split_group_id: string | null;
      split_batch_id: string | null;
      expense_date: string;
      description: string;
      total_amount_minor: number;
      note: string | null;
      linked_transaction_id: string | null;
      group_name: string | null;
      batch_name: string | null;
      closed_on: string | null;
      payer_person_id: string;
      payer_person_name: string;
      category_name: string | null;
      linked_transaction_description: string | null;
    }>();

  const shares = await db
    .prepare(`
      SELECT
        split_expense_shares.split_expense_id,
        split_expense_shares.person_id,
        split_expense_shares.ratio_basis_points,
        split_expense_shares.amount_minor,
        people.display_name
      FROM split_expense_shares
      INNER JOIN split_expenses ON split_expenses.id = split_expense_shares.split_expense_id
      INNER JOIN people ON people.id = split_expense_shares.person_id
      WHERE split_expenses.household_id = ?
      ORDER BY split_expense_shares.created_at
    `)
    .bind(DEMO_HOUSEHOLD_ID)
    .all<{
      split_expense_id: string;
      person_id: string;
      ratio_basis_points: number;
      amount_minor: number;
      display_name: string;
    }>();

  const shareMap = groupSplits(
    shares.results.map((row) => ({
      entry_id: row.split_expense_id,
      person_id: row.person_id,
      ratio_basis_points: row.ratio_basis_points,
      amount_minor: row.amount_minor,
      display_name: row.display_name
    })),
    "entry_id"
  );

  return expenses.results.map((row) => ({
    id: row.id,
    groupId: row.split_group_id ?? undefined,
    groupName: row.group_name ?? "Non-group expenses",
    batchId: row.split_batch_id ?? undefined,
    batchLabel: row.batch_name ?? undefined,
    batchClosedAt: row.closed_on ?? undefined,
    date: row.expense_date,
    description: row.description,
    categoryName: row.category_name ?? "Other",
    payerPersonId: row.payer_person_id,
    payerPersonName: row.payer_person_name,
    totalAmountMinor: row.total_amount_minor,
    note: row.note ?? undefined,
    linkedTransactionId: row.linked_transaction_id ?? undefined,
    linkedTransactionDescription: row.linked_transaction_description ?? undefined,
    shares: shareMap.get(row.id) ?? []
  }));
}

export async function loadSplitSettlements(db: D1Database, month = "2025-10"): Promise<SplitSettlementDto[]> {
  const settlements = await db
    .prepare(`
      SELECT
        split_settlements.id,
        split_settlements.split_group_id,
        split_settlements.split_batch_id,
        split_settlements.settlement_date,
        split_settlements.amount_minor,
        split_settlements.note,
        split_settlements.linked_transaction_id,
        split_groups.group_name,
        split_batches.batch_name,
        split_batches.closed_on,
        from_person.id AS from_person_id,
        from_person.display_name AS from_person_name,
        to_person.id AS to_person_id,
        to_person.display_name AS to_person_name,
        transactions.description AS linked_transaction_description
      FROM split_settlements
      LEFT JOIN split_groups ON split_groups.id = split_settlements.split_group_id
      LEFT JOIN split_batches ON split_batches.id = split_settlements.split_batch_id
      INNER JOIN people AS from_person ON from_person.id = split_settlements.from_person_id
      INNER JOIN people AS to_person ON to_person.id = split_settlements.to_person_id
      LEFT JOIN transactions ON transactions.id = split_settlements.linked_transaction_id
      WHERE split_settlements.household_id = ?
      ORDER BY split_settlements.settlement_date DESC, split_settlements.created_at DESC
    `)
    .bind(DEMO_HOUSEHOLD_ID)
    .all<{
      id: string;
      split_group_id: string | null;
      split_batch_id: string | null;
      settlement_date: string;
      amount_minor: number;
      note: string | null;
      linked_transaction_id: string | null;
      group_name: string | null;
      batch_name: string | null;
      closed_on: string | null;
      from_person_id: string;
      from_person_name: string;
      to_person_id: string;
      to_person_name: string;
      linked_transaction_description: string | null;
    }>();

  return settlements.results.map((row) => ({
    id: row.id,
    groupId: row.split_group_id ?? undefined,
    groupName: row.group_name ?? "Non-group expenses",
    batchId: row.split_batch_id ?? undefined,
    batchLabel: row.batch_name ?? undefined,
    batchClosedAt: row.closed_on ?? undefined,
    date: row.settlement_date,
    fromPersonId: row.from_person_id,
    fromPersonName: row.from_person_name,
    toPersonId: row.to_person_id,
    toPersonName: row.to_person_name,
    amountMinor: row.amount_minor,
    note: row.note ?? undefined,
    linkedTransactionId: row.linked_transaction_id ?? undefined,
    linkedTransactionDescription: row.linked_transaction_description ?? undefined
  }));
}

export async function loadSplitMatchCandidates(db: D1Database, month = "2025-10"): Promise<SplitMatchCandidateDto[]> {
  const [expenses, settlements] = await Promise.all([
    loadSplitExpenses(db, month),
    loadSplitSettlements(db, month)
  ]);
  const transactionRows = await db
    .prepare(`
      SELECT
        transactions.id,
        transactions.transaction_date,
        transactions.description,
        transactions.amount_minor,
        transactions.entry_type,
        transactions.import_id
      FROM transactions
      INNER JOIN imports ON imports.id = transactions.import_id
      WHERE transactions.household_id = ?
        AND transactions.import_id IS NOT NULL
        AND imports.status = 'completed'
      ORDER BY transactions.transaction_date DESC, transactions.created_at DESC
    `)
    .bind(DEMO_HOUSEHOLD_ID)
    .all<{
      id: string;
      transaction_date: string;
      description: string;
      amount_minor: number;
      entry_type: "expense" | "income" | "transfer";
      import_id: string;
    }>();

  const matches: SplitMatchCandidateDto[] = [];

  for (const expense of expenses.filter((item) => !item.linkedTransactionId)) {
    const candidate = transactionRows.results
      .filter((row) => row.entry_type === "expense")
      .map((row) => ({
        row,
        dateDelta: diffDays(expense.date, row.transaction_date),
        amountDelta: Math.abs(expense.totalAmountMinor - row.amount_minor),
        overlap: countSharedTokens(expense.description, row.description)
      }))
      .filter((item) => item.dateDelta <= 5 && item.amountDelta <= 150 && item.overlap > 0)
      .sort((left, right) => (
        left.amountDelta - right.amountDelta
        || left.dateDelta - right.dateDelta
        || right.overlap - left.overlap
      ))[0];

    if (!candidate) {
      continue;
    }

    matches.push({
      id: `expense-match-${expense.id}-${candidate.row.id}`,
      kind: "expense",
      groupId: expense.groupId ?? "split-group-none",
      groupName: expense.groupName,
      splitRecordId: expense.id,
      transactionId: candidate.row.id,
      transactionDate: candidate.row.transaction_date,
      transactionDescription: candidate.row.description,
      amountMinor: candidate.row.amount_minor,
      confidenceLabel: candidate.amountDelta === 0 && candidate.dateDelta <= 1 ? "High" : "Medium",
      reviewLabel: "Imported transaction could match this split expense"
    });
  }

  for (const settlement of settlements.filter((item) => !item.linkedTransactionId)) {
    const candidate = transactionRows.results
      .filter((row) => row.entry_type === "transfer")
      .map((row) => ({
        row,
        dateDelta: diffDays(settlement.date, row.transaction_date),
        amountDelta: Math.abs(settlement.amountMinor - row.amount_minor)
      }))
      .filter((item) => item.dateDelta <= 7 && item.amountDelta <= 150)
      .sort((left, right) => left.amountDelta - right.amountDelta || left.dateDelta - right.dateDelta)[0];

    if (!candidate) {
      continue;
    }

    matches.push({
      id: `settlement-match-${settlement.id}-${candidate.row.id}`,
      kind: "settlement",
      groupId: settlement.groupId ?? "split-group-none",
      groupName: settlement.groupName,
      splitRecordId: settlement.id,
      transactionId: candidate.row.id,
      transactionDate: candidate.row.transaction_date,
      transactionDescription: candidate.row.description,
      amountMinor: candidate.row.amount_minor,
      confidenceLabel: candidate.amountDelta === 0 && candidate.dateDelta <= 1 ? "High" : "Medium",
      reviewLabel: "Imported transfer could match this settle-up"
    });
  }

  return matches;
}

export async function createSplitGroupRecord(
  db: D1Database,
  input: { name: string }
) {
  const id = `split-group-${slugify(input.name)}-${Date.now()}`;
  await db
    .prepare(`
      INSERT INTO split_groups (
        id, household_id, group_name, sort_order
      ) VALUES (?, ?, ?, ?)
    `)
    .bind(id, DEMO_HOUSEHOLD_ID, input.name.trim(), Date.now())
    .run();

  return { groupId: id };
}

export async function createSplitExpenseRecord(
  db: D1Database,
  input: {
    groupId?: string | null;
    date: string;
    description: string;
    categoryName: string;
    payerPersonName: string;
    amountMinor: number;
    note?: string;
    splitBasisPoints?: number;
  }
) {
  const payerPersonId = PERSON_IDS[input.payerPersonName];
  if (!payerPersonId) {
    throw new Error("Unknown split expense payer.");
  }

  const id = `split-expense-${Date.now()}`;
  const batchId = await getOrCreateActiveSplitBatch(db, {
    groupId: input.groupId || null,
    date: input.date
  });
  const categoryId = findCategoryId(input.categoryName);
  const firstBasisPoints = Math.max(0, Math.min(10000, input.splitBasisPoints ?? 5000));
  const secondBasisPoints = 10000 - firstBasisPoints;
  const firstAmount = Math.round(input.amountMinor * (firstBasisPoints / 10000));
  const secondAmount = input.amountMinor - firstAmount;
  const shares = [
    { personId: "person-tim", ratioBasisPoints: firstBasisPoints, amountMinor: firstAmount },
    { personId: "person-joyce", ratioBasisPoints: secondBasisPoints, amountMinor: secondAmount }
  ];

  await db
    .prepare(`
      INSERT INTO split_expenses (
        id, household_id, split_group_id, split_batch_id, payer_person_id, expense_date,
        description, category_id, total_amount_minor, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      id,
      DEMO_HOUSEHOLD_ID,
      input.groupId || null,
      batchId,
      payerPersonId,
      input.date,
      input.description.trim(),
      categoryId,
      input.amountMinor,
      input.note ?? null
    )
    .run();

  for (const share of shares) {
    await db
      .prepare(`
        INSERT INTO split_expense_shares (
          id, split_expense_id, person_id, ratio_basis_points, amount_minor
        ) VALUES (?, ?, ?, ?, ?)
      `)
      .bind(`${id}-${share.personId}`, id, share.personId, share.ratioBasisPoints, share.amountMinor)
      .run();
  }

  return { splitExpenseId: id };
}

export async function createSplitSettlementRecord(
  db: D1Database,
  input: {
    groupId?: string | null;
    date: string;
    fromPersonName: string;
    toPersonName: string;
    amountMinor: number;
    note?: string;
  }
) {
  const fromPersonId = PERSON_IDS[input.fromPersonName];
  const toPersonId = PERSON_IDS[input.toPersonName];
  if (!fromPersonId || !toPersonId || fromPersonId === toPersonId) {
    throw new Error("Settlement requires two different people.");
  }

  const id = `split-settlement-${Date.now()}`;
  const batchId = await getOrCreateActiveSplitBatch(db, {
    groupId: input.groupId || null,
    date: input.date
  });
  await db
    .prepare(`
      INSERT INTO split_settlements (
        id, household_id, split_group_id, split_batch_id, from_person_id, to_person_id,
        settlement_date, amount_minor, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      id,
      DEMO_HOUSEHOLD_ID,
      input.groupId || null,
      batchId,
      fromPersonId,
      toPersonId,
      input.date,
      input.amountMinor,
      input.note ?? null
    )
    .run();
  await closeSplitBatch(db, { batchId, closedOn: input.date });

  return { settlementId: id };
}

export async function updateSplitExpenseRecord(
  db: D1Database,
  input: {
    splitExpenseId: string;
    groupId?: string | null;
    date: string;
    description: string;
    categoryName: string;
    payerPersonName: string;
    amountMinor: number;
    note?: string;
    splitBasisPoints?: number;
  }
) {
  const payerPersonId = PERSON_IDS[input.payerPersonName];
  if (!payerPersonId) {
    throw new Error("Unknown split expense payer.");
  }

  const existing = await db
    .prepare(`
      SELECT split_group_id, split_batch_id
      FROM split_expenses
      WHERE id = ? AND household_id = ?
    `)
    .bind(input.splitExpenseId, DEMO_HOUSEHOLD_ID)
    .first<{ split_group_id: string | null; split_batch_id: string | null }>();
  if (!existing) {
    throw new Error("Split expense not found.");
  }

  const nextGroupId = input.groupId || null;
  const batchId = existing.split_group_id === nextGroupId
    ? existing.split_batch_id
    : await getOrCreateActiveSplitBatch(db, { groupId: nextGroupId, date: input.date });

  await db
    .prepare(`
      UPDATE split_expenses
      SET split_group_id = ?, split_batch_id = ?, payer_person_id = ?, expense_date = ?, description = ?,
          category_id = ?, total_amount_minor = ?, note = ?
      WHERE id = ? AND household_id = ?
    `)
    .bind(
      input.groupId || null,
      batchId ?? null,
      payerPersonId,
      input.date,
      input.description.trim(),
      findCategoryId(input.categoryName),
      input.amountMinor,
      input.note ?? null,
      input.splitExpenseId,
      DEMO_HOUSEHOLD_ID
    )
    .run();

  const firstBasisPoints = Math.max(0, Math.min(10000, input.splitBasisPoints ?? 5000));
  const secondBasisPoints = 10000 - firstBasisPoints;
  const firstAmount = Math.round(input.amountMinor * (firstBasisPoints / 10000));
  const secondAmount = input.amountMinor - firstAmount;

  await db.prepare("DELETE FROM split_expense_shares WHERE split_expense_id = ?").bind(input.splitExpenseId).run();
  await db
    .prepare(`
      INSERT INTO split_expense_shares (
        id, split_expense_id, person_id, ratio_basis_points, amount_minor
      ) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)
    `)
    .bind(
      `${input.splitExpenseId}-person-tim`,
      input.splitExpenseId,
      "person-tim",
      firstBasisPoints,
      firstAmount,
      `${input.splitExpenseId}-person-joyce`,
      input.splitExpenseId,
      "person-joyce",
      secondBasisPoints,
      secondAmount
    )
    .run();

  return { splitExpenseId: input.splitExpenseId };
}

export async function updateSplitSettlementRecord(
  db: D1Database,
  input: {
    settlementId: string;
    groupId?: string | null;
    date: string;
    fromPersonName: string;
    toPersonName: string;
    amountMinor: number;
    note?: string;
  }
) {
  const fromPersonId = PERSON_IDS[input.fromPersonName];
  const toPersonId = PERSON_IDS[input.toPersonName];
  if (!fromPersonId || !toPersonId || fromPersonId === toPersonId) {
    throw new Error("Settlement requires two different people.");
  }

  const existing = await db
    .prepare(`
      SELECT split_group_id, split_batch_id
      FROM split_settlements
      WHERE id = ? AND household_id = ?
    `)
    .bind(input.settlementId, DEMO_HOUSEHOLD_ID)
    .first<{ split_group_id: string | null; split_batch_id: string | null }>();
  if (!existing) {
    throw new Error("Split settlement not found.");
  }

  const nextGroupId = input.groupId || null;
  const batchId = existing.split_group_id === nextGroupId
    ? existing.split_batch_id
    : await getOrCreateActiveSplitBatch(db, { groupId: nextGroupId, date: input.date });

  await db
    .prepare(`
      UPDATE split_settlements
      SET split_group_id = ?, split_batch_id = ?, from_person_id = ?, to_person_id = ?,
          settlement_date = ?, amount_minor = ?, note = ?
      WHERE id = ? AND household_id = ?
    `)
    .bind(
      input.groupId || null,
      batchId ?? null,
      fromPersonId,
      toPersonId,
      input.date,
      input.amountMinor,
      input.note ?? null,
      input.settlementId,
      DEMO_HOUSEHOLD_ID
    )
    .run();
  if (batchId) {
    await closeSplitBatch(db, { batchId, closedOn: input.date });
  }

  return { settlementId: input.settlementId };
}

export async function linkSplitExpenseMatch(
  db: D1Database,
  input: { splitExpenseId: string; transactionId: string }
) {
  await db
    .prepare("UPDATE split_expenses SET linked_transaction_id = ? WHERE id = ? AND household_id = ?")
    .bind(input.transactionId, input.splitExpenseId, DEMO_HOUSEHOLD_ID)
    .run();

  return { ok: true };
}

export async function linkSplitSettlementMatch(
  db: D1Database,
  input: { settlementId: string; transactionId: string }
) {
  await db
    .prepare("UPDATE split_settlements SET linked_transaction_id = ? WHERE id = ? AND household_id = ?")
    .bind(input.transactionId, input.settlementId, DEMO_HOUSEHOLD_ID)
    .run();

  return { ok: true };
}

export async function createSplitExpenseFromEntryRecord(
  db: D1Database,
  input: { entryId: string; splitGroupId?: string | null }
) {
  const entry = await db
    .prepare(`
      SELECT
        transactions.id,
        transactions.transaction_date,
        transactions.description,
        transactions.amount_minor,
        transactions.ownership_type,
        transactions.owner_person_id,
        transactions.note,
        transactions.category_id,
        transactions.entry_type,
        accounts.owner_person_id AS account_owner_person_id
      FROM transactions
      INNER JOIN accounts ON accounts.id = transactions.account_id
      WHERE transactions.household_id = ?
        AND transactions.id = ?
    `)
    .bind(DEMO_HOUSEHOLD_ID, input.entryId)
    .first<{
      id: string;
      transaction_date: string;
      description: string;
      amount_minor: number;
      ownership_type: "direct" | "shared";
      owner_person_id: string | null;
      note: string | null;
      category_id: string | null;
      entry_type: "expense" | "income" | "transfer";
      account_owner_person_id: string | null;
    }>();

  if (!entry) {
    throw new Error("Entry not found.");
  }

  if (entry.entry_type !== "expense") {
    throw new Error("Only expense entries can be added to splits.");
  }

  const existingSplit = await db
    .prepare("SELECT id FROM split_expenses WHERE household_id = ? AND linked_transaction_id = ?")
    .bind(DEMO_HOUSEHOLD_ID, input.entryId)
    .first<{ id: string }>();

  if (existingSplit) {
    throw new Error("This entry is already linked to a split expense.");
  }

  const payerPersonId = entry.owner_person_id ?? entry.account_owner_person_id;
  if (!payerPersonId) {
    throw new Error("This entry does not have a clear payer. Assign an owner first.");
  }

  if (entry.ownership_type !== "shared") {
    await db
      .prepare(`
        UPDATE transactions
        SET ownership_type = 'shared',
            owner_person_id = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE household_id = ?
          AND id = ?
      `)
      .bind(DEMO_HOUSEHOLD_ID, input.entryId)
      .run();

    await syncTransactionSplits(db, {
      transactionId: input.entryId,
      ownershipType: "shared",
      amountMinor: entry.amount_minor,
      splitBasisPoints: 5000
    });
  }

  const id = `split-expense-${Date.now()}`;
  await db
    .prepare(`
      INSERT INTO split_expenses (
        id, household_id, split_group_id, payer_person_id, expense_date,
        description, category_id, total_amount_minor, note, linked_transaction_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      id,
      DEMO_HOUSEHOLD_ID,
      input.splitGroupId || null,
      payerPersonId,
      entry.transaction_date,
      entry.description,
      entry.category_id,
      entry.amount_minor,
      entry.note,
      entry.id
    )
    .run();

  const transactionSplits = await db
    .prepare(`
      SELECT person_id, ratio_basis_points, amount_minor
      FROM transaction_splits
      WHERE transaction_id = ?
      ORDER BY created_at
    `)
    .bind(input.entryId)
    .all<{
      person_id: string;
      ratio_basis_points: number;
      amount_minor: number;
    }>();

  for (const split of transactionSplits.results) {
    await db
      .prepare(`
        INSERT INTO split_expense_shares (
          id, split_expense_id, person_id, ratio_basis_points, amount_minor
        ) VALUES (?, ?, ?, ?, ?)
      `)
      .bind(`${id}-${split.person_id}`, id, split.person_id, split.ratio_basis_points, split.amount_minor)
      .run();
  }

  return { splitExpenseId: id };
}

function getMonthBounds(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const monthStart = `${year}-${String(monthNumber).padStart(2, "0")}-01`;
  const nextMonthDate = new Date(Date.UTC(year, monthNumber, 1));
  const nextMonth = `${nextMonthDate.getUTCFullYear()}-${String(nextMonthDate.getUTCMonth() + 1).padStart(2, "0")}-01`;
  return [monthStart, nextMonth] as const;
}

function getMonthEndDate(month: string) {
  const [, nextMonth] = getMonthBounds(month);
  const date = new Date(`${nextMonth}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function normalizeStatementDate(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed && /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function formatMoneyCsvMinor(valueMinor: number) {
  return (Number(valueMinor) / 100).toFixed(2);
}

function escapeCsvCell(value: string | number | null | undefined) {
  const text = String(value ?? "");
  if (!/[",\n\r]/.test(text)) {
    return text;
  }

  return `"${text.replace(/"/g, "\"\"")}"`;
}

function hasSetIntersection(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) {
    return false;
  }

  for (const value of left) {
    if (right.has(value)) {
      return true;
    }
  }

  return false;
}

function buildPlanDate(month: string, dayLabel?: string) {
  if (!dayLabel || !/^\d+$/.test(dayLabel)) {
    return null;
  }

  return `${month}-${dayLabel.padStart(2, "0")}`;
}

function inferMonthKeyFromPlanRow(id: string) {
  const match = id.match(/plan-(\d{4}-\d{2})-/);
  return match?.[1] ?? "2025-10";
}

function nextMonthKey(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function shiftPlanDate(planDate: string | null, year: number, month: number) {
  if (!planDate) {
    return null;
  }

  const day = new Date(`${planDate}T00:00:00Z`).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function buildSnapshotRowsForScope(rows: MonthPlanRowDto[], personScope: string) {
  if (personScope === "household") {
    return rows;
  }

  return rows
    .filter((row) => row.splits.some((split) => split.personId === personScope))
    .map((row) => {
      if (row.ownershipType === "direct") {
        return row;
      }

      const split = row.splits.find((item) => item.personId === personScope);
      const ratio = (split?.ratioBasisPoints ?? 0) / 10000;
      return {
        ...row,
        plannedMinor: Math.round(row.plannedMinor * ratio),
        sourceRowIds: row.sourceRowIds ?? [row.id]
      };
    });
}

async function syncMonthlyPlanRowSplits(
  db: D1Database,
  input: {
    rowId: string;
    ownershipType: "direct" | "shared";
    plannedMinor: number;
    ownerName?: string;
    splitBasisPoints?: number;
  }
) {
  await db.prepare("DELETE FROM monthly_plan_row_splits WHERE monthly_plan_row_id = ?").bind(input.rowId).run();

  if (input.ownershipType === "direct") {
    const ownerId = await resolvePersonId(db, input.ownerName);
    await db
      .prepare(`
        INSERT INTO monthly_plan_row_splits (
          id, monthly_plan_row_id, person_id, ratio_basis_points, amount_minor
        ) VALUES (?, ?, ?, ?, ?)
      `)
      .bind(
        `${input.rowId}-split-direct`,
        input.rowId,
        ownerId,
        10000,
        input.plannedMinor
      )
      .run();
    return;
  }

  const people = await db
    .prepare("SELECT id FROM people WHERE household_id = ? ORDER BY created_at LIMIT 2")
    .bind(DEMO_HOUSEHOLD_ID)
    .all<{ id: string }>();

  const [firstPerson, secondPerson] = people.results;
  if (!firstPerson || !secondPerson) {
    throw new Error("Shared plan rows require two people");
  }

  const firstBasisPoints = Math.max(0, Math.min(10000, input.splitBasisPoints ?? 5000));
  const secondBasisPoints = 10000 - firstBasisPoints;
  const firstAmount = Math.round((input.plannedMinor * firstBasisPoints) / 10000);
  const secondAmount = input.plannedMinor - firstAmount;

  await db
    .prepare(`
      INSERT INTO monthly_plan_row_splits (
        id, monthly_plan_row_id, person_id, ratio_basis_points, amount_minor
      ) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)
    `)
    .bind(
      `${input.rowId}-split-1`,
      input.rowId,
      firstPerson.id,
      firstBasisPoints,
      firstAmount,
      `${input.rowId}-split-2`,
      input.rowId,
      secondPerson.id,
      secondBasisPoints,
      secondAmount
    )
    .run();
}

async function syncTransactionSplits(
  db: D1Database,
  input: {
    transactionId: string;
    ownershipType: "direct" | "shared";
    amountMinor: number;
    ownerName?: string;
    splitBasisPoints?: number;
  }
) {
  await db.prepare("DELETE FROM transaction_splits WHERE transaction_id = ?").bind(input.transactionId).run();

  if (input.ownershipType === "direct") {
    const ownerId = await resolvePersonId(db, input.ownerName);
    await db
      .prepare(`
        INSERT INTO transaction_splits (
          id, transaction_id, person_id, ratio_basis_points, amount_minor
        ) VALUES (?, ?, ?, ?, ?)
      `)
      .bind(
        `${input.transactionId}-split-direct`,
        input.transactionId,
        ownerId,
        10000,
        input.amountMinor
      )
      .run();
    return;
  }

  const people = await db
    .prepare("SELECT id FROM people WHERE household_id = ? ORDER BY created_at LIMIT 2")
    .bind(DEMO_HOUSEHOLD_ID)
    .all<{ id: string }>();

  const [firstPerson, secondPerson] = people.results;
  if (!firstPerson || !secondPerson) {
    throw new Error("Shared entries require two people");
  }

  const firstBasisPoints = Math.max(0, Math.min(10000, input.splitBasisPoints ?? 5000));
  const secondBasisPoints = 10000 - firstBasisPoints;
  const firstAmount = Math.round((input.amountMinor * firstBasisPoints) / 10000);
  const secondAmount = input.amountMinor - firstAmount;

  await db
    .prepare(`
      INSERT INTO transaction_splits (
        id, transaction_id, person_id, ratio_basis_points, amount_minor
      ) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)
    `)
    .bind(
      `${input.transactionId}-split-1`,
      input.transactionId,
      firstPerson.id,
      firstBasisPoints,
      firstAmount,
      `${input.transactionId}-split-2`,
      input.transactionId,
      secondPerson.id,
      secondBasisPoints,
      secondAmount
    )
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
      .bind(DEMO_HOUSEHOLD_ID, year, monthNumber)
      .all<{ person_scope: string; note: string | null }>()
  ]);

  const notesByScope = new Map(existingSnapshots.results.map((row) => [row.person_scope, row.note ?? ""]));
  const scopes = [
    { key: "household", incomeRows: await loadMonthIncomeRows(db, "household", month) },
    { key: "person-tim", incomeRows: await loadMonthIncomeRows(db, "person-tim", month) },
    { key: "person-joyce", incomeRows: await loadMonthIncomeRows(db, "person-joyce", month) }
  ];

  for (const scope of scopes) {
    const visibleRows = buildSnapshotRowsForScope(planRows, scope.key);
    const plannedExpenseMinor = visibleRows.reduce((sum, row) => sum + row.plannedMinor, 0);
    const actualExpenseMinor = sumVisibleExpenseMinor(entries, scope.key);
    const savingsGoalMinor = visibleRows
      .filter((row) => row.label === "Savings")
      .reduce((sum, row) => sum + row.plannedMinor, 0);
    const incomeMinor = scope.incomeRows.reduce((sum, row) => sum + row.plannedMinor, 0);
    const sharedMinor = visibleRows
      .filter((row) => row.ownershipType === "shared")
      .reduce((sum, row) => sum + row.plannedMinor, 0);

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
        DEMO_HOUSEHOLD_ID,
        year,
        monthNumber,
        scope.key,
        incomeMinor,
        plannedExpenseMinor,
        actualExpenseMinor,
        savingsGoalMinor,
        incomeMinor - actualExpenseMinor,
        sharedMinor,
        notesByScope.get(scope.key) ?? null
      )
      .run();
  }
}

function sumVisibleExpenseMinor(entries: EntryDto[], personScope: string) {
  return entries.reduce((sum, entry) => {
    if (entry.entryType !== "expense") {
      return sum;
    }

    if (personScope === "household") {
      return sum + entry.amountMinor;
    }

    if (entry.ownershipType === "direct") {
      return entry.splits.some((split) => split.personId === personScope)
        ? sum + entry.amountMinor
        : sum;
    }

    const split = entry.splits.find((item) => item.personId === personScope);
    return split ? sum + split.amountMinor : sum;
  }, 0);
}

function weekdayLabel(date: string) {
  return new Intl.DateTimeFormat("en-SG", {
    weekday: "short",
    timeZone: "UTC"
  }).format(new Date(`${date}T00:00:00Z`));
}

function mapAccountKind(kind: string) {
  switch (kind) {
    case "credit_card":
      return "credit_card";
    case "bank":
      return "bank";
    default:
      return "bank";
  }
}

function findAccountId(accountName?: string) {
  if (!accountName) {
    return null;
  }

  return demoAccounts.find((account) => account.name === accountName)?.id ?? null;
}

async function resolveAccountId(db: D1Database, accountName?: string) {
  if (!accountName) {
    return null;
  }

  const account = await db
    .prepare("SELECT id FROM accounts WHERE household_id = ? AND account_name = ?")
    .bind(DEMO_HOUSEHOLD_ID, accountName)
    .first<{ id: string }>();

  if (!account) {
    throw new Error(`Unknown account: ${accountName}`);
  }

  return account.id;
}

function findCategoryId(categoryName?: string) {
  if (!categoryName) {
    return null;
  }

  return demoCategories.find((category) => category.name === categoryName)?.id ?? null;
}

async function resolveCategoryId(db: D1Database, categoryName?: string) {
  if (!categoryName) {
    return null;
  }

  const category = await db
    .prepare("SELECT id FROM categories WHERE household_id = ? AND name = ?")
    .bind(DEMO_HOUSEHOLD_ID, categoryName)
    .first<{ id: string }>();

  if (!category) {
    throw new Error(`Unknown category: ${categoryName}`);
  }

  return category.id;
}

async function resolvePersonId(db: D1Database, personName?: string) {
  if (!personName) {
    throw new Error("Missing owner name");
  }

  const person = await db
    .prepare("SELECT id FROM people WHERE household_id = ? AND display_name = ?")
    .bind(DEMO_HOUSEHOLD_ID, personName)
    .first<{ id: string }>();

  if (!person) {
    throw new Error(`Unknown owner: ${personName}`);
  }

  return person.id;
}

function normalizeImportRow(rawRow: Record<string, string>) {
  const entries = Object.entries(rawRow).reduce<Record<string, string>>((accumulator, [key, value]) => {
    accumulator[key.trim().toLowerCase()] = value.trim();
    return accumulator;
  }, {});

  const rawDate = firstDefined(entries, ["date", "transaction date", "posting date", "posted date"]);
  const description = firstDefined(entries, ["description", "details", "narrative", "merchant", "memo"]);
  const accountName = firstDefined(entries, ["account", "wallet", "account name", "source account"]);
  const categoryName = firstDefined(entries, ["category"]);
  const note = firstDefined(entries, ["note", "notes", "remarks"]);

  const signedAmount = parseMoneyToMinor(firstDefined(entries, ["amount", "transaction amount", "amt", "value"]));
  const debitAmount = parseMoneyToMinor(firstDefined(entries, ["expense", "debit", "withdrawal", "outflow"]));
  const creditAmount = parseMoneyToMinor(firstDefined(entries, ["income", "credit", "deposit", "inflow"]));
  const transferFlag = firstDefined(entries, ["type", "transaction type"])?.toLowerCase() === "transfer";

  let amountMinor = 0;
  let entryType: "expense" | "income" | "transfer" = "expense";
  let transferDirection: "in" | "out" | undefined;

  if (typeof signedAmount === "number") {
    amountMinor = Math.abs(signedAmount);
    entryType = signedAmount < 0 ? "expense" : "income";
  } else if (typeof debitAmount === "number" && debitAmount > 0) {
    amountMinor = debitAmount;
    entryType = "expense";
  } else if (typeof creditAmount === "number" && creditAmount > 0) {
    amountMinor = creditAmount;
    entryType = "income";
  }

  if (transferFlag) {
    entryType = "transfer";
    if (typeof creditAmount === "number" && creditAmount > 0) {
      transferDirection = "in";
    } else if (typeof debitAmount === "number" && debitAmount > 0) {
      transferDirection = "out";
    } else {
      transferDirection = typeof signedAmount === "number" && signedAmount >= 0 ? "in" : "out";
    }
  }

  const errors: string[] = [];
  const date = rawDate ? normalizeDateString(rawDate) : undefined;
  if (!date) {
    errors.push("missing date");
  }
  if (!description) {
    errors.push("missing description");
  }
  if (typeof amountMinor !== "number" || amountMinor <= 0) {
    errors.push("missing amount");
  }

  return {
    date,
    description,
    accountName,
    categoryName,
    note,
    amountMinor,
    entryType,
    transferDirection,
    errors
  };
}

function firstDefined(record: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (value) {
      return value;
    }
  }
  return undefined;
}

function parseMoneyToMinor(value?: string) {
  if (!value) {
    return undefined;
  }

  const normalized = value.replace(/,/g, "").replace(/[^\d.-]/g, "");
  if (!normalized || normalized === "-" || normalized === "." || normalized === "-.") {
    return undefined;
  }

  const parsed = Number.parseFloat(normalized);
  if (Number.isNaN(parsed)) {
    return undefined;
  }

  return Math.round(parsed * 100);
}

function normalizeDateString(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const slashMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, day, month, year] = slashMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed.toISOString().slice(0, 10);
}

function buildImportRowHash(row: ImportPreviewRowDto) {
  return `${row.date}|${row.description}|${row.amountMinor}|${row.accountName ?? ""}|${row.entryType}`;
}

function formatMoneyMinor(valueMinor: number) {
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: "SGD"
  }).format(valueMinor / 100);
}

function daysBetween(left: string, right: string) {
  const leftDate = new Date(`${left}T00:00:00Z`);
  const rightDate = new Date(`${right}T00:00:00Z`);
  return Math.round((rightDate.getTime() - leftDate.getTime()) / 86400000);
}

function diffDays(left: string, right: string) {
  return Math.abs(daysBetween(left, right));
}

function countSharedTokens(left: string, right: string) {
  const leftTokens = new Set(normalizeDescriptionForMatch(left).split(" ").filter(Boolean));
  const rightTokens = new Set(normalizeDescriptionForMatch(right).split(" ").filter(Boolean));
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }
  return overlap;
}

function compareDescriptionSimilarity(left: string, right: string) {
  const leftTokens = new Set(normalizeDescriptionForMatch(left).split(" ").filter(Boolean));
  const rightTokens = new Set(normalizeDescriptionForMatch(right).split(" ").filter(Boolean));
  if (!leftTokens.size || !rightTokens.size) {
    return 0;
  }

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function normalizeDescriptionForMatch(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizePlanMatchHint(value: string) {
  return normalizeDescriptionForMatch(value);
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function groupSplits<T extends { person_id: string; ratio_basis_points: number; amount_minor: number; display_name: string }>(
  rows: (T & Record<string, string>)[],
  keyName: string
) {
  const map = new Map<string, EntrySplitDto[]>();

  for (const row of rows) {
    const key = row[keyName] as string;
    const current = map.get(key) ?? [];
    current.push({
      personId: row.person_id,
      personName: row.display_name,
      ratioBasisPoints: row.ratio_basis_points,
      amountMinor: row.amount_minor
    });
    map.set(key, current);
  }

  return map;
}
