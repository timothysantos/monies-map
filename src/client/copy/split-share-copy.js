// Words for adding an entry to Splits from the entry editor: the one-tap
// quick add and the 0% / 50% / 100% share choices (split-share-choices.jsx).
// Loaded with the Entries route, never in the first screen. An even split is
// "half each" in plain words, never a ratio like "50/50".

export const splitShareCopy = {
  halfEach: "Half each",
  // The quick add under the Splits row: the group it adds to, half each.
  quickAdd: (groupName) => `Add to ${groupName} · Half each`,
  quickAddTitle: (groupName) => `Add this expense to ${groupName}, half each`,
  shareGroup: (personName) => `${personName}'s share`,
  // The share is the first person's. At 0% none of the expense is theirs, so
  // if they paid it the other person owes them all of it.
  shareHint: (personName, otherName) => `0% means none of it is ${personName}'s: if ${personName} paid, ${otherName} owes ${personName} all of it. 100% means it is all ${personName}'s.`,
  otherPersonFallback: "the other person"
};
