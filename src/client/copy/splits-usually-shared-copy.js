// "Usually shared, not on Splits yet" (the Splits page's lazy section,
// splits-usually-shared.jsx; DOMAIN.md "Usually Shared"). Plain words: what
// the person did with their money, then the count. It ships with the lazy
// Splits route, never with the first screen.
import { countOf } from "./wording";

const entries = (count) => countOf(count, "entry", "entries");

export const usuallySharedCopy = {
  title: "Usually shared, not on Splits yet",
  summary: (entryCount, shopCount) => `You usually share these: ${entries(entryCount)} at ${countOf(shopCount, "shop")}.`,
  review: "Review",
  hide: "Hide",
  sheetTitle: "Usually shared",
  sheetHint: "Past purchases at shops you usually split. Untick any you paid for alone, then add the rest.",
  close: "Close",
  entriesCount: entries,
  // "Usually half each with Joyce in Baby River." / "Usually Tim 70% and Joyce 30% in Baby River."
  usually: ({ ownerName, otherPersonName, groupName, basisPoints, inGroup }) => {
    const percent = Math.round(basisPoints / 100);
    const share = percent === 50 ? "half each" : `${ownerName} ${percent}% and ${otherPersonName} ${100 - percent}%`;
    const withWho = percent === 50 ? ` with ${otherPersonName}` : "";
    return `Usually ${share}${withWho}${inGroup ? ` in ${groupName}` : ""}.`;
  },
  evidence: ({ evidenceCount, matchedCount, matchedBy }) => (
    matchedBy === "category"
      ? `Shared ${evidenceCount} of ${matchedCount} similar purchases.`
      : `Shared ${evidenceCount} of ${matchedCount} times.`
  ),
  add: (count) => `Add ${count}`,
  confirmAll: (count) => `Yes, add all ${count}`,
  confirmHint: (count) => `This puts ${entries(count)} on Splits at once.`,
  cancel: "Cancel",
  adding: "Adding...",
  includeEntry: (description, date) => `Include ${description} on ${date}`,
  added: (count) => `Added ${entries(count)} to Splits.`,
  undo: "Undo",
  undoing: "Taking back...",
  undone: "Taken back off Splits.",
  notAdded: (count) => `${entries(count)} could not be added.`,
  failed: "These could not be added to Splits. Nothing was changed.",
  undoFailed: "These could not be taken back off Splits. Nothing was changed.",
  loadFailed: "The usual list could not be loaded."
};
