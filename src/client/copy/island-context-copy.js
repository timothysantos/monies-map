// Words for the phone island's contextual line (mobile-context-line.jsx, a
// lazy chunk). The Entries filter wording is in entries-island-copy.js,
// loaded with the Entries route.

export const islandContextCopy = {
  // The trailing button while filters are applied, and what a screen reader hears.
  clear: "Clear",
  clearName: "Clear all filters",
  // A month other than this one on the Summary tab.
  backToMonth: "Back to this month",
  viewing: (month) => `Viewing ${month}`,
  // The summary opens the filters; the visible text is part of the name.
  changeFilters: (text) => `${text}, change filters`
};
