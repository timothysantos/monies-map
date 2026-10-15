// The words of the column + line chart above Summary's month-by-month list
// (earned-spent-chart.js, design.md "Plan or Simple"). The chart is a lazy
// chunk, so none of this is in the first screen. Every figure is written
// with the page's own money() so it follows the money privacy setting (the
// chart itself draws nothing while money is hidden).
export const earnedSpentChartCopy = {
  chartLabel: {
    simple: "Earned, spent and kept, month by month",
    plan: "Earned, spent and planned spending, month by month"
  },
  legendLabel: "Show or hide in the chart",
  series: {
    earned: "Earned",
    spent: "Spent",
    kept: "Kept",
    plan: "Planned spending"
  },
  // What a column or point is called for assistive tech and the quick
  // facts' first line: "Oct 2026 earned $113.30".
  seriesWord: {
    earned: "earned",
    spent: "spent",
    kept: "kept",
    overspent: "overspent",
    plan: "planned spending"
  },
  pointLabel: (monthLabel, word, amount) => `${monthLabel} ${word} ${amount}`,
  // The quick facts under a menu's title, one per line (figure-menu.js).
  percentOfEarned: (percent) => `${percent}% of what came in`,
  wentOut: (amount) => `${amount} went out`,
  keptAmount: (amount) => `${amount} kept`,
  overspentAmount: (amount) => `${amount} overspent`,
  earnedAndSpent: (earned, spent) => `Earned ${earned}, spent ${spent}`,
  planned: (amount) => `${amount} planned`,
  spentAmount: (amount) => `${amount} spent`,
  underPlan: (amount) => `${amount} under plan`,
  overPlan: (amount) => `${amount} over plan`,
  onPlan: "On plan",
  noPlan: "No plan for this month",
  // Axis words.
  axisLabel: "Amount per month, with zero marked"
};
