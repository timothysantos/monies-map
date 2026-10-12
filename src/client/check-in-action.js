// What a Money insights link does to the Entries URL: it replaces the
// entry filters with the records the insight names, and leaves the rest
// (view, month, wallets) alone.

const ENTRY_FILTER_KEYS = ["entry_id", "entry_category", "entry_search", "entry_type"];

export function applyCheckInAction(current, action) {
  const next = new URLSearchParams(current);
  ENTRY_FILTER_KEYS.forEach((key) => next.delete(key));
  if (action.id === "show-entries") {
    (action.entryIds ?? []).forEach((entryId) => next.append("entry_id", entryId));
    // Entries from another month (money moved months ago) open that month.
    if (action.month) {
      next.set("month", action.month);
    }
  } else if (action.id === "open-category" && action.categoryName) {
    next.set("entry_category", action.categoryName);
  }
  return next;
}

// True when the list already shows exactly what the link would show, so
// pressing it would change nothing.
export function isCheckInActionApplied(current, action) {
  const next = applyCheckInAction(current, action);
  return [...ENTRY_FILTER_KEYS, "month"].every((key) => sameValues(current.getAll(key), next.getAll(key)));
}

// The Entries location a "show these entries" link opens from another page:
// the page's own search (view, scope) with the month and entries it names.
export function entriesLocationForAction(search, action) {
  const next = applyCheckInAction(new URLSearchParams(search), action);
  return { pathname: "/entries", search: `?${next.toString()}` };
}

function sameValues(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  const sortedRight = [...right].sort();
  return [...left].sort().every((value, index) => value === sortedRight[index]);
}
