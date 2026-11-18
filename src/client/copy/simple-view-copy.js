// The Simple view's extra parts (simple-detail.js): its facts under the
// savings bar and Summary's "Earned vs spent by month". They load with
// those parts, never in the first screen. Hidden money shows shares only:
// no amount, and no word that says which side of zero a period ended on.
export const simpleViewCopy = {
  earned: "Earned",
  spent: "Spent",
  invested: "Invested",
  kept: "Kept",
  overspent: "Overspent",
  hiddenShare: (percent) => `Spent · ${percent}% of earned`,
  // The month list's fold, worded and drawn as Spending mix's own (a down
  // chevron, turned up while the whole list shows).
  showAll: (count) => `Show all ${count}`,
  showFewer: "Show fewer",
  // The facts under the bar (simple-metrics.js).
  metricsLabel: "This period at a glance",
  dailySpend: (amount, soFar) => `${soFar ? "Daily spend so far" : "Daily spend"} ${amount}`,
  topSpending: "Top spending",
  topCategory: (name, percent) => `${name} ${percent}%`
};
