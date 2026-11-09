// Trips and events (DOMAIN.md "Trip or Event"; app-repository-trip-events.ts).
//
// - GET  /api/trip-events                  the list (the picker, the sheet)
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
  loadTripEvents,
  putAwayTripEvent,
  saveTripEvent,
  setTripEventEntries,
  undoTripEventChange
} from "../domain/app-repository-trip-events";
import { MAX_TRIP_EVENT_CHANGE, isTripEventAddedBy, type TripEventEntryChange } from "../domain/trip-events";
import { json } from "./json";
import { readJsonObject, RequestBodyTooLargeError } from "./limited-body";

export const TRIP_EVENTS_PATH = "/api/trip-events";
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
  return pathname === TRIP_EVENTS_PATH || WRITE_PATHS.has(pathname);
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
    return json({ ok: true, available, tripEvents });
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
        return json({
          ok: true,
          ...(await setTripEventEntries(env.DB, {
            changes: readTripEventChanges(body),
            // Ask's own routes pass "ask"; a page's tap is the person's,
            // or a suggestion they accepted.
            addedBy: isTripEventAddedBy(body.addedBy) && body.addedBy !== "ask_auto" && body.addedBy !== "ask" ? body.addedBy : "person",
            newTripEvent
          }))
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
