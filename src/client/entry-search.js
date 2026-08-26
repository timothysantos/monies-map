import {
  moneySearchText,
  textMatchesSearch,
  uniqueSearchSuggestions
} from "./search-filter";

export function entryMatchesSearch(entry, query) {
  return textMatchesSearch(buildEntrySearchText(entry), query);
}

export function getEntrySearchSuggestions(entries, query = "", limit = 6) {
  return uniqueSearchSuggestions(entries.flatMap((entry) => [
    entry.description,
    entry.note,
    entry.accountName,
    entry.categoryName,
    entry.ownerName,
    ...(entry.splits ?? []).map((split) => split.personName)
  ]), query, limit);
}

function buildEntrySearchText(entry) {
  return [
    entry.date,
    entry.postedDate,
    entry.description,
    entry.note,
    entry.accountName,
    entry.categoryName,
    entry.ownerName,
    entry.entryType,
    entry.transferDirection,
    entry.sourceType,
    entry.bankCertificationStatus,
    moneySearchText(entry.amountMinor, entry.totalAmountMinor, entry.visibleAmountMinor),
    ...(entry.splits ?? []).flatMap((split) => [
      split.personName,
      moneySearchText(split.amountMinor)
    ])
  ].filter(Boolean).join(" ");
}
