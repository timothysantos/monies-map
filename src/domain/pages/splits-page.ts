import { getCurrentMonthKey } from "../../lib/month";
import { buildSplitsPage } from "../splits-projection";
import { adjustEntriesForList } from "../month-projection";
import { loadEntries } from "../app-repository-entries";
import {
  loadSplitActivityHistory,
  loadSplitExpenses,
  loadSplitGroups,
  loadSplitMatchCandidatesWithRecords,
  loadSplitSettlementCheckpoints,
  loadSplitSettlements
} from "../app-repository-splits";
import { loadSettledSectionSummaries, loadSplitGroupFacets, summariseSettledSections } from "../split-settled-history";
import { reduceGroupFacts, type SplitGroupFacts } from "../split-group-facts";
import type { SettledSectionSummary } from "../split-open-period";
import type { EntryDto } from "../../types/dto";
import {
  loadRoutePageContext,
  resolveEffectiveMonth
} from "../route-context";

type SplitsPage = ReturnType<typeof buildSplitsPage>;

export interface SplitsPageWithSettledSummaries extends Omit<SplitsPage, "settlementCheckpoints"> {
  settlementCheckpoints: Array<Omit<SplitsPage["settlementCheckpoints"][number], "includedRecordIds">>;
  // One per settlement and group: the collapsed section's heading and the
  // archive row. Its rows load when it is opened (/api/splits/settled-rows).
  settledSections?: SettledSectionSummary[];
  // The whole-group facts behind the Just for fun lines, for each group
  // with a settled section (the page holds every other group's records).
  groupFacts?: Record<string, SplitGroupFacts>;
}

// Build the route-owned Splits page DTO. Its month slice carries only what the
// Splits screen reads: the month key and the month's transfers (for matching
// a settlement checkpoint to a bank transfer), adjusted for the person view.
// Plan rows, income rows and summary figures belong to the Month page and are
// neither loaded nor sent here.
//
// Split records a settlement checkpoint covers are not sent (a settlement can
// cover hundreds): each settled section is a summary with its count and
// spend, and a group with one gets its whole-group facts, both counted in SQL
// (split-settled-history.ts). The rows load on demand (pages/splits-settled.ts).
export async function buildSplitsPageDto(
  db: D1Database,
  selectedViewId = "household",
  selectedMonth = getCurrentMonthKey()
): Promise<{ viewId: string; label: string; monthPage: { month: string; entries: EntryDto[] }; splitsPage: SplitsPageWithSettledSummaries }> {
  const { categories, trackedMonths, viewId, label, personNameById } = await loadRoutePageContext(db, selectedViewId);
  const effectiveSelectedMonth = resolveEffectiveMonth(trackedMonths, selectedMonth);
  const outsideSettledSections = { kind: "outside-settled-sections" } as const;
  const [splitGroups, splitExpenses, splitSettlements, matchData, settlementCheckpoints, activityHistory, monthEntries, settledSectionRows, facetsByGroup] = await Promise.all([
    loadSplitGroups(db),
    loadSplitExpenses(db, effectiveSelectedMonth, outsideSettledSections),
    loadSplitSettlements(db, effectiveSelectedMonth, outsideSettledSections),
    loadSplitMatchCandidatesWithRecords(db, effectiveSelectedMonth),
    loadSplitSettlementCheckpoints(db),
    loadSplitActivityHistory(db),
    loadEntries(db, effectiveSelectedMonth),
    loadSettledSectionSummaries(db, viewId),
    loadSplitGroupFacets(db, viewId)
  ]);
  const { sections: settledSections, groups: settledGroups } = summariseSettledSections(settledSectionRows, settlementCheckpoints);
  const monthTransfers = adjustEntriesForList(monthEntries, viewId).filter((entry) => entry.entryType === "transfer");
  const page = buildSplitsPage(
    viewId,
    splitGroups,
    splitExpenses,
    splitSettlements,
    matchData.matches,
    categories,
    effectiveSelectedMonth,
    personNameById,
    settlementCheckpoints,
    activityHistory,
    { matchRecords: { expenses: matchData.expenses, settlements: matchData.settlements }, settledGroups }
  );
  const groupFacts: Record<string, SplitGroupFacts> = {};
  for (const [groupId, facets] of facetsByGroup) {
    groupFacts[groupId] = reduceGroupFacts(facets, page.groups.find((group) => group.id === groupId)?.currency);
  }

  return {
    viewId,
    label,
    monthPage: { month: effectiveSelectedMonth, entries: monthTransfers },
    splitsPage: {
      ...page,
      // The record ids a checkpoint covers stay on the server: the page
      // shows the count, and a section's rows carry their checkpoint.
      settlementCheckpoints: page.settlementCheckpoints.map(({ includedRecordIds: _ids, ...checkpoint }) => checkpoint),
      // Left out while nothing is settled (the page reads them as empty).
      ...(settledSections.length ? { settledSections } : {}),
      ...(Object.keys(groupFacts).length ? { groupFacts } : {})
    }
  };
}
