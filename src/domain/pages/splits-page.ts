import { getCurrentMonthKey } from "../../lib/month";
import {
  adjustEntriesForView,
  applyActualsFromEntries,
  buildMonthPage,
  buildSplitsPage,
  buildEmptySummaryMonth,
  loadPageShell,
  loadPlannedSummaryMonthsForViews
} from "../app-shell";
import {
  loadEntries,
  loadMonthIncomeRows,
  loadMonthPlanRows,
  loadSplitExpenses,
  loadSplitGroups,
  loadSplitMatchCandidates,
  loadSplitSettlements,
  loadSummaryMonths
} from "../app-repository";

// Build the route-owned Splits page DTO and keep the linked month slice local
// to this route module.
export async function buildSplitsPageDto(
  db: D1Database,
  selectedViewId = "household",
  selectedMonth = getCurrentMonthKey()
): Promise<{ viewId: string; label: string; monthPage: ReturnType<typeof buildMonthPage>; splitsPage: ReturnType<typeof buildSplitsPage> }> {
  const { categories, trackedMonths, viewId, label, personNameById } = await loadPageShell(db, selectedViewId);
  const effectiveSelectedMonth = trackedMonths.includes(selectedMonth)
    ? selectedMonth
    : trackedMonths[trackedMonths.length - 1] ?? selectedMonth;
  const [splitGroups, splitExpenses, splitSettlements, splitMatches, monthEntries, monthPlanRows, incomeRows, summaryMonths] = await Promise.all([
    loadSplitGroups(db),
    loadSplitExpenses(db, effectiveSelectedMonth),
    loadSplitSettlements(db, effectiveSelectedMonth),
    loadSplitMatchCandidates(db, effectiveSelectedMonth),
    loadEntries(db, effectiveSelectedMonth),
    loadMonthPlanRows(db, effectiveSelectedMonth),
    loadMonthIncomeRows(db, viewId, effectiveSelectedMonth),
    loadSummaryMonths(db, viewId)
  ]);
  const plannedSummaryMonthsByView = await loadPlannedSummaryMonthsForViews(db, [viewId], [effectiveSelectedMonth]);
  const adjustedMonthEntries = adjustEntriesForView(monthEntries, viewId);
  const currentSnapshotMonth = summaryMonths.find((month) => month.month === effectiveSelectedMonth) ?? null;
  const currentPlannedSummaryMonth = (plannedSummaryMonthsByView[viewId] ?? []).find((month) => month.month === effectiveSelectedMonth) ?? null;
  const currentSummaryMonth = applyActualsFromEntries(
    currentSnapshotMonth ?? currentPlannedSummaryMonth ?? buildEmptySummaryMonth(effectiveSelectedMonth),
    adjustedMonthEntries,
    effectiveSelectedMonth
  );

  return {
    viewId,
    label,
    monthPage: buildMonthPage(
      viewId,
      "direct_plus_shared",
      incomeRows,
      adjustedMonthEntries,
      monthPlanRows,
      categories,
      effectiveSelectedMonth,
      currentSummaryMonth
    ),
    splitsPage: buildSplitsPage(viewId, splitGroups, splitExpenses, splitSettlements, splitMatches, categories, effectiveSelectedMonth, personNameById)
  };
}
