// The check before a money answer (docs/flows/ask-flow.md "Money
// questions"): which way a skew candidate (DOMAIN.md "Skew Candidate")
// skews the figures now, and the words for its two chips and the notes
// after them. Pure, so the chip row and its tests read it without the card.

import { askCopy } from "./copy/ask-copy";

/** @returns {"spending" | "income" | "both"} */
export function skewCountedKind(candidate) {
  const { spendingMinor = 0, incomeMinor = 0 } = candidate?.skew ?? {};
  if (spendingMinor && incomeMinor) return "both";
  return spendingMinor ? "spending" : "income";
}

export function skewCheckLabels(candidate) {
  const counted = skewCountedKind(candidate);
  const settlement = candidate?.kind === "settlement";
  return {
    resolve: settlement ? askCopy.money.check.markSettlement : askCopy.money.check.linkTransfer,
    keep: counted === "income" ? askCopy.money.check.realIncome : askCopy.money.check.realSpending,
    resolved: settlement ? askCopy.money.check.marked : askCopy.money.check.linked,
    kept: counted === "income" ? askCopy.money.check.keptIncome : askCopy.money.check.keptSpending
  };
}
