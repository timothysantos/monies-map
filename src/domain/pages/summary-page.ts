import { getCurrentMonthKey } from "../../lib/month";
import {
  accountsForSummary,
  adjustEntriesForView,
  buildSummaryPage,
  buildSummaryRange,
  loadPageShell,
  loadPlannedSummaryMonthsForViews
} from "../app-shell";
import {
  loadEntriesForMonths,
  loadSummaryMonths
} from "../app-repository";
import type { PersonScope, SummaryPageDto } from "../../types/dto";

// Build the route-owned Summary page DTO from the shell seed and the summary
// range requested by the active route.
export async function buildSummaryPageDto(
  db: D1Database,
  selectedViewId = "household",
  selectedMonth = getCurrentMonthKey(),
  selectedScope: PersonScope = "direct_plus_shared",
  summaryStartMonth?: string,
  summaryEndMonth?: string
): Promise<{ viewId: string; label: string; summaryPage: SummaryPageDto }> {
  const { household, accounts, categories, trackedMonths, viewId, label, personNameById } = await loadPageShell(db, selectedViewId);
  const effectiveSelectedMonth = trackedMonths.includes(selectedMonth)
    ? selectedMonth
    : trackedMonths[trackedMonths.length - 1] ?? selectedMonth;
  const summaryRangeMonths = buildSummaryRange(trackedMonths, summaryStartMonth, summaryEndMonth ?? effectiveSelectedMonth);
  const [summaryMonths, summaryEntries] = await Promise.all([
    loadSummaryMonths(db, viewId),
    loadEntriesForMonths(db, summaryRangeMonths)
  ]);
  const plannedSummaryMonthsByView = await loadPlannedSummaryMonthsForViews(db, [viewId], summaryRangeMonths);
  const adjustedSummaryEntries = adjustEntriesForView(summaryEntries, viewId);
  const visibleSummaryEntries = adjustedSummaryEntries;

  return {
    viewId,
    label,
    summaryPage: buildSummaryPage(
      viewId,
      visibleSummaryEntries,
      { [viewId]: summaryMonths },
      plannedSummaryMonthsByView,
      categories,
      accountsForSummary(viewId, accounts),
      effectiveSelectedMonth,
      summaryRangeMonths,
      trackedMonths,
      personNameById
    )
  };
}
