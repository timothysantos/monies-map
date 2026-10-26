// Entries page copy. It ships with the route that shows it, not with the first
// screen: src/client/copy/en-SG.js holds the copy every page needs.
import { messages } from "./en-SG";

export const entriesMessages = {
  viewing: (label) => `Viewing entries for ${label}`,
  wallet: "By wallet",
  category: "By category",
  person: "By people",
  resetFilters: "Reset filters",
  allWallets: "All wallets",
  allCategories: "All categories",
  searchPlaceholder: "Merchant, note, wallet, amount...",
  filter: "Filter",
  filtered: "Filtered",
  allPeople: "All people",
  type: "By type",
  allTypes: "All types",
  totalsLabel: "Entry totals",
  // The Entries top (entries-overview.jsx, design.md "Entries top").
  totals: {
    spentEyebrow: (monthLabel) => `Spent · ${monthLabel}`,
    shareAside: (name) => `${name}'s share`,
    pillShare: (name) => `${name}'s`,
    spendingByCategory: "Spending by category",
    filters: "Filters",
    filtersAll: "All entries",
    filtersOn: (count) => `${count} ${count === 1 ? "filter" : "filters"} on`
  },
  totalSpend: "Spend",
  totalTransfersOut: "Transfers",
  totalOutflow: "Outflow",
  totalIncome: "Income",
  totalDifference: "Difference",
  dateNet: "Daily net",
  addEntry: messages.shell.addEntry,
  editCategory: "Category",
  editDate: "Date",
  editType: "Type",
  editAmount: "Amount",
  editDescription: "Description",
  editWallet: "Wallet",
  editOwner: "Owner",
  editPostDate: "Posted date",
  editTime: "Time",
  editSplit: "Split %",
  editNote: "Note",
  editTransferDirection: "Transfer direction",
  scope: "Scope",
  shared: "Shared",
  offsetsCategory: " • offsets category",
  split: "Split",
  counterpart: "Counterpart",
  doneEdit: "Done",
  cancelEdit: "Cancel",
  saveCategoryPrompt: "Save this category?",
  saveCategoryPromptDetail: "Apply this category change to the entry now.",
  saveCategoryNow: "Save category",
  addToSplits: "Add to splits",
  // The entry edit card (entry-edit-card.jsx, design.md "Lead · Support · Detail").
  // Added by (DOMAIN.md): the bank state chip names the tool that saved a
  // provisional entry, More details says who added it, and a list row
  // carries a small glyph beside its amount.
  source: {
    applePayProvisional: "Apple Pay · provisional",
    askProvisional: "Ask · provisional",
    addedBy: "Added by",
    applePayShortcut: "Apple Pay shortcut",
    ask: "Ask",
    addedWithApplePay: "Added with Apple Pay",
    addedInAsk: "Added in Ask"
  },
  editCard: {
    sheetContext: (ownerLabel, monthLabel) => [ownerLabel, monthLabel].filter(Boolean).join(" · "),
    detailsLabel: "Entry details",
    notSet: "Not set",
    clearTime: "Clear time",
    whatWasIt: "What was it?",
    notePlaceholder: "Add a note",
    moreDetails: "More details",
    fewerDetails: "Fewer details",
    moreDetailsOpen: "Date, wallet, time, posted date, type",
    moreDetailsLocked: "Time, posted date, type",
    // The same, when the entry has an Added by row.
    moreDetailsOpenAddedBy: "Date, wallet, time, posted date, type, added by",
    moreDetailsLockedAddedBy: "Time, posted date, type, added by",
    transferOut: "Transfer out",
    transferIn: "Transfer in",
    splits: "Splits",
    viewSplit: "View split",
    // The Splits row of an entry on Splits opens a small menu: View split,
    // and Remove from Splits (keeps the entry, removes only its split).
    splitsMenuLabel: "Splits: View split or Remove from Splits",
    removeFromSplits: "Remove from Splits",
    // Its confirmation: the full words in the title, and a short button
    // ("Remove from Splits" wraps to two lines at 320 px).
    removeFromSplitsTitle: "Remove from Splits?",
    removeFromSplitsNote: "The entry stays in Entries. Only its split on Splits is removed.",
    removeFromSplitsConfirm: "Remove",
    deleteEntry: "Delete entry",
    transferMatch: "Transfer match",
    manageTransfer: "Manage transfer"
  },
  // A transfer to someone in the household that says what it pays for
  // (DOMAIN.md "Transfer Purpose"). Owner-approved design, 2026-10-20.
  transferPurpose: {
    label: "What is this for?",
    clear: "Just a transfer",
    rememberedCue: "Set like last month",
    undo: "Undo",
    saving: "Saving...",
    sentChip: (name) => `Transfer to ${name}`,
    receivedChip: (name) => `${name}'s transfer to you`,
    householdChip: (transferLabel, categoryName) => `${transferLabel} · for ${categoryName}`,
    failed: "That didn't save. Try again."
  },
  noSpendBreakdown: "No spend rows in this view.",
  noSpendBreakdownDetail: "Spending shows up here once entries are recorded.",
  noEntries: "No entries match this view.",
  noEntriesFilteredDetail: "Try fewer filters, or a different month.",
  noEntriesYet: "No entries yet.",
  noEntriesYetDetail: "Add one here, or bring in a bank file from Imports.",
  walletViewMismatchTitle: "This wallet is outside the current view.",
  walletViewMismatchDetail: (walletLabel, ownerLabel, viewLabel) => `No entries match ${viewLabel}'s view. ${walletLabel} belongs to ${ownerLabel}, and there are no shared rows for this wallet this month.`,
  walletViewMismatchHouseholdAction: "View household",
  walletViewMismatchOwnerAction: (ownerLabel) => `View ${ownerLabel}`
};
