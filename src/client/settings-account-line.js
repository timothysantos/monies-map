import { messages } from "./copy/en-SG";
import { accountKindLabel } from "./enum-labels";

// "Citibank · Credit card · Ethan": the account kind in words, never the
// stored value (credit_card).
export function describeAccountLine(account) {
  return messages.common.triplet(account.institution, accountKindLabel(account.kind), account.ownerLabel);
}
