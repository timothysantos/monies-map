// Month page copy. It ships with the route that shows it, not with the first
// screen: src/client/copy/en-SG.js holds the copy every page needs.
import { countOf } from "./wording";

export const monthMessages = {
  planLinkNoCandidates: "No matching expense entries fit the current filters.",
  planLinkSaveFailed: "The matches could not be saved.",
  rowDeleteFailed: "The row could not be deleted.",
  rowNoteSaveFailed: "The note could not be saved.",
  monthNoteSaveFailed: "The month note could not be saved.",
  duplicateMonthFailed: "The month could not be duplicated.",
  resetMonthFailed: "The month could not be reset.",
  deleteMonthFailed: "The month could not be deleted.",
  incomeSectionTitle: "Income",
  incomeSectionDetail: "Planned income sources that fund the month before expenses are allocated.",
  actions: "Actions",
  duplicateMonth: "Duplicate month",
  resetMonth: "Reset month",
  resetMonthDetail: "This clears the current month's plan rows, entries, and summary totals.",
  resetMonthPlaceholder: "Type 'reset month'",
  resetMonthConfirm: "Confirm reset month",
  deleteMonth: "Delete month",
  // Demo data is mentioned only on the demo site.
  deleteMonthDetail: ({ isDemo = false } = {}) => isDemo
    ? "This removes the current month entirely from the demo, including its summary snapshot."
    : "This removes the current month entirely, including its summary snapshot.",
  deleteMonthPlaceholder: "Type 'delete month'",
  deleteMonthConfirm: "Confirm delete month",
  addIncomeSource: "+ Add income source",
  editIncomeSource: "Edit income source",
  incomeRowNote: "Main planned income source for the month.",
  extraIncomeNote: "Additional planned income source.",
  addPlannedItem: "+ Add bill or dated payment",
  editPlannedItem: "Edit bill or dated payment",
  addBudgetBucket: "+ Add monthly budget",
  editBudgetBucket: "Edit monthly budget",
  newPlannedItemNote: "New bill or dated payment.",
  newBudgetBucketNote: "New monthly budget.",
  doneEdit: "Done",
  cancelEdit: "Cancel",
  // The plan-row sheet (month-plan-sheet.jsx, design.md "Lead · Support ·
  // Detail"): the planned amount leads, actual against it under the bar.
  planSheet: {
    context: (personLabel, monthLabel) => [personLabel, monthLabel].filter(Boolean).join(" · "),
    kind: { income: "Income", planned_items: "Bill or dated payment", budget_buckets: "Monthly budget" },
    plannedCaption: "planned",
    spent: "spent",
    received: "received",
    spentHidden: "Spent",
    receivedHidden: "Received",
    left: "left",
    over: "over",
    toCome: "to come",
    entryCount: (count) => countOf(count, "entry", "entries"),
    seeEntries: (count) => count === 1 ? "See the entry" : `See the ${count} entries`,
    noEntries: "No contributing entries yet",
    itemName: "Item name",
    addNote: "Add a note",
    detailsLabel: "Plan details"
  },
  notesTitle: "Monthly Note",
  notesDetail: "Why the month looked like this.",
  accountsTitle: "Accounts",
  accountsDetail: "Tracked finance accounts.",
  editHint: "Click a row to edit the plan. Actual stays read-only because it should come from entries.",
  readOnlyCombinedHint: "Combined household view is read-only. Switch to a person view to edit the plan.",
  table: {
    category: "Category",
    day: "Date",
    item: "Item",
    planned: "Planned",
    actual: "Actual",
    variance: "Variance",
    total: "Total",
    account: "Account",
    note: "Note"
  }
};
