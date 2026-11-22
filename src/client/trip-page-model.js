// The trip page's readings that need a little work in the browser
// (DOMAIN.md "Trip page"; trip-panel.jsx). Pure, so the figure tests run
// them on the page DTO exactly as the panel does.

// How firm Spent is (money-figures.ts `tripPageFigures` byFirmness): the
// parts in the server's order, each with every entry id behind it. The
// server sends the part with the most entries without its ids; they are
// the days' ids less the other parts' (the days hold every entry Spent
// counts, and each is in exactly one part).
// Where a "Needs a look" line's one action goes: the place that already
// fixes it. A payment with no amount opens its card at the top of Entries
// (the trip view does not show that card); an entry opens its editor in the
// household's trip view, whose lead's "Open <trip>" is the way back; two
// that may be one purchase open the trip view with just the two. The URL's
// month stays.
export function needsLookTarget(item, { tripId, search = "" }) {
  const current = new URLSearchParams(search);
  const next = new URLSearchParams({ view: "household" });
  if (item.reason === "no_amount") {
    next.set("month", item.date.slice(0, 7));
    next.set("waiting_tap", item.id);
    return { pathname: "/entries", search: `?${next.toString()}` };
  }
  const month = current.get("month");
  if (month) next.set("month", month);
  next.set("scope", "direct_plus_shared");
  next.set("entries_scope", "direct_plus_shared");
  next.set("entry_trip", tripId);
  if (item.reason === "maybe_copy") {
    next.append("entry_id", item.id);
    next.append("entry_id", item.otherId);
  } else {
    next.set("editing_entry", item.id);
  }
  return { pathname: "/entries", search: `?${next.toString()}` };
}

export function firmnessParts(page) {
  const parts = page?.firmness?.parts ?? [];
  const named = new Set(parts.flatMap((part) => part.entryIds ?? []));
  const rest = (page?.days ?? []).flatMap((day) => day.entryIds).filter((id) => !named.has(id));
  return parts.map((part) => ({ part: part.part, amountMinor: part.amountMinor, entryIds: part.entryIds ?? rest }));
}
