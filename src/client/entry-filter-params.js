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
// - entry_invest_moves=1: with entry_category Investments, also the transfers
//   into investment accounts (the invested part's View entries and the
//   invested answer's Open in Entries; src/domain/investment-moves.ts)
// - entry_id: entry ids (the check-in's links, and an insight answer's
//   Open in Entries)
// - entry_figure: the rows behind one figure and that figure as the lead
//   (src/domain/money-figures.ts): spending | invested | kept | earned |
//   from_savings | took_out | spent | expenses | transfers | outflow |
//   difference; a
//   card's "View entries" (design.md "Openable figures")
// - entry_from, entry_to: a period of months (YYYY-MM) in place of the one
//   month, when entry_to is the page's month: a Summary range's figure
//   lists the whole range. Another month picked in the header drops it.
// - entry_trip: a trip or event's id (DOMAIN.md "Trip or Event"): the trip
//   view, every entry on it across its months, whatever the month
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
  "entry_id",
  "entry_invest_moves",
  "entry_figure",
  "entry_from",
  "entry_to",
  "entry_trip",
  "from_ask"
]);

// The figures entry_figure names (MONEY_FIGURES in src/domain/money-figures.ts,
// pinned by tests/money-figures.test.mjs; listed here so this module stays
// free of the domain's entry code).
export const ENTRY_FIGURES = Object.freeze(["spending", "invested", "kept", "earned", "from_savings", "took_out", "spent", "expenses", "transfers", "outflow", "difference"]);

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;
// The longest period Entries lists at once: two years of months.
export const MAX_ENTRY_RANGE_MONTHS = 24;

/**
 * The first month of the period Entries lists, or "" for the one month:
 * entry_from when entry_to is `month` and the period is at most
 * MAX_ENTRY_RANGE_MONTHS long.
 */
export function readEntriesRangeStart(searchParams, month) {
  const from = searchParams.get("entry_from") ?? "";
  const to = searchParams.get("entry_to") ?? "";
  if (!MONTH_KEY.test(from) || to !== month || !(from < month)) {
    return "";
  }
  const span = (Number(month.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(month.slice(5, 7)) - Number(from.slice(5, 7)) + 1;
  return span <= MAX_ENTRY_RANGE_MONTHS ? from : "";
}

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
  const figure = searchParams.get("entry_figure") ?? "";
  return {
    selectedScope: searchParams.get("entries_scope") ?? defaultScope,
    entryFilters: {
      entryIds: searchParams.getAll("entry_id"),
      wallets: readMultiValues(searchParams, "entry_wallet"),
      categories: readMultiValues(searchParams, "entry_category"),
      type,
      search: searchParams.get("entry_search") ?? "",
      minAmountMinor: readAmountParam(searchParams.get("entry_min")),
      maxAmountMinor: readAmountParam(searchParams.get("entry_max")),
      investmentMovesIn: searchParams.get("entry_invest_moves") === "1",
      figure: ENTRY_FIGURES.includes(figure) ? figure : "",
      tripEventId: searchParams.get("entry_trip") ?? ""
    }
  };
}

/**
 * An Ask answer's filter (ask-filter-reader.js) as the Entries URL that
 * shows the same rows.
 * `fromMonth` lists the months from it to `month` (entry_from, entry_to);
 * `figure` narrows to the rows behind one figure (entry_figure).
 * @param {{ month: string, viewId: string, scope: string, search?: string, categories?: string[], wallets?: string[], type?: string, minAmountMinor?: number | null, maxAmountMinor?: number | null, entryIds?: string[], investmentMovesIn?: boolean, figure?: string, fromMonth?: string, tripEventId?: string }} filter
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
  if (filter.investmentMovesIn) params.set("entry_invest_moves", "1");
  if (filter.figure && ENTRY_FIGURES.includes(filter.figure)) params.set("entry_figure", filter.figure);
  if (filter.month && filter.fromMonth && filter.fromMonth < filter.month) {
    params.set("entry_from", filter.fromMonth);
    params.set("entry_to", filter.month);
  }
  if (filter.type && ENTRY_TYPES.includes(filter.type)) params.set("entry_type", filter.type);
  if (Number.isFinite(filter.minAmountMinor)) params.set("entry_min", formatAmountParam(filter.minAmountMinor));
  if (Number.isFinite(filter.maxAmountMinor)) params.set("entry_max", formatAmountParam(filter.maxAmountMinor));
  for (const entryId of filter.entryIds ?? []) params.append("entry_id", entryId);
  if (filter.tripEventId) params.set("entry_trip", filter.tripEventId);
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
    maxAmountMinor: entryFilters.maxAmountMinor,
    entryIds: entryFilters.entryIds
  };
}

export function hasAskFilterChip(searchParams) {
  if (searchParams.get("from_ask") !== "1") {
    return false;
  }
  const filter = readAskFilterFromParams(searchParams);
  return Boolean(filter.search || filter.wallets.length || filter.categories.length || filter.type
    || filter.minAmountMinor !== null || filter.maxAmountMinor !== null || filter.entryIds.length);
}

export function clearAskFilterParams(searchParams) {
  const next = new URLSearchParams(searchParams);
  ASK_FILTER_PARAM_KEYS.forEach((key) => next.delete(key));
  return next;
}
