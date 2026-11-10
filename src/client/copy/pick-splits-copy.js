// Visible words for "Add to Splits" in the picked rows' bar on Entries
// (design.md "Picking many", DOMAIN.md "Chosen Split"). Plain words: what
// happens to the person's money, then the count. Loaded with the lazy pick
// bar, never with the first screen.
import { countOf } from "./wording";

const entries = (count) => countOf(count, "entry", "entries");

export const pickSplitsCopy = {
  button: "Add to Splits",
  title: (count) => `Add ${entries(count)} to Splits`,
  close: "Close",
  groupLegend: "Split group",
  shareLegend: "Share",
  halfEach: "Half each",
  // "Joyce owes all of it": the person who paid is owed the whole amount.
  otherOwesAll: (otherName) => `${otherName} owes all of it`,
  allPayers: (payerName) => `All ${payerName}'s`,
  otherPersonFallback: "the other person",
  payerFallback: "the payer",
  // "12 entries to Splits with Joyce, half each, in Okaeri"
  preview: ({ count, otherName, share, groupName }) => `${entries(count)} to Splits with ${otherName}, ${share}${groupName ? `, in ${groupName}` : ""}`,
  shareWords: {
    half: "half each",
    otherOwesAll: (otherName) => `${otherName} owes all of it`,
    allPayers: (payerName) => `all ${payerName}'s`
  },
  add: (count) => `Add ${count}`,
  adding: "Adding...",
  confirmAll: (count) => `Add all ${count} to Splits?`,
  yesAll: (count) => `Yes, add all ${count}`,
  nothingToAdd: "Nothing to add: these are already on Splits, or they are income or transfers.",
  added: (count) => `${entries(count)} added to Splits`,
  alreadyOn: (count) => `${count} ${count === 1 ? "was" : "were"} already on Splits`,
  leftOut: (count) => `${count} income or transfer ${count === 1 ? "was" : "were"} left out`,
  couldNot: (count) => `${count} could not be added`,
  noneAdded: "None of these could be added to Splits.",
  saveFailed: "That didn't save. Try again.",
  undoFailed: "That could not be undone. Try again."
};
