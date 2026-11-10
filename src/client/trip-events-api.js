// Every request trips and events make (src/server/trip-events-route.ts).
// Writes answer { ok: true, ... } or { ok: false, error } and never throw;
// the list is read through fetchQueryWithLease so a picker opened twice
// joins one request.
import { fetchQueryWithLease } from "./query-leases";

const JSON_HEADERS = { "Content-Type": "application/json" };
export const TRIP_EVENTS_QUERY_KEY = Object.freeze(["trip-events"]);

async function postJson(path, body, fallbackError) {
  try {
    const response = await fetch(path, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    return response.ok && data?.ok !== false ? { ...(data ?? {}), ok: true } : { ok: false, error: data?.error || fallbackError };
  } catch {
    return { ok: false, error: fallbackError };
  }
}

/**
 * @typedef {{ id: string, name: string, iconKey: string, startDate?: string, endDate?: string, currency?: string, splitGroupId?: string, putAway?: true, entryCount: number, lastUsedAt: string }} TripEvent
 */

/** @returns {Promise<{ available: boolean, tripEvents: TripEvent[] }>} */
export function loadTripEvents(queryClient, { bypassCache = false, signal = undefined } = {}) {
  return fetchQueryWithLease(queryClient, {
    queryKey: TRIP_EVENTS_QUERY_KEY,
    bypassCache,
    signal,
    abortMessage: "Trips and events request aborted.",
    fetcher: async ({ signal: requestSignal }) => {
      const response = await fetch("/api/trip-events", { cache: "no-store", signal: requestSignal });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "Trips and events didn't load.");
      }
      return { available: data.available !== false, tripEvents: Array.isArray(data.tripEvents) ? data.tripEvents : [] };
    }
  });
}

export function forgetTripEvents(queryClient) {
  queryClient.removeQueries({ queryKey: TRIP_EVENTS_QUERY_KEY });
}

// { entryIds, tripEventId } or { changes }; `newTripEvent` makes one too.
export function setTripEventEntries(body, fallbackError) {
  return postJson("/api/trip-events/entries/set", body, fallbackError);
}

export function undoTripEventChange(undoId, fallbackError) {
  return postJson("/api/trip-events/undo", { undoId }, fallbackError);
}

export function saveTripEvent(body, fallbackError) {
  return postJson("/api/trip-events/save", body, fallbackError);
}

export function putAwayTripEvent(tripEventId, putAway, fallbackError) {
  return postJson("/api/trip-events/put-away", { tripEventId, putAway }, fallbackError);
}

// The picked rows' Category (and its Undo): Entries' bulk category command,
// the one Ask's recategorise uses. Over 10 rows it needs `confirmedCount`
// (the person's "Yes, change all N", passed only once they tapped it); over
// 200 it refuses.
export function changeEntryCategories(changes, { confirmedCount = undefined } = {}, fallbackError = "") {
  const body = Number.isInteger(confirmedCount) ? { changes, confirmedCount } : { changes };
  return postJson("/api/entries/update-category", body, fallbackError);
}

export function deleteTripEvent(tripEventId, fallbackError) {
  return postJson("/api/trip-events/delete", { tripEventId }, fallbackError);
}

async function getJson(path, { signal = undefined } = {}, fallbackError = "") {
  try {
    const response = await fetch(path, { cache: "no-store", signal });
    const data = await response.json().catch(() => null);
    return response.ok && data?.ok !== false ? { ...(data ?? {}), ok: true } : { ok: false, error: data?.error || fallbackError };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { ok: false, error: fallbackError };
  }
}

// The New sheet's lists: every trip (for a name clash) and the split groups
// (for "Start from a split group" and "Shared costs"). Its own key, so the
// picker's list stays small.
export function loadTripEventsWithSplitGroups(queryClient, { signal = undefined } = {}) {
  return fetchQueryWithLease(queryClient, {
    queryKey: [...TRIP_EVENTS_QUERY_KEY, "split-groups"],
    bypassCache: true,
    signal,
    abortMessage: "Trips and events request aborted.",
    fetcher: async ({ signal: requestSignal }) => {
      const result = await getJson("/api/trip-events?with=split-groups", { signal: requestSignal }, "Trips and events didn't load.");
      if (!result.ok) throw new Error(result.error);
      return { tripEvents: result.tripEvents ?? [], splitGroups: result.splitGroups ?? [] };
    }
  });
}

/**
 * The review list (design 2d): for a saved trip `{ tripEventId }`, or for
 * the New sheet's draft `{ start, end, currency, splitGroupId }`.
 * @param {Record<string, string | null | undefined>} params
 */
export function loadTripSuggestions(params, { signal = undefined } = {}, fallbackError = "") {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }
  return getJson(`/api/trip-events/suggestions?${query.toString()}`, { signal }, fallbackError);
}

// "Booked before you went?": words, before the trip's first day.
export function searchTripSuggestions(tripEventId, words, { signal = undefined } = {}, fallbackError = "") {
  const query = new URLSearchParams({ tripEventId, q: words });
  return getJson(`/api/trip-events/search?${query.toString()}`, { signal }, fallbackError);
}

// A New sheet from picked rows: their first and last day and currency.
export function loadTripEventDefaults(entryIds, fallbackError) {
  return postJson("/api/trip-events/new-defaults", { entryIds }, fallbackError);
}
