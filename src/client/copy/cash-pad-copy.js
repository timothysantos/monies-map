// Every visible word of the cash pad (design.md "Cash pad";
// docs/flows/cash-entry-flow.md). Plain words: what happened to the
// person's money, then the number.
export const cashPadCopy = Object.freeze({
  // The chip on Ask's new entry card that opens the pad.
  chip: "Cash",
  title: "Cash",
  description: "Type what you paid in cash, then Save.",
  close: "Close",
  changeLine: "Change wallet, currency, day or who paid",
  chooseWallet: "Choose a wallet",
  today: "Today",
  yesterday: "Yesterday",
  amountLabel: "Amount paid",
  again: "Again",
  save: "Save",
  saving: "Saving…",
  keys: { back: "Delete last digit", thousand: "Three zeros", point: "Decimal point" },
  // The change panel behind the quiet line.
  change: {
    wallet: "Wallet",
    currency: "Currency",
    day: "Day",
    person: "Who paid",
    done: "Done"
  },
  walletQuestion: "Which wallet did the cash come from?",
  walletHint: "Set a cash wallet in Settings, Payment ways, and this won't ask again.",
  // After Save.
  saved: (what) => `Saved: ${what}`,
  undo: "Undo",
  undone: "Removed that payment.",
  moreCategories: "More categories",
  shared: "Shared",
  sharedDone: "Shared on Splits",
  addNote: "Add a note",
  notePlaceholder: "What was it for?",
  saveNote: "Save note",
  noteSaved: "Note saved",
  addAnother: "Add another",
  done: "Done",
  categoryTitle: "Category",
  // Waiting to send.
  waitingTitle: "Waiting to send",
  waitingDetail: "Kept on this phone. It sends by itself when the connection is back.",
  waitingSaved: (what) => `Waiting to send: ${what}`,
  waitingRate: (currency) => `No ${currency} exchange rate yet. It sends by itself when there is one.`,
  waitingNotKept: "This phone couldn't keep it. Keep the pad open until it sends.",
  sendNow: "Send now",
  remove: "Remove",
  notSent: (reason) => `Not sent: ${reason}`,
  sent: (count) => (count === 1 ? "1 waiting payment sent." : `${count} waiting payments sent.`),
  // Something went wrong on a follow-up; the entry is saved.
  followUpFailed: "That change didn't save. The payment itself is saved."
});
