// The Entries list filters as the URL carries them, read and written in one
// place. The Entries page reads its filters with readEntriesFilterParams;
// the Ask page writes an Ask answer's filter with buildEntriesFilterSearch
// and reads it back through the same reader, so an answer's numbers and the
// Entries page it opens can never disagree (docs/flows/ask-flow.md, "Search
// and filter").
//
// Params (all on /entries):
// - entry_search: words every row must contain (entry-search.js)
// - entry_wallet: account ids, one param each (a comma list still reads)
// - entry_category: category names, one param each (a comma list still reads)
// - entry_type: expense | income | transfer
// - entry_min, entry_max: amounts in dollars ("50" or "50.00"), compared with
//   the amount the row shows for the view; only an Ask answer sets them
// - entry_id: entry ids (the check-in's links)
// - entries_scope: direct | shared | direct_plus_shared
// - from_ask=1: the filters came from an Ask answer, so the page shows the
//   "From Ask" chip that clears them or goes back to Ask

import { normalizeEntryFilterValues } from "./entry-filter-values";

export const ENTRY_TYPES = Object.freeze(["expense", "income", "transfer"]);
export const ENTRY_SCOPES = Object.freeze(["direct", "shared", "direct_plus_shared"]);

// The list filters an Ask answer sets and the From Ask chip's ✕ clears. The
// view, month and scope stay: the page header and the View and scope bar
// show them.
export const ASK_FILTER_PARAM_KEYS = Object.freeze([
  "entry_search",
  "entry_wallet",
  "entry_category",
  "entry_type",
  "entry_min",
  "entry_max",
  "from_ask"
]);

function readMultiValues(searchParams, key) {
  const values = searchParams.getAll(key);
  if (values.length > 1) {
    return normalizeEntryFilterValues(values);
  }
  const singleValue = values[0] ?? "";
  return singleValue ? normalizeEntryFilterValues(singleValue.split(",").map((value) => value.trim())) : [];
}

// "50", "50.5", "1,200.00" → minor units; anything else → null.
export function readAmountParam(value) {
  const text = String(value ?? "").replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    return null;
  }
  return Math.round(Number(text) * 100);
}

export function formatAmountParam(amountMinor) {
  return Number.isFinite(amountMinor) && amountMinor >= 0 ? (amountMinor / 100).toFixed(2) : "";
}

export function readEntriesFilterParams(searchParams, defaultScope = "direct_plus_shared") {
  const type = searchParams.get("entry_type") ?? "";
  return {
    selectedScope: searchParams.get("entries_scope") ?? defaultScope,
    entryFilters: {
      entryIds: searchParams.getAll("entry_id"),
      wallets: readMultiValues(searchParams, "entry_wallet"),
      categories: readMultiValues(searchParams, "entry_category"),
      type,
      search: searchParams.get("entry_search") ?? "",
      minAmountMinor: readAmountParam(searchParams.get("entry_min")),
      maxAmountMinor: readAmountParam(searchParams.get("entry_max"))
    }
  };
}

/**
 * An Ask answer's filter (ask-filter-reader.js) as the Entries URL that
 * shows the same rows.
 * @param {{ month: string, viewId: string, scope: string, search?: string, categories?: string[], wallets?: string[], type?: string, minAmountMinor?: number | null, maxAmountMinor?: number | null }} filter
 */
export function buildEntriesFilterSearch(filter, { fromAsk = true } = {}) {
  const params = new URLSearchParams();
  const viewId = filter.viewId || "household";
  const scope = viewId === "household" ? "direct_plus_shared" : (ENTRY_SCOPES.includes(filter.scope) ? filter.scope : "direct_plus_shared");
  params.set("view", viewId);
  if (filter.month) params.set("month", filter.month);
  params.set("scope", scope);
  params.set("entries_scope", scope);
  if (filter.search) params.set("entry_search", filter.search);
  for (const wallet of normalizeEntryFilterValues(filter.wallets ?? [])) params.append("entry_wallet", wallet);
  for (const category of normalizeEntryFilterValues(filter.categories ?? [])) params.append("entry_category", category);
  if (filter.type && ENTRY_TYPES.includes(filter.type)) params.set("entry_type", filter.type);
  if (Number.isFinite(filter.minAmountMinor)) params.set("entry_min", formatAmountParam(filter.minAmountMinor));
  if (Number.isFinite(filter.maxAmountMinor)) params.set("entry_max", formatAmountParam(filter.maxAmountMinor));
  if (fromAsk) params.set("from_ask", "1");
  return params;
}

// The filters the From Ask chip names, read back from the URL (so a filter
// changed by hand on Entries shows as it now is).
export function readAskFilterFromParams(searchParams) {
  const { entryFilters } = readEntriesFilterParams(searchParams);
  return {
    search: entryFilters.search,
    wallets: entryFilters.wallets,
    categories: entryFilters.categories,
    type: ENTRY_TYPES.includes(entryFilters.type) ? entryFilters.type : "",
    minAmountMinor: entryFilters.minAmountMinor,
    maxAmountMinor: entryFilters.maxAmountMinor
  };
}

export function hasAskFilterChip(searchParams) {
  if (searchParams.get("from_ask") !== "1") {
    return false;
  }
  const filter = readAskFilterFromParams(searchParams);
  return Boolean(filter.search || filter.wallets.length || filter.categories.length || filter.type
    || filter.minAmountMinor !== null || filter.maxAmountMinor !== null);
}

export function clearAskFilterParams(searchParams) {
  const next = new URLSearchParams(searchParams);
  ASK_FILTER_PARAM_KEYS.forEach((key) => next.delete(key));
  return next;
}
