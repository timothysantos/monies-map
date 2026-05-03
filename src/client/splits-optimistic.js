function sortSplitActivity(items) {
  return [...items].sort((left, right) => right.date.localeCompare(left.date) || right.id.localeCompare(left.id));
}

function resolveGroup(groupId, groupOptions = []) {
  const normalizedGroupId = groupId ?? "split-group-none";
  const matchingGroup = groupOptions.find((group) => group.id === normalizedGroupId);
  return {
    id: normalizedGroupId,
    name: matchingGroup?.name ?? "Non-group expenses"
  };
}

function buildExpenseShares(draft, people = []) {
  const totalAmountMinor = Math.max(0, Number(draft?.amountMinor ?? 0));
  const primaryAmountMinor = Math.min(totalAmountMinor, Math.max(0, Math.round(Number(draft?.splitAmountMinor ?? 0))));
  const primaryBasisPoints = totalAmountMinor > 0
    ? Math.max(0, Math.min(10000, Math.round((primaryAmountMinor / totalAmountMinor) * 10000)))
    : 0;
  const secondaryAmountMinor = totalAmountMinor - primaryAmountMinor;
  const sharePerson = people.find((person) => person.name === draft?.sharePersonName) ?? people[0] ?? null;
  const partnerPerson = people.find((person) => person.id !== sharePerson?.id) ?? people[1] ?? sharePerson;

  return {
    primary: {
      personId: sharePerson?.id ?? "",
      personName: sharePerson?.name ?? draft?.sharePersonName ?? "",
      ratioBasisPoints: primaryBasisPoints,
      amountMinor: primaryAmountMinor
    },
    secondary: {
      personId: partnerPerson?.id ?? "",
      personName: partnerPerson?.name ?? "",
      ratioBasisPoints: 10000 - primaryBasisPoints,
      amountMinor: secondaryAmountMinor
    }
  };
}

function viewerExpenseAmount(viewId, shares, totalAmountMinor) {
  if (viewId === "household") {
    return totalAmountMinor;
  }

  const viewerShareMinor = viewId === shares.primary.personId
    ? shares.primary.amountMinor
    : viewId === shares.secondary.personId
      ? shares.secondary.amountMinor
      : 0;

  if (viewId === shares.primary.personId || viewId === shares.secondary.personId) {
    return viewerShareMinor;
  }

  return 0;
}

function resolvePayer(draft, people = []) {
  const payer = people.find((person) => person.name === draft?.payerPersonName) ?? people[0] ?? null;
  return {
    personId: payer?.id ?? "",
    personName: payer?.name ?? draft?.payerPersonName ?? ""
  };
}

function buildExpenseDirectionLabel(viewId, payerPersonId) {
  if (viewId === "household") {
    return "";
  }

  return payerPersonId === viewId ? "you lent" : "you borrowed";
}

function buildSettlementDirectionLabel(viewId, draft, people = []) {
  const fromPerson = people.find((person) => person.name === draft?.fromPersonName) ?? null;
  const toPerson = people.find((person) => person.name === draft?.toPersonName) ?? null;

  if (viewId === "household") {
    return `${draft?.fromPersonName ?? fromPerson?.name ?? ""} paid ${draft?.toPersonName ?? toPerson?.name ?? ""}`.trim();
  }

  return fromPerson?.id === viewId ? "you paid" : "you received";
}

export function buildOptimisticExpenseActivityItem({
  draft,
  splitExpenseId,
  viewId,
  people = [],
  groupOptions = [],
  existingItem = null
}) {
  const group = resolveGroup(draft?.groupId, groupOptions);
  const shares = buildExpenseShares(draft, people);
  const payer = resolvePayer(draft, people);
  const totalAmountMinor = Math.max(0, Number(draft?.amountMinor ?? 0));
  const viewerAmountMinor = viewId === "household"
    ? totalAmountMinor
    : payer.personId === viewId
      ? totalAmountMinor - viewerExpenseAmount(viewId, shares, totalAmountMinor)
      : viewerExpenseAmount(viewId, shares, totalAmountMinor);

  return {
    id: splitExpenseId ?? draft?.id ?? `optimistic-split-expense-${Date.now()}`,
    kind: "expense",
    groupId: group.id,
    groupName: group.name,
    batchId: existingItem?.batchId,
    batchLabel: existingItem?.batchLabel,
    batchClosedAt: existingItem?.batchClosedAt,
    isArchived: Boolean(existingItem?.batchClosedAt),
    date: draft?.date ?? existingItem?.date ?? "",
    description: draft?.description?.trim() || existingItem?.description || "",
    categoryName: draft?.categoryName ?? existingItem?.categoryName ?? "Other",
    paidByPersonName: payer.personName,
    totalAmountMinor,
    viewerAmountMinor,
    editableSplitPersonName: shares.primary.personName,
    editableSplitBasisPoints: shares.primary.ratioBasisPoints,
    editableSplitAmountMinor: shares.primary.amountMinor,
    viewerDirectionLabel: buildExpenseDirectionLabel(viewId, payer.personId),
    note: draft?.note ?? "",
    linkedTransactionId: draft?.linkedTransactionId ?? existingItem?.linkedTransactionId,
    linkedTransactionDescription: existingItem?.linkedTransactionDescription,
    matched: Boolean(draft?.linkedTransactionId ?? existingItem?.linkedTransactionId),
    isPendingDerived: true
  };
}

export function buildOptimisticSettlementActivityItem({
  draft,
  settlementId,
  viewId,
  people = [],
  groupOptions = [],
  existingItem = null
}) {
  const group = resolveGroup(draft?.groupId, groupOptions);
  const totalAmountMinor = Math.max(0, Number(draft?.amountMinor ?? 0));

  return {
    id: settlementId ?? draft?.id ?? `optimistic-split-settlement-${Date.now()}`,
    kind: "settlement",
    groupId: group.id,
    groupName: group.name,
    batchId: existingItem?.batchId,
    batchLabel: existingItem?.batchLabel,
    batchClosedAt: existingItem?.batchClosedAt,
    isArchived: Boolean(existingItem?.batchClosedAt),
    date: draft?.date ?? existingItem?.date ?? "",
    description: "Settle up",
    fromPersonName: draft?.fromPersonName ?? existingItem?.fromPersonName ?? "",
    toPersonName: draft?.toPersonName ?? existingItem?.toPersonName ?? "",
    totalAmountMinor,
    viewerDirectionLabel: buildSettlementDirectionLabel(viewId, draft, people),
    note: draft?.note ?? "",
    linkedTransactionId: draft?.linkedTransactionId ?? existingItem?.linkedTransactionId,
    linkedTransactionDescription: existingItem?.linkedTransactionDescription,
    matched: Boolean(draft?.linkedTransactionId ?? existingItem?.linkedTransactionId),
    isPendingDerived: true
  };
}

export function upsertOptimisticSplitActivity(activity = [], nextItem) {
  const remainingItems = activity.filter((item) => !(item.kind === nextItem.kind && item.id === nextItem.id));
  return sortSplitActivity([nextItem, ...remainingItems]);
}

export function removeOptimisticSplitActivity(activity = [], target) {
  return activity.filter((item) => !(item.kind === target.kind && item.id === target.id));
}

export function applyOptimisticSplitMatch(page, match) {
  return {
    ...page,
    activity: page.activity.map((item) => (
      item.id === match.splitRecordId && item.kind === match.kind
        ? {
            ...item,
            linkedTransactionId: match.transactionId,
            linkedTransactionDescription: match.transactionDescription,
            matched: true,
            isPendingDerived: true
          }
        : item
    )),
    matches: page.matches.filter((item) => item.id !== match.id)
  };
}
