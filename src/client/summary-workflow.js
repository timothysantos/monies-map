export function buildSummaryMutationRefreshPlan({
  kind,
  refreshShell = false
}) {
  if (kind === "filter-only" || kind === "mobile-sheet") {
    return {
      invalidateMonth: false,
      invalidateSummary: false,
      refreshShell: false
    };
  }

  if (kind === "note-save") {
    return {
      invalidateMonth: true,
      invalidateSummary: true,
      refreshShell: false
    };
  }

  if (kind === "drilldown-return") {
    return {
      invalidateMonth: false,
      invalidateSummary: true,
      refreshShell: false
    };
  }

  return {
    invalidateMonth: true,
    invalidateSummary: true,
    refreshShell: Boolean(refreshShell)
  };
}

// Summary drilldowns preserve the current summary route context while only
// swapping the downstream entry filters that the target screen actually owns.
export function buildSummaryEntriesLocation(search, nextFilters) {
  const next = new URLSearchParams(search);
  next.delete("entry_wallet");
  next.delete("entry_person");
  next.delete("entry_type");
  next.delete("entry_category");
  next.delete("entry_invest_moves");

  for (const [key, value] of Object.entries(nextFilters)) {
    if (value) {
      next.set(key, value);
    }
  }

  return {
    pathname: "/entries",
    search: `?${next.toString()}`
  };
}

// A Money insights "show these entries" link from Summary: Entries filtered to
// the records it names, in the month they are in. Kept here (not in
// check-in-action.js) so the first screen loads no extra chunk for it.
/** @param {string} search @param {{ entryIds?: string[], month?: string }} [action] */
export function buildSummaryEntriesForIdsLocation(search, { entryIds = [], month } = {}) {
  const location = buildSummaryEntriesLocation(search, month ? { month } : {});
  const next = new URLSearchParams(location.search);
  next.delete("entry_id");
  entryIds.forEach((entryId) => next.append("entry_id", entryId));
  return { ...location, search: `?${next.toString()}` };
}
