import { incomeMinor } from "../domain/category-offset";

// Month · Simple's "Money in" (design.md "Plan or Simple"): what came in this
// month, one row per source, biggest first. A source is the entry's
// description (case and spacing aside), so three "Salary" entries are one row
// with their total. The entries are the ones the Actual cards count (the
// person's own, in the selected scope: selectMonthInsightEntries); a payback
// filed as income under a spending category is not income (incomeMinor).
export function buildMoneyIn(entries = []) {
  const bySource = new Map();
  for (const entry of entries) {
    const amountMinor = incomeMinor(entry);
    if (amountMinor <= 0) continue;
    const label = String(entry.description ?? "").trim() || entry.categoryName;
    const key = label.toLowerCase().replace(/\s+/g, " ");
    const row = bySource.get(key) ?? { label, categoryName: entry.categoryName, amountMinor: 0, entryIds: [] };
    row.amountMinor += amountMinor;
    row.entryIds.push(entry.id);
    bySource.set(key, row);
  }
  const rows = [...bySource.values()].sort((left, right) => right.amountMinor - left.amountMinor || left.label.localeCompare(right.label));
  return { rows, totalMinor: rows.reduce((sum, row) => sum + row.amountMinor, 0) };
}
