import { getCurrentMonthKey } from "../../lib/month";
import { buildSplitsPage } from "../splits-projection";
import { adjustEntriesForView } from "../month-projection";
import {
  loadEntries,
  loadSplitExpenses,
  loadSplitGroups,
  loadSplitMatchCandidates,
  loadSplitSettlements,
  loadSplitSettlementCheckpoints,
  loadSplitActivityHistory
} from "../app-repository";
import type { EntryDto } from "../../types/dto";
import {
  loadRoutePageContext,
  resolveEffectiveMonth
} from "../route-context";

// Build the route-owned Splits page DTO. Its month slice carries only what the
// Splits screen reads: the month key and the month's transfers (for matching
// a settlement checkpoint to a bank transfer), adjusted for the person view.
// Plan rows, income rows and summary figures belong to the Month page and are
// neither loaded nor sent here.
export async function buildSplitsPageDto(
  db: D1Database,
  selectedViewId = "household",
  selectedMonth = getCurrentMonthKey()
): Promise<{ viewId: string; label: string; monthPage: { month: string; entries: EntryDto[] }; splitsPage: ReturnType<typeof buildSplitsPage> }> {
  const { categories, trackedMonths, viewId, label, personNameById } = await loadRoutePageContext(db, selectedViewId);
  const effectiveSelectedMonth = resolveEffectiveMonth(trackedMonths, selectedMonth);
  const [splitGroups, splitExpenses, splitSettlements, splitMatches, settlementCheckpoints, activityHistory, monthEntries] = await Promise.all([
    loadSplitGroups(db),
    loadSplitExpenses(db, effectiveSelectedMonth),
    loadSplitSettlements(db, effectiveSelectedMonth),
    loadSplitMatchCandidates(db, effectiveSelectedMonth),
    loadSplitSettlementCheckpoints(db),
    loadSplitActivityHistory(db),
    loadEntries(db, effectiveSelectedMonth)
  ]);
  const monthTransfers = adjustEntriesForView(monthEntries, viewId).filter((entry) => entry.entryType === "transfer");

  return {
    viewId,
    label,
    monthPage: { month: effectiveSelectedMonth, entries: monthTransfers },
    splitsPage: buildSplitsPage(viewId, splitGroups, splitExpenses, splitSettlements, splitMatches, categories, effectiveSelectedMonth, personNameById, settlementCheckpoints, activityHistory)
  };
}
