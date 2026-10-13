// Copy for planning by chat on the Ask page (ask-plan-draft-card.jsx;
// docs/flows/ask-flow.md "Planning by chat"): a draft of a change to a
// month's plan. Nothing is saved until Save plan. Its own module, so it
// ships with the Ask page only (ask-copy.js is shared with Entries and
// Splits).

const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// "November 2026"
export function formatMonthYear(monthKey) {
  const [year, month] = String(monthKey ?? "").split("-").map(Number);
  return month ? `${LONG_MONTHS[month - 1]} ${year}` : "";
}

export const askPlanCopy = {
  reading: "Drafting that change…",
  intro: "Here is the change. Nothing is saved until you tap Save.",
  draftTag: "Draft",
  aiTag: "Read by AI",
  savedTag: "Saved",
  cardLabel: "Plan change",
  lineTitle: (label) => `${label} plan`,
  moveTitle: (amount) => `Move ${amount}`,
  moveSubtitle: (from, to) => `${from} to ${to}`,
  copyTitle: (month) => `${month} plan`,
  copySubtitle: (month) => `Like ${month}`,
  was: (amount) => `was ${amount}`,
  newLine: "New line",
  planned: "planned",
  sameSpend: "Planned spend stays the same",
  household: "Household",
  rowsLabel: "What changes",
  savedRowsLabel: "After saving",
  change: (from, to) => `${from} → ${to}`,
  lineWithOwner: (label, owner) => `${label} · ${owner}`,
  moreLines: (count) => `${count} more ${count === 1 ? "line" : "lines"}`,
  fewerLines: "Fewer lines",
  totals: {
    plannedIncome: "Planned income",
    plannedSpend: "Planned spend",
    remaining: "Remaining budget"
  },
  discard: "Discard",
  save: "Save plan",
  saving: "Saving…",
  seeOnMonth: "See it on Month",
  undo: "Undo this change",
  undoing: "Undoing…",
  notes: {
    saved: (month) => `Saved to the ${month} plan.`,
    discarded: "Discarded. The plan is unchanged.",
    undone: "Undone. The plan is back as it was.",
    failed: "That couldn't be drafted just now. Try again in a moment.",
    saveFailed: "The plan couldn't be saved. Check your connection and try again.",
    undoFailed: "That couldn't be undone. Open Month to change it back.",
    noPlanToCopy: (month) => `${month} has no plan to copy.`,
    sameMonth: (month) => `That's already the ${month} plan.`,
    unknownLine: (name, month) => `There's no “${name}” line in the ${month} plan.`,
    nothingChanges: (month) => `The ${month} plan already says that, so nothing would change.`,
    notEnough: (label, amount) => `${label} only has ${amount} planned.`,
    notEnoughHidden: (label) => `${label} doesn't have that much planned.`,
    moveMixed: "Money can only move between two spending lines."
  },
  questions: {
    month: "Which month's plan?",
    line: (name) => `Which line do you mean by “${name}”?`,
    owner: (line) => `Whose ${line} line is it?`
  }
};
