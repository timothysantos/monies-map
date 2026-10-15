// The opened money jobs list (money-jobs-detail.js, design.md "Money
// jobs"). It loads with that module on the first open, so none of this is
// in the first screen; the folded "3 of 4 things on track" line is in
// en-SG.js, and the menu a row opens is figure-copy.js.
export const moneyJobsCopy = {
  listLabel: "Where your money goes",
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
