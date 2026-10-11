import { getCurrentMonthKey } from "../../lib/month";
import { getMonthBounds } from "../app-repository-helpers";
import { loadEntriesForDateRange, loadTransferGroupedEntryIds } from "../app-repository-entries";
import { loadAccountReferences } from "../app-repository-settings";
import {
  loadSplitExpenses,
  loadSplitGroups,
  loadSplitSettlementCheckpoints,
  loadSplitSettlements
} from "../app-repository-splits";
import { effectiveScopeForView } from "../person-view-scope";
import { deriveSkewGroupBalances, findSkewCandidates, SKEW_ENTRY_PADDING_DAYS } from "../skew-candidates";
import { buildSplitsPage } from "../splits-projection";
import type { SkewCandidatesDto } from "../../types/dto";
import { loadRoutePageContext, resolveEffectiveMonth } from "../route-context";

// The read-only skew-candidate projection for one view and month
// (GET /api/skew-candidates). It is not a page DTO and no first-screen or
// page payload carries it. It reads the month's entries (plus padding for
// counterparts across the month end), the account owners, the open
// settlement checkpoints, and the open split group balances exactly as the
// Splits page computes them, then leaves the matching to the pure finder.
// One-sided `medium` settlements are left out unless `includeMedium` (the
// route's `?include=medium`) asks for them.
export async function buildSkewCandidatesDto(
  db: D1Database,
  selectedViewId = "household",
  selectedMonth = getCurrentMonthKey(),
  selectedScope?: string | null,
  options: { includeMedium?: boolean } = {}
): Promise<SkewCandidatesDto> {
  const { household, categories, trackedMonths, viewId, label, personNameById } = await loadRoutePageContext(db, selectedViewId);
  const month = resolveEffectiveMonth(trackedMonths, selectedMonth);
  const scope = effectiveScopeForView(viewId, selectedScope);
  const [monthStart, nextMonth] = getMonthBounds(month);
  const rangeStart = shiftIsoDate(monthStart, -SKEW_ENTRY_PADDING_DAYS);
  const rangeEnd = shiftIsoDate(nextMonth, SKEW_ENTRY_PADDING_DAYS);

  const [entries, transferGroupedEntryIds, accounts, splitGroups, splitExpenses, splitSettlements, settlementCheckpoints] = await Promise.all([
    loadEntriesForDateRange(db, rangeStart, rangeEnd),
    loadTransferGroupedEntryIds(db, rangeStart, rangeEnd),
    loadAccountReferences(db),
    loadSplitGroups(db),
    loadSplitExpenses(db),
    loadSplitSettlements(db),
    loadSplitSettlementCheckpoints(db)
  ]);

  // Group balances as the first person sees them on Splits (positive: the
  // other person owes them). Settlement needs two people.
  const [viewerPerson, otherPerson] = household.people;
  let groupBalances: ReturnType<typeof deriveSkewGroupBalances> = [];
  if (viewerPerson && otherPerson) {
    const splitsPage = buildSplitsPage(viewerPerson.id, splitGroups, splitExpenses, splitSettlements, [], categories, month, personNameById, settlementCheckpoints);
    groupBalances = deriveSkewGroupBalances({ groups: splitsPage.groups, activity: splitsPage.activity, viewerPersonId: viewerPerson.id, otherPersonId: otherPerson.id });
  }

  const settleUpLinkedEntryIds = splitSettlements
    .map((settlement) => settlement.linkedTransactionId)
    .filter((id): id is string => Boolean(id));

  const result = findSkewCandidates({
    month,
    viewId,
    scope,
    entries,
    alreadyLinkedEntryIds: [...transferGroupedEntryIds, ...settleUpLinkedEntryIds],
    accounts,
    people: household.people,
    settlementCheckpoints,
    groupBalances,
    includeMedium: options.includeMedium === true
  });

  return { viewId, label, month, scope, ...result };
}

function shiftIsoDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
