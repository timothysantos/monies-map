import { getCurrentMonthKey } from "../../lib/month";
import {
  applyActualsFromEntries,
  buildEmptySummaryMonth,
  buildPlannedSummaryMonthsForViews
} from "../summary-projection";
import { adjustEntriesForView, buildMonthPage } from "../month-projection";
import { effectiveScopeForView, filterEntriesForView } from "../person-view-scope";
import { loadEntries } from "../app-repository";
import { loadMonthIncomeRowsForMonths, loadMonthPlanRowsForMonths } from "../app-repository-months";
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
  // The (up to three) tracked months before this one, for plan history.
  const historyMonths = historyMonthsFor(effectiveSelectedMonth).filter((candidate) => trackedMonths.includes(candidate));
  const planMonths = [effectiveSelectedMonth, ...historyMonths];
  // Every read is sent at once: this month's and the history months' plan
  // and income rows come from one range read each, and the history's entries
  // from one read over their dates.
  const [monthEntries, planRowsByMonth, incomeRowsByMonth, summaryMonths, investmentAccountIds, historyEntries] = await Promise.all([
    loadEntries(db, effectiveSelectedMonth),
    loadMonthPlanRowsForMonths(db, planMonths),
    loadMonthIncomeRowsForMonths(db, viewId, planMonths),
    loadRepairedSummaryMonths(db, viewId),
    loadInvestmentAccountIds(db),
    historyMonths.length ? loadEntriesForMonths(db, historyMonths) : Promise.resolve([])
  ]);
  const monthPlanRows = planRowsByMonth.get(effectiveSelectedMonth) ?? [];
  const incomeRows = incomeRowsByMonth.get(effectiveSelectedMonth) ?? [];
  const plannedSummaryMonthsByView = buildPlannedSummaryMonthsForViews(
    [viewId],
    [effectiveSelectedMonth],
    new Map([[effectiveSelectedMonth, monthPlanRows]]),
    new Map([[`${viewId}:${effectiveSelectedMonth}`, incomeRows]])
  );
  // Each month read with its own page's rules (deriveHistoryMonth). Months
  // the household never tracked are skipped, so an old month reads nothing.
  const history = historyMonths.length
    ? historyMonths.map((candidate) => deriveHistoryMonth({
      month: candidate,
      planRows: planRowsByMonth.get(candidate) ?? [],
      incomeRows: incomeRowsByMonth.get(candidate) ?? [],
      entries: historyEntries.filter((entry) => entry.date.slice(0, 7) === candidate)
    }, viewId, selectedScope))
    : null;
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
