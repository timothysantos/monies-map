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
        label: string;
        planned_amount_minor: number;
        actual_amount_minor: number;
        notes: string | null;
        category_name: string | null;
        owner_name: string | null;
      }>()
    : await statement.bind(DEMO_HOUSEHOLD_ID, year, monthNumber, selectedPersonId).all<{
        id: string;
        label: string;
        planned_amount_minor: number;
        actual_amount_minor: number;
        notes: string | null;
        category_name: string | null;
        owner_name: string | null;
      }>();

  return result.results.map((row) => ({
    id: row.id,
    categoryName: row.category_name ?? "Income",
    label: selectedPersonId === "household" && row.owner_name ? `${row.owner_name} ${row.label.toLowerCase()}` : row.label,
    plannedMinor: row.planned_amount_minor,
    actualMinor: row.actual_amount_minor,
    note: row.notes ?? undefined
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
        accounts.account_name,
        accounts.account_kind,
        accounts.currency,
        accounts.is_joint,
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
      account_name: string;
      account_kind: string;
      currency: string;
      is_joint: number;
      institution_name: string;
      owner_name: string | null;
    }>();

  return result.results.map((row) => ({
    id: row.id,
    name: row.account_name,
    institution: row.institution_name,
    kind: row.account_kind,
    ownerLabel: row.owner_name ?? "Shared",
    currency: row.currency,
    isJoint: Boolean(row.is_joint)
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
      SELECT id, source_label, source_type, imported_at, status, note
      FROM imports
      WHERE household_id = ?
      ORDER BY imported_at DESC
    `)
    .bind(DEMO_HOUSEHOLD_ID)
    .all<{
      id: string;
      source_label: string;
      source_type: "csv" | "pdf" | "manual";
      imported_at: string;
      status: "draft" | "completed" | "rolled_back";
      note: string | null;
    }>();

  return result.results.map((row) => ({
    id: row.id,
    sourceLabel: row.source_label,
    sourceType: row.source_type,
    importedAt: row.imported_at,
    status: row.status,
    transactionCount: 0,
    note: row.note ?? undefined
  }));
}

export async function loadMonthPlanRows(db: D1Database, month = "2025-10"): Promise<MonthPlanRowDto[]> {
  const [year, monthNumber] = month.split("-").map(Number);
  const rows = await db
    .prepare(`
      SELECT
        monthly_plan_rows.id,
        monthly_plan_rows.section_key,
        monthly_plan_rows.label,
        monthly_plan_rows.plan_date,
        monthly_plan_rows.planned_amount_minor,
        monthly_plan_rows.actual_amount_minor,
        monthly_plan_rows.notes,
        monthly_plan_rows.ownership_type,
        people.display_name AS owner_name,
        categories.name AS category_name,
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
      section_key: "planned_items" | "budget_buckets" | "income";
      label: string;
      plan_date: string | null;
      planned_amount_minor: number;
      actual_amount_minor: number;
      notes: string | null;
      ownership_type: "direct" | "shared";
      owner_name: string | null;
      category_name: string | null;
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
      categoryName: row.category_name ?? "Other",
      label: row.label,
      dayLabel: row.plan_date ? String(new Date(row.plan_date).getUTCDate()) : undefined,
      dayOfWeek: row.plan_date ? weekdayLabel(row.plan_date) : undefined,
      plannedMinor: row.planned_amount_minor,
      actualMinor: row.actual_amount_minor,
      accountName: row.account_name ?? undefined,
      note: row.notes ?? undefined,
      ownershipType: row.ownership_type,
      ownerName: row.owner_name ?? undefined,
      splits: splitMap.get(row.id) ?? []
    }));
}

export async function loadEntries(db: D1Database, month = "2025-10"): Promise<EntryDto[]> {
  const [year, monthNumber] = month.split("-").map(Number);
  const monthStart = `${year}-${String(monthNumber).padStart(2, "0")}-01`;
  const nextMonthDate = new Date(Date.UTC(year, monthNumber, 1));
  const nextMonth = `${nextMonthDate.getUTCFullYear()}-${String(nextMonthDate.getUTCMonth() + 1).padStart(2, "0")}-01`;
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
        plannedMinor: Math.round(row.plannedMinor * ratio)
      };
    });
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

function findCategoryId(categoryName?: string) {
  if (!categoryName) {
    return null;
  }

  return demoCategories.find((category) => category.name === categoryName)?.id ?? null;
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
