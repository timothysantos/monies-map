import { getCurrentMonthKey } from "../../lib/month";
import { buildSummaryPage, buildSummaryRange, loadPlannedSummaryMonthsForViews } from "../summary-projection";
import { adjustEntriesForView } from "../month-projection";
import { loadEntriesForMonths } from "../app-repository";
import { loadRepairedSummaryMonths } from "../app-repository-snapshots";
import type { PersonScope, SummaryPageDto } from "../../types/dto";
import {
  loadRoutePageContext,
  resolveEffectiveMonth
} from "../route-context";

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
  const { categories, trackedMonths, viewId, label, personNameById } = await loadRoutePageContext(db, selectedViewId);
  const effectiveSelectedMonth = resolveEffectiveMonth(trackedMonths, selectedMonth);
  const summaryRangeMonths = buildSummaryRange(trackedMonths, summaryStartMonth, summaryEndMonth ?? effectiveSelectedMonth);
  const [summaryMonths, summaryEntries] = await Promise.all([
    loadRepairedSummaryMonths(db, viewId),
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
      effectiveSelectedMonth,
      summaryRangeMonths,
      trackedMonths,
      personNameById
    )
  };
}
