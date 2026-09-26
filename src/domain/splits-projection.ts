// Splits projection (H15e): the Splits page DTO for a person or the
// household, with balances, activity, matches and direction labels.

import { buildDonutChart } from "./donut-chart-projection";
import { formatCurrencyMinor } from "./split-currency";
import type { SplitActivityHistoryDto } from "../types/dto";
import type {
  CategoryDto,
  SplitActivityDto,
  SplitExpenseDto,
  SplitGroupDto,
  SplitGroupPillDto,
  SplitMatchCandidateDto,
  SplitSettlementDto,
  SplitSettlementCheckpointDto
} from "../types/dto";

export function buildSplitsPage(
  viewId: string,
  splitGroups: SplitGroupDto[],
  splitExpenses: SplitExpenseDto[],
  splitSettlements: SplitSettlementDto[],
  splitMatches: SplitMatchCandidateDto[],
  categories: CategoryDto[],
  selectedMonth: string,
  personNameById: Record<string, string>,
  settlementCheckpoints: SplitSettlementCheckpointDto[] = [],
  activityHistory: SplitActivityHistoryDto[] = []
) {
  const visibleExpenses = splitExpenses.filter((expense) => splitExpenseMatchesView(expense, viewId));
  const visibleSettlements = splitSettlements.filter((settlement) => splitSettlementMatchesView(settlement, viewId));
  const checkpointByRecordId = new Map(
    settlementCheckpoints
      .filter((checkpoint) => !["reopened", "voided"].includes(checkpoint.status))
      .flatMap((checkpoint) => (checkpoint.includedRecordIds ?? []).map((recordId) => [recordId, checkpoint] as const))
  );
  const checkpointedExpenses = visibleExpenses.map((expense) => ({ ...expense, settlementCheckpoint: checkpointByRecordId.get(expense.id) }));
  const checkpointedSettlements = visibleSettlements.map((settlement) => ({ ...settlement, settlementCheckpoint: checkpointByRecordId.get(settlement.id) }));
  const openExpenses = checkpointedExpenses.filter((expense) => !expense.batchClosedAt && !expense.settlementCheckpoint);
  const openSettlements = checkpointedSettlements.filter((settlement) => !settlement.batchClosedAt && !settlement.settlementCheckpoint);
  const groupMap = new Map<string, { id: string; name: string; iconKey?: string; sortOrder?: number; balanceMinor: number; entryCount: number; pendingMatchCount: number; currency: string; expenseSource: SplitGroupDto["expenseSource"] }>();

  groupMap.set("split-group-none", {
    id: "split-group-none",
    name: "Non-group expenses",
    iconKey: "receipt",
    sortOrder: -1,
    balanceMinor: 0,
    entryCount: 0,
    pendingMatchCount: 0
    ,currency: "SGD",
    expenseSource: "mixed"
  });

  // Persisted groups must exist in the UI even before their first split entry.
  for (const group of splitGroups) {
    groupMap.set(group.id, {
      id: group.id,
      name: group.name,
      iconKey: group.iconKey ?? "receipt",
      sortOrder: group.sortOrder,
      balanceMinor: 0,
      entryCount: 0,
      pendingMatchCount: 0,
      currency: group.currency,
      expenseSource: group.expenseSource
    });
  }

  for (const expense of visibleExpenses) {
    const groupId = expense.groupId ?? "split-group-none";
    const current = groupMap.get(groupId) ?? {
      id: groupId,
      name: expense.groupName,
      iconKey: iconKeyForCategory(expense.categoryName, categories),
      sortOrder: Number.MAX_SAFE_INTEGER,
      balanceMinor: 0,
      entryCount: 0,
      pendingMatchCount: 0,
      currency: expense.currency,
      expenseSource: "mixed"
    };
    groupMap.set(groupId, current);
  }

  for (const settlement of visibleSettlements) {
    const groupId = settlement.groupId ?? "split-group-none";
    const current = groupMap.get(groupId) ?? {
      id: groupId,
      name: settlement.groupName,
      iconKey: "arrow-right-left",
      sortOrder: Number.MAX_SAFE_INTEGER,
      balanceMinor: 0,
      entryCount: 0,
      pendingMatchCount: 0,
      currency: settlement.currency,
      expenseSource: "mixed"
    };
    groupMap.set(groupId, current);
  }

  for (const expense of openExpenses) {
    const groupId = expense.groupId ?? "split-group-none";
    const current = groupMap.get(groupId);
    if (!current) {
      continue;
    }
    current.balanceMinor += splitExpenseBalanceForView(expense, viewId);
    current.entryCount += 1;
  }

  for (const settlement of openSettlements) {
    const groupId = settlement.groupId ?? "split-group-none";
    const current = groupMap.get(groupId);
    if (!current) {
      continue;
    }
    current.balanceMinor -= splitSettlementBalanceForView(settlement, viewId);
    current.entryCount += 1;
  }

  for (const match of splitMatches.filter((item) => splitMatchMatchesView(item, visibleExpenses, visibleSettlements, viewId))) {
    const current = groupMap.get(match.groupId) ?? {
      id: match.groupId,
      name: match.groupName,
      iconKey: "receipt",
      sortOrder: Number.MAX_SAFE_INTEGER,
      balanceMinor: 0,
      entryCount: 0,
      pendingMatchCount: 0,
      currency: "SGD",
      expenseSource: "mixed"
    };
    current.pendingMatchCount += 1;
    groupMap.set(match.groupId, current);
  }

  const groups: SplitGroupPillDto[] = [...groupMap.values()]
    .sort((left, right) => {
      if (left.id === "split-group-none") {
        return -1;
      }
      if (right.id === "split-group-none") {
        return 1;
      }
      return Math.abs(right.balanceMinor) - Math.abs(left.balanceMinor)
        || (left.sortOrder ?? 0) - (right.sortOrder ?? 0)
        || left.name.localeCompare(right.name);
    })
    .map((group) => ({
      id: group.id,
      name: group.name,
      iconKey: group.iconKey,
      balanceMinor: group.balanceMinor,
      summaryText: formatSplitBalanceSummary(group.balanceMinor, group.currency, viewId, personNameById),
      entryCount: group.entryCount,
      pendingMatchCount: group.pendingMatchCount,
      currency: group.currency,
      expenseSource: group.expenseSource,
      isDefault: false
    }));

  const nonGroup = groups.find((group) => group.id === "split-group-none");
  const defaultGroupId = (nonGroup && nonGroup.entryCount > 0 ? nonGroup.id : undefined)
    ?? groups.find((group) => group.id !== "split-group-none" && group.entryCount > 0 && group.balanceMinor !== 0)?.id
    ?? groups.find((group) => group.id !== "split-group-none" && group.entryCount > 0)?.id
    ?? groups.find((group) => group.id !== "split-group-none" && group.pendingMatchCount > 0)?.id
    ?? groups.find((group) => group.id !== "split-group-none")?.id
    ?? (nonGroup && (nonGroup.entryCount > 0 || nonGroup.pendingMatchCount > 0) ? nonGroup.id : undefined)
    ?? "split-group-none";

  const activity: SplitActivityDto[] = buildSplitActivity(viewId, checkpointedExpenses, checkpointedSettlements, personNameById);
  const donutChart = buildDonutChart(
    openExpenses.map((expense) => ({
      id: expense.id,
      date: expense.date,
      description: expense.description,
      accountName: expense.groupName,
      categoryName: expense.categoryName,
      entryType: "expense",
      ownershipType: "shared",
      amountMinor: viewerExpenseAmountForChart(expense, viewId),
      offsetsCategory: false,
      splits: expense.shares
    })),
    categories
  );

  return {
    month: selectedMonth,
    groups: groups.map((group) => ({ ...group, isDefault: group.id === defaultGroupId })),
    activity,
    matches: splitMatches.filter((item) => splitMatchMatchesView(item, visibleExpenses, visibleSettlements, viewId)),
    donutChart,
    settlementCheckpoints,
    activityHistory
  };
}

function splitExpenseMatchesView(expense: SplitExpenseDto, viewId: string) {
  if (viewId === "household") {
    return true;
  }

  return expense.shares.some((share) => share.personId === viewId);
}

function splitSettlementMatchesView(settlement: SplitSettlementDto, viewId: string) {
  if (viewId === "household") {
    return true;
  }

  return settlement.fromPersonId === viewId || settlement.toPersonId === viewId;
}

function splitMatchMatchesView(
  match: SplitMatchCandidateDto,
  expenses: Array<SplitExpenseDto & { settlementCheckpoint?: SplitSettlementCheckpointDto }>,
  settlements: Array<SplitSettlementDto & { settlementCheckpoint?: SplitSettlementCheckpointDto }>,
  viewId: string
) {
  if (viewId === "household") {
    return true;
  }

  if (match.kind === "expense") {
    const expense = expenses.find((item) => item.id === match.splitRecordId);
    return expense ? splitExpenseMatchesView(expense, viewId) : false;
  }

  const settlement = settlements.find((item) => item.id === match.splitRecordId);
  return settlement ? splitSettlementMatchesView(settlement, viewId) : false;
}

function splitExpenseBalanceForView(expense: SplitExpenseDto, viewId: string) {
  const [primaryShare, partnerShare] = expense.shares;
  const primaryShareMinor = primaryShare?.amountMinor ?? 0;
  const partnerShareMinor = partnerShare?.amountMinor ?? 0;
  const primaryPersonId = primaryShare?.personId ?? "";
  const partnerPersonId = partnerShare?.personId ?? "";
  const balanceFromPrimaryPerspective = expense.payerPersonId === primaryPersonId ? partnerShareMinor : -primaryShareMinor;
  if (viewId === partnerPersonId) {
    return -balanceFromPrimaryPerspective;
  }
  return balanceFromPrimaryPerspective;
}

function splitSettlementBalanceForView(settlement: SplitSettlementDto, viewId: string) {
  if (viewId === settlement.toPersonId) {
    return settlement.amountMinor;
  }

  if (viewId === settlement.fromPersonId) {
    return -settlement.amountMinor;
  }

  return settlement.amountMinor;
}

// The balance is in the group's own currency (a JPY trip reads "You owe
// Joyce JP¥6,000"); it is never converted to SGD.
function formatSplitBalanceSummary(balanceMinor: number, currency: string, viewId: string, personNameById: Record<string, string>) {
  if (balanceMinor === 0) {
    return "Settled up";
  }

  const abs = formatCurrencyMinor(Math.abs(balanceMinor), currency);
  if (viewId === "household") {
    return `Net balance ${abs}`;
  }

  const [primaryPersonId, partnerPersonId] = getOrderedPersonIds(personNameById);
  const primaryName = personNameById[primaryPersonId] ?? "Primary";
  const secondaryName = personNameById[partnerPersonId] ?? "Partner";
  if (viewId === primaryPersonId) {
    return balanceMinor > 0 ? `${secondaryName} owes you ${abs}` : `You owe ${secondaryName} ${abs}`;
  }

  if (viewId === partnerPersonId) {
    return balanceMinor > 0 ? `${primaryName} owes you ${abs}` : `You owe ${primaryName} ${abs}`;
  }

  return balanceMinor > 0 ? `${secondaryName} owes ${primaryName} ${abs}` : `${primaryName} owes ${secondaryName} ${abs}`;
}

function getOrderedPersonIds(personNameById: Record<string, string>) {
  const personIds = Object.keys(personNameById);
  return [personIds[0] ?? "person-primary", personIds[1] ?? "person-partner"];
}

function buildSplitActivity(
  viewId: string,
  expenses: Array<SplitExpenseDto & { settlementCheckpoint?: SplitSettlementCheckpointDto }>,
  settlements: Array<SplitSettlementDto & { settlementCheckpoint?: SplitSettlementCheckpointDto }>,
  personNameById: Record<string, string>
): SplitActivityDto[] {
  const activity: SplitActivityDto[] = [];

  for (const expense of expenses) {
    const viewerShare = viewerExpenseAmountForChart(expense, viewId);
    const editableShare = canonicalEditableExpenseShare(expense, personNameById);
    activity.push({
      id: expense.id,
      kind: "expense",
      groupId: expense.groupId ?? "split-group-none",
      groupName: expense.groupName,
      batchId: expense.batchId,
      batchLabel: expense.batchLabel,
      batchClosedAt: expense.batchClosedAt,
      isArchived: Boolean(expense.batchClosedAt),
      date: expense.date,
      description: expense.description,
      categoryName: expense.categoryName,
      paidByPersonName: expense.payerPersonName,
      totalAmountMinor: expense.totalAmountMinor,
      shares: expense.shares,
      viewerAmountMinor: viewerShare,
      editableSplitPersonName: editableShare?.personName,
      editableSplitBasisPoints: editableShare?.ratioBasisPoints,
      editableSplitAmountMinor: editableShare?.amountMinor,
      viewerDirectionLabel: formatExpenseDirectionLabel(expense, viewId, personNameById),
      note: expense.note,
      linkedTransactionId: expense.linkedTransactionId,
      linkedTransactionDescription: expense.linkedTransactionDescription,
      linkedTransactionNote: expense.linkedTransactionNote,
      matched: Boolean(expense.linkedTransactionId),
      settlementCheckpointId: expense.settlementCheckpoint?.id,
      settlementCheckpointStatus: expense.settlementCheckpoint?.status,
      settlementStatus: expense.settlementCheckpoint ? "settled" : expense.batchClosedAt ? "settled" : "open"
      ,currency: expense.currency
      ,homeAmountMinor: expense.homeAmountMinor
      ,fxRateBasisPoints: expense.fxRateBasisPoints
      ,paymentMethod: expense.paymentMethod
      ,paymentStatus: expense.paymentStatus
    });
  }

  for (const settlement of settlements) {
    activity.push({
      id: settlement.id,
      kind: "settlement",
      groupId: settlement.groupId ?? "split-group-none",
      groupName: settlement.groupName,
      batchId: settlement.batchId,
      batchLabel: settlement.batchLabel,
      batchClosedAt: settlement.batchClosedAt,
      isArchived: Boolean(settlement.batchClosedAt),
      date: settlement.date,
      description: "Settle up",
      fromPersonName: settlement.fromPersonName,
      toPersonName: settlement.toPersonName,
      totalAmountMinor: settlement.amountMinor,
      viewerDirectionLabel: formatSettlementDirectionLabel(settlement, viewId),
      note: settlement.note,
      linkedTransactionId: settlement.linkedTransactionId,
      linkedTransactionDescription: settlement.linkedTransactionDescription,
      linkedTransactionNote: settlement.linkedTransactionNote,
      matched: Boolean(settlement.linkedTransactionId),
      settlementCheckpointId: settlement.settlementCheckpoint?.id,
      settlementCheckpointStatus: settlement.settlementCheckpoint?.status,
      settlementStatus: settlement.settlementCheckpoint ? "settled" : settlement.batchClosedAt ? "settled" : "open"
      ,currency: settlement.currency
      ,fxRateBasisPoints: settlement.fxRateBasisPoints
      ,paymentMethod: settlement.paymentMethod
      ,paymentStatus: settlement.paymentStatus
    });
  }

  return activity.sort((left, right) => right.date.localeCompare(left.date) || right.id.localeCompare(left.id));
}

function viewerExpenseAmountForChart(expense: SplitExpenseDto, viewId: string) {
  if (viewId === "household") {
    return expense.totalAmountMinor;
  }

  const viewerShare = expense.shares.find((share) => share.personId === viewId)?.amountMinor ?? 0;
  if (expense.payerPersonId === viewId) {
    return expense.totalAmountMinor - viewerShare;
  }

  return viewerShare;
}

function canonicalEditableExpenseShare(expense: SplitExpenseDto, personNameById: Record<string, string>) {
  const [primaryPersonId] = getOrderedPersonIds(personNameById);
  return expense.shares.find((share) => share.personId === primaryPersonId) ?? expense.shares[0];
}

function formatExpenseDirectionLabel(expense: SplitExpenseDto, viewId: string, personNameById: Record<string, string>) {
  if (viewId === "household") {
    return "";
  }

  if (expense.payerPersonId === viewId) {
    return "you lent";
  }

  return "you borrowed";
}

function formatSettlementDirectionLabel(settlement: SplitSettlementDto, viewId: string) {
  if (viewId === "household") {
    return `${settlement.fromPersonName} paid ${settlement.toPersonName}`;
  }

  if (settlement.fromPersonId === viewId) {
    return "you paid";
  }

  return "you received";
}

function iconKeyForCategory(categoryName: string, categories: CategoryDto[]) {
  return categories.find((category) => category.name === categoryName)?.iconKey ?? "receipt";
}
