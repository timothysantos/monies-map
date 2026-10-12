import { messages } from "./copy/en-SG";
import { ACCOUNT_KIND_OPTIONS } from "./ui-options";

const ACCOUNT_KIND_LABELS = Object.fromEntries(ACCOUNT_KIND_OPTIONS.map((option) => [option.value, option.label]));

// "Citibank · Credit card · Ethan": the account kind in words, never the
// stored value (credit_card).
export function describeAccountLine(account) {
  return messages.common.triplet(account.institution, ACCOUNT_KIND_LABELS[account.kind] ?? account.kind, account.ownerLabel);
}
