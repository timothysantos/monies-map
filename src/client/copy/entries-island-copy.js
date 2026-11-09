// Words for the Entries filter summary on the phone island's context line
// (entries-island-context.js). Plain words, no amounts. Loaded with the
// Entries route, never in the first screen.

export const entriesIslandCopy = {
  filteredBy: (label, countText) => `Filtered by ${label}, ${countText}`,
  searching: (words) => `Searching “${words}”`,
  quoted: (words) => `“${words}”`,
  filters: (count) => `${count} filters`,
  amountRange: "Amount range",
  pickedEntries: "Picked entries",
  tripEvent: "A trip or event",
  severalMonths: "Several months",
  noEntries: "No entries",
  entries: (count) => (count === 1 ? "1 entry" : `${count} entries`),
  more: (first, count) => `${first} +${count}`
};
