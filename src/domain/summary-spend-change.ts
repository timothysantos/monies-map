// What Summary's Spending Mix compares its total with (design.md "Change
// notes"; docs/money-insights-copy.md "Change notes"): the range's spending
// against the same number of months straight before it. Both sides are the
// stored month totals of the view, already loaded for the page, so this costs
// no read. It reports what happened and never estimates:
//
// - only complete months count, so a range that ends in the month in
//   progress leaves that month out of both sides (`partial`);
// - the earlier months must all have a stored total and be contiguous with
//   the range, or there is no comparison (not enough history);
// - an earlier total under $100 is too small a base for a percentage.
import type { SummaryMonthDto, SummarySpendChangeDto } from "../types/dto";
import { addMonths } from "./money-signals/format";

export const SPEND_CHANGE_MIN_BASE_MINOR = 10_000;

export function buildSpendChange(
  rangeMonths: string[],
  pageMonths: Array<Pick<SummaryMonthDto, "month" | "realExpensesMinor">>,
  storedMonths: Array<Pick<SummaryMonthDto, "month" | "realExpensesMinor">>,
  currentMonth: string
): SummarySpendChangeDto | undefined {
  const complete = rangeMonths.filter((month) => month < currentMonth);
  if (!complete.length) return undefined;
  // The complete months must run one after another from the range's start.
  if (complete.some((month, index) => month !== addMonths(complete[0], index))) return undefined;
  const pageByMonth = new Map(pageMonths.map((month) => [month.month, month.realExpensesMinor]));
  const storedByMonth = new Map(storedMonths.map((month) => [month.month, month.realExpensesMinor]));
  const count = complete.length;
  let currentMinor = 0;
  for (const month of complete) {
    const spent = pageByMonth.get(month);
    if (spent === undefined) return undefined;
    currentMinor += spent;
  }
  let previousMinor = 0;
  for (let back = 1; back <= count; back += 1) {
    const spent = storedByMonth.get(addMonths(complete[0], -back));
    if (spent === undefined) return undefined;
    previousMinor += spent;
  }
  if (previousMinor < SPEND_CHANGE_MIN_BASE_MINOR) return undefined;
  return { months: count, currentMinor, previousMinor, partial: count < rangeMonths.length };
}
