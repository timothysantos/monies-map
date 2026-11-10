// Words for Summary's "What changed this month" card (DOMAIN.md "What Changed
// Card"), built on the owner's go-ahead of 10 Nov 2026 and logged for review.
// Loaded with the card's lazy chunk, never in the first screen. With money
// hidden the card says no amount and no direction (up or down).

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthName = (month) => MONTHS[Number(String(month).slice(5, 7)) - 1] ?? "";

export const summaryChangedCopy = {
  title: "What changed this month",
  // "November so far, against the same days of October."
  intro: (month, baseMonth) => `${monthName(month)} so far, against the same days of ${monthName(baseMonth)}.`,
  quiet: "Nothing has moved much so far this month.",
  up: "up",
  down: "down",
  moreThanUsual: "more than usual",
  // "$520 so far" and "$280 at this point last month".
  soFar: "so far",
  lastMonth: "at this point last month",
  shopsBehind: "Shops behind it",
  openRow: (name) => `${name}: shops behind the change`,
  showAll: (count) => `Show all ${count} ›`
};
