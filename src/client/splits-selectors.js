import { messages } from "./copy/en-SG";
import { moniesClient } from "./monies-client-service";

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
  dismissedMatchIds,
  archiveBatchId
}) {
  const groups = view.splitsPage.groups;
  const groupOptions = [{ id: "split-group-none", name: messages.splits.nonGroup }, ...groups.filter((group) => group.id !== "split-group-none")];
  const activeGroup = groups.find((group) => group.id === selectedGroupId) ?? groups[0] ?? null;
  const activeGroupId = activeGroup?.id ?? "split-group-none";
  const activeGroupActivity = view.splitsPage.activity.filter((item) => item.groupId === activeGroupId);
  const currentGroupActivity = activeGroupActivity.filter((item) => !item.isArchived);
  const archivedGroupActivity = activeGroupActivity.filter((item) => item.isArchived);
  const groupedCurrentActivity = splitService.groupActivityByDate(currentGroupActivity);
  const archivedBatches = splitService.groupActivityByBatch(archivedGroupActivity);
  const selectedArchivedBatch = archiveBatchId
    ? archivedBatches.find((batch) => batch.batchId === archiveBatchId) ?? null
    : null;
  const unresolvedMatches = view.splitsPage.matches.filter((item) => !dismissedMatchIds.includes(item.id));
  const groupBalanceMinor = activeGroup?.balanceMinor ?? 0;

  return {
    activeGroup,
    archivedBatches,
    categoryOptions: getCategoryOptions(categories),
    donutRows: buildDonutRows(view.splitsPage.donutChart, categories),
    expenseMatchCount: unresolvedMatches.filter((item) => item.kind === "expense").length,
    groupBalanceMinor,
    groupedCurrentActivity,
    groups,
    groupOptions,
    groupSummaryLabel: view.id === "household" ? "" : getGroupSummaryLabel(groupBalanceMinor),
    linkedEntriesById: new Map(view.monthPage.entries.map((entry) => [entry.id, entry])),
    pendingMatchCount: unresolvedMatches.length,
    selectedArchivedBatch,
    settlementMatchCount: unresolvedMatches.filter((item) => item.kind === "settlement").length,
    totalExpenseMinor: currentGroupActivity
      .filter((item) => item.kind === "expense")
      .reduce((sum, item) => sum + item.totalAmountMinor, 0),
    visibleMatches: unresolvedMatches
  };
}

function getCategoryOptions(categories) {
  return categoryService.getNameOptions(categories);
}

function buildDonutRows(donutChart, categories) {
  return donutChart.map((item, index) => ({
    ...item,
    theme: categoryService.getTheme(categories, { categoryName: item.label }, index)
  }));
}

function getGroupSummaryLabel(groupBalanceMinor) {
  if (groupBalanceMinor === 0) {
    return messages.splits.settledUp;
  }
  return groupBalanceMinor > 0 ? messages.splits.youAreOwed : messages.splits.youOwe;
}
