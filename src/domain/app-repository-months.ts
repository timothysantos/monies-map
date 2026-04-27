import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import {
  groupSplits,
  normalizePlanMatchHint,
  weekdayLabel
} from "./app-repository-helpers";
import { getCurrentMonthKey } from "../lib/month";
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

export async function loadTrackedMonths(db: D1Database): Promise<string[]> {
  const result = await db
    .prepare(`
      SELECT DISTINCT month_key
      FROM (
        SELECT substr(transaction_date, 1, 7) AS month_key
        FROM transactions
        LEFT JOIN imports ON imports.id = transactions.import_id
        WHERE transactions.household_id = ?
          AND (transactions.import_id IS NULL OR imports.status = 'completed')

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
    .bind(DEFAULT_HOUSEHOLD_ID, DEFAULT_HOUSEHOLD_ID, DEFAULT_HOUSEHOLD_ID)
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
    .bind(DEFAULT_HOUSEHOLD_ID, year, monthNumber)
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
    .bind(DEFAULT_HOUSEHOLD_ID, year, monthNumber)
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
    .bind(DEFAULT_HOUSEHOLD_ID, year, monthNumber)
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
