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
  // The link above a page that "Check my books" sent the person to
  // (return-to-check.js): the page's own name, as the Ask back link does.
  returnToCheck: {
    label: "‹ Check my books",
    aria: "Back to Check my books"
  },
  tabs: {
    summary: "Summary",
    month: "Month",
    entries: "Entries",
    splits: "Splits",
    ask: "Ask",
    askInProgress: "Ask, conversation in progress",
    askReminders: (count) => `Ask, ${count} ${count === 1 ? "reminder" : "reminders"}`,
    askInProgressAndReminders: (count) => `Ask, conversation in progress and ${count} ${count === 1 ? "reminder" : "reminders"}`,
    imports: "Imports",
    settings: "Settings",
    faq: "FAQ",
    check: "Check my books",
    ariaLabel: "Dashboard sections",
    // The copy of the page links that floats at the bottom of a long
    // desktop page: its own landmark name, so a screen reader never lists
    // two navigations with one name.
    keptInViewAriaLabel: "Dashboard sections, kept in view"
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
    // The floating bar's two Add buttons (their pages' copy repeats these words).
    addEntry: "+ Add entry",
    addSplitsExpense: "+ Add expense",
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
  }
};
