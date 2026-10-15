// Plan history (DOMAIN.md "Plan history"): the little a plan row's slider
// popover says about its past. Each current plan row (and income row) may carry
// one tuple, `history`:
//
//   [last month's plan, last month's actual, average actual of the previous
//    three months that had the row, how many months that average counts]
//
// A past month is read with the rules of its own Month page (the view's rows,
// each row's actual from entries), so last month's figures equal what that
// page shows. A row is matched to a past row by category and name. Months the
// household never tracked are not read at all, so the work is at most three
// bounded month reads (entries, plan rows, income rows) next to the page's own.
// Pure functions here; the page loader (pages/month-page.ts) does the reads.

import { isSavingsTargetRow } from "./money-job-plan";
import { adjustEntriesForView, deriveIncomeRowActuals, derivePlanRowActuals, buildPlanRowsForView, normalizeCategoryLabel } from "./month-projection";
import { effectiveScopeForView, filterEntriesForView } from "./person-view-scope";
import type { EntryDto, MonthIncomeRowDto, MonthPlanRowDto, PersonScope } from "../types/dto";

export const HISTORY_MONTH_COUNT = 3;

function addMonths(month: string, delta: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const index = year * 12 + (monthNumber - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** The months before `month`, most recent first. */
export function historyMonthsFor(month: string, count = HISTORY_MONTH_COUNT): string[] {
  return Array.from({ length: count }, (_, index) => addMonths(month, -(index + 1)));
}

/** What a row is matched by across months: its category and its name. */
export function planRowHistoryKey(row: { categoryName?: string; label?: string }) {
  return `${normalizeCategoryLabel(row.categoryName)}::${normalizeCategoryLabel(row.label)}`;
}

export interface HistoryMonth {
  month: string;
  incomeRows: MonthIncomeRowDto[];
  planRows: MonthPlanRowDto[];
}

type HistoryRow = { categoryName?: string; label?: string; plannedMinor: number; actualMinor: number };

// The Savings line is measured by money kept, not by entries linked to the
// row, so its row actual says nothing: only its plan is carried.
const hasMeaningfulActual = (row: HistoryRow) => !isSavingsTargetRow(row);

function tupleFor(currentMonth: string, row: HistoryRow, past: Array<{ month: string; rows: Map<string, HistoryRow> }>) {
  const key = planRowHistoryKey(row);
  const lastMonth = addMonths(currentMonth, -1);
  const matches = past
    .map((entry) => ({ month: entry.month, found: entry.rows.get(key) }))
    .filter((entry): entry is { month: string; found: HistoryRow } => Boolean(entry.found));
  if (!matches.length) {
    return null;
  }
  const last = matches.find((entry) => entry.month === lastMonth)?.found;
  const counted = hasMeaningfulActual(row) ? matches : [];
  const average = counted.length
    ? Math.round(counted.reduce((sum, entry) => sum + entry.found.actualMinor, 0) / counted.length)
    : null;
  return [
    last ? last.plannedMinor : null,
    last && hasMeaningfulActual(row) ? last.actualMinor : null,
    average,
    counted.length
  ] as [number | null, number | null, number | null, number];
}

/**
 * Adds `history` to every row that a past month also had. `past` holds the
 * view's rows of each earlier month with their actuals already derived.
 */
export function attachPlanHistory(
  current: { incomeRows: MonthIncomeRowDto[]; planRows: MonthPlanRowDto[] },
  past: HistoryMonth[],
  currentMonth: string
) {
  const index = (pick: (month: HistoryMonth) => HistoryRow[]) => past.map((entry) => ({
    month: entry.month,
    rows: new Map(pick(entry).map((row) => [planRowHistoryKey(row), row]))
  }));
  const incomePast = index((entry) => entry.incomeRows);
  const planPast = index((entry) => entry.planRows);
  const attach = <Row extends HistoryRow>(rows: Row[], source: ReturnType<typeof index>) => rows.map((row) => {
    const history = tupleFor(currentMonth, row, source);
    return history ? { ...row, history } : row;
  });
  return {
    incomeRows: attach(current.incomeRows, incomePast),
    planRows: attach(current.planRows, planPast)
  };
}

/** A past month's rows as the view sees them, with each row's actual from that month's entries. */
export function deriveHistoryMonth(
  input: { month: string; planRows: MonthPlanRowDto[]; incomeRows: MonthIncomeRowDto[]; entries: EntryDto[] },
  viewId: string,
  scope: PersonScope
): HistoryMonth {
  const visibleEntries = filterEntriesForView(
    adjustEntriesForView(input.entries, viewId),
    viewId,
    effectiveScopeForView(viewId, scope)
  );
  return {
    month: input.month,
    planRows: derivePlanRowActuals(buildPlanRowsForView(input.planRows, viewId), visibleEntries, viewId),
    incomeRows: deriveIncomeRowActuals(input.incomeRows, visibleEntries, viewId)
  };
}
