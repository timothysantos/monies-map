// Category offset (DOMAIN.md "Category offset"): money in under a spending
// category, such as a refund or a friend paying back their share of a court
// booking, corrects what was spent in that category. It lowers that
// category's spending and is not counted as income, so net is unchanged.
//
// The category decides. Income categories (Salary, Extra Income, anything
// named "... Income"), money that is not spending (Transfer, Savings,
// Investments, Loans) and the uncategorised "Other" never offset: money in
// there is income. The stored transactions.offsets_category switch is no
// longer read.

const NOT_SPENDING = new Set(["transfer", "savings", "investments", "loans", "other"]);

type OffsetEntry = { entryType: string; categoryName?: string | null };

export function isSpendingCategoryName(name?: string | null) {
  const normalized = String(name ?? "").trim().toLowerCase();
  return Boolean(normalized) && !NOT_SPENDING.has(normalized) && !/\bincome\b/.test(normalized) && normalized !== "salary";
}

export function offsetsCategory(entry: OffsetEntry) {
  return entry.entryType === "income" && isSpendingCategoryName(entry.categoryName);
}

// What an entry adds to spending: an expense adds, a payback takes away.
// Pass a person's share as amountMinor; it defaults to the whole entry.
export function spendingMinor(entry: OffsetEntry & { amountMinor: number }, amountMinor = entry.amountMinor) {
  if (entry.entryType === "expense") {
    return amountMinor;
  }
  return offsetsCategory(entry) ? -amountMinor : 0;
}

// What an entry adds to income: money in that is not a payback.
export function incomeMinor(entry: OffsetEntry & { amountMinor: number }, amountMinor = entry.amountMinor) {
  return entry.entryType === "income" && !offsetsCategory(entry) ? amountMinor : 0;
}
