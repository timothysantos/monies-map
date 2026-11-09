import { useCallback, useMemo, useState } from "react";

// Trips and events on the Entries page (DOMAIN.md "Trip or Event"): each
// row's trip, and the chips the page names. The page DTO is the source
// (entries' `tripEventId`, the page's `tripEvents`), read by entry id, so an
// open editor's own copy of its entry never hides a newer trip. A change
// saved here shows at once through a small overlay; each overlay value goes
// once a page arrives that says the same.
const NO_CHIPS = Object.freeze({});

function pageLinks(entriesPage) {
  return new Map((entriesPage?.monthPage?.entries ?? []).map((entry) => [entry.id, entry.tripEventId ?? null]));
}

export function useTripEventsOnEntries(entriesPage) {
  const [overlay, setOverlay] = useState(() => ({ page: entriesPage, links: new Map(), chips: {} }));
  let current = overlay;
  if (overlay.page !== entriesPage) {
    // A new page: drop what it now agrees with. Adjusting state while
    // rendering keeps the overlay in step without an effect.
    const fromPage = pageLinks(entriesPage);
    const links = new Map([...overlay.links].filter(([entryId, tripEventId]) => fromPage.has(entryId) && fromPage.get(entryId) !== tripEventId));
    current = { page: entriesPage, links, chips: links.size ? overlay.chips : {} };
    setOverlay(current);
  }
  const pageChips = entriesPage?.tripEvents ?? NO_CHIPS;
  const fromPage = useMemo(() => pageLinks(entriesPage), [entriesPage]);

  const tripEventIdOf = useCallback((entry) => {
    if (current.links.has(entry.id)) return current.links.get(entry.id);
    if (fromPage.has(entry.id)) return fromPage.get(entry.id);
    return entry.tripEventId ?? null;
  }, [current, fromPage]);
  const chipOf = useCallback(
    (tripEventId) => (tripEventId ? current.chips[tripEventId] ?? pageChips[tripEventId] ?? null : null),
    [current, pageChips]
  );
  // A saved change: [{ entryId, to }] and the trip it went to (if any).
  const applyChanges = useCallback((changes, tripEvent = null) => {
    setOverlay((previous) => {
      const links = new Map(previous.links);
      for (const change of changes ?? []) {
        links.set(change.entryId, change.to ?? null);
      }
      const chips = tripEvent?.id ? { ...previous.chips, [tripEvent.id]: { name: tripEvent.name, iconKey: tripEvent.iconKey } } : previous.chips;
      return { ...previous, links, chips };
    });
  }, []);

  return useMemo(() => ({ tripEventIdOf, chipOf, applyChanges }), [applyChanges, chipOf, tripEventIdOf]);
}
