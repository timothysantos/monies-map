// Trips and events (DOMAIN.md "Trip or Event"; app-repository-trip-events.ts).
//
// - GET  /api/trip-events                  the list (the picker, the sheet);
//                                           ?with=split-groups adds the split groups (the New sheet)
// - GET  /api/trip-events/suggestions      the review list for a trip (?tripEventId=) or for the
//                                           New sheet's draft (?start=&end=&currency=&splitGroupId=)
// - GET  /api/trip-events/search           "Booked before you went?" (?tripEventId=&q=)
// - POST /api/trip-events/new-defaults     a New sheet's dates and currency from picked rows (a read)
// - POST /api/trip-events/save             make or change one
// - POST /api/trip-events/entries/set      put up to 200 entries on one, move or take them off
// - POST /api/trip-events/put-away         hide one from the picker, or bring it back
// - POST /api/trip-events/delete           delete one (its entries stay)
// - POST /api/trip-events/undo             put a set or a delete back, through its audit event
//
// Every write is one all-or-nothing command. A cross-site write never
// reaches here (cross-site-guard.ts).

import {
  TripEventRefusedError,
  deleteTripEvent,
  loadSplitGroupsForTripEvents,
  loadTripEventDefaultsForEntries,
  loadTripEventSuggestions,
  loadTripEvents,
  searchTripEventSuggestions,
  putAwayTripEvent,
  saveTripEvent,
  setTripEventEntries,
  undoTripEventChange
} from "../domain/app-repository-trip-events";
import { MAX_TRIP_EVENT_CHANGE, isTripEventAddedBy, type TripEventEntryChange } from "../domain/trip-events";
import { BULK_RECATEGORISE_CONFIRM_ABOVE } from "../domain/entry-category-bulk";
import { todayInAppTimeZone } from "../lib/app-calendar";
import { json } from "./json";
import { readJsonObject, RequestBodyTooLargeError } from "./limited-body";

export const TRIP_EVENTS_PATH = "/api/trip-events";
const READ_PATHS = new Set(["/api/trip-events/suggestions", "/api/trip-events/search"]);
const NEW_DEFAULTS_PATH = "/api/trip-events/new-defaults";
const WRITE_PATHS = new Set([
  "/api/trip-events/save",
  "/api/trip-events/entries/set",
  "/api/trip-events/put-away",
  "/api/trip-events/delete",
  "/api/trip-events/undo"
]);
// 200 changes of two ids each, with room to spare.
const MAX_BODY_BYTES = 64 * 1024;

export function isTripEventsPath(pathname: string) {
  return pathname === TRIP_EVENTS_PATH || READ_PATHS.has(pathname) || pathname === NEW_DEFAULTS_PATH || WRITE_PATHS.has(pathname);
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

// The body's changes: `changes` [{entryId, tripEventId|null}], or the short
// form `entryIds` with one `tripEventId` (null takes them off).
export function readTripEventChanges(body: { changes?: unknown; entryIds?: unknown; tripEventId?: unknown }): TripEventEntryChange[] {
  const tripEventId = (value: unknown) => (typeof value === "string" && value ? value : null);
  if (Array.isArray(body.changes)) {
    return body.changes.slice(0, MAX_TRIP_EVENT_CHANGE + 1).map((change) => ({
      entryId: text((change as { entryId?: unknown })?.entryId),
      tripEventId: tripEventId((change as { tripEventId?: unknown })?.tripEventId)
    }));
  }
  if (Array.isArray(body.entryIds)) {
    const to = tripEventId(body.tripEventId);
    return body.entryIds.slice(0, MAX_TRIP_EVENT_CHANGE + 1).map((entryId) => ({ entryId: text(entryId), tripEventId: to }));
  }
  return [];
}

export async function handleTripEventsRoute(request: Request, url: URL, env: { DB: D1Database }): Promise<Response | null> {
  if (url.pathname === TRIP_EVENTS_PATH) {
    if (request.method !== "GET") {
      return json({ ok: false, error: "This route only answers GET." }, 405, { Allow: "GET" });
    }
    const { available, tripEvents } = await loadTripEvents(env.DB);
    const splitGroups = url.searchParams.get("with") === "split-groups" ? await loadSplitGroupsForTripEvents(env.DB) : null;
    return json({ ok: true, available, tripEvents, ...(splitGroups ? { splitGroups } : {}) });
  }
  if (READ_PATHS.has(url.pathname)) {
    if (request.method !== "GET") {
      return json({ ok: false, error: "This route only answers GET." }, 405, { Allow: "GET" });
    }
    const params = url.searchParams;
    try {
      if (url.pathname === "/api/trip-events/search") {
        return json({ ok: true, ...(await searchTripEventSuggestions(env.DB, { tripEventId: params.get("tripEventId") ?? "", query: params.get("q") ?? "", today: todayInAppTimeZone() })) });
      }
      return json({
        ok: true,
        ...(await loadTripEventSuggestions(env.DB, {
          tripEventId: params.get("tripEventId") || null,
          startDate: params.get("start") ?? undefined,
          endDate: params.get("end") ?? undefined,
          currency: params.get("currency") ?? undefined,
          splitGroupId: params.get("splitGroupId") ?? undefined
        }))
      });
    } catch (error) {
      if (error instanceof TripEventRefusedError) {
        return json({ ok: false, error: error.message }, 400);
      }
      throw error;
    }
  }
  if (url.pathname === NEW_DEFAULTS_PATH) {
    if (request.method !== "POST") {
      return json({ ok: false, error: "This route only answers POST." }, 405, { Allow: "POST" });
    }
    let body: Record<string, unknown>;
    try {
      body = await readJsonObject<Record<string, unknown>>(request, MAX_BODY_BYTES);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return json({ ok: false, error: error.message }, 413);
      }
      throw error;
    }
    const entryIds = Array.isArray(body.entryIds) ? body.entryIds.slice(0, MAX_TRIP_EVENT_CHANGE).map(text) : [];
    return json({ ok: true, ...(await loadTripEventDefaultsForEntries(env.DB, entryIds)) });
  }
  if (!WRITE_PATHS.has(url.pathname)) {
    return null;
  }
  if (request.method !== "POST") {
    return json({ ok: false, error: "This route only answers POST." }, 405, { Allow: "POST" });
  }
  let body: Record<string, unknown>;
  try {
    body = await readJsonObject<Record<string, unknown>>(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return json({ ok: false, error: error.message }, 413);
    }
    throw error;
  }

  try {
    switch (url.pathname) {
      case "/api/trip-events/save":
        return json({ ok: true, ...(await saveTripEvent(env.DB, body)) });
      case "/api/trip-events/entries/set": {
        const newTripEvent = body.newTripEvent && typeof body.newTripEvent === "object" ? body.newTripEvent as Record<string, unknown> : null;
        const changes = readTripEventChanges(body);
        // Who put them on, as a label only: the person's tap, a suggestion
        // they accepted, or an Ask change card they saved ("ask"; the card
        // posts it). Every one of these is the person's own Save; nothing
        // here trusts it. "ask_auto" (Ask on its own) is never taken from a
        // page. An Ask card over ten entries carries the count the person
        // confirmed ("Yes, put all N"), as the bulk recategorise does.
        const addedBy = isTripEventAddedBy(body.addedBy) && body.addedBy !== "ask_auto" ? body.addedBy : "person";
        if (addedBy === "ask" && changes.length > BULK_RECATEGORISE_CONFIRM_ABOVE && body.confirmedCount !== changes.length) {
          return json({ ok: false, error: `Confirm all ${changes.length} entries first.` }, 400);
        }
        return json({
          ok: true,
          ...(await setTripEventEntries(env.DB, { changes, addedBy, newTripEvent }))
        });
      }
      case "/api/trip-events/put-away":
        return json({ ok: true, ...(await putAwayTripEvent(env.DB, { tripEventId: text(body.tripEventId), putAway: body.putAway !== false })) });
      case "/api/trip-events/delete":
        return json({ ok: true, ...(await deleteTripEvent(env.DB, { tripEventId: text(body.tripEventId) })) });
      case "/api/trip-events/undo":
        return json({ ok: true, ...(await undoTripEventChange(env.DB, { undoId: text(body.undoId) })) });
    }
  } catch (error) {
    if (error instanceof TripEventRefusedError) {
      return json({ ok: false, error: error.message }, 400);
    }
    throw error;
  }
  return null;
}
