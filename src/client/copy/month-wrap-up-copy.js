// Words for the Month page's wrap-up card (DOMAIN.md "Month Wrap-up";
// design.md "Month wrap-up"), built on the owner's go-ahead of 14 Nov 2026
// with no mockup: every label and action reuses the words the app already
// says for the same thing (the month checklist reminder, the What changed
// card, the figure menu, Ask's "Open in Entries"). Loaded with the card's
// lazy chunk, never in the first screen. With money hidden the card says no
// amount and never who owes whom.

const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const joinNames = (names) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

export const monthWrapUpCopy = {
  // The card's head ("Wrap up", "October: 2 of 6 checks done") is in
  // summary-card-titles.js with every card's. The whole card once every check is done.
  wrappedUp: (monthName) => `${monthName} is wrapped up`,
  listLabel: (monthName) => `Checks for ${monthName}`,
  done: "Done",
  toDo: "Still to do",

  changed: {
    label: "What changed",
    // "against September": the month it is compared with.
    against: (monthName) => `Against ${monthName}`,
    up: "up",
    down: "down",
    seeAll: "See all"
  },
  other: {
    label: "Left in Other (no category)",
    value: (count) => plural(count, "entry", "entries"),
    none: "None",
    open: "Open in Entries"
  },
  estimates: {
    label: "Foreign currency estimates",
    value: (count) => `${count} not confirmed by the bank yet`,
    none: "None",
    open: "Open in Entries"
  },
  statements: {
    label: "Statements imported",
    missing: (names) => `${names.length === 1 ? "1 statement" : `${names.length} statements`} not brought in yet: ${joinNames(names)}`,
    all: (count) => (count === 1 ? "The only one" : `All ${count}`),
    open: "Open Imports"
  },
  splits: {
    label: "Splits to settle",
    none: "Nothing to settle",
    // With money hidden: how many, never who owes whom.
    many: (count) => `${count} to settle`,
    usuallyShared: (count) => `${plural(count, "entry", "entries")} you usually share, not on Splits yet`,
    open: "Open Splits"
  },
  plan: {
    label: "Over plan",
    over: "over",
    hiddenCount: (count) => plural(count, "category", "categories"),
    none: "Nothing over plan",
    open: "Open plan"
  },
  note: {
    label: "Monthly note",
    written: "Written",
    notWritten: "Not written yet",
    open: "Write the note"
  }
};
