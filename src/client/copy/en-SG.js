import { countOf } from "./wording";

export const messages = {
  common: {
    loading: "Loading...",
    loadingLatest: "Loading latest data...",
    refresh: "Refresh",
    search: "Search",
    close: "Close",
    saving: "Saving...",
    working: "Working...",
    // A tappable Support chip's name for assistive tech, and what a locked
    // chip adds after its text (design.md, "Tappable chips").
    changeChip: (field, value) => `Change ${field.toLowerCase()}, ${value}`,
    chipLockedByStatement: "locked by the statement",
    appShellErrorTitle: "Dashboard data could not load.",
    appShellRetry: "Try loading dashboard again",
    appShellResourceLimitTitle: "Cloudflare stopped the request before the app could return data.",
    appShellResourceLimitDetail: "This is usually a Worker CPU or resource limit on the shared app-shell request, not proof that an import changed data. If this keeps happening, check Cloudflare Workers observability for /api/app-shell and reduce that endpoint's work or move the Worker to a plan with more headroom.",
    appShellDiagnosticsUnavailable: "Settings and Error diagnostics also need the app shell. If /api/app-shell is the failing request, the diagnostics page may not open until the endpoint succeeds again.",
    loadFailedDetail: "Your saved data is not affected. Try again in a moment.",
    loadFailedUnreachable: "We couldn't reach your data just now.",
    pageLoadErrorTitleFor: (pageName) => pageName ? `The ${pageName} page could not load.` : "This page could not load.",
    retryPageLoad: "Try loading again",
    refreshFailedTitle: "This page could not refresh.",
    refreshFailedDetail: "Saved changes are kept. Some figures here may be out of date until the page refreshes.",
    refreshFailedRetry: "Refresh now",
    refreshFailedDismiss: "Dismiss",
    screenCrashTitle: "This page hit a problem and could not be shown.",
    appCrashTitle: "The app hit a problem and could not be shown.",
    codeLoadCrashTitle: "This page needs a fresh copy of the app.",
    screenCrashDetail: "Your saved data is not affected. Try again, open another page, or reload the app.",
    appCrashDetail: "Your saved data is not affected. Reload the app to continue.",
    screenCrashRetry: "Try again",
    screenCrashReload: "Reload app",
    referenceDataErrorTitle: "Reference data could not load.",
    referenceDataErrorDetail: "The app shell loaded, but account and category reference data did not. Try loading reference data again; if this keeps failing, check Error diagnostics or Cloudflare observability for /api/reference-data.",
    referenceDataRetry: "Try loading reference data again",
    emptyValue: "—",
    viewingDot: (label) => `Viewing • ${label}`,
    contextWithView: (left, right) => `${left} • ${right}`,
    triplet: (...parts) => parts.filter(Boolean).join(" • "),
    moneyAndPercent: (moneyValue, percentage) => `${moneyValue} • ${percentage}%`,
    shownInChart: "Shown",
    hiddenFromChart: "Hidden",
    clickToToggle: "Click to toggle",
    resetHiddenCategories: (count) => `Show ${count} hidden ${count === 1 ? "category" : "categories"}`,
    viewEntries: "View entries",
    viewEntriesFor: (categoryName) => `View entries for ${categoryName}`
  },
  views: {
    household: "Household",
    // A person view's scopes: the short name the View and scope bar shows,
    // and what each one counts, in plain words (DOMAIN.md person views).
    scopeShortLabel: {
      direct: "Direct",
      shared: "Shared",
      direct_plus_shared: "Direct + Shared"
    },
    scopeHint: {
      direct: (name) => `${name}'s entries that are not part of a split.`,
      shared: (name) => `${name}'s share of split expenses.`,
      direct_plus_shared: (name) => `${name}'s entries plus their share of split expenses.`
    }
  },
  tabs: {
    summary: "Summary",
    month: "Month",
    entries: "Entries",
    splits: "Splits",
    ask: "Ask",
    askInProgress: "Ask, conversation in progress",
    imports: "Imports",
    settings: "Settings",
    faq: "FAQ",
    ariaLabel: "Dashboard sections"
  },
  // Other pages' wording the app shell shows on every page.
  shell: {
    importInboxBannerTitle: (count) => `${count} bank file${count === 1 ? "" : "s"} needed`,
    importInboxBannerDetail: (institutionCount, splitCount) => {
      const bankText = `${institutionCount} bank login session${institutionCount === 1 ? "" : "s"}`;
      const splitText = splitCount ? ` Split cleanup waits after bank files.` : "";
      return `Open Imports for the guided bank run across ${bankText}.${splitText}`;
    },
    importInboxBannerAction: "Open import inbox",
    categorySuggestionBadgeTitle: (count) => `${count} pending category match suggestion${count === 1 ? "" : "s"}`
  },
  // An account's statement health: Summary's account pills and Settings.
  accountHealth: {
    matched: (month) => `Reconciled to ${month} statement`,
    mismatch: (month, delta) => `${month} statement is off by ${delta}`,
    needsCheckpoint: "No statement checkpoint yet",
    // An investment account's latest statement: what it was worth, as the
    // statement says, never a promise of what it will be.
    investmentWorth: (amount, date) => `${amount} on ${date}, as the statement says`
  },
  // The desktop Ask field and the panel or popup it opens (ask-dock.jsx).
  askDock: {
    fieldLabel: "Ask",
    placeholder: "Ask, or drop a receipt…",
    attach: "Add a receipt photo",
    close: "Close",
    closeLabel: "Close Ask",
    expand: "Dock Ask beside the page"
  },
  period: {
    month: "Month",
    year: "Range",
    currentYear: "2025",
    previousAriaLabel: "Previous period",
    nextAriaLabel: "Next period"
  },
  summary: {
    spendingMix: "Spending Mix",
    // The Summary tab's month choice: the phone island control, its "Pick a
    // month" sheet and the desktop month row (summary-month-picker.jsx).
    monthChoice: {
      label: "Month",
      allMonths: "All months",
      allMonthsDetail: "The whole range on one page",
      sheetTitle: "Pick a month",
      changeRange: "Change range",
      // "of $37,807.52 plan": the amount sits between, masked with money.
      planPrefix: "of",
      planSuffix: "plan",
      over: "over",
      legendSpent: "Spent of plan",
      legendOver: "Over plan",
      previousMonth: "Previous month",
      nextMonth: "Next month",
      done: "Done"
    },
    // The Summary top: one lead card for spend against plan, and the Income
    // and Saved pills with their plans (summary-lead.jsx). "of" and "plan"
    // around the planned spend are monthChoice.planPrefix / planSuffix.
    lead: {
      spent: (rangeLabel) => rangeLabel ? `Spent · ${rangeLabel}` : "Spent",
      percentOfPlan: (percent) => `${percent}% of plan`,
      underPlan: "under plan",
      overPlan: "over plan",
      income: "Income",
      incomePlan: "plan",
      saved: "Saved",
      savedTarget: "target",
      // The lead's Plan | Simple switch (lead-view.js) and the Simple lead,
      // "Earned $x · Spent $y".
      view: { label: "Show this period", plan: "Plan", simple: "Simple" },
      earned: "Earned",
      // The savings bar under the lead (ui/savings-bar.jsx, design.md): all
      // the money earned in the period is the bar; spent and kept share it.
      // Hidden money gets percentages and a share sentence, never an amount.
      savingsBar: {
        label: "Spent and kept, against what you earned",
        spentName: "Spent",
        keptName: "Kept",
        investedName: "Invested",
        savingsName: "Came out of savings",
        // The tick where the income ends on an overspent bar: all the money
        // earned in the period (the amount joins it where there is room).
        tick: "All you earned",
        tickWithAmount: (amount) => `All you earned ${amount}`,
        // The always-visible legend under the bars, one short label per part
        // (the striped part is what came out of savings), and the thin plan bar.
        // `takenOut` is a line of its own, with no part on the bar: a period
        // that took more out of investment accounts than it put in.
        legend: { spent: "Spent", invested: "Invested", kept: "Kept", savings: "From savings", takenOut: "Took out of investments" },
        planName: "Plan",
        planSpend: "spend",
        planInvest: "invest",
        planKeep: "keep",
        planLegend: (parts) => `Plan: ${parts.join(" · ")}`,
        kept: (kept, earned, percent) => `You kept ${kept} of the ${earned} you earned (${percent}%)`,
        keptAndInvested: (kept, invested, earned) => `You kept ${kept} and invested ${invested} of the ${earned} you earned`,
        spentMore: (more) => `You spent ${more} more than you earned`,
        spentMoreAndInvested: (more, invested) => `You spent ${more} more than you earned, and invested ${invested}`,
        investedFromSavings: (invested, fromSavings) => `You invested ${invested}, ${fromSavings} of it from savings`,
        hiddenSentence: "Spent and kept, as a share of what you earned",
        hiddenSentenceInvested: "Spent, invested and kept, as shares of income",
        // The same, short enough for one line on a phone (the Month card
        // stays at most 205 px). Only the sentences that name investing differ.
        short: {
          keptAndInvested: (kept, invested, earned) => `Kept ${kept} · invested ${invested} of ${earned}`,
          spentMoreAndInvested: (more, invested) => `Spent ${more} over income · invested ${invested}`
        }
      },
      // The where-your-money-goes line under the savings bar (ui/money-jobs.jsx,
      // design.md "Money jobs"): how many of the plan's four things are on track. The
      // opened rows and their menu are worded in copy/money-jobs-copy.js,
      // which loads with them, out of the first screen.
      moneyJobs: {
        summary: (done, total, soFar) => `${done} of ${total} ${total === 1 ? "thing" : "things"} on track${soFar ? " so far" : ""}`
      }
    },
    fromMonth: "From",
    toMonth: "To",
    focusMonth: "Focus",
    intentVsOutcome: "Intent vs Outcome",
    intentVsOutcomeDetail: "Monthly comparison with expandable detail.",
    // Each Intent vs Outcome month card (summary-intent-outcome.jsx).
    intent: {
      plannedIncome: "Planned income",
      actualIncome: "Actual income",
      details: "Details",
      detailsHint: "Income · spend · savings · note",
      detailsFor: (monthLabel) => `${monthLabel} details`
    },
    totalSpend: "Total spend",
    scope: "Scope",
    // The desktop scope switch under the Summary title.
    scopeSwitchLabel: {
      direct: "Direct",
      shared: "Shared",
      direct_plus_shared: "Both"
    },
    table: {
      metric: "Metric",
      estimate: "Planned",
      actual: "Actual",
      variance: "Variance",
      note: "Context",
      income: "Income",
      expectedExpenses: "Expected spend",
      expectedSavings: "Savings goal",
      actualSavings: "Realized savings"
    }
  },
  month: {
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
  },
  entries: {
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
    addEntry: "+ Add entry",
    editCategory: "Category",
    editDate: "Date",
    editType: "Type",
    editAmount: "Amount",
    editDescription: "Description",
    editWallet: "Wallet",
    editOwner: "Owner",
    editPostDate: "Posted date",
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
      whatWasIt: "What was it?",
      notePlaceholder: "Add a note",
      moreDetails: "More details",
      fewerDetails: "Fewer details",
      moreDetailsOpen: "Date, wallet, posted date, type",
      moreDetailsLocked: "Posted date, type",
      // The same, when the entry has an Added by row.
      moreDetailsOpenAddedBy: "Date, wallet, posted date, type, added by",
      moreDetailsLockedAddedBy: "Posted date, type, added by",
      transferOut: "Transfer out",
      transferIn: "Transfer in",
      splits: "Splits",
      viewSplit: "View split",
      deleteSplit: "Delete split",
      deleteEntry: "Delete entry",
      transferMatch: "Transfer match",
      manageTransfer: "Manage transfer"
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
  },
  splits: {
    viewing: (label) => `Viewing splits for ${label}`,
    nonGroup: "Non-group expenses",
    addGroup: "+",
    matches: "Matches",
    reviewMatches: "Review matches",
    backToGroup: "Back to split group",
    entryCount: (count) => countOf(count, "entry", "entries"),
    allClear: "All clear",
    toReview: (count) => `${count} to review`,
    matchInboxTitle: (count) => `${count} possible split ${count === 1 ? "link" : "links"}`,
    matchInboxDetail: "Imported bank rows may already correspond to split expenses you entered manually. Review them before creating duplicates.",
    matchReviewDetail: (count) => `Compare each existing split with its imported ledger row, then link it or keep it separate. ${count} ${count === 1 ? "candidate" : "candidates"} ready.`,
    existingSplitRecord: "Existing split",
    importedLedgerRow: "Imported ledger row",
    matchDeltaSummary: (dateDeltaDays, amountDelta) => `${dateDeltaDays} day${dateDeltaDays === 1 ? "" : "s"} apart • ${amountDelta} amount difference`,
    expenseMatches: "Expense matches",
    settlementMatches: "Settlement matches",
    addExpense: "+ Add expense",
    settleUp: "Settle group",
    settledUp: "Settled up",
    noGroups: "No split groups yet.",
    noGroupsDetail: "A group keeps the costs you share, like a trip or a home.",
    noEntries: "No split entries yet for this group.",
    noEntriesDetail: "Add an expense to start keeping track of who owes whom.",
    noMatches: "No split matches to review right now.",
    historyEmpty: "No split activity has been recorded yet.",
    searchPlaceholder: "Expense, person, note, amount...",
    noSearchResults: "No split activity matches this search.",
    noSearchResultsDetail: "Try a different word, or clear the search.",
    clearSearch: "Clear search",
    youAreOwed: "You are owed",
    youOwe: "You owe",
    net: "Net",
    createGroup: "Create group",
    groupName: "Group name",
    saveGroup: "Save group",
    createExpense: "New split expense",
    expenseDate: "Date",
    expenseDescription: "Description",
    expenseCategory: "Category",
    expensePaidBy: "Paid by",
    expenseAmount: "Expense total",
    expenseSplit: (personName) => `${personName} share %`,
    expenseExactAmount: (personName) => `${personName} share amount`,
    expenseNote: "Note",
    saveExpense: "Save expense",
    // The create expense card (split-expense-card.jsx, design.md "Lead · Support · Detail").
    expenseCard: {
      sheetContext: (groupName, personNames) => [groupName, personNames.join(" and ")].filter(Boolean).join(" · "),
      close: "Close create split expense",
      closeEdit: "Close edit split",
      closeView: "Close view split",
      cancel: "Cancel",
      // Asks first in the Delete split row dialog.
      deleteSplit: "Delete",
      whatWasIt: "What was it?",
      detailsLabel: "Expense details",
      shareRow: (personName) => `${personName}’s share`,
      shareValue: (percentLabel, amountLabel) => `${percentLabel} · ${amountLabel}`,
      sharesLabel: "Split share amounts",
      paidBy: (personName) => `Paid by ${personName}`,
      group: "Group",
      currency: "Currency",
      paidUsing: "Paid using",
      paidUsingLedger: "Paid using (ledger)",
      sharesChip: "Shares",
      paymentLockedByLedger: "set by the linked entry",
      evidence: "Evidence",
      moreDetails: "More details",
      fewerDetails: "Fewer details",
      moreDetailsSummary: "Date, paid by, paid using, currency, evidence, note",
      notePlaceholder: "Add a note",
      paymentMethods: { cash: "Cash", card: "Card", bank: "Bank", other: "Other" },
      evidenceOptions: { recorded: "Recorded", awaiting_statement: "Awaiting statement", certified: "Statement certified" }
    },
    createSettlement: "Record settlement",
    settlementFrom: "Paid by",
    settlementTo: "Received by",
    settlementAmount: "Amount",
    settlementDate: "Date",
    saveSettlement: "Save settlement",
    groupSettlementDetail: (groupName) => `Record payment for ${groupName || "this group"} only. This closes its current batch; Simplify settlement remains optional for combining open groups in the same currency.`,
    includedSplitRecords: (count) => countOf(count, "included split record"),
    keepSeparate: "Keep separate",
    match: "Match",
    linked: "Linked",
    imported: "Imported transaction",
    manual: "Manual split",
    editSplit: "Edit split",
    viewSplit: "View split",
    viewLinkedEntry: "View entry",
    linkedEntry: "Linked entry",
    categoryBreakdown: "Category breakdown"
  },
  faq: {
    viewing: (label) => `Viewing FAQ for ${label}`,
    tabsLabel: "Guide",
    tabs: {
      user: "User guide",
      developers: "For developers"
    },
    contents: "Contents",
    loading: "Loading guide...",
    loadFailed: "This guide could not load. Check your connection and try again.",
    retry: "Try again"
  }
};
