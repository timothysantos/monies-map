// Every visible word of the quick pad (design.md "Cash pad";
// docs/flows/cash-entry-flow.md). Plain words: what happened to the
// person's money, then the number.
export const cashPadCopy = Object.freeze({
  // The chip on Ask's new entry card that opens the pad, and its title: one
  // pad for cash and cards, for a payment just made.
  chip: "Just paid",
  title: "Just paid",
  description: "Type what you paid, then Save. Say what it was later.",
  close: "Close",
  // From a new entry: back to it, to type or say a sentence or scan a receipt.
  typeInstead: "Type it instead",
  changeLine: "Change how you paid, the currency, day or who paid",
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
    way: "Paid with",
    wallet: "Cash from",
    currency: "Currency",
    day: "Day",
    person: "Who paid",
    done: "Done"
  },
  // "Paid with": cash, or one of this person's cards (by name).
  cash: "Cash",
  walletQuestion: "Which wallet did the cash come from?",
  walletHint: "Set a cash wallet in Settings, Payment ways, and this won't ask again.",
  // After a save whose wallet the person just picked for cash (the pad's
  // question, or Ask's): one tap makes it their cash wallet, so cash stops
  // asking. Shared with Ask (ask-chips.js).
  rememberCash: "Remember this for cash",
  rememberedCash: (walletName) => `Cash will use ${walletName} from now on. Change it in Settings, Payment ways.`,
  // Apple Pay taps that reached the app without their amount.
  taps: {
    title: "Apple Pay missed the amount",
    button: (merchant, time) => (time ? `${merchant}, ${time}` : merchant),
    chosen: (merchant, cardName) => `${merchant} · ${cardName}`,
    clear: "Not this one"
  },
  // A card payment saved while a tap on that card waits.
  offer: {
    question: (merchant, time) => `Is this the ${merchant} payment${time ? ` from ${time}` : ""}? Apple Pay didn't send its amount.`,
    yes: "Yes, that one",
    no: "No, a new payment"
  },
  // After Save.
  saved: (what) => `Saved: ${what}`,
  undo: "Undo",
  undone: "Removed that payment.",
  moreCategories: "More categories",
  shared: "Shared",
  sharedDone: "Shared on Splits",
  addAnother: "Add another",
  done: "Done",
  categoryTitle: "Category",
  // The one words box: what it was, in a few words, now or later.
  words: {
    label: "What was it?",
    // The other person's name when there is one: "Like: dinner, split with Joyce".
    placeholder: (otherName) => (otherName ? `Like: dinner, split with ${otherName}` : "Like: dinner"),
    send: "Add",
    reading: "Reading…",
    failed: "That couldn't be read just now. Try again, or pick a category.",
    other: "That reads like something else. Say what it was, and who shared it.",
    saved: "Saved.",
    undone: "Put back as it was."
  },
  // The list Ask's reminder opens: payments that still need a few words.
  list: {
    title: (count) => (count === 1 ? "1 payment needs a few words" : `${count} payments need a few words`),
    none: "Every payment has a few words now.",
    backToPad: "Type a payment",
    describe: "Add words",
    described: "Has its words"
  },
  // Waiting to send.
  waitingTitle: "Waiting to send",
  waitingDetail: "Kept on this phone. It sends by itself when the connection is back.",
  waitingSaved: (what) => `Waiting to send: ${what}`,
  // The same line once that payment has gone.
  waitingSent: (what) => `Sent: ${what}`,
  waitingRate: (currency) => `No ${currency} exchange rate yet. It sends by itself when there is one.`,
  waitingNotKept: "This phone couldn't keep it. Keep the pad open until it sends.",
  sendNow: "Send now",
  remove: "Remove",
  notSent: (reason) => `Not sent: ${reason}`,
  sent: (count) => (count === 1 ? "1 waiting payment sent." : `${count} waiting payments sent.`),
  // Something went wrong on a follow-up; the entry is saved.
  followUpFailed: "That change didn't save. The payment itself is saved."
});
