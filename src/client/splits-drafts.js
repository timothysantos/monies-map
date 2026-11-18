import { buildSplitShareState } from "./split-share-state";
import { todayInAppTimeZone } from "./app-dates";

// These builders mirror dialog state, not storage rows, so edit forms can stay dumb.
export function buildExpenseDraft(item, categoryOptions, people) {
  const shareState = buildSplitShareState({
    totalAmountMinor: item.totalAmountMinor,
    splitBasisPoints: item.editableSplitBasisPoints ?? 5000,
    splitAmountMinor: item.editableSplitAmountMinor ?? Math.floor(item.totalAmountMinor / 2),
    splitValueMode: item.editableSplitAmountMinor == null ? "percent" : "amount"
  });

  return {
    kind: "expense",
    id: item.id,
    linkedTransactionId: item.linkedTransactionId,
    linkedTransactionNote: item.linkedTransactionNote ?? "",
    linkedTransactionCategoryName: item.linkedTransactionCategoryName ?? "",
    groupId: item.groupId,
    currency: item.currency ?? "SGD",
    date: item.date,
    description: item.description,
    categoryName: item.categoryName ?? (categoryOptions[0] ?? "Other"),
    payerPersonName: item.paidByPersonName ?? people[0]?.name ?? "",
    amountMinor: item.totalAmountMinor,
    note: item.note ?? "",
    paymentMethod: item.paymentMethod ?? "cash",
    paymentStatus: item.paymentStatus ?? "recorded",
    originalNote: item.note ?? "",
    sharePersonName: item.editableSplitPersonName ?? people[0]?.name ?? "",
    ...shareState
  };
}

export function buildSettlementDraft(item, people) {
  return {
    kind: "settlement",
    id: item.id,
    linkedTransactionId: item.linkedTransactionId,
    linkedTransactionNote: item.linkedTransactionNote ?? "",
    groupId: item.groupId,
    currency: item.currency ?? "SGD",
    date: item.date,
    fromPersonName: item.fromPersonName ?? people[1]?.name ?? "",
    toPersonName: item.toPersonName ?? people[0]?.name ?? "",
    amountMinor: item.totalAmountMinor,
    note: item.note ?? "",
    paymentMethod: item.paymentMethod ?? "cash",
    paymentStatus: item.paymentStatus ?? "recorded",
    originalNote: item.note ?? ""
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
    ownershipType: "direct",
    ownerName: entry.ownerName ?? "",
    note: entry.note ?? "",
    splitBasisPoints: entry.viewerSplitRatioBasisPoints ?? entry.linkedSplitShares?.[0]?.ratioBasisPoints ?? 5000
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
    currency: activeGroup?.currency ?? "SGD",
    date: todayInAppTimeZone(),
    description: "",
    categoryName: categoryOptions[0] ?? "Other",
    payerPersonName: (view.id !== "household"
      ? people.find((person) => person.id === view.id)?.name
      : people[0]?.name) ?? "",
    amountMinor: 0,
    note: "",
    paymentMethod: activeGroup?.expenseSource === "ledger" ? "card" : "cash",
    paymentStatus: "recorded",
    sharePersonName: people[0]?.name ?? "",
    ...shareState
  };
}

// Settle group pays off the group's balance: the one who owes pays the one
// owed. `groupBalanceMinor` is the viewer's (positive: owed to them); the
// household view reads the first person's side. A payment the wrong way
// round would double what is owed, and a payment only settles the group at
// zero (DOMAIN.md "Split Settlement").
export function buildNewSettlementDraft({ activeGroup, groupBalanceMinor, people, viewId = "" }) {
  const viewer = people.find((person) => person.id === viewId) ?? people[0];
  const other = people.find((person) => person !== viewer && person.id !== viewer?.id);
  const viewerOwes = groupBalanceMinor < 0;
  return {
    groupId: activeGroup?.id ?? "split-group-none",
    currency: activeGroup?.currency ?? "SGD",
    date: todayInAppTimeZone(),
    fromPersonName: (viewerOwes ? viewer?.name : other?.name) ?? "",
    toPersonName: (viewerOwes ? other?.name : viewer?.name) ?? "",
    amountMinor: Math.abs(groupBalanceMinor),
    note: "",
    paymentMethod: "cash",
    paymentStatus: "recorded"
  };
}
