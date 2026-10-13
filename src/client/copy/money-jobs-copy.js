// The opened money jobs list and the menu a bar part or a job opens
// (money-jobs-detail.js, design.md "Money jobs"). They load with that
// module on the first open or tap, so none of this is in the first screen;
// the folded "3 of 4 money jobs done" line is in en-SG.js.
export const moneyJobsCopy = {
  listLabel: "Money jobs",
  spend: (plan) => (plan ? `Spend within ${plan}` : "Spend within plan"),
  save: (plan) => (plan ? `Save ${plan}` : "Save"),
  invest: (plan) => (plan ? `Invest ${plan}` : "Invest"),
  income: (plan) => (plan ? `Income ${plan}` : "Income"),
  done: (soFar) => (soFar ? "✓ so far" : "✓ done"),
  short: (amount, soFar) => `short by ${amount}${soFar ? " so far" : ""}`,
  over: (amount, soFar) => `over by ${amount}${soFar ? " so far" : ""}`,
  hiddenDone: "✓",
  hiddenPercent: (percent) => `${percent}%`
};

// The menu: the entries behind a part, or a question for Ask to fill in
// (the person sends it).
export const moneyActionsCopy = {
  label: (name) => `${name}: what next`,
  viewEntries: "View entries",
  viewMonthEntries: (monthLabel) => `View ${monthLabel} entries`,
  ask: "Ask about this",
  // The period as a question says it: "in Sep 2026", "from Oct 2025 to Sep 2026".
  inMonth: (monthLabel) => `in ${monthLabel}`,
  inRange: (startLabel, endLabel) => `from ${startLabel} to ${endLabel}`,
  questions: {
    spentOverPlan: (period) => `Why did I spend more than planned ${period}?`,
    spentMost: (period) => `What did I spend the most on ${period}?`,
    spentVsPlan: (period) => `How did my spending compare with the plan ${period}?`,
    spentMore: (period) => `Why did I spend more than I earned ${period}?`,
    spentVsIncome: (period) => `How did my spending compare with my income ${period}?`,
    invested: (period) => `How much did I invest ${period}?`,
    saved: (period) => `How much did I save ${period}?`,
    income: (period) => `How much did I earn ${period}?`
  }
};
