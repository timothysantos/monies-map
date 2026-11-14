// Visible words on a trip or event's own page (DOMAIN.md "Trip page";
// design.md "Trip page"). Plain words; the trip's own name is the title.
// Words the trip view on Entries already uses ("Spent", "Day by day",
// "Where it went") are the same here.

const plural = (count, one, many) => (count === 1 ? one : many);

export const tripPageCopy = Object.freeze({
  loading: "Loading this trip or event…",
  loadFailed: "This trip or event didn't load.",
  loadFailedDetail: "Check your connection and try again.",
  tryAgain: "Try again",
  missing: "This trip or event is gone.",
  missingDetail: "It may have been deleted. Its entries are still in Entries.",
  backToEntries: "Open Entries",
  openInEntries: "Open in Entries",
  entries: (count) => `${count} ${plural(count, "entry", "entries")}`,
  spent: "Spent",
  // The Spent figure counts Wallet estimates until their statement comes.
  estimates: (count) => `${count} ${plural(count, "amount was", "amounts were")} paid in another currency and ${plural(count, "is an estimate", "are estimates")} until the card statement comes in.`,
  nothingYet: "Nothing is on it yet. Put entries on it from Entries.",
  dayByDay: "Day by day",
  dayByDaySub: "Tap a day to see what was spent",
  viewDay: (label) => `View entries for ${label}`,
  dayLoading: "Loading…",
  dayFailed: "These entries didn't load. Tap the day to try again.",
  whereItWent: "Where it went",
  whereItWentSub: "By category",
  whoPaid: "Who paid",
  whoPaidSub: "From each person's cards and accounts",
  shared: "Shared",
  stillOwed: "Still owed",
  stillOwedSub: "For this trip's entries on Splits",
  owes: (from, to) => `${from} owes ${to}`,
  nobodyOwes: "Nobody owes anything for this trip.",
  openSplits: "Open Splits",
  biggest: "Biggest spending",
  biggestSub: (count) => (count === 1 ? "The largest entry" : `The ${count} largest entries`),
  estimate: "Estimate"
});
