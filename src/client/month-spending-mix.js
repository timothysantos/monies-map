// Spending Mix for the month picked in the Summary tab (the Month page).
// The tab's month choice drives Spending Mix: All months shows the range
// (the Summary page's categoryShareChart), a picked month shows that month.
//
// The Month page DTO already carries the month's category share
// (monthPage.categoryShareChart, buildDonutChart over the view's entries in
// the scope): the same projection as the Summary page's categoryShareByMonth
// entry for that month (tests/month-spending-mix.test.mjs holds the two
// equal). Reading it from the Month page costs no request, also on a /month
// deep link before the range's Summary page lands, and always matches the
// month, view and scope of the figures beside it.
import { sumDonutValueMinor } from "./donut-visibility";
import { buildSpendChange } from "../domain/summary-spend-change";

export function selectMonthSpendingMix(monthPage) {
  const data = Array.isArray(monthPage?.categoryShareChart) ? monthPage.categoryShareChart : [];
  return {
    month: monthPage?.month ?? "",
    data,
    totalMinor: sumDonutValueMinor(data),
    isEmpty: data.length === 0
  };
}

// The note under the Month's Spending mix total (design.md "Month cards"):
// this month's spending against the month before, read with Summary's own
// rule (buildSpendChange: complete months only, a stored total for the month
// before, a base of at least $100). This month's total is the Month page's;
// the month before is in the range's Summary page, which the Summary tab
// already holds beside the Month page (App.jsx loadSummaryRangeContext), so
// the note costs no request and no payload. The month in progress has no
// note (Summary leaves it out too), and neither does the range's first month
// (the month before it is not loaded). `pending` holds the note's line while
// the range page is still on its way.
/**
 * @param {{ month: string, monthSummary: { month: string, realExpensesMinor: number } | null, rangeMonths: Array<{ month: string, realExpensesMinor: number }> | null | undefined, currentMonth: string }} input
 */
export function selectMonthSpendChange({ month, monthSummary, rangeMonths, currentMonth }) {
  if (!month || month >= currentMonth || !monthSummary) return { spendChange: undefined, pending: false };
  if (!rangeMonths) return { spendChange: undefined, pending: true };
  return { spendChange: buildSpendChange([month], [monthSummary], rangeMonths, currentMonth), pending: false };
}
