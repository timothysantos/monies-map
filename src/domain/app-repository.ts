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
  SummaryMonthDto
} from "../types/dto";

const DEMO_HOUSEHOLD_ID = demoHousehold.id;

const PERSON_IDS: Record<string, string> = {
  Tim: "person-tim",
  Joyce: "person-joyce"
};

const SHARED_ACCOUNT_INSTITUTION = "DBS";

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
}

export async function reseedDemoData(db: D1Database, settings: DemoSettings) {
  await ensureDemoSchema(db);
  await clearDemoData(db);
  await seedDemoData(db, settings);
}

export async function clearDemoData(db: D1Database) {
  await db.prepare("PRAGMA defer_foreign_keys = ON").run();
  const deletions = [
    "DELETE FROM transaction_splits",
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

  for (const month of demoMonths) {
    await recalculateMonthlySnapshots(db, month);
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
        transaction.amount_minor
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
    const firstAmount = Math.round((transaction.amount_minor * firstBasisPoints) / 10000);
    const secondAmount = transaction.amount_minor - firstAmount;

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

export async function deleteMonthPlanRow(
  db: D1Database,
  input: {
    rowId: string;
    month: string;
  }
) {
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
      statement_balance_minor: number;
      note: string | null;
    }>();

  const checkpointHistoryRows = await db
    .prepare(`
      SELECT
        account_id,
        checkpoint_month,
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
    let net = 0;
    for (const row of transactionRows.results) {
      if (row.account_id !== checkpoint.account_id || row.transaction_date.slice(0, 7) > checkpoint.checkpoint_month) {
        continue;
      }

      net += row.entry_type === "income" || (row.entry_type === "transfer" && row.transfer_direction === "in")
        ? Number(row.amount_minor)
        : -Number(row.amount_minor);
    }
    checkpointLedgerNetByAccountId.set(checkpoint.account_id, net);
  }

  for (const checkpoint of checkpointHistoryRows.results) {
    let net = 0;
    for (const row of transactionRows.results) {
      if (row.account_id !== checkpoint.account_id || row.transaction_date.slice(0, 7) > checkpoint.checkpoint_month) {
        continue;
      }

      net += row.entry_type === "income" || (row.entry_type === "transfer" && row.transfer_direction === "in")
        ? Number(row.amount_minor)
        : -Number(row.amount_minor);
    }

    const computedBalanceMinor = net;
    const statementBalanceMinor = Number(checkpoint.statement_balance_minor ?? 0);
    const currentHistory = checkpointHistoryByAccountId.get(checkpoint.account_id) ?? [];
    currentHistory.push({
      month: checkpoint.checkpoint_month,
      statementBalanceMinor,
      computedBalanceMinor: Number(
        result.results.find((account) => account.id === checkpoint.account_id)?.opening_balance_minor ?? 0
      ) + computedBalanceMinor,
      deltaMinor: Number(
        result.results.find((account) => account.id === checkpoint.account_id)?.opening_balance_minor ?? 0
      ) + computedBalanceMinor - statementBalanceMinor,
      note: checkpoint.note ?? undefined
    });
    checkpointHistoryByAccountId.set(checkpoint.account_id, currentHistory);
  }

  return result.results.map((row) => ({
    ...buildAccountHealth({
      accountId: row.id,
      openingBalanceMinor: Number(row.opening_balance_minor ?? 0),
      latestTransactionDate: latestTransactionDateByAccountId.get(row.id),
      latestImportAt: latestImportAtByAccountId.get(row.id),
      unresolvedTransferCount: unresolvedTransferCountByAccountId.get(row.id) ?? 0,
      currentLedgerBalanceMinor: Number(row.opening_balance_minor ?? 0) + (balanceByAccountId.get(row.id) ?? 0),
      checkpoint: checkpointByAccountId.get(row.id),
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
    statement_balance_minor: number;
    note: string | null;
  };
  checkpointLedgerNetMinor?: number;
  checkpointHistory?: AccountDto["checkpointHistory"];
}) {
  const checkpointComputedBalanceMinor = input.checkpoint
    ? input.openingBalanceMinor + (input.checkpointLedgerNetMinor ?? 0)
    : undefined;
  const checkpointDeltaMinor = input.checkpoint && checkpointComputedBalanceMinor != null
    ? checkpointComputedBalanceMinor - Number(input.checkpoint.statement_balance_minor ?? 0)
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
    latestCheckpointBalanceMinor: input.checkpoint ? Number(input.checkpoint.statement_balance_minor ?? 0) : undefined,
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
    statementBalanceMinor: number;
    note?: string;
  }
) {
  const account = await db
    .prepare(`
      SELECT id
      FROM accounts
      WHERE household_id = ? AND id = ?
    `)
    .bind(DEMO_HOUSEHOLD_ID, input.accountId)
    .first<{ id: string }>();

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
  await db
    .prepare(`
      INSERT INTO account_balance_checkpoints (
        id, household_id, account_id, checkpoint_month, statement_balance_minor, note
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, checkpoint_month) DO UPDATE SET
        statement_balance_minor = excluded.statement_balance_minor,
        note = excluded.note,
        updated_at = CURRENT_TIMESTAMP
    `)
    .bind(
      checkpointId,
      DEMO_HOUSEHOLD_ID,
      input.accountId,
      input.checkpointMonth,
      Math.round(input.statementBalanceMinor),
      input.note?.trim() || null
    )
    .run();

  await recordAuditEvent(db, {
    entityType: "account",
    entityId: input.accountId,
    action: "checkpoint_saved",
    detail: existingCheckpoint
      ? `Updated ${input.checkpointMonth} statement checkpoint ${formatMoneyMinor(existingCheckpoint.statement_balance_minor)} -> ${formatMoneyMinor(input.statementBalanceMinor)}.`
      : `Saved ${input.checkpointMonth} statement checkpoint at ${formatMoneyMinor(input.statementBalanceMinor)}.`
  });

  return { accountId: input.accountId, checkpointMonth: input.checkpointMonth, saved: true };
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
      LEFT JOIN (
        SELECT transfer_group_id, COUNT(*) AS pair_count
        FROM transactions
        WHERE household_id = ? AND transfer_group_id IS NOT NULL
        GROUP BY transfer_group_id
      ) AS grouped ON grouped.transfer_group_id = transactions.transfer_group_id
      WHERE transactions.household_id = ?
        AND transactions.entry_type = 'transfer'
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
        COUNT(DISTINCT import_rows.id) AS transaction_count,
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
      SELECT DISTINCT imports.id AS import_id, accounts.account_name
      FROM imports
      LEFT JOIN transactions ON transactions.import_id = imports.id
      LEFT JOIN accounts ON accounts.id = transactions.account_id
      WHERE imports.household_id = ?
    `)
    .bind(DEMO_HOUSEHOLD_ID)
    .all<{ import_id: string; account_name: string | null }>();

  const accountNamesByImportId = new Map<string, Set<string>>();
  for (const row of accountRows.results) {
    if (!row.account_name) {
      continue;
    }
    const current = accountNamesByImportId.get(row.import_id) ?? new Set<string>();
    current.add(row.account_name);
    accountNamesByImportId.set(row.import_id, current);
  }

  return result.results.map((row) => {
    const overlapImportCount = result.results.filter((candidate) => (
      candidate.id !== row.id
      && row.start_date
      && row.end_date
      && candidate.start_date
      && candidate.end_date
      && candidate.status !== "rolled_back"
      && row.status !== "rolled_back"
      && row.start_date <= candidate.end_date
      && row.end_date >= candidate.start_date
    )).length;

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
      overlapImportCount,
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
      ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'completed', ?)
    `)
    .bind(importId, DEMO_HOUSEHOLD_ID, "csv", input.sourceLabel, "generic_csv", input.note ?? null)
    .run();

  for (const row of input.rows) {
    const rowId = `import-row-${crypto.randomUUID()}`;
    const transactionId = `txn-${crypto.randomUUID()}`;
    const accountId = row.accountName ? await resolveAccountId(db, row.accountName) : null;

    if (!accountId) {
      throw new Error(`Unknown account: ${row.accountName ?? "Unassigned"}`);
    }

    const categoryName = row.entryType === "transfer" ? "Transfer" : row.categoryName;
    const categoryId = await resolveCategoryId(db, categoryName);
    const directOwnerId = row.ownershipType === "direct"
      ? await resolvePersonId(db, row.ownerName)
      : null;

    await db
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
        buildImportRowHash(row),
      )
      .run();

    await db
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
        directOwnerId,
        row.note ?? null
      )
      .run();

    await syncTransactionSplits(db, {
      transactionId,
      ownershipType: row.ownershipType,
      amountMinor: row.amountMinor,
      ownerName: row.ownerName,
      splitBasisPoints: row.splitBasisPoints
    });

    monthsToRecalculate.add(row.date.slice(0, 7));
  }

  for (const month of monthsToRecalculate) {
    await recalculateMonthlySnapshots(db, month);
  }

  await recordAuditEvent(db, {
    entityType: "import",
    entityId: importId,
    action: "import_committed",
    detail: `Committed import ${input.sourceLabel} with ${input.rows.length} row${input.rows.length === 1 ? "" : "s"}.`
  });

  return { importId, created: true };
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

  await db
    .prepare(`
      DELETE FROM transaction_splits
      WHERE transaction_id IN (
        SELECT id FROM transactions WHERE household_id = ? AND import_id = ?
      )
    `)
    .bind(DEMO_HOUSEHOLD_ID, input.importId)
    .run();

  await db
    .prepare("DELETE FROM transactions WHERE household_id = ? AND import_id = ?")
    .bind(DEMO_HOUSEHOLD_ID, input.importId)
    .run();

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

  return rows.results
    .filter((row) => row.section_key !== "income")
    .map((row) => ({
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
      isDerived: false,
      sourceRowIds: [row.id],
      splits: splitMap.get(row.id) ?? []
    }));
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
      WHERE transactions.household_id = ?
        AND transactions.transaction_date >= ?
        AND transactions.transaction_date < ?
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

function getMonthBounds(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const monthStart = `${year}-${String(monthNumber).padStart(2, "0")}-01`;
  const nextMonthDate = new Date(Date.UTC(year, monthNumber, 1));
  const nextMonth = `${nextMonthDate.getUTCFullYear()}-${String(nextMonthDate.getUTCMonth() + 1).padStart(2, "0")}-01`;
  return [monthStart, nextMonth] as const;
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
  const debitAmount = parseMoneyToMinor(firstDefined(entries, ["debit", "withdrawal", "outflow"]));
  const creditAmount = parseMoneyToMinor(firstDefined(entries, ["credit", "deposit", "inflow"]));
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
    transferDirection = typeof signedAmount === "number" && signedAmount >= 0 ? "in" : "out";
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
