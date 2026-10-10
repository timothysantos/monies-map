// Entries page money totals and the per-category breakdown. Kept free of
// the client service so the arithmetic can be tested on its own.
import { incomeMinor, offsetsCategory } from "../domain/category-offset";

export function getEntryTotals(entries) {
  return entries.reduce((totals, entry) => {
    const visibleAmountMinor = entry.visibleAmountMinor ?? entry.amountMinor;
    const grossAmountMinor = entry.grossAmountMinor ?? entry.totalAmountMinor ?? entry.amountMinor;

    // Entries keeps income/expense/transfer math separate so the page can show
    // both net cash flow and total money moved out. A payback lowers spending
    // instead of adding to income (category-offset.ts).
    if (offsetsCategory(entry)) {
      totals.spendMinor -= visibleAmountMinor;
      totals.grossSpendMinor -= grossAmountMinor;
    } else if (entry.entryType === "income") {
      totals.incomeMinor += incomeMinor(entry, visibleAmountMinor);
    } else if (entry.entryType === "expense") {
      totals.spendMinor += visibleAmountMinor;
      totals.grossSpendMinor += grossAmountMinor;
    } else if (entry.entryType === "transfer" && entry.transferDirection === "out") {
      totals.transferOutMinor += visibleAmountMinor;
      totals.grossTransferOutMinor += grossAmountMinor;
    } else if (entry.entryType === "transfer" && entry.transferDirection === "in") {
      totals.transferInMinor += visibleAmountMinor;
    }

    return totals;
  }, {
    incomeMinor: 0,
    spendMinor: 0,
    grossSpendMinor: 0,
    transferInMinor: 0,
    transferOutMinor: 0,
    grossTransferOutMinor: 0
  });
}

export function getExpenseBreakdown(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    const isPayback = offsetsCategory(entry);
    if (entry.entryType !== "expense" && !isPayback) {
      continue;
    }
    const key = entry.categoryName;
    const current = grouped.get(key) ?? {
      key,
      label: key,
      categoryName: key,
      valueMinor: 0,
      entryCount: 0
    };
    const amountMinor = entry.visibleAmountMinor ?? entry.amountMinor;
    current.valueMinor += isPayback ? -amountMinor : amountMinor;
    current.entryCount += 1;
    grouped.set(key, current);
  }

  return Array.from(grouped.values())
    .filter((item) => item.valueMinor > 0)
    .sort((left, right) => right.valueMinor - left.valueMinor);
}
