import { getCurrentMonthKey } from "../../lib/month";
import {
  adjustEntriesForView,
  applyActualsFromEntries,
  buildMonthPage,
  buildEmptySummaryMonth,
  loadPageShell,
  loadPlannedSummaryMonthsForViews
} from "../app-shell";
import {
  loadEntries,
  loadMonthIncomeRows,
  loadMonthPlanRows,
  loadSummaryMonths
} from "../app-repository";
import type { EntryDto, MonthPageDto, PersonScope, SummaryMonthDto } from "../../types/dto";

// Build the route-owned Month page DTO from the current month route.
export async function buildMonthPageDto(
  db: D1Database,
  selectedViewId = "household",
  selectedMonth = getCurrentMonthKey(),
  selectedScope: PersonScope = "direct_plus_shared"
): Promise<{ viewId: string; label: string; summaryPage: Pick<{ months: SummaryMonthDto[] }, "months">; monthPage: MonthPageDto; householdMonthEntries: EntryDto[] }> {
  const { categories, trackedMonths, viewId, label } = await loadPageShell(db, selectedViewId);
  const effectiveSelectedMonth = trackedMonths.includes(selectedMonth)
    ? selectedMonth
    : trackedMonths[trackedMonths.length - 1] ?? selectedMonth;
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
    ),
    householdMonthEntries: monthEntries
  };
}
