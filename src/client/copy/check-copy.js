// The "Check my books" page's wording (docs/flows/check-flow.md). It ships with
// the lazy route, never with the first screen: src/client/copy/en-SG.js holds
// only the page's name in the menu. Plain words for a non-technical reader
// (AGENTS.md naming rule): say what happened to the money, then the number. No
// "finding", "detector", "tier", "evidence", "kind" or "dismiss" in anything
// shown (tests/check-copy-lint.test.mjs). The sentences that describe each
// problem come from the report itself (src/domain/ledger-checkup, already
// linted); this file words everything around them.

const plural = (count, one, many) => (count === 1 ? one : many);

export const checkCopy = {
  title: "Check my books",
  intro: "Looks over your entries, statements, shared expenses and plans for things that seem wrong. It only looks: nothing changes unless you choose to fix it.",
  viewingHousehold: "Checking the whole household",
  viewingPerson: (name) => `Checking ${name} and anything shared`,

  checkAgain: "Check again",
  checking: "Checking…",
  checkingDetail: "This can take a few seconds.",
  checkedAt: (time) => `Checked ${time}`,
  announceChecking: "Checking your books.",
  announceDone: (summary) => `Check finished. ${summary}.`,

  summary: {
    needFixing: (count) => `${count} ${plural(count, "thing needs", "things need")} fixing`,
    worthChecking: (count) => `${count} worth checking`,
    goodToKnow: (count) => `${count} good to know`,
    allClear: "Everything checks out",
    allClearDetail: (time) => `Checked ${time}. Nothing looks wrong in your entries, statements, shared expenses or plans.`,
    partialClear: "Nothing found in the checks that ran",
    partialClearDetail: (time) => `Checked ${time}. Some checks could not run, so this is not a full all-clear.`
  },

  tiers: {
    high: { title: "Needs fixing", detail: "Your records show a problem here." },
    check: { title: "Worth checking", detail: "Something does not add up. It is often fine." },
    note: { title: "Good to know", detail: "Tidy-ups and heads-ups. Nothing urgent." }
  },

  // One heading per group of related problems.
  headings: {
    wrong_card: "Purchases that may be on the wrong card",
    duplicates: "Possible duplicates",
    transfers: "Transfers waiting for their other side",
    statements: "Missing statements",
    estimates: "Estimates the bank never confirmed",
    balances: "Balances that don't match",
    plan: "Plan problems",
    settle_up: "Settle-up mistakes",
    tidy: "Tidy-ups"
  },

  group: {
    showMore: (count) => `Show ${count} more`,
    showFewer: "Show fewer",
    showing: (shown, total) => `Showing ${shown} of ${total}`,
    incomplete: "There may be more than shown",
    notListed: (count) => `${count} more ${plural(count, "is", "are")} not listed yet. Sort out the ones above first.`
  },

  item: {
    involved: (money) => `${money} involved`,
    thisIsFine: "This is fine",
    thisIsFineFor: (title) => `This is fine: ${title}`,
    fixFor: (label, title) => `${label}: ${title}`,
    // Money hidden: no amount and nothing that says which way it went.
    moneyHidden: "Money is hidden. Show money totals to read this.",
    planNeutralTitle: "The plan needs a look"
  },

  hidden: {
    toggle: (count) => `Show hidden (${count})`,
    toggleOff: (count) => `Hide hidden (${count})`,
    title: "Hidden by you",
    detail: "You marked these as fine. They come back if the records behind them change.",
    showAgain: "Show again",
    showAgainFor: (title) => `Show again: ${title}`,
    notice: "Hidden.",
    undo: "Undo",
    undoFor: (title) => `Undo hiding: ${title}`,
    hideFailed: "Could not hide this. Try again.",
    restoreFailed: "Could not show this again. Try again."
  },

  unavailable: {
    title: "Could not check this",
    retry: "Try again"
  },

  errors: {
    loadFailedTitle: "Could not check your books",
    loadFailedDetail: "Check your connection and try again. Nothing was changed.",
    retry: "Try again",
    againFailedTitle: "Could not check again",
    againFailedDetail: "Showing the result from before."
  }
};
