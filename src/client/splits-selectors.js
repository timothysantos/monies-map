import { messages } from "./copy/en-SG";
import { moniesClient } from "./monies-client-service";
import { deriveGroupFigures } from "../domain/split-open-period";
import {
  filterSplitActivityForSearch,
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
  archiveBatchId
}) {
  // Splits can render before the route slice finishes hydrating, so the
  // selectors stay defensive and fall back to empty collections.
  const splitsPage = view.splitsPage ?? {
    groups: [],
    activity: [],
    matches: []
  };
  const groups = splitsPage.groups;
  const groupOptions = [{ id: "split-group-none", name: messages.splits.nonGroup, currency: "SGD", expenseSource: "mixed" }, ...groups.filter((group) => group.id !== "split-group-none")];
  const activeGroup = groups.find((group) => group.id === selectedGroupId) ?? groups[0] ?? null;
  const activeGroupId = activeGroup?.id ?? "split-group-none";
  const activeGroupActivity = splitsPage.activity.filter((item) => item.groupId === activeGroupId);
  const currentGroupActivity = filterSplitActivityForSearch(activeGroupActivity.filter((item) => !item.isArchived), searchQuery);
  const archivedGroupActivity = activeGroupActivity.filter((item) => item.isArchived);
  const groupedCurrentActivity = splitService.groupActivityByDate(currentGroupActivity);
  const archivedBatches = splitService.groupActivityByBatch(archivedGroupActivity);
  const selectedArchivedBatch = archiveBatchId
    ? archivedBatches.find((batch) => batch.batchId === archiveBatchId) ?? null
    : null;
  const unresolvedMatches = filterSplitMatchesForSearch(splitsPage.matches.filter((item) => !dismissedMatchIds.includes(item.id)), searchQuery);
  const groupBalanceMinor = activeGroup?.balanceMinor ?? 0;
  // The chip, the donut and the label all read the one open period (the
  // search narrows them like the list under them).
  const { spendMinor, hasSettledBefore, donutChart } = deriveGroupFigures({
    groupActivity: activeGroupActivity,
    shownActivity: currentGroupActivity,
    categories,
    viewId: view.id
  });

  return {
    activeGroup,
    archivedBatches,
    categoryOptions: getCategoryOptions(categories),
    currentGroupActivity,
    // All of the group's activity before any search, settled or not: the
    // money check-in reads it and says which of its figures are all-time.
    groupActivity: activeGroupActivity,
    donutChart,
    donutRows: buildDonutRows(donutChart, categories),
    expenseMatchCount: unresolvedMatches.filter((item) => item.kind === "expense").length,
    groupBalanceMinor,
    groupedCurrentActivity,
    groups,
    groupOptions,
    pendingMatchCount: unresolvedMatches.length,
    selectedArchivedBatch,
    settlementMatchCount: unresolvedMatches.filter((item) => item.kind === "settlement").length,
    // Spend of the open period (what no settle-up has covered); the label
    // follows whether the group was ever settled, which a search must not change.
    totalExpenseMinor: spendMinor,
    hasSettledBefore,
    visibleMatches: unresolvedMatches,
    searchSuggestions: getSplitSearchSuggestions(activeGroupActivity, splitsPage.matches, searchQuery)
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
