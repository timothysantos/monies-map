import { buildSplitShareState } from "./split-share-state";

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

// These builders mirror dialog state, not storage rows, so edit forms can stay dumb.
export function buildExpenseDraft(item, categoryOptions, people) {
  const shareState = buildSplitShareState({
    totalAmountMinor: item.totalAmountMinor,
    splitBasisPoints: item.editableSplitBasisPoints ?? 5000,
    splitAmountMinor: item.editableSplitAmountMinor ?? Math.round(item.totalAmountMinor / 2),
    splitValueMode: "percent"
  });

  return {
    kind: "expense",
    id: item.id,
    linkedTransactionId: item.linkedTransactionId,
    groupId: item.groupId,
    date: item.date,
    description: item.description,
    categoryName: item.categoryName ?? (categoryOptions[0] ?? "Other"),
    payerPersonName: item.paidByPersonName ?? people[0]?.name ?? "",
    amountMinor: item.totalAmountMinor,
    note: item.note ?? "",
    sharePersonName: item.editableSplitPersonName ?? people[0]?.name ?? "",
    ...shareState
  };
}

export function buildSettlementDraft(item, people) {
  return {
    kind: "settlement",
    id: item.id,
    linkedTransactionId: item.linkedTransactionId,
    groupId: item.groupId,
    date: item.date,
    fromPersonName: item.fromPersonName ?? people[1]?.name ?? "",
    toPersonName: item.toPersonName ?? people[0]?.name ?? "",
    amountMinor: item.totalAmountMinor,
    note: item.note ?? ""
  };
}

export function buildLinkedEntryDraft(entry) {
  return {
    entryId: entry.id,
    date: entry.date,
    description: entry.description,
    accountName: entry.accountName,
    categoryName: entry.categoryName,
    amountMinor: entry.totalAmountMinor ?? entry.amountMinor,
    entryType: entry.entryType,
    transferDirection: entry.transferDirection,
    ownershipType: entry.ownershipType,
    ownerName: entry.ownerName ?? "",
    note: entry.note ?? "",
    splitBasisPoints: entry.viewerSplitRatioBasisPoints ?? entry.splits[0]?.ratioBasisPoints ?? 5000
  };
}

export function buildNewExpenseDraft({ activeGroup, categoryOptions, people, view }) {
  const shareState = buildSplitShareState({
    totalAmountMinor: 0,
    splitBasisPoints: 5000,
    splitValueMode: "percent"
  });

  return {
    groupId: activeGroup?.id ?? "split-group-none",
    date: todayIsoDate(),
    description: "",
    categoryName: categoryOptions[0] ?? "Other",
    payerPersonName: (view.id !== "household"
      ? people.find((person) => person.id === view.id)?.name
      : people[0]?.name) ?? "",
    amountMinor: 0,
    note: "",
    sharePersonName: people[0]?.name ?? "",
    ...shareState
  };
}

export function buildNewSettlementDraft({ activeGroup, groupBalanceMinor, people }) {
  return {
    groupId: activeGroup?.id ?? "split-group-none",
    date: todayIsoDate(),
    fromPersonName: people[1]?.name ?? "",
    toPersonName: people[0]?.name ?? "",
    amountMinor: Math.abs(groupBalanceMinor),
    note: ""
  };
}
