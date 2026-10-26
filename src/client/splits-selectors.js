import { splitsMessages } from "./copy/en-SG-splits";
import { moniesClient } from "./monies-client-service";
import { deriveGroupFigures } from "../domain/split-open-period";
import { buildSplitActivitySections } from "./splits-settled-sections";
import {
  filterSplitMatchesForSearch,
  getSplitSearchSuggestions,
  splitActivityMatchesSearch,
  splitMatchMatchesSearch
} from "./split-search";

const {
  categories: categoryService,
  splits: splitService
} = moniesClient;

// Splits page terminology:
// - a "group" is a named shared-expense bucket such as a trip or household pot.
// - "activity" is the timeline of expenses and settlements for one group.
// - "matches" are unresolved links between split records and imported ledger rows.
export function buildSplitsPanelModel({
  view,
  categories,
  selectedGroupId,
  searchQuery = "",
  dismissedMatchIds,
  archiveBatchId,
  // The settled rows loaded so far (splits-settled-rows.js): a section's
  // `{ status, items }` by settlement, and the search's settled matches.
  settledRows = null
}) {
  // Splits can render before the route slice finishes hydrating, so the
  // selectors stay defensive and fall back to empty collections.
  const splitsPage = view.splitsPage ?? {
    groups: [],
    activity: [],
    matches: []
  };
  const groups = splitsPage.groups;
  const groupOptions = [{ id: "split-group-none", name: splitsMessages.nonGroup, currency: "SGD", expenseSource: "mixed" }, ...groups.filter((group) => group.id !== "split-group-none")];
  const activeGroup = groups.find((group) => group.id === selectedGroupId) ?? groups[0] ?? null;
  const activeGroupId = activeGroup?.id ?? "split-group-none";
  const activeGroupActivity = splitsPage.activity.filter((item) => item.groupId === activeGroupId);
  // The list shows the open records by date; what a settlement covered waits
  // in one collapsed section per settlement at the end (search narrows both).
  // The page sends each section as a summary; its rows load when it opens.
  const settlementCheckpoints = splitsPage.settlementCheckpoints ?? [];
  const groupSettledSummaries = (splitsPage.settledSections ?? []).filter((section) => section.groupId === activeGroupId);
  const settledSearchItems = settledRows?.search?.items ?? [];
  const {
    shownActivity: currentGroupActivity,
    groupedOpenActivity: groupedCurrentActivity,
    settledSections
  } = buildSplitActivitySections({
    activity: activeGroupActivity.filter((item) => !item.isArchived),
    summaries: groupSettledSummaries,
    checkpoints: settlementCheckpoints,
    searchQuery,
    sectionRows: (checkpointId) => settledRows?.sections?.get(checkpointId) ?? null,
    searchResults: settledSearchItems
  });
  const archivedGroupActivity = activeGroupActivity.filter((item) => item.isArchived);
  const archivedBatches = splitService.groupActivityByBatch(archivedGroupActivity);
  const selectedArchivedBatch = archiveBatchId
    ? archivedBatches.find((batch) => batch.batchId === archiveBatchId) ?? null
    : null;
  const unresolvedMatches = filterSplitMatchesForSearch(splitsPage.matches.filter((item) => !dismissedMatchIds.includes(item.id)), searchQuery);
  const groupBalanceMinor = activeGroup?.balanceMinor ?? 0;
  // The chip, the donut and the label all read the one open period (the
  // search narrows them like the list under them).
  const { spendMinor, hasSettledBefore: hasSettledInPage, donutChart, wholeGroupDonutChart } = deriveGroupFigures({
    groupActivity: activeGroupActivity,
    shownActivity: currentGroupActivity,
    categories,
    viewId: view.id
  });
  // A settled section is a settle-up the group had, though its rows stay on
  // the server.
  const hasSettledBefore = hasSettledInPage || groupSettledSummaries.length > 0;

  return {
    activeGroup,
    archivedBatches,
    categoryOptions: getCategoryOptions(categories),
    currentGroupActivity,
    // The group's activity the page holds, before any search: the money
    // check-in reads the open period from it, and the whole group (settled
    // or not) from `groupFacts` when the page sent them.
    groupActivity: activeGroupActivity,
    groupFacts: splitsPage.groupFacts?.[activeGroupId] ?? null,
    donutChart,
    donutRows: buildDonutRows(donutChart, categories),
    // The "Whole group" reading (same object as the donut for everyone's view).
    wholeGroupDonutChart,
    wholeGroupDonutRows: buildDonutRows(wholeGroupDonutChart, categories),
    expenseMatchCount: unresolvedMatches.filter((item) => item.kind === "expense").length,
    groupBalanceMinor,
    groupedCurrentActivity,
    groups,
    groupOptions,
    pendingMatchCount: unresolvedMatches.length,
    selectedArchivedBatch,
    settledSections,
    settlementCheckpoints,
    settlementMatchCount: unresolvedMatches.filter((item) => item.kind === "settlement").length,
    // Spend of the open period (what no settle-up has covered); the label
    // follows whether the group was ever settled, which a search must not change.
    totalExpenseMinor: spendMinor,
    hasSettledBefore,
    visibleMatches: unresolvedMatches,
    searchSuggestions: getSplitSearchSuggestions([...activeGroupActivity, ...settledSearchItems], splitsPage.matches, searchQuery)
  };
}

export { getSplitSearchSuggestions, splitActivityMatchesSearch, splitMatchMatchesSearch };

function getCategoryOptions(categories) {
  return categoryService.getNameOptions(categories);
}

function buildDonutRows(donutChart, categories) {
  return donutChart.map((item, index) => ({
    ...item,
    theme: categoryService.getTheme(categories, { categoryName: item.label }, index)
  }));
}
