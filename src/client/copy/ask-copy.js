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
    savedOnSplits: "Saved to Entries and added to Splits.",
    splitAddFailed: (error) => `Saved to Entries, but it couldn't be added to Splits: ${error}`,
    undone: "Removed. The card is back if you want to change it and save again.",
    shortcutSaved: "Saved from Apple Pay.",
    shortcutMissing: "That entry couldn't be found. It may have been removed.",
    shortcutLoading: "Opening the saved entry…",
    categoryChanged: (name) => `Moved to ${name}.`,
    addedToSplits: (groupName) => (groupName ? `Added to Splits: ${groupName}.` : "Added to Splits."),
    askNotReady: "I can add entries here for now. Questions about your money aren't answered yet."
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
