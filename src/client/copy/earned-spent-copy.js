// Summary's "Earned vs spent by month" (summary-earned-spent.jsx), the
// Simple view's month list. It loads with that list, never in the first
// screen. Hidden money shows the share of income spent and no amount, and
// no word that says which side of zero a month ended on.
export const earnedSpentCopy = {
  title: "Earned vs spent by month",
  detail: "What came in and what went out, month by month.",
  earned: "Earned",
  spent: "Spent",
  invested: "Invested",
  kept: "Kept",
  overspent: "Overspent",
  hiddenShare: (percent) => `Spent · ${percent}% of earned`
};
