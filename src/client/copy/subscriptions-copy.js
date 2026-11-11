// Words for Summary's "Subscriptions and bills" card (DOMAIN.md "Repeating
// Charge"), as the owner approved them on 10 Nov 2026. Loaded with the
// card's lazy chunk, never in the first screen.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const monthIndex = (month) => Number(String(month).slice(5, 7)) - 1;
export const monthName = (month) => MONTHS[monthIndex(month)] ?? "";
export const shortMonthName = (month) => SHORT_MONTHS[monthIndex(month)] ?? "";

// "the 1st", "the 22nd".
export function ordinalDay(day) {
  const tens = day % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[day % 10] ?? "th");
  return `the ${day}${suffix}`;
}

// "12 Mar", "1 Dec".
export const dayMonth = (date) => `${Number(String(date).slice(8, 10))} ${shortMonthName(String(date).slice(0, 7))}`;

export const subscriptionsCopy = {
  title: "Subscriptions and bills",
  intro: "Charges that come back every month or every year, found in your entries.",
  introPhone: "Charges that come back every month or year.",
  inMonth: (month) => `In ${monthName(month)}`,
  lastYear: "Last 12 months",
  all: (count) => `All ${count}`,
  sorted: "Sorted by cost over 12 months",
  // The wide card's chips and bar legend.
  priceRises: (count) => (count === 1 ? "1 price rise" : `${count} price rises`),
  nextCharge: (name, amount, date) => `Next: ${name}${amount ? ` ${amount}` : ""} on ${dayMonth(date)}`,
  kindLabel: { monthly: "Monthly", varies: "Changes each month", yearly: "Yearly" },
  kindBarLabel: "What you pay, by kind",
  aMonth: "a month",
  aYear: "a year",
  lastOne: "last one",
  yearLabel: "12 months",
  monthly: "monthly",
  yearly: "yearly",
  around: (series) => (series.period === "yearly" ? `around ${dayMonth(series.nextDate)}` : `around ${ordinalDay(series.usualDay)}`),
  // "Insurance · monthly, around the 1st · UOB One • Tim"
  meta: (series) => [series.category, `${series.period === "yearly" ? "yearly" : "monthly"}, ${subscriptionsCopy.around(series)}`, series.account].filter(Boolean).join(" · "),
  // The phone's shorter line: "Monthly · around the 1st".
  metaPhone: (series) => `${series.period === "yearly" ? "Yearly" : "Monthly"} · ${series.kind === "varies" ? "changes each month" : subscriptionsCopy.around(series)}`,
  lateMeta: (series) => `Usually around ${ordinalDay(series.usualDay)} · stopped?`,
  changesEachMonth: "Changes each month",
  // "Went up: $38.90 → $42.90 in Sep", in three parts around the two amounts
  // (each its own figure).
  wentUpParts: (date) => ["Went up: ", " → ", ` in ${shortMonthName(String(date).slice(0, 7))}`],
  wentUpPhone: (by, date) => `Went up ${by} in ${shortMonthName(String(date).slice(0, 7))}`,
  // With money hidden: no amounts.
  wentUpHidden: (date) => `Went up in ${shortMonthName(String(date).slice(0, 7))}`,
  notSeenSince: (month) => `Not seen since ${shortMonthName(month)}`,
  mightRepeat: (count) => `${count} more might repeat`,
  mightRepeatHint: "Found twice in a row · check them ›",
  takenOff: (count) => `${count} taken off the list`,
  stopped: (count) => `${count} stopped`,
  show: "Show ›",
  hide: "Hide",
  seeAll: (count) => `See all ${count} ›`,
  // Choices (owner decision D3: the whole household sees them).
  introChoices: "Charges that come back every month or every year, found in your entries. Tap one to keep it, rename it or take it off the list.",
  openRow: (name) => `${name}: details and choices`,
  usually: "Usually",
  wentUpLabel: "Went up",
  comes: "Comes",
  paidFrom: "Paid from",
  found: (series) => (series.period === "yearly"
    ? `Found ${series.runLength} years in a row in your entries.`
    : `Found ${series.runLength} months in a row in your entries.`),
  keep: "Keep it on the list",
  rename: "Rename",
  notRepeating: "Not a subscription or bill",
  showAgain: "Show again",
  close: "Close",
  nameLabel: "Name",
  nameMax: 40,
  saveName: "Save",
  renameNote: "Rename changes only the name shown here.",
  // The line after a choice, with Undo.
  done: {
    keep: "Kept on the list",
    take_off: "Taken off the list",
    show_again: "Back on the list",
    rename: "Renamed",
    restore: "Undone"
  },
  undo: "Undo",
  // Coming up: the next 30 days, by week.
  comingUp: "Coming up",
  tabsLabel: "Subscriptions and bills lists",
  weeks: { this: "This week", next: "Next week", later: "Later" },
  usuallyAround: (date) => `Usually around ${dayMonth(date)}`,
  lastThree: "last 3",
  moreBy: (count, date) => `${count} more by ${dayMonth(date)} ›`,
  nothingComing: "Nothing is due to come in the next 30 days.",
  saveFailed: "That didn't save. Try again."
};
