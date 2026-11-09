import { entryFilterCopy } from "./copy/entry-filter-copy";
import { figureCopy } from "./copy/figure-copy";
import { entriesIslandCopy as copy } from "./copy/entries-island-copy";

// What the phone island's context says while the Entries list is
// narrowed (design.md, "Island context line"). Pure: the panel passes the
// filters it already reads from the URL and the number of rows it shows.
//
// A filter counts as applied when it narrows the list: categories, accounts,
// type, search words, an amount range, picked entries, a figure and a period
// of months. The view, the scope and the month are not filters (the island
// already shows them and Clear keeps them). Amounts are never shown: an
// amount range is only named.

export const ISLAND_SEARCH_MAX = 21;
const NAME_MAX = 24;

function cut(text, max) {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

// Words as the person typed them, on one line: no line breaks, no runs of
// spaces, no quote marks of ours inside the quotes. React escapes the rest.
function cleanSearch(search) {
  return String(search ?? "")
    .replace(/[“”"]|\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function listLabel(names) {
  const first = cut(names[0], NAME_MAX);
  return names.length === 1 ? first : copy.more(first, names.length - 1);
}

/**
 * @param {{ entryFilters: any, entryCount: number, wallets?: { value: string, label?: string }[], hasPeriod?: boolean, tripName?: string }} input
 * @returns {{ text: string, label: string, announce: string, filterCount: number } | null}
 */
export function buildEntriesIslandContext({ entryFilters, entryCount, wallets = [], hasPeriod = false, tripName = "" }) {
  const parts = [];
  // A trip or event first, by its name (DOMAIN.md "Trip or Event").
  if (entryFilters.tripEventId) {
    parts.push(cut(tripName || copy.tripEvent, NAME_MAX));
  }
  const categories = entryFilters.categories ?? [];
  const walletIds = entryFilters.wallets ?? [];
  const search = cleanSearch(entryFilters.search);
  if (categories.length) {
    parts.push(listLabel(categories));
  }
  if (walletIds.length) {
    parts.push(listLabel(walletIds.map((id) => wallets.find((option) => option.value === id)?.label ?? id)));
  }
  if (entryFilters.type && entryFilterCopy.types[entryFilters.type]) {
    parts.push(entryFilterCopy.types[entryFilters.type]);
  }
  if (Number.isFinite(entryFilters.minAmountMinor) || Number.isFinite(entryFilters.maxAmountMinor)) {
    parts.push(copy.amountRange);
  }
  if (entryFilters.entryIds?.length) {
    parts.push(copy.pickedEntries);
  }
  if (entryFilters.figure) {
    parts.push(figureCopy.names[entryFilters.figure] ?? figureCopy.names.spent);
  }
  if (hasPeriod) {
    parts.push(copy.severalMonths);
  }
  const quotedSearch = search ? cut(search, ISLAND_SEARCH_MAX) : "";
  if (quotedSearch) {
    parts.push(copy.quoted(quotedSearch));
  }
  if (!parts.length) {
    return null;
  }
  // Search alone reads "Searching “coffee”"; among other filters just the quoted words.
  const label = parts.length > 2
    ? copy.filters(parts.length)
    : parts.length === 1 && quotedSearch
      ? copy.searching(quotedSearch)
      : parts.join(", ");
  const countText = entryCount > 0 ? copy.entries(entryCount) : copy.noEntries;
  return {
    text: `${label} · ${countText}`,
    label,
    announce: copy.filteredBy(label, countText),
    filterCount: parts.length
  };
}
