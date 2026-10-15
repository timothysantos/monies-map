import { getCurrentMonthKey } from "../../lib/month";
import {
  applyActualsFromEntries,
  buildEmptySummaryMonth,
  loadPlannedSummaryMonthsForViews
} from "../summary-projection";
import { adjustEntriesForView, buildMonthPage } from "../month-projection";
import { effectiveScopeForView, filterEntriesForView } from "../person-view-scope";
import {
  loadEntries,
  loadMonthIncomeRows,
  loadMonthPlanRows
} from "../app-repository";
import { loadRepairedSummaryMonths } from "../app-repository-snapshots";
import { loadEntriesForMonths, loadInvestmentAccountIds } from "../app-repository-entries";
import { sumInvestmentMoves } from "../investment-moves";
import { attachPlanHistory, deriveHistoryMonth, historyMonthsFor } from "../month-plan-history";
import type { MonthPageDto, PersonScope, SummaryMonthDto } from "../../types/dto";
import {
  loadRoutePageContext,
  resolveEffectiveMonth
} from "../route-context";

// Build the route-owned Month page DTO from the current month route.
export async function buildMonthPageDto(
  db: D1Database,
  selectedViewId = "household",
  selectedMonth = getCurrentMonthKey(),
  selectedScope: PersonScope = "direct_plus_shared"
): Promise<{ viewId: string; label: string; summaryPage: Pick<{ months: SummaryMonthDto[] }, "months">; monthPage: MonthPageDto }> {
  const { categories, trackedMonths, viewId, label } = await loadRoutePageContext(db, selectedViewId);
  const effectiveSelectedMonth = resolveEffectiveMonth(trackedMonths, selectedMonth);
  const [monthEntries, monthPlanRows, incomeRows, summaryMonths, investmentAccountIds] = await Promise.all([
    loadEntries(db, effectiveSelectedMonth),
    loadMonthPlanRows(db, effectiveSelectedMonth),
    loadMonthIncomeRows(db, viewId, effectiveSelectedMonth),
    loadRepairedSummaryMonths(db, viewId),
    loadInvestmentAccountIds(db)
  ]);
  const plannedSummaryMonthsByView = await loadPlannedSummaryMonthsForViews(db, [viewId], [effectiveSelectedMonth]);
  const history = await loadPlanHistory(db, viewId, selectedScope, effectiveSelectedMonth, trackedMonths);
  const adjustedMonthEntries = adjustEntriesForView(monthEntries, viewId);
  // The Actual spend card counts the same entries as Summary and the stored
  // person month totals: only the person's own, in the selected scope.
  const visibleEntries = filterEntriesForView(
    adjustedMonthEntries,
    viewId,
    effectiveScopeForView(viewId, selectedScope)
  );
  const currentSnapshotMonth = summaryMonths.find((month) => month.month === effectiveSelectedMonth) ?? null;
  const currentPlannedSummaryMonth = (plannedSummaryMonthsByView[viewId] ?? []).find((month) => month.month === effectiveSelectedMonth) ?? null;
  const currentSummaryMonth = applyActualsFromEntries(
    currentSnapshotMonth ?? currentPlannedSummaryMonth ?? buildEmptySummaryMonth(effectiveSelectedMonth),
    visibleEntries,
    effectiveSelectedMonth
  );

  const monthPage = buildMonthPage(
      viewId,
      selectedScope,
      incomeRows,
      adjustedMonthEntries,
      monthPlanRows,
      categories,
      effectiveSelectedMonth,
      currentSummaryMonth,
      sumInvestmentMoves(visibleEntries, adjustedMonthEntries, investmentAccountIds)
    );
  // No separate household entry list: monthPage.entries already holds
  // every household entry (adjusted for the view), which is all plan
  // linking needs. Sending both doubled the response (H14).
  return {
    viewId,
    label,
    summaryPage: { months: [currentSummaryMonth] },
    monthPage: history ? withPlanHistory(monthPage, history) : monthPage
  };
}

// The rows of the (up to three) tracked months before this one, each read with
// its own page's rules: one entries read over their dates, then one plan-row
// read and one income read per month, all in parallel. Months the household
// never tracked are skipped, so a new household or an old month reads nothing.
async function loadPlanHistory(db: D1Database, viewId: string, scope: PersonScope, month: string, trackedMonths: string[]) {
  const months = historyMonthsFor(month).filter((candidate) => trackedMonths.includes(candidate));
  if (!months.length) {
    return null;
  }
  const [entries, planRows, incomeRows] = await Promise.all([
    loadEntriesForMonths(db, months),
    Promise.all(months.map((candidate) => loadMonthPlanRows(db, candidate))),
    Promise.all(months.map((candidate) => loadMonthIncomeRows(db, viewId, candidate)))
  ]);
  return months.map((candidate, index) => deriveHistoryMonth({
    month: candidate,
    planRows: planRows[index],
    incomeRows: incomeRows[index],
    entries: entries.filter((entry) => entry.date.slice(0, 7) === candidate)
  }, viewId, scope));
}

function withPlanHistory(monthPage: MonthPageDto, history: ReturnType<typeof deriveHistoryMonth>[]): MonthPageDto {
  const planRows = monthPage.planSections.flatMap((section) => section.rows);
  const attached = attachPlanHistory({ incomeRows: monthPage.incomeRows, planRows }, history, monthPage.month);
  const byId = new Map(attached.planRows.map((row) => [row.id, row]));
  return {
    ...monthPage,
    incomeRows: attached.incomeRows,
    planSections: monthPage.planSections.map((section) => ({ ...section, rows: section.rows.map((row) => byId.get(row.id) ?? row) }))
  };
}
