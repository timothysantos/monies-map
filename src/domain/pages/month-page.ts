import { getCurrentMonthKey } from "../../lib/month";
import {
  applyActualsFromEntries,
  buildEmptySummaryMonth,
  loadPlannedSummaryMonthsForViews
} from "../summary-projection";
import { adjustEntriesForView, buildMonthPage } from "../month-projection";
import {
  loadEntries,
  loadMonthIncomeRows,
  loadMonthPlanRows,
  loadSummaryMonths
} from "../app-repository";
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
  const [monthEntries, monthPlanRows, incomeRows, summaryMonths] = await Promise.all([
    loadEntries(db, effectiveSelectedMonth),
    loadMonthPlanRows(db, effectiveSelectedMonth),
    loadMonthIncomeRows(db, viewId, effectiveSelectedMonth),
    loadSummaryMonths(db, viewId)
  ]);
  const plannedSummaryMonthsByView = await loadPlannedSummaryMonthsForViews(db, [viewId], [effectiveSelectedMonth]);
  const adjustedMonthEntries = adjustEntriesForView(monthEntries, viewId);
  const visibleEntries = adjustedMonthEntries;
  const currentSnapshotMonth = summaryMonths.find((month) => month.month === effectiveSelectedMonth) ?? null;
  const currentPlannedSummaryMonth = (plannedSummaryMonthsByView[viewId] ?? []).find((month) => month.month === effectiveSelectedMonth) ?? null;
  const currentSummaryMonth = applyActualsFromEntries(
    currentSnapshotMonth ?? currentPlannedSummaryMonth ?? buildEmptySummaryMonth(effectiveSelectedMonth),
    visibleEntries,
    effectiveSelectedMonth
  );

  return {
    viewId,
    label,
    summaryPage: { months: [currentSummaryMonth] },
    monthPage: buildMonthPage(
      viewId,
      selectedScope,
      incomeRows,
      adjustedMonthEntries,
      monthPlanRows,
      categories,
      effectiveSelectedMonth,
      currentSummaryMonth
    )
    // No separate household entry list: monthPage.entries already holds
    // every household entry (adjusted for the view), which is all plan
    // linking needs. Sending both doubled the response (H14).
  };
}
