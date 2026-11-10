import { getCurrentMonthKey } from "../../lib/month";
import { buildSummaryPage, buildSummaryRange, loadPlannedSummaryMonthsForViews } from "../summary-projection";
import { adjustEntriesForView } from "../month-projection";
import { effectiveScopeForView, filterEntriesForView } from "../person-view-scope";
import { loadEntriesForMonths } from "../app-repository";
import { loadInvestmentAccountIds } from "../app-repository-entries";
import { sumInvestmentMoves } from "../investment-moves";
import { loadRepairedSummaryMonths } from "../app-repository-snapshots";
import type { PersonScope, SummaryPageDto } from "../../types/dto";
import { loadBankFeesYear } from "./summary-bank-fees";
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
  const [summaryMonths, summaryEntries, investmentAccountIds, plannedSummaryMonthsByView, bankFeesYear] = await Promise.all([
    loadRepairedSummaryMonths(db, viewId),
    // Summary shows totals and charts, never an entry's text.
    loadEntriesForMonths(db, summaryRangeMonths, { figuresOnly: true }),
    loadInvestmentAccountIds(db),
    loadPlannedSummaryMonthsForViews(db, [viewId], summaryRangeMonths),
    // Bank fees this year (Money insights), for the range's last month.
    loadBankFeesYear(db, viewId, effectiveScopeForView(viewId, selectedScope), summaryRangeMonths.at(-1) ?? effectiveSelectedMonth)
  ]);
  // A person view counts only that person's entries in the scope, each at
  // their own amount, the same rule as the stored person month totals.
  const visibleSummaryEntries = filterEntriesForView(
    adjustEntriesForView(summaryEntries, viewId),
    viewId,
    effectiveScopeForView(viewId, selectedScope)
  );

  const summaryPage = buildSummaryPage(
    viewId,
    visibleSummaryEntries,
    { [viewId]: summaryMonths },
    plannedSummaryMonthsByView,
    categories,
    effectiveSelectedMonth,
    summaryRangeMonths,
    trackedMonths,
    personNameById,
    sumInvestmentMoves(visibleSummaryEntries, summaryEntries, investmentAccountIds),
    // Month by month, so each month of "Earned vs spent by month" is its
    // Month lead (and the Entries figure a row opens).
    summaryRangeMonths.flatMap((month) => {
      const moves = sumInvestmentMoves(
        visibleSummaryEntries.filter((entry) => entry.date.slice(0, 7) === month),
        summaryEntries,
        investmentAccountIds
      );
      return moves ? [{ month, ...moves }] : [];
    })
  );
  return {
    viewId,
    label,
    // Left out when the year has no fee at all, so most pages do not grow.
    summaryPage: bankFeesYear && (bankFeesYear.parts.length || bankFeesYear.refundedParts.length)
      ? { ...summaryPage, bankFeesYear }
      : summaryPage
  };
}
