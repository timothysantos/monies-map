// Spending Mix's words (spending-mix-section.jsx, design.md "Summary
// body"). The section is a lazy chunk, so none of this is in the first
// screen.
export const spendingMixCopy = {
  showAll: (count) => `Show all ${count}`,
  showFewer: "Show fewer",
  hideList: "Hide list",
  showList: "Show list",
  // A slice's quick facts, first in its menu (figure-menu.js data-fig-note).
  sliceAmount: (amount, percent) => `${amount} · ${percent} of spending`,
  sliceShare: (percent) => `${percent} of spending`,
  sliceEntries: (count) => (count === 1 ? "1 entry" : `${count} entries`),
  slicePlan: (spent, planned) => `${spent} of ${planned} planned`,
  sliceMerchants: (names) => `Most at ${names}`,
  sliceLabel: (name, percent) => `${name}, ${percent} of spending`,
  // The Entries list's eye toggle (entries-overview.jsx), pressed while the
  // category's slice is in the donut.
  // The icon-bubble donut (spending-mix-bubbles.jsx): the one bubble the slices
  // after the biggest five share, and the ring's name for assistive tech.
  moreName: (count) => `${count} more categories`,
  shareOfSpending: (percent) => `${percent} of spending`,
  chartLabel: "Spending by category: tap a bubble or a slice to see its amount",
  showInChart: (name) => `Show ${name} in the chart`
};
