import { splitActivityMatchesSearch } from "../domain/search-text";
import {
  moneySearchText,
  textMatchesSearch,
  uniqueSearchSuggestions
} from "./search-filter";

// A split row's search text is the domain's (search-text.ts), shared with
// the Worker's search inside settled sections.
export { splitActivityMatchesSearch };

export function splitMatchMatchesSearch(match, query) {
  return textMatchesSearch(buildSplitMatchSearchText(match), query);
}

export function filterSplitActivityForSearch(activity, query = "") {
  return activity.filter((item) => splitActivityMatchesSearch(item, query));
}

export function filterSplitMatchesForSearch(matches, query = "") {
  return matches.filter((item) => splitMatchMatchesSearch(item, query));
}

export function getSplitSearchSuggestions(activity, matches = [], query = "", limit = 6) {
  return uniqueSearchSuggestions([
    ...activity.flatMap((item) => [
      item.description,
      item.note,
      item.categoryName,
      item.paidByPersonName,
      item.fromPersonName,
      item.toPersonName,
      item.groupName,
      item.linkedTransactionDescription,
      item.linkedTransactionNote,
      ...(item.shares ?? []).map((share) => share.personName)
    ]),
    ...matches.flatMap((match) => [
      match.splitDescription,
      match.transactionDescription,
      match.groupName,
      match.reviewLabel,
      match.confidenceLabel
    ])
  ], query, limit);
}

function buildSplitMatchSearchText(match) {
  return [
    match.kind,
    match.groupName,
    match.reviewLabel,
    match.confidenceLabel,
    match.splitDate,
    match.splitDescription,
    match.transactionDate,
    match.transactionDescription,
    moneySearchText(match.splitAmountMinor, match.amountMinor, match.amountDeltaMinor)
  ].filter(Boolean).join(" ");
}
