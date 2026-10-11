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

export function selectMonthSpendingMix(monthPage) {
  const data = Array.isArray(monthPage?.categoryShareChart) ? monthPage.categoryShareChart : [];
  return {
    month: monthPage?.month ?? "",
    data,
    totalMinor: sumDonutValueMinor(data),
    isEmpty: data.length === 0
  };
}
