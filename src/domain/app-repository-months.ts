import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import {
  groupSplits,
  normalizePlanMatchHint,
  weekdayLabel
} from "./app-repository-helpers";
import { getCurrentMonthKey } from "../lib/month";
import type { PlanRowInput } from "./plan-draft";
import type {
  MonthIncomeRowDto,
  MonthPlanRowDto,
  SummaryMonthDto
} from "../types/dto";

export async function loadSummaryMonths(db: D1Database, personScope: string): Promise<SummaryMonthDto[]> {
  const result = await db
    .prepare(`
      SELECT year, month, total_income_minor, total_expense_minor, note
      , estimated_expense_minor, savings_goal_minor
      FROM monthly_snapshots
      WHERE household_id = ? AND person_scope = ?
      ORDER BY year DESC, month DESC
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, personScope)
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
      plannedIncomeMinor: row.total_income_minor,
      actualIncomeMinor: row.total_income_minor,
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

export async function loadSummaryMonthsForScopes(
  db: D1Database,
  personScopes: string[]
): Promise<Record<string, SummaryMonthDto[]>> {
  const uniqueScopes = [...new Set(personScopes)].filter(Boolean);
  if (!uniqueScopes.length) {
    return {};
  }

  const placeholders = uniqueScopes.map(() => "?").join(", ");
  const result = await db
    .prepare(`
      SELECT person_scope, year, month, total_income_minor, total_expense_minor, note
      , estimated_expense_minor, savings_goal_minor
      FROM monthly_snapshots
      WHERE household_id = ? AND person_scope IN (${placeholders})
      ORDER BY person_scope, year DESC, month DESC
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, ...uniqueScopes)
    .all<{
      person_scope: string;
      year: number;
      month: number;
      total_income_minor: number;
      estimated_expense_minor: number;
      total_expense_minor: number;
      savings_goal_minor: number;
      note: string | null;
    }>();

  const monthsByScope = Object.fromEntries(uniqueScopes.map((scope) => [scope, [] as SummaryMonthDto[]]));
  for (const row of result.results) {
    monthsByScope[row.person_scope] ??= [];
    monthsByScope[row.person_scope].push({
      month: `${row.year}-${String(row.month).padStart(2, "0")}`,
      plannedIncomeMinor: row.total_income_minor,
      actualIncomeMinor: row.total_income_minor,
      estimatedExpensesMinor: row.estimated_expense_minor,
      realExpensesMinor: row.total_expense_minor,
      savingsGoalMinor: row.savings_goal_minor,
      realizedSavingsMinor: row.total_income_minor - row.total_expense_minor,
      estimatedDiffMinor: row.total_income_minor - row.estimated_expense_minor,
      realDiffMinor: row.total_income_minor - row.total_expense_minor,
      note: row.note ?? "Month tracked close to plan overall."
    });
  }

  for (const scope of uniqueScopes) {
    monthsByScope[scope].sort((left, right) => left.month.localeCompare(right.month));
  }

  return monthsByScope;
}

// Every month plan row of one month, income included, with who shares it:
// what a plan draft (plan-draft.ts) resolves names against and copies from.
export async function loadMonthPlanRowsForDraft(db: D1Database, month: string): Promise<PlanRowInput[]> {
  const [year, monthNumber] = month.split("-").map(Number);
  const [rows, splits] = await Promise.all([
    db
      .prepare(`
        SELECT
          monthly_plan_rows.id,
          monthly_plan_rows.section_key,
          monthly_plan_rows.label,
          monthly_plan_rows.plan_date,
          monthly_plan_rows.planned_amount_minor,
          monthly_plan_rows.notes,
          monthly_plan_rows.ownership_type,
          monthly_plan_rows.person_id,
          people.display_name AS owner_name,
          categories.name AS category_name,
          accounts.account_name AS account_name
        FROM monthly_plan_rows
        LEFT JOIN people ON people.id = monthly_plan_rows.person_id
        LEFT JOIN categories ON categories.id = monthly_plan_rows.category_id
        LEFT JOIN accounts ON accounts.id = monthly_plan_rows.account_id
        WHERE monthly_plan_rows.household_id = ? AND monthly_plan_rows.year = ? AND monthly_plan_rows.month = ?
        ORDER BY monthly_plan_rows.created_at, monthly_plan_rows.id
      `)
      .bind(DEFAULT_HOUSEHOLD_ID, year, monthNumber)
      .all<{
        id: string;
        section_key: "income" | "planned_items" | "budget_buckets";
        label: string;
        plan_date: string | null;
        planned_amount_minor: number;
        notes: string | null;
        ownership_type: "direct" | "shared";
        person_id: string | null;
        owner_name: string | null;
        category_name: string | null;
        account_name: string | null;
      }>(),
    db
      .prepare(`
        SELECT monthly_plan_row_splits.monthly_plan_row_id, monthly_plan_row_splits.person_id, monthly_plan_row_splits.ratio_basis_points
        FROM monthly_plan_row_splits
        INNER JOIN monthly_plan_rows ON monthly_plan_rows.id = monthly_plan_row_splits.monthly_plan_row_id
        WHERE monthly_plan_rows.household_id = ? AND monthly_plan_rows.year = ? AND monthly_plan_rows.month = ?
        ORDER BY monthly_plan_row_splits.created_at, monthly_plan_row_splits.id
      `)
      .bind(DEFAULT_HOUSEHOLD_ID, year, monthNumber)
      .all<{ monthly_plan_row_id: string; person_id: string; ratio_basis_points: number }>()
  ]);
  const splitsByRow = new Map<string, Array<{ personId: string; ratioBasisPoints: number }>>();
  for (const split of splits.results) {
    const list = splitsByRow.get(split.monthly_plan_row_id) ?? [];
    list.push({ personId: split.person_id, ratioBasisPoints: split.ratio_basis_points });
    splitsByRow.set(split.monthly_plan_row_id, list);
  }
  return rows.results.map((row) => ({
    id: row.id,
    section: row.section_key,
    categoryName: row.category_name ?? "Other",
    label: row.label,
    plannedMinor: row.planned_amount_minor,
    ownershipType: row.ownership_type,
    personId: row.person_id,
    ownerName: row.owner_name,
    splits: splitsByRow.get(row.id) ?? [],
    planDate: row.plan_date,
    accountName: row.account_name,
    note: row.notes
  }));
}

export async function loadTrackedMonths(db: D1Database): Promise<string[]> {
  // The ledger's months are found by skipping from month to month along
  // idx_transactions_household_date (one index seek per month) instead of
  // reading every transaction: every page reads this, and the whole-table
  // DISTINCT read ~24,000 rows (13 ms of D1 time) on production's ledger.
  // A month counts when it has a manual entry or one from a completed import;
  // `month_key || char(1114111)` sorts after every date in that month.
  const result = await db
    .prepare(`
      WITH RECURSIVE entry_months(month_key) AS (
        SELECT (
          SELECT substr(transactions.transaction_date, 1, 7)
          FROM transactions
          LEFT JOIN imports ON imports.id = transactions.import_id
          WHERE transactions.household_id = ?
            AND transactions.transaction_date > ''
            AND (transactions.import_id IS NULL OR imports.status = 'completed')
          ORDER BY transactions.transaction_date
          LIMIT 1
        )
        UNION ALL
        SELECT (
          SELECT substr(transactions.transaction_date, 1, 7)
          FROM transactions
          LEFT JOIN imports ON imports.id = transactions.import_id
          WHERE transactions.household_id = ?
            AND transactions.transaction_date >= entry_months.month_key || char(1114111)
            AND (transactions.import_id IS NULL OR imports.status = 'completed')
          ORDER BY transactions.transaction_date
          LIMIT 1
        )
        FROM entry_months
        WHERE entry_months.month_key IS NOT NULL
      )
      SELECT DISTINCT month_key
      FROM (
        SELECT month_key FROM entry_months

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
    .bind(DEFAULT_HOUSEHOLD_ID, DEFAULT_HOUSEHOLD_ID, DEFAULT_HOUSEHOLD_ID, DEFAULT_HOUSEHOLD_ID)
    .all<{ month_key: string }>();

  return result.results.map((row) => row.month_key);
}

export async function loadMonthIncomeRows(
  db: D1Database,
  selectedPersonId: string,
  month = getCurrentMonthKey()
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
    ? await statement.bind(DEFAULT_HOUSEHOLD_ID, year, monthNumber).all<{
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
    : await statement.bind(DEFAULT_HOUSEHOLD_ID, year, monthNumber, selectedPersonId).all<{
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

export async function loadMonthIncomeRowsForViews(
  db: D1Database,
  selectedPersonIds: string[],
  month = getCurrentMonthKey()
): Promise<Record<string, MonthIncomeRowDto[]>> {
  const [year, monthNumber] = month.split("-").map(Number);
  const uniqueViewIds = [...new Set(selectedPersonIds)].filter(Boolean);
  const result = await db
    .prepare(`
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
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, year, monthNumber)
    .all<{
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

  const rowsByView = Object.fromEntries(uniqueViewIds.map((viewId) => [viewId, [] as MonthIncomeRowDto[]]));
  for (const row of result.results) {
    const dtoBase = {
      id: row.id,
      categoryId: row.category_id ?? undefined,
      categoryName: row.category_name ?? "Income",
      plannedMinor: row.planned_amount_minor,
      actualMinor: row.actual_amount_minor,
      personId: row.person_id ?? undefined,
      ownerName: row.owner_name ?? undefined,
      note: row.notes ?? undefined,
      isDerived: false,
      sourceRowIds: [row.id]
    };

    if (rowsByView.household) {
      rowsByView.household.push({
        ...dtoBase,
        label: row.owner_name ? `${row.owner_name} ${row.label.toLowerCase()}` : row.label
      });
    }

    if (row.person_id && rowsByView[row.person_id]) {
      rowsByView[row.person_id].push({
        ...dtoBase,
        label: row.label
      });
    }
  }

  return rowsByView;
}

export async function loadMonthPlanRows(db: D1Database, month = getCurrentMonthKey()): Promise<MonthPlanRowDto[]> {
  return (await loadMonthPlanRowsForMonths(db, [month])).get(month) ?? [];
}

// The year and month bounds of a set of month keys, for one range read.
function monthRangeBounds(months: string[]) {
  const sorted = [...new Set(months)].filter(Boolean).sort();
  const [firstYear, firstMonth] = sorted[0].split("-").map(Number);
  const [lastYear, lastMonth] = sorted[sorted.length - 1].split("-").map(Number);
  return { sorted, firstYear, lastYear, firstKey: firstYear * 100 + firstMonth, lastKey: lastYear * 100 + lastMonth };
}

const monthKeyOf = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

// The plan rows (not income) of several months, by month: four reads sent
// together whatever the number of months. Summary reads its whole range and
// Month its month and the months before it; a read per month cost four
// sequential D1 round trips for each month. Each month's rows keep the order
// the one-month read gave them (created_at).
export async function loadMonthPlanRowsForMonths(db: D1Database, months: string[]): Promise<Map<string, MonthPlanRowDto[]>> {
  const byMonth = new Map<string, MonthPlanRowDto[]>();
  if (!months.filter(Boolean).length) {
    return byMonth;
  }
  const { sorted, firstYear, lastYear, firstKey, lastKey } = monthRangeBounds(months);
  const inRange = `monthly_plan_rows.household_id = ?
        AND monthly_plan_rows.year BETWEEN ? AND ?
        AND monthly_plan_rows.year * 100 + monthly_plan_rows.month BETWEEN ? AND ?`;
  const rangeValues = [DEFAULT_HOUSEHOLD_ID, firstYear, lastYear, firstKey, lastKey];
  const [rows, splits, linkedEntries, matchHints] = await Promise.all([
    db
      .prepare(`
        SELECT
          monthly_plan_rows.id,
          monthly_plan_rows.year,
          monthly_plan_rows.month,
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
        WHERE ${inRange}
        ORDER BY monthly_plan_rows.created_at
      `)
      .bind(...rangeValues)
      .all<{
        id: string;
        year: number;
        month: number;
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
      }>(),
    db
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
        WHERE ${inRange}
        ORDER BY monthly_plan_row_splits.created_at
      `)
      .bind(...rangeValues)
      .all<{
        monthly_plan_row_id: string;
        person_id: string;
        ratio_basis_points: number;
        amount_minor: number;
        display_name: string;
      }>(),
    db
      .prepare(`
        SELECT
          monthly_plan_entry_links.monthly_plan_row_id,
          monthly_plan_entry_links.transaction_id
        FROM monthly_plan_entry_links
        INNER JOIN monthly_plan_rows ON monthly_plan_rows.id = monthly_plan_entry_links.monthly_plan_row_id
        WHERE ${inRange}
        ORDER BY monthly_plan_entry_links.created_at
      `)
      .bind(...rangeValues)
      .all<{
        monthly_plan_row_id: string;
        transaction_id: string;
      }>(),
    db
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
      .bind(DEFAULT_HOUSEHOLD_ID)
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
      }>()
  ]);

  const splitMap = groupSplits(splits.results, "monthly_plan_row_id");
  const linkedEntryMap = linkedEntries.results.reduce((map, row) => {
    const current = map.get(row.monthly_plan_row_id) ?? [];
    current.push(row.transaction_id);
    map.set(row.monthly_plan_row_id, current);
    return map;
  }, new Map<string, string[]>());

  for (const month of sorted) {
    byMonth.set(month, []);
  }
  for (const row of rows.results) {
    const list = byMonth.get(monthKeyOf(row.year, row.month));
    if (!list || row.section_key === "income") {
      continue;
    }
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
    list.push({
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
    });
  }
  return byMonth;
}

// One view's income rows for several months, by month, in one read
// (loadMonthIncomeRows cost a round trip per month). The labels follow the
// same rule: the household view names the person.
export async function loadMonthIncomeRowsForMonths(
  db: D1Database,
  selectedPersonId: string,
  months: string[]
): Promise<Map<string, MonthIncomeRowDto[]>> {
  const byMonth = new Map<string, MonthIncomeRowDto[]>();
  if (!months.filter(Boolean).length) {
    return byMonth;
  }
  const { sorted, firstYear, lastYear, firstKey, lastKey } = monthRangeBounds(months);
  const household = selectedPersonId === "household";
  const result = await db
    .prepare(`
      SELECT
        monthly_plan_rows.id,
        monthly_plan_rows.year,
        monthly_plan_rows.month,
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
        AND monthly_plan_rows.year BETWEEN ? AND ?
        AND monthly_plan_rows.year * 100 + monthly_plan_rows.month BETWEEN ? AND ?
        AND monthly_plan_rows.section_key = 'income'
        ${household ? "" : "AND monthly_plan_rows.person_id = ?"}
      ORDER BY monthly_plan_rows.created_at
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, firstYear, lastYear, firstKey, lastKey, ...(household ? [] : [selectedPersonId]))
    .all<{
      id: string;
      year: number;
      month: number;
      person_id: string | null;
      category_id: string | null;
      label: string;
      planned_amount_minor: number;
      actual_amount_minor: number;
      notes: string | null;
      category_name: string | null;
      owner_name: string | null;
    }>();

  for (const month of sorted) {
    byMonth.set(month, []);
  }
  for (const row of result.results) {
    byMonth.get(monthKeyOf(row.year, row.month))?.push({
      id: row.id,
      categoryId: row.category_id ?? undefined,
      categoryName: row.category_name ?? "Income",
      label: household && row.owner_name ? `${row.owner_name} ${row.label.toLowerCase()}` : row.label,
      plannedMinor: row.planned_amount_minor,
      actualMinor: row.actual_amount_minor,
      personId: row.person_id ?? undefined,
      ownerName: row.owner_name ?? undefined,
      note: row.notes ?? undefined,
      isDerived: false,
      sourceRowIds: [row.id]
    });
  }
  return byMonth;
}
