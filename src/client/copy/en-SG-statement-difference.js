// Why a saved statement and the entries differ. Shown on the Imports page's
// account check and in Settings' statement history, so it ships with those
// routes and not with the first screen.
import { countOf, listOf } from "./wording";

export const statementDifferenceMessages = {
  matched: "Matched",
  // The whole difference is purchases (or payments) the bank put on the
  // next statement: nothing is wrong.
  matchedBilledNext: (count, amount) =>
    `Matched. ${countOf(count, "entry", "entries")} worth ${amount} ${count === 1 ? "was" : "were"} billed on the next statement.`,
  offBy: (amount) => `Off by ${amount}`,
  entry: (description, date, amount) => `${description} on ${date} (${amount})`,
  notOnStatementOne: (entry) => `${entry} is not on the statement.`,
  notOnStatementOneOf: (entries) => `One of these is not on the statement: ${listOf(entries)}.`,
  notOnStatementGroup: (entries, moreCount) =>
    `These are not on the statement: ${listOf(entries)}${moreCount ? ` and ${moreCount} more` : ""}.`,
  partlyBilledNext: (amount) => `${amount} of it was billed on the next statement.`,
  notExplained: (amount) => `${amount} is not explained yet.`,
  removeEntry: "Remove this entry",
  removeEntryPrompt: (entry) => `You are removing ${entry}. This cannot be undone here. Confirm?`,
  removeEntryConfirm: "Remove"
};
