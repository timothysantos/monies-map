// Visible words for trips and events (DOMAIN.md "Trip or Event"; owner
// approved the design's wording, 2026-11-10). Plain words: a chip shows only
// the trip's name, never the words "Trip or event".

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dayMonth(iso) {
  const [, month, day] = iso.split("-").map(Number);
  return { day, month: MONTHS[month - 1] };
}

// "3 – 9 Oct", "28 Sep – 2 Oct", "16 Aug"; with `year`, the end's year too
// ("3 – 9 Oct 2026"). "" when the trip has no dates.
export function formatTripDates(trip, { year = false } = {}) {
  if (!trip?.startDate) {
    return "";
  }
  const start = dayMonth(trip.startDate);
  const end = dayMonth(trip.endDate ?? trip.startDate);
  const endYear = year ? ` ${(trip.endDate ?? trip.startDate).slice(0, 4)}` : "";
  if (!trip.endDate || trip.endDate === trip.startDate) {
    return `${start.day} ${start.month}${endYear}`;
  }
  const startYear = year && trip.startDate.slice(0, 4) !== trip.endDate.slice(0, 4) ? ` ${trip.startDate.slice(0, 4)}` : "";
  return start.month === end.month && !startYear
    ? `${start.day} – ${end.day} ${end.month}${endYear}`
    : `${start.day} ${start.month}${startYear} – ${end.day} ${end.month}${endYear}`;
}

const entriesWord = (count) => `${count} ${count === 1 ? "entry" : "entries"}`;

export const tripEventsCopy = Object.freeze({
  rowLabel: "Trip or event",
  listTitle: "Trips & events",
  none: "None",
  takeOffAll: "Take off any trip or event",
  searchLabel: "Find or make a trip or event",
  searchPlaceholder: "Find or make a trip or event",
  now: "Now",
  nowTag: "Now",
  recent: "Recent",
  more: "More",
  newRow: "New trip or event",
  newRowHint: "Type its name above",
  noMatch: "No match",
  similar: "Similar",
  make: (name) => `Make "${name}"`,
  makeHint: (count = 1) => count === 1
    ? "Puts this entry on it. Add dates later if you like"
    : `Puts these ${count} entries on it. Add dates later if you like`,
  putManyTitle: (count) => `Put ${entriesWord(count)} on…`,
  tripMeta: (trip) => [formatTripDates(trip), entriesWord(trip.entryCount ?? 0)].filter(Boolean).join(" · "),
  entries: entriesWord,
  moved: (name) => `Moved to ${name}`,
  putOn: (count, name) => (count === 1 ? `Put on ${name}` : `${entriesWord(count)} put on ${name}`),
  takenOff: (count) => (count === 1 ? "Taken off its trip or event" : `${entriesWord(count)} taken off their trip or event`),
  nothingChanged: "Already there",
  undo: "Undo",
  undone: "Undone",
  saveFailed: "That didn't save. Try again.",
  loadFailed: "Trips and events didn't load. Try again.",
  close: "Close",
  chipTitle: (name) => `On ${name}. Change it`,
  suggestionTitle: (name) => `Put this on ${name}?`,
  suggestionLabel: (name) => `${name}?`,
  // The filter, the trip view and the Trips & events sheet.
  filterAll: "All trips & events",
  clear: "Clear",
  // The trip's own page (DOMAIN.md "Trip page"): "Open Seoul trip".
  openTrip: (name) => `Open ${name}`,
  missing: "This trip or event is gone.",
  spent: "Spent",
  before: "Before",
  beforeYouWent: "Before you went",
  whileAway: "While away",
  perDay: (amount) => `${amount} a day`,
  days: (count) => (count === 1 ? "1 day" : `${count} days`),
  categories: (count) => (count === 1 ? "1 category" : `${count} categories`),
  whereItWent: "Where it went",
  dayByDay: "Day by day",
  putAway: "Put away",
  bringBack: "Bring back",
  delete: "Delete",
  putAwayDone: (name) => `${name} put away`,
  broughtBack: (name) => `${name} brought back`,
  deleted: (name) => `${name} deleted. Its entries stay`,
  noDates: "No dates",
  emptyTitle: "See what a trip really cost",
  emptyBody: "Put the spending from a holiday, a wedding or a move in one place, whatever its category or month. Then see the total, who paid and where it went.",
  putAwayCount: (count, shown) => `${count} put away · ${shown ? "Hide" : "Show"}`,
  done: "Done",
  // Picking many rows and the floating bar.
  pick: "Pick",
  pickWholeDay: "Pick the whole day",
  pickDay: "Pick day",
  picked: (count) => `${count} picked`,
  putOnTrip: "Put on a trip or event",
  category: "Category",
  cancel: "Cancel",
  pickBarLabel: "Picked entries",
  tooMany: (max) => `Pick ${max} or fewer to change them together.`,
  categoryTitle: (count) => `Move ${entriesWord(count)} to…`,
  categoryMoved: (count, name) => (count === 1 ? `Moved to ${name}` : `${entriesWord(count)} moved to ${name}`),
  alreadyInCategory: (name) => `They are all in ${name} already.`,
  transfersKeep: "A transfer keeps its Transfer category.",
  changedMeanwhile: "Some of these entries changed meanwhile. Pick them again to see them as they are now.",
  confirmAll: (count, name) => `Change all ${count} to ${name}?`,
  yesAll: (count) => `Yes, change all ${count}`,
  // The New sheet (design 2d), also used to change one.
  newTitle: "New trip or event",
  changeTitle: (name) => `Change ${name}`,
  change: "Change",
  name: "Name",
  namePlaceholder: "Seoul trip",
  icon: "Icon",
  dates: "Dates (if it has some)",
  firstDay: "First day",
  lastDay: "Last day",
  to: "to",
  paidIn: "Paid in (optional)",
  notAbroad: "Not abroad",
  sharedCosts: "Shared costs",
  linkSplits: (name) => `Link "${name}" splits`,
  noLink: "No link",
  startFromGroup: "Start from a split group",
  checkThem: "Check them",
  makeEmpty: "Make it empty",
  save: "Save",
  saving: "Saving…",
  // "37 entries look like part of it. 28 paid in won and 9 already on Seoul
  // trip splits. 12 more in these days were paid in dollars."
  preview: ({ ticked, inCurrency, onSplits, others, currencyWord, groupName, abroad }) => {
    const parts = [
      inCurrency ? `${inCurrency} paid in ${currencyWord}` : "",
      onSplits ? `${onSplits} already on ${groupName} splits` : ""
    ].filter(Boolean);
    const lead = ticked ? `${entriesWord(ticked)} look${ticked === 1 ? "s" : ""} like part of it.${parts.length ? ` ${parts.join(" and ")}.` : ""}` : "";
    const rest = others
      ? (ticked
        ? ` ${others} more in these days ${abroad ? "were paid in dollars" : (others === 1 ? "is" : "are") + " not ticked"}.`
        : `${entriesWord(others)} ${others === 1 ? "is" : "are"} in these days.`)
      : "";
    return `${lead}${rest}`.trim();
  },
  // The review list (design 2d).
  reviewTitle: (name) => `Add to ${name}`,
  groupCurrency: (word) => `Paid in ${word}`,
  groupSplits: (name) => `On ${name} splits`,
  groupDollars: "Also in these dates, in dollars",
  groupInDates: "In these dates",
  groupSearch: "Booked before you went?",
  ofTicked: (ticked, total) => `${ticked} of ${total} ticked`,
  ofCount: (ticked, total) => `${ticked} of ${total}`,
  search: "Search",
  searchWords: "Shop or note",
  searchNothing: "Nothing found before the trip.",
  addEntries: (count) => (count === 1 ? "Add 1 entry" : `Add ${count} entries`),
  homeBillsLeft: "Home bills in these days (rent, standing orders) are left unticked.",
  moreThanListed: "There are more entries in these days than this list shows.",
  nothingToAdd: "No more entries look like part of it.",
  added: (count, name) => `${entriesWord(count)} added to ${name}`,
  checkDates: "Check entries from these dates",
  // "Also ₩96,000 cash on Seoul trip splits, not in Entries", around the
  // amount (an openable figure).
  splitCash: (name) => ({ before: "Also ", after: ` cash on ${name} splits, not in Entries` }),
  // Owner decision 3 = A: Add to splits on a linked group.
  alsoPutOn: (name) => `Also put on ${name}`,
  // The Trips & events sheet's empty state.
  makeFirst: "Make your first one",
  startFrom: (name) => `Start from "${name}" splits`
});
