import { spendingMinor } from "../domain/category-offset";
import { spendingMixCopy as copy } from "./copy/spending-mix-copy";
import { wholeMoney } from "./money-jobs-model";

const sameName = (left, right) => String(left ?? "").trim().toLowerCase() === String(right ?? "").trim().toLowerCase();

/**
 * The Month page's quick facts for a Spending Mix slice (design.md "Summary
 * body", "Openable figures"), from what the page already holds: the plan for
 * the category (its plan rows' planned total against what was spent) and
 * where most of it went (the two biggest merchants by spending). The entries
 * are the view's own (selectMonthInsightEntries), at the view's amounts.
 * Hidden money: no facts with amounts, so none at all. A change against the
 * previous month is left out: the page does not load that month.
 * @returns {(slice: { label: string, valueMinor: number }, hidden: boolean) => ({ lines: string[], hasPlan: boolean })}
 */
export function buildMonthSliceFacts({ planRows = [], entries = [] }) {
  return (slice, hidden) => {
    const rows = planRows.filter((row) => sameName(row.categoryName, slice.label) && row.label !== "Savings");
    const plannedMinor = rows.reduce((sum, row) => sum + (row.plannedMinor ?? 0), 0);
    const hasPlan = rows.length > 0 && plannedMinor > 0;
    if (hidden) {
      return { lines: [], hasPlan };
    }
    const byMerchant = new Map();
    for (const entry of entries) {
      if (!sameName(entry.categoryName, slice.label)) continue;
      const amount = spendingMinor(entry);
      if (!amount) continue;
      const name = String(entry.description ?? "").trim() || slice.label;
      byMerchant.set(name, (byMerchant.get(name) ?? 0) + amount);
    }
    const top = [...byMerchant.entries()].filter(([, minor]) => minor > 0).sort((left, right) => right[1] - left[1]).slice(0, 2);
    return {
      hasPlan,
      lines: [
        hasPlan ? copy.slicePlan(wholeMoney(slice.valueMinor), wholeMoney(plannedMinor)) : null,
        top.length ? copy.sliceMerchants(top.map(([name, minor]) => `${name} ${wholeMoney(minor)}`).join(", ")) : null
      ].filter(Boolean)
    };
  };
}
