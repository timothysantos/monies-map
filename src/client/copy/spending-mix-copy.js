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
  showInChart: (name) => `Show ${name} in the chart`
};
