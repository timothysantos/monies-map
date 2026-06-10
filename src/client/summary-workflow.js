export const SUMMARY_FOCUS_OVERALL = "overall";

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

// Opening a month from Summary should keep the surrounding range context while
// only swapping the active month route parameter.
export function buildSummaryMonthLocation(search, month) {
  const next = new URLSearchParams(search);
  next.set("month", month);

  return {
    pathname: "/month",
    search: `?${next.toString()}`
  };
}
