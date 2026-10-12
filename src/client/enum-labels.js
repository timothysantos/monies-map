// The words for values the app stores as codes (credit_card, transfer,
// restored). Screens show these labels, never the code: a person reads
// "Credit card", not credit_card. tests/raw-enum-guard.test.mjs fails when a
// screen puts one of these fields straight into visible text.

export const ACCOUNT_KIND_LABELS = {
  bank: "Bank",
  credit_card: "Credit card",
  loan: "Loan",
  cash: "Cash",
  investment: "Investment"
};

export const ENTRY_TYPE_LABELS = {
  expense: "Expense",
  income: "Income",
  transfer: "Transfer"
};

export const SPLIT_HISTORY_ACTION_LABELS = {
  created: "Created",
  updated: "Updated",
  deleted: "Deleted",
  restored: "Restored"
};

/**
 * A code with no label yet, spelled out as words ("future_kind" becomes
 * "Future kind") so it never shows raw.
 * @param {unknown} value
 */
export function humanizeEnum(value) {
  const words = String(value ?? "").replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
}

function labelFrom(labels, value) {
  return Object.hasOwn(labels, value) ? labels[value] : humanizeEnum(value);
}

/** @param {unknown} kind */
export function accountKindLabel(kind) {
  return labelFrom(ACCOUNT_KIND_LABELS, kind);
}

/** @param {unknown} entryType */
export function entryTypeLabel(entryType) {
  return labelFrom(ENTRY_TYPE_LABELS, entryType);
}

/** @param {unknown} action */
export function splitHistoryActionLabel(action) {
  return labelFrom(SPLIT_HISTORY_ACTION_LABELS, action);
}
