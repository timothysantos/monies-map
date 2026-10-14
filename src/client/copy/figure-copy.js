// Words for openable figures (design.md "Openable figures"): the small menu
// a figure opens (figure-menu.js) and the Entries top when it shows the
// money behind one figure (entry_figure). Loaded with the Entries route and
// the menu's lazy chunk, never in the first screen.

// A figure's short name, as the Entries lead and the menu say it.
const names = {
  spending: "Spent",
  invested: "Invested",
  kept: "Kept",
  earned: "Earned",
  from_savings: "From savings",
  took_out: "Took out of investments",
  spent: "Spent",
  expenses: "Spent",
  transfers: "Transfers",
  outflow: "Outflow",
  difference: "Difference",
  plan: "Plan",
  splits: "Splits"
};

export const figureCopy = {
  names,
  // The Entries lead: "Invested · Jun 2025 – May 2026".
  eyebrow: (figure, periodLabel) => `${names[figure] ?? names.spent} · ${periodLabel}`,
  // The chip on Entries that says the list is narrowed to one figure or a
  // period of months; ✕ goes back to the month's whole list.
  chipLabel: (parts) => parts.join(" · "),
  clear: "Show all of this month's entries",
  // The menu: its title says what it opens ("Invested · Jun 2025 – May 2026").
  periodRange: (startLabel, endLabel) => `${startLabel} – ${endLabel}`,
  menuLabel: (name) => `${name}: what next`,
  viewEntries: "View entries",
  openPlan: "Open plan",
  openMonthPlan: (monthLabel) => `Open ${monthLabel} plan`,
  openSplits: "Open Splits",
  ask: "Ask about this",
  // The period as a question says it: "in Sep 2026", "from Oct 2025 to Sep 2026".
  inMonth: (monthLabel) => `in ${monthLabel}`,
  inRange: (startLabel, endLabel) => `from ${startLabel} to ${endLabel}`,
  // Ask's questions. None holds an amount; with money hidden none says which
  // side of the plan or of income the money fell.
  questions: {
    spentOverPlan: (period) => `Why did I spend more than planned ${period}?`,
    spentMost: (period) => `What did I spend the most on ${period}?`,
    spentVsPlan: (period) => `How did my spending compare with the plan ${period}?`,
    spentMore: (period) => `Why did I spend more than I earned ${period}?`,
    spentVsIncome: (period) => `How did my spending compare with my income ${period}?`,
    invested: (period) => `How much did I invest ${period}?`,
    saved: (period) => `How much did I save ${period}?`,
    income: (period) => `How much did I earn ${period}?`,
    plan: (period) => `How did I do against the plan ${period}?`,
    category: (name, period) => `How much did I spend on ${name} ${period}?`,
    owed: "Who owes whom?"
  }
};
