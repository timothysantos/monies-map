// Copy for the Ask page. It ships with the Ask route only, never with the
// first screen (en-SG.js holds the tab label alone). Plain words, no app
// jargon: AGENTS.md "Readability".

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parts(isoDate) {
  const [year, month, day] = String(isoDate ?? "").split("-").map(Number);
  if (!year || !month || !day) {
    return null;
  }
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { year, month, day, weekday };
}

// "Today", "Yesterday", or "Sun 28 Sep" (the year only when it is not this year's).
export function formatCardDate(isoDate, today, { withYear = false } = {}) {
  const date = parts(isoDate);
  if (!date) {
    return askCopy.card.notSet;
  }
  if (isoDate === today) {
    return askCopy.card.today;
  }
  const todayParts = parts(today);
  if (todayParts) {
    const gap = Math.round((Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day) - Date.UTC(date.year, date.month - 1, date.day)) / 86_400_000);
    if (gap === 1) {
      return askCopy.card.yesterday;
    }
  }
  const showYear = withYear || (todayParts && todayParts.year !== date.year);
  return `${WEEKDAYS[date.weekday]} ${date.day} ${MONTHS[date.month - 1]}${showYear ? ` ${date.year}` : ""}`;
}

// "16 May 2026": day, short month, year, no weekday.
export function formatDayMonthYear(isoDate) {
  const date = parts(isoDate);
  return date ? `${date.day} ${MONTHS[date.month - 1]} ${date.year}` : "";
}

export function formatLongMonth(monthKey) {
  const [, month] = String(monthKey ?? "").split("-").map(Number);
  return LONG_MONTHS[(month ?? 1) - 1] ?? "";
}

export function formatShortMonth(monthKey) {
  const [year, month] = String(monthKey ?? "").split("-").map(Number);
  return month ? `${MONTHS[month - 1]} ${year}` : "";
}

export const askCopy = {
  title: "Ask",
  newTitle: {
    expense: "New entry",
    income: "New income",
    transfer: "New transfer"
  },
  savedTitle: "Saved",
  contextLine: (items) => items.filter(Boolean).join(" · "),
  threadLabel: "Conversation",
  newChat: "New chat",
  greeting: "Ask about your money, or add something.",
  greetingHint: "Type below, or tap a shortcut.",
  sinceLastLooked: "Since you last looked",
  briefHidden: "Reveal money totals to read these insights.",
  monthSpent: (monthKey) => `${formatLongMonth(monthKey)} spent`,
  ofPlan: (amount) => `of ${amount} plan`,
  chipsLabel: "Suggestions",
  chips: {
    scanReceipt: "Scan receipt",
    paste: "Paste",
    addEntry: "Add entry",
    addExpense: "Add expense",
    expense: "Expense",
    income: "Income",
    transfer: "Transfer",
    back: (label) => `‹ ${label}`,
    swapDirection: "Swap direction",
    addNote: "Add a note",
    differentCard: "Different card",
    differentWallet: "Different wallet",
    splitWith: (name) => `Split with ${name}`,
    notShared: "Not shared",
    editInForm: "Edit in form",
    backTo: (label) => `Back to ${label}`,
    openEntry: "Open this entry",
    openOnSplits: "Open on Splits",
    undo: "Undo",
    shareOnSplits: "Share on Splits",
    addToGroup: (name) => `Add to ${name}`,
    // The split suggestion's two answers (ask-split-suggestion.js).
    suggestedSplit: (share, groupName) => `Split ${share} in ${groupName}`,
    notThisTime: "Not this time",
    chooseCategory: "Choose category",
    openInEntries: "Open in Entries",
    // An unsaved card further up the thread, once something newer owns the chips.
    backToCard: "Back to the unsaved entry",
    newEntry: "Add another"
  },
  backLabels: {
    entries: "Entries",
    splits: "Splits",
    ask: "Ask"
  },
  composer: {
    label: "Message",
    chatPlaceholder: "Ask, or paste a receipt",
    addPlaceholder: "Type or say it…",
    changePlaceholder: "Anything to change?",
    savedPlaceholder: "Ask, or add another",
    // The + inside the message field and its little menu.
    add: "Add a photo or paste",
    menu: {
      takePhoto: "Take a photo",
      choosePhoto: "Choose a photo",
      paste: "Paste"
    },
    send: "Send",
    save: "Save",
    saving: "Saving…",
    saveHint: "Add the missing details to save."
  },
  // The composer's mic (ask-voice.js). Notes are calm and never block typing.
  voice: {
    start: "Start voice input",
    stop: "Stop voice input",
    listening: "Listening…",
    transcribing: "Writing down what you said…",
    done: "Check the message, then send.",
    notes: {
      denied: "The microphone isn't allowed here. You can allow it in your browser settings, or type instead.",
      noSpeech: "I didn't catch that. Hold the mic and try again.",
      failed: "Voice input didn't work this time. You can type instead.",
      unavailable: "Voice input isn't available in this browser. You can type instead.",
      allowance: "Voice input is used up for today. You can type instead.",
      tooLong: "That was too long. Keep it under 30 seconds."
    }
  },
  card: {
    label: "New entry",
    whatWasIt: "What was it?",
    descriptionLabel: "What it was",
    amountLabel: "Amount",
    coaxBefore: "Type the amount and shop, or just say it below: ",
    coaxExample: "“Koufu lunch $12.50, Citi”",
    coaxAfter: ". A receipt photo works too.",
    filledFromMessage: "Filled in from your message",
    readFromReceipt: "Read from your receipt",
    saved: "Saved",
    savedTo: "Saved to Entries",
    savedOnSplits: (groupName) => (groupName ? `Also on Splits: ${groupName}` : "Also on Splits"),
    today: "Today",
    yesterday: "Yesterday",
    notSet: "Not set",
    chooseWallet: "Choose a wallet",
    chooseGroup: "Choose a group",
    transfer: "Transfer",
    transferTitle: (from, to) => `${from || "Choose a wallet"} → ${to || "Choose a wallet"}`,
    receiptThumb: "Your receipt photo",
    moreDetails: "More details",
    moreDetailsHint: "Posted date, owner, note",
    fewerDetails: "Fewer details",
    filledDot: "filled in for you",
    rows: {
      date: "Date",
      category: "Category",
      wallet: "Wallet",
      type: "Type",
      from: "From",
      to: "To",
      postDate: "Posted date",
      owner: "Owner",
      share: "Split share",
      note: "Note",
      splitGroup: "Split group"
    },
    types: {
      expense: "Expense",
      income: "Income",
      transfer: "Transfer"
    },
    sharedOwner: "Shared",
    notePlaceholder: "Add a note",
    shareTitle: (name) => `Share with ${name} on Splits`,
    shareTitleFallback: "Share on Splits"
  },
  you: {
    photo: "Sent a receipt photo"
  },
  notes: {
    readingSentence: "Reading your message…",
    readingReceipt: "Reading your receipt…",
    sentenceUnavailable: "I couldn't read that, so nothing was filled in. You can still fill in the card.",
    receiptOnDevice: "Read on this device. Check the total and the date, then save.",
    receiptUnavailable: "The receipt couldn't be read. You can still fill in the card.",
    photoFailed: "That photo couldn't be opened. Try another one.",
    pasteEmpty: "There's nothing to paste. Copy a receipt photo or a sentence first.",
    pasteBlocked: "This browser didn't allow pasting here. Press and hold in the message box to paste.",
    saved: "Saved to Entries.",
    savedAndLinked: "Saved to Entries and linked to the other side.",
    transferLinkFailed: (error) => `Saved to Entries, but it couldn't be linked to the other side: ${error}`,
    savedOnSplits: "Saved to Entries and added to Splits.",
    splitAddFailed: (error) => `Saved to Entries, but it couldn't be added to Splits: ${error}`,
    undone: "Removed. The card is back if you want to change it and save again.",
    shortcutSaved: "Saved from Apple Pay.",
    shortcutMissing: "That entry couldn't be found. It may have been removed.",
    shortcutLoading: "Opening the saved entry…",
    categoryChanged: (name) => `Moved to ${name}.`,
    addedToSplits: (groupName) => (groupName ? `Added to Splits: ${groupName}.` : "Added to Splits."),
    askNotReady: "I can find entries and add new ones. Other questions aren't answered yet."
  },
  // Ask's turn (docs/flows/ask-flow.md "AI first"): the one-line note when
  // AI can't read a message and the built-in rules do, and the two draft
  // cards a turn can add (an entry onto Splits, a settle-up payment).
  turn: {
    // A quiet line under each reply: where it came from.
    source: { claude: "Reply from Claude", "workers-ai": "Reply from the basic model", rules: "Reply from the built-in rules" },
    rulesNote: "AI isn't available right now, so Ask read this with its built-in rules.",
    // The public demo only, when its own Claude allowance is used up.
    demoAllowanceNote: "The demo's Claude allowance is used up for today, so Ask is using its built-in rules.",
    opened: (page) => `Opened ${page}.`,
    pages: { summary: "Summary", month: "Month", entries: "Entries", splits: "Splits", imports: "Imports", settings: "Settings", help: "Help" },
    draftTag: "Draft",
    split: {
      label: "Add to Splits",
      title: "Add to Splits",
      paidBy: (name) => `${name} paid`,
      share: (name) => `${name}'s share`,
      group: "Split group",
      noGroup: "No group",
      save: "Add to Splits",
      saving: "Adding…",
      discard: "Not now",
      savedTag: "On Splits",
      saved: (groupName) => (groupName ? `Added to Splits: ${groupName}.` : "Added to Splits."),
      discarded: "Not added. The entry is unchanged.",
      openOnSplits: "Open on Splits",
      percentInstead: "Is that a percentage instead?",
      undo: "Undo",
      undoing: "Removing…",
      undone: "Removed from Splits. The entry is unchanged."
    },
    settlement: {
      label: "Settle-up payment",
      title: (from, to) => `${from} paid ${to} back`,
      date: "Date",
      group: "Split group",
      noGroup: "No group",
      save: "Record payment",
      saving: "Recording…",
      discard: "Not now",
      savedTag: "Recorded",
      saved: "Recorded on Splits.",
      discarded: "Not recorded.",
      unsure: "This may have been recorded before the page closed. Check Splits before recording it again.",
      openSplits: "Open Splits"
    },
    // A change to saved data Ask drafted (ask-turn-cards.jsx AskChangeCard):
    // what changes, before and after; nothing is saved until its button.
    change: {
      label: "Change",
      savedTag: "Saved",
      undoneTag: "Changed back",
      subtitle: {
        edit_entry: "Change this entry",
        recategorise: "Change the category",
        recategorise_bulk: (count) => `${count === 1 ? "1 entry" : `${count} entries`} change category`,
        entry_note: "Change the note",
        month_note: "Change the month's note",
        link_transfer: "Link as a transfer",
        link_transfer_none: "Make this a transfer",
        group_create: "New split group",
        group_move: "Move to another split group",
        simplify: (count) => `Simplify ${count} open ${count === 1 ? "split" : "splits"} into one payment`,
        payment_way: "Payment ways",
        category_create: "New category",
        category_rename: "Rename category",
        category_colour: "Change its colour",
        plan_link: (count) => `Link ${count === 1 ? "1 entry" : `${count} entries`} to this plan line`
      },
      fields: {
        amount: "Amount",
        date: "Date",
        description: "Description",
        category: "Category",
        wallet: "Wallet",
        owner: "Owner",
        note: "Note",
        from: "From",
        to: "To",
        group: "Split group",
        name: "Name",
        currency: "Currency",
        paynow: "PayNow",
        cash: "Cash",
        colour: "Colour",
        line: "Plan line"
      },
      none: "None",
      noGroup: "No group",
      mixed: "Several",
      entriesLabel: "Entries it changes",
      more: (count) => `and ${count} more`,
      confirm: (count) => `Yes, change all ${count} entries`,
      confirmHint: "Tap to confirm",
      save: {
        recategorise_bulk: (count) => `Change ${count === 1 ? "1 entry" : `${count} entries`}`,
        link_transfer: "Link",
        group_create: "Create group",
        simplify: "Simplify",
        category_create: "Add category",
        plan_link: "Link entries"
      },
      saveTransferNone: "Save as a transfer",
      saveDefault: "Save",
      saving: "Saving…",
      discard: "Not now",
      discarded: "Not changed.",
      saved: {
        recategorise_bulk: (count, category) => `Moved ${count === 1 ? "1 entry" : `${count} entries`} to ${category}.`,
        link_transfer: "Linked as a transfer.",
        group_create: "Group created on Splits.",
        simplify: "Simplified on Splits.",
        category_create: "Category added.",
        plan_link: "Linked to the plan line."
      },
      savedTransferNone: "Marked as a transfer. The other side isn't linked yet.",
      // The other sides of a transfer to choose from (ask-transfer-choices.jsx).
      transfer: {
        label: "Other side",
        none: "No other side yet (keep as an unmatched transfer)",
        noneRow: "No other side yet",
        chip: (wallet, day) => `${wallet}, ${day}`,
        walletMissed: (wallet) => `Nothing in ${wallet} has this amount. These other accounts do.`,
        walletMissedNone: (wallet) => `Nothing in ${wallet} has this amount.`
      },
      savedDefault: "Saved.",
      undo: "Undo",
      undoing: "Changing back…",
      undone: "Changed back.",
      rule: (pattern, category) => `Also file new ${pattern} entries as ${category}`,
      ruleSaving: "Saving the rule…",
      ruleSaved: (category) => `New ones will go to ${category} too.`,
      open: { entries: "Open in Entries", splits: "Open Splits", settings: "Open Settings", month: "Open Month" }
    },
    // Bank rows that may be the payment behind a split (AskMatchesCard).
    matches: {
      label: "Matches to review",
      title: "Bank rows that may match your splits",
      subtitle: (month) => month,
      bank: "Bank row",
      accept: "Match",
      skip: "Not this one",
      linked: "Matched",
      skipped: "Skipped",
      needsRate: "Check the rate on Splits",
      saved: "Matched on Splits.",
      openSplits: "Open Splits"
    }
  },
  questions: {
    description: "What was it for?",
    amountMinor: "How much was it?",
    foreignAmount: (amount) => `That was ${amount}. What did it cost in your card's currency? Type it in the amount.`,
    accountId: "Which card or account was it?",
    transferAccountId: "Which account did it move to?",
    transferFrom: "Which account did it come from?",
    date: "Which day was it?",
    ownerName: "Whose is it?",
    splitBasisPoints: "How was it split?",
    otherCategory: "It landed in Other. Which category fits?",
    shareOnSplits: "Share it on Splits?",
    usualSplit: (name, groupName) => `You usually split this with ${name}. Add it to ${groupName}?`,
    checkField: (label) => `Check the ${label.toLowerCase()}.`
  },
  shareOption: (name, percent) => `${name} ${percent}%`,
  // An answer to a search or filter request (ask-answer-card.jsx).
  answer: {
    leads: {
      spend: "Spent",
      income: "Income",
      transfersOut: "Transfers out",
      transfersIn: "Transfers in"
    },
    detail: (label, count) => `${label} · ${count === 1 ? "1 entry" : `${count} entries`}`,
    share: (name) => (name ? `${name}'s share` : "Your share"),
    more: (first, count) => `${first} +${count}`,
    searched: (words) => `“${words}”`,
    types: {
      expense: "Spending",
      income: "Income",
      transfer: "Transfers"
    },
    allEntries: "All entries",
    loading: "Adding it up…",
    noMonth: (month) => `There are no entries for ${month} yet.`,
    loadFailed: "This month's entries couldn't be loaded. Open in Entries to try again."
  },
  // An answer to a money question (ask-money-answer-card.jsx) and the check
  // before it when a likely settle-up or own-account move would change the
  // figures. The answer's own words come from the server's facts.
  money: {
    reading: "Working that out…",
    // The tag on an answer whose words the optional AI phrased (the figures
    // never come from it).
    wordedByAi: "Worded by AI",
    failed: "That couldn't be answered just now. Try again in a moment.",
    check: {
      title: "Check this first",
      settlement: (from, to, date) => `This payment from ${from} to ${to} on ${date} looks like a settle-up between you.`,
      ownTransfer: (owner, date) => `This looks like ${owner} moving money between their own accounts on ${date}.`,
      counted: { spending: "It's counted as spending.", income: "It's counted as income.", both: "It's counted as spending and as income." },
      why: "Sort it first so the answer is right.",
      markSettlement: "Mark as settlement",
      linkTransfer: "Link as transfer",
      realSpending: "It's real spending",
      realIncome: "It's real income",
      marked: "Marked as a settlement.",
      linked: "Linked as a transfer.",
      keptSpending: "Kept as spending.",
      keptIncome: "Kept as income."
    }
  },
  // An insight question: "Ask about this" on a Money insights line
  // (ask-insight-answer.js, ask-insight-answer-card.jsx).
  insight: {
    // The card's title and the question with money hidden (the line itself
    // carries amounts).
    hiddenTitle: "A money insight",
    hiddenQuestion: "Explain this money insight",
    basedOn: "What it's based on",
    entries: "The entries",
    moreEntries: (count) => `${count} more in Entries`,
    noEntries: "No entries match this any more.",
    loading: "Loading the entries…",
    loadFailed: "The entries couldn't be loaded. Open in Entries to see them.",
    openInEntries: "Open in Entries",
    openMonth: "Open Month",
    openSplits: "Open Splits",
    compareStatement: "Compare with the statement",
    // Planning by chat: the month goes in the message box after the caret,
    // so the person types the change before it ("cut shopping by $100").
    changePlan: "Change my plan",
    changePlanText: (monthLabel) => ` in ${monthLabel}`,
    // Money questions Ask already answers, as follow-up chips.
    questions: {
      plan: "How am I doing against the plan?",
      income: "How much income came in?",
      owed: "Who owes who?",
      biggest: "What were the biggest expenses?",
      spending: (monthKey) => `Why was ${formatLongMonth(monthKey)} so expensive?`
    }
  },
  // Follow-ups when a request could mean more than one thing, and view
  // changes, which always wait for a tap.
  filter: {
    questions: {
      month: "Which month? Entries shows one month at a time.",
      wallet: "Which card or account?",
      category: "Which category?",
      person: "Whose entries?"
    },
    unknownCategoryQuestion: (word) => `I couldn't find a category called “${word}”. Did you mean one of these?`,
    unknownCategory: (word) => `I couldn't find a category called “${word}”.`,
    switchPrompt: "Change the view?",
    switchTo: (label) => `Switch to ${label}`,
    nowShowing: (label) => `Now showing ${label}.`,
    alreadyShowing: (label) => `You're already looking at ${label}.`
  }
};
