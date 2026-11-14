// Where a trip or event figure opens (figure-menu-model.js, the trip view's
// lead): the trip view, narrowed. Kept apart so the figure menu's chunk
// carries only this.
export function tripFigureSearch(search, { tripEventId, personId = "", categoryName = "", entryIds = [] }) {
  const next = new URLSearchParams(search);
  // The list's other filters stay (the figure was worked out over them); a
  // category bar replaces the category, a day replaces picked entries.
  for (const key of ["entry_figure", "entry_from", "entry_to", "from_ask"]) next.delete(key);
  if (categoryName) next.delete("entry_category");
  if (entryIds.length) next.delete("entry_id");
  next.set("entry_trip", tripEventId);
  if (personId) {
    next.set("view", personId);
    next.set("entries_scope", "direct_plus_shared");
    next.set("scope", "direct_plus_shared");
  }
  if (categoryName) next.append("entry_category", categoryName);
  for (const id of entryIds) next.append("entry_id", id);
  return `?${next.toString()}`;
}

// A trip or event's own page (DOMAIN.md "Trip page"): /trips/<id>, keeping
// the page's view, month and scope so going back to another tab keeps them.
export function tripPageLocation(search, tripEventId) {
  const current = new URLSearchParams(search);
  const next = new URLSearchParams();
  for (const key of ["view", "month", "scope"]) {
    const value = current.get(key);
    if (value) next.set(key, value);
  }
  const query = next.toString();
  return { pathname: `/trips/${encodeURIComponent(tripEventId)}`, search: query ? `?${query}` : "" };
}

// The trip id a /trips/<id> path names, or "".
export function readTripPageId(pathname) {
  const match = /^\/trips\/([^/]+)\/?$/.exec(pathname ?? "");
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return "";
  }
}
