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
  estimate: "Estimate",
  // How firm Spent is (DOMAIN.md "Trip page", "how firm the total is"):
  // what the bank has confirmed, what is not on a statement yet, and what
  // is an estimate. Plain ink: an estimate is not an alarm.
  firmness: "How sure this total is",
  firmnessPart: {
    confirmed: "Confirmed by the bank",
    waiting: "Not on a statement yet",
    estimate: "Estimated"
  },
  noAmount: (count) => `${count} ${plural(count, "payment", "payments")} with no amount yet`,
  // Needs a look (DOMAIN.md "Trip page", "needs a look"): one line why,
  // one way to fix it.
  needsLook: "Needs a look",
  needsLookSub: "Payments that may be wrong or missing something",
  lookWhy: {
    no_amount: (item) => (item.name ? "The amount didn't come through." : "No details came through."),
    old_estimate: (item) => `Still an estimate after ${item.days} days. Its card statement may be missing.`,
    shared_not_on_splits: () => "Marked Shared, but not on Splits.",
    splits_no_group: (item, groupName) => (groupName ? `On Splits, but not in ${groupName}.` : "On Splits, but not in this trip's group."),
    other_category: () => "In Other, so it has no category yet.",
    maybe_copy: (item) => `Same day and amount as ${item.otherName}. One may be a copy.`
  },
  lookAction: {
    no_amount: "Add the amount",
    old_estimate: "Open",
    shared_not_on_splits: "Add to Splits",
    splits_no_group: "Open",
    other_category: "Open",
    maybe_copy: "See both"
  },
  lookActionLabel: (action, name) => `${action}: ${name}`,
  // A payment with no shop (DOMAIN.md "Bare Tap").
  lookBareName: "Apple Pay payment",
  lookBareAction: "Add the details"
});
