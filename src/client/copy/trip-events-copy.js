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
  suggestionLabel: (name) => `${name}?`
});
