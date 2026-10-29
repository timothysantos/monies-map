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

  // "Link these N clear pairs" on the group "Transfers waiting for their other
  // side" (docs/flows/check-flow.md, "Link clear pairs"). A pair is two
  // entries that are the same money moving between two of the person's own
  // accounts; "clear" is explained once, in the group.
  clear: {
    explain: "Only pairs with exactly one possible match on each side.",
    button: (count) => (count === 1 ? "Link this clear pair" : `Link these ${count} clear pairs`),
    buttonFor: (count) => (count === 1 ? "Link this clear pair of transfers" : `Link these ${count} clear pairs of transfers`),
    title: (count) => (count === 1 ? "Link 1 clear pair" : `Link ${count} clear pairs`),
    loading: "Looking at the pairs…",
    summary: (count, first, last) => `${count} ${plural(count, "pair", "pairs")}${first ? (first === last ? ` in ${first}` : `, ${first} to ${last}`) : ""}`,
    rowFrom: (from, to) => `${from} → ${to}`,
    more: (count) => `and ${count} more`,
    effect: "Each pair will become one move between your accounts. Nothing is deleted. You can unlink a pair from its details.",
    noUndoAll: "There is no undo for all of them at once.",
    capNote: (shown, remaining) => `This links the first ${shown}. ${remaining} more ${plural(remaining, "pair is", "pairs are")} still waiting afterwards.`,
    confirm: (count) => `Link ${count} ${plural(count, "pair", "pairs")}`,
    working: "Linking…",
    cancel: "Cancel",
    close: "Close",
    none: "There are no clear pairs to link any more.",
    result: (linked, skipped) => (skipped === 0
      ? `Linked ${linked} ${plural(linked, "pair", "pairs")}. 0 skipped.`
      : `Linked ${linked} ${plural(linked, "pair", "pairs")}. ${skipped} changed since you looked and ${plural(skipped, "was", "were")} skipped.`),
    loadFailed: "Could not look at the pairs. Nothing was changed. Try again.",
    linkFailed: "Nothing was linked. Check your connection and try again."
  },

  // Fixing on the page itself (docs/flows/check-flow.md, "Fixing and coming
  // back"): the button that does it, and the quiet one that opens the page.
  inPlace: {
    label: {
      link_pair: "Link these two",
      transfer: "Open transfer details",
      correct_settled: "Correct this"
    },
    openInEntries: "Open in Entries",
    openInSplits: "Open in Splits",
    fixFailed: "Could not save that. Nothing was changed. Try again.",
    // Only the words around the Transfer details dialog; the dialog's own
    // words are the ones Entries shows.
    transfer: {
      title: "Transfer details",
      loading: "Looking at this transfer…",
      loadFailed: "Could not look at this transfer. Nothing was changed. Try again.",
      notATransfer: "This is no longer a transfer, so there is nothing to match."
    },
    // The small dialog before two sides are linked.
    pair: {
      title: "Link these two?",
      loading: "Looking at the two entries…",
      effect: "They are the same money moving between your accounts, so they will become one move. Nothing is deleted. You can unlink them from their details.",
      out: "Money out",
      in: "Money in",
      confirm: "Link these two",
      working: "Linking…",
      cancel: "Cancel",
      close: "Close",
      loadFailed: "Could not look at the two entries. Nothing was changed. Try again.",
      changed: "These two cannot be linked from here any more. Open the transfer to choose.",
      linkFailed: "Nothing was linked. Check your connection and try again."
    }
  },

  // The line that replaces the "Checking ..." line for a few seconds after a
  // fix, whether it was made on the page or on the page the person came back
  // from. Worked out from how many problems the list had before and has now.
  change: {
    fixed: (left) => (left === 0 ? "Fixed. Nothing left." : `Fixed. ${left} ${plural(left, "thing", "things")} left.`),
    unchanged: "Nothing changed."
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
