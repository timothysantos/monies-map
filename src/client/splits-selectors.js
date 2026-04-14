import { getCategoryTheme } from "./category-utils";
import { messages } from "./copy/en-SG";
import {
  groupSplitActivityByBatch,
  groupSplitActivityByDate
} from "./split-helpers";

export function buildSplitsPanelModel({
  view,
  categories,
  selectedGroupId,
  dismissedMatchIds,
  archiveBatchId
}) {
  const groups = view.splitsPage.groups;
  const groupOptions = [{ id: "split-group-none", name: messages.splits.nonGroup }, ...groups.filter((group) => group.id !== "split-group-none")];
  const defaultGroupId = groups.find((group) => group.isDefault)?.id ?? "split-group-none";
  const activeGroup = groups.find((group) => group.id === selectedGroupId) ?? groups[0] ?? null;
  const activeGroupId = activeGroup?.id ?? "split-group-none";
  const visibleActivity = view.splitsPage.activity.filter((item) => item.groupId === activeGroupId);
  const currentActivity = visibleActivity.filter((item) => !item.isArchived);
  const archivedActivity = visibleActivity.filter((item) => item.isArchived);
  const groupedCurrentActivity = groupSplitActivityByDate(currentActivity);
  const archivedBatches = groupSplitActivityByBatch(archivedActivity);
  const selectedArchivedBatch = archiveBatchId
    ? archivedBatches.find((batch) => batch.batchId === archiveBatchId) ?? null
    : null;
  const visibleMatches = view.splitsPage.matches.filter((item) => (
    item.groupId === activeGroupId && !dismissedMatchIds.includes(item.id)
  ));
  const pendingMatches = view.splitsPage.matches.filter((item) => !dismissedMatchIds.includes(item.id));
  const groupBalanceMinor = activeGroup?.balanceMinor ?? 0;

  return {
    activeGroup,
    archivedBatches,
    categoryOptions: getCategoryOptions(categories),
    defaultGroupId,
    donutRows: buildDonutRows(view.splitsPage.donutChart, categories),
    expenseMatchCount: pendingMatches.filter((item) => item.kind === "expense").length,
    groupBalanceMinor,
    groupedCurrentActivity,
    groups,
    groupOptions,
    groupSummaryLabel: getGroupSummaryLabel(groupBalanceMinor),
    linkedEntriesById: new Map(view.monthPage.entries.map((entry) => [entry.id, entry])),
    pendingMatchCount: pendingMatches.length,
    selectedArchivedBatch,
    settlementMatchCount: pendingMatches.filter((item) => item.kind === "settlement").length,
    totalExpenseMinor: currentActivity
      .filter((item) => item.kind === "expense")
      .reduce((sum, item) => sum + item.totalAmountMinor, 0),
    visibleMatches
  };
}

function getCategoryOptions(categories) {
  return categories
    .slice()
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name))
    .map((category) => category.name);
}

function buildDonutRows(donutChart, categories) {
  return donutChart.map((item, index) => ({
    ...item,
    theme: getCategoryTheme(categories, { categoryName: item.label }, index)
  }));
}

function getGroupSummaryLabel(groupBalanceMinor) {
  if (groupBalanceMinor === 0) {
    return messages.splits.settledUp;
  }
  return groupBalanceMinor > 0 ? messages.splits.youAreOwed : messages.splits.youOwe;
}
