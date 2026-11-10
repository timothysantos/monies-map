// Storage and commands for trips and events (DOMAIN.md "Trip or Event";
// trip-events.ts holds the rules). The two tables are additive (schema.sql
// "trip_events", "trip_event_entries"): every read tolerates them missing
// (the feature is simply off) and a command refuses with a plain message.
//
// Every command is all-or-nothing (docs/code-spec.md "Persistence
// Atomicity Contract"): it reads and checks first, then commits its writes
// and one audit event in one db.batch(). No month total changes (a trip
// cuts across categories), so no month refresh markers are written.
//
// Undo goes through the audit event: a change's event holds each entry's
// trip before and after (and a deleted trip's own fields), keyed by an undo
// id; undoTripEventChange reads it back and puts things as they were.

import { buildAuditEventStatement } from "./app-repository-audit";
import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import {
  MAX_TRIP_EVENT_CHANGE,
  TripEventRefusedError,
  isTripEventIcon,
  readTripEventInput,
  tripEventNameKey,
  type TripEventAddedBy,
  type TripEventChipDto,
  type TripEventDto,
  type TripEventEntryChange,
  type TripEventIcon,
  type TripEventInput
} from "./trip-events";
import {
  HOME_CURRENCY,
  MAX_SEARCH_ROWS,
  MAX_SPLIT_SUGGESTION_ROWS,
  MAX_SUGGESTION_ROWS,
  SEARCH_MONTHS_BEFORE,
  buildTripEventSearchResults,
  buildTripEventSuggestions,
  monthsBefore,
  readSearchWords,
  suggestTripEventsForNewEntries,
  tripEventDefaultsFromEntries,
  type ActiveTripEvent,
  type TripSuggestionGroupDto,
  type TripSuggestionSourceRow,
  type TripSuggestionsDto,
  type WalletHistory
} from "./trip-event-suggestions";

export { TripEventRefusedError } from "./trip-events";

const AUDIT_ENTITY = "trip_event";
// The longest list the picker and the sheet read: far more than a household
// makes, and a bound on the read.
const MAX_TRIP_EVENTS = 500;

interface TripEventRow {
  id: string;
  name: string;
  icon_key: string;
  start_date: string | null;
  end_date: string | null;
  currency: string | null;
  split_group_id: string | null;
  put_away_at: string | null;
  created_at: string;
  entry_count: number;
  last_added_at: string | null;
}

function toTripEvent(row: TripEventRow): TripEventDto {
  return {
    id: row.id,
    name: row.name,
    iconKey: isTripEventIcon(row.icon_key) ? row.icon_key : "star",
    ...(row.start_date ? { startDate: row.start_date } : {}),
    ...(row.end_date ? { endDate: row.end_date } : {}),
    ...(row.currency ? { currency: row.currency } : {}),
    ...(row.split_group_id ? { splitGroupId: row.split_group_id } : {}),
    ...(row.put_away_at ? { putAway: true as const } : {}),
    entryCount: Number(row.entry_count ?? 0),
    lastUsedAt: [row.last_added_at, row.created_at].filter(Boolean).sort().at(-1) ?? row.created_at
  };
}

// The household's trips and events, newest first, with how many entries
// each holds. `available: false` when the tables do not exist yet.
export async function loadTripEvents(db: D1Database): Promise<{ available: boolean; tripEvents: TripEventDto[] }> {
  try {
    const result = await db
      .prepare(`
        SELECT trip_events.id, trip_events.name, trip_events.icon_key, trip_events.start_date, trip_events.end_date,
          trip_events.currency, trip_events.split_group_id, trip_events.put_away_at, trip_events.created_at,
          COUNT(trip_event_entries.transaction_id) AS entry_count,
          MAX(trip_event_entries.added_at) AS last_added_at
        FROM trip_events
        LEFT JOIN trip_event_entries
          ON trip_event_entries.trip_event_id = trip_events.id
         AND trip_event_entries.household_id = trip_events.household_id
        WHERE trip_events.household_id = ?
        GROUP BY trip_events.id
        ORDER BY COALESCE(trip_events.start_date, trip_events.created_at) DESC, trip_events.name
        LIMIT ${MAX_TRIP_EVENTS}
      `)
      .bind(DEFAULT_HOUSEHOLD_ID)
      .all<TripEventRow>();
    return { available: true, tripEvents: result.results.map(toTripEvent) };
  } catch {
    return { available: false, tripEvents: [] };
  }
}

export async function loadTripEvent(db: D1Database, tripEventId: string): Promise<TripEventDto | null> {
  const { tripEvents } = await loadTripEvents(db);
  return tripEvents.find((trip) => trip.id === tripEventId) ?? null;
}

const LINKS_IN_RANGE_SQL = `
  SELECT 'link' AS kind, trip_event_entries.transaction_id, trip_events.id AS trip_event_id, trip_events.name, trip_events.icon_key,
    NULL AS currency, NULL AS amount_minor
  FROM trip_event_entries
  INNER JOIN transactions ON transactions.id = trip_event_entries.transaction_id
  INNER JOIN trip_events ON trip_events.id = trip_event_entries.trip_event_id
  WHERE trip_event_entries.household_id = ?
    AND transactions.household_id = ?
    AND transactions.transaction_date >= ?
    AND transactions.transaction_date < ?
`;

// The trip of each entry in a date range (the Entries page's rows), and
// the chips those trips need. Empty when the tables are missing. With
// `splitCashGroupId` (the trip view of a trip linked to a split group), the
// same round trip also sums that group's cash expenses that have no entry,
// per currency.
export async function loadTripEventLinksForDateRange(
  db: D1Database,
  rangeStart: string,
  rangeEndExclusive: string,
  { splitCashGroupId = null }: { splitCashGroupId?: string | null } = {}
): Promise<{ links: Map<string, string>; chips: Record<string, TripEventChipDto>; splitCash: Array<{ currency: string; amountMinor: number }> }> {
  try {
    const result = await db
      .prepare(`${LINKS_IN_RANGE_SQL}${splitCashGroupId ? `UNION ALL ${SPLIT_CASH_SQL}` : ""}`)
      .bind(DEFAULT_HOUSEHOLD_ID, DEFAULT_HOUSEHOLD_ID, rangeStart, rangeEndExclusive, ...(splitCashGroupId ? [DEFAULT_HOUSEHOLD_ID, splitCashGroupId] : []))
      .all<{ kind: "link" | "cash"; transaction_id: string; trip_event_id: string; name: string; icon_key: string; currency: string | null; amount_minor: number | null }>();
    return {
      ...linksFromRows(result.results.filter((row) => row.kind === "link")),
      splitCash: splitCashFromRows(result.results)
    };
  } catch {
    return { links: new Map(), chips: {}, splitCash: [] };
  }
}

// A split group's cash expenses with no entry (DOMAIN.md "Trip or Event":
// they are not entries, so a trip's total leaves them out and its view names
// them in one line).
const SPLIT_CASH_SQL = `
  SELECT 'cash' AS kind, NULL AS transaction_id, NULL AS trip_event_id, NULL AS name, NULL AS icon_key,
    currency, SUM(total_amount_minor) AS amount_minor
  FROM split_expenses
  WHERE household_id = ? AND split_group_id = ? AND deleted_at IS NULL AND linked_transaction_id IS NULL
  GROUP BY currency
`;

function splitCashFromRows(rows: Array<{ kind: string; currency: string | null; amount_minor: number | null }>) {
  return rows
    .filter((row) => row.kind === "cash" && row.currency && Number(row.amount_minor) > 0)
    .map((row) => ({ currency: String(row.currency), amountMinor: Number(row.amount_minor) }))
    .sort((left, right) => left.currency.localeCompare(right.currency));
}

// A trip view whose trip has no entries yet still names its split cash.
export async function loadSplitGroupCash(db: D1Database, splitGroupId: string) {
  const result = await db
    .prepare(SPLIT_CASH_SQL)
    .bind(DEFAULT_HOUSEHOLD_ID, splitGroupId)
    .all<{ kind: string; currency: string | null; amount_minor: number | null }>();
  return splitCashFromRows(result.results);
}

function linksFromRows(rows: Array<{ transaction_id: string; trip_event_id: string; name: string; icon_key: string }>) {
  const links = new Map<string, string>();
  const chips: Record<string, TripEventChipDto> = {};
  for (const row of rows) {
    links.set(row.transaction_id, row.trip_event_id);
    chips[row.trip_event_id] ??= { name: row.name, iconKey: isTripEventIcon(row.icon_key) ? row.icon_key : "star" };
  }
  return { links, chips };
}

// The first and last day of a trip's entries, or null when it has none (or
// the tables are missing). Bounded by the link table.
// `tripEventId` "*" is every trip's entries together.
export async function loadTripEventEntrySpan(db: D1Database, tripEventId: string): Promise<{ first: string; last: string; count: number } | null> {
  try {
    const row = await db
      .prepare(`
        SELECT MIN(transactions.transaction_date) AS first, MAX(transactions.transaction_date) AS last, COUNT(*) AS count
        FROM trip_event_entries
        INNER JOIN transactions ON transactions.id = trip_event_entries.transaction_id
        WHERE trip_event_entries.household_id = ?${tripEventId === "*" ? "" : " AND trip_event_entries.trip_event_id = ?"}
      `)
      .bind(DEFAULT_HOUSEHOLD_ID, ...(tripEventId === "*" ? [] : [tripEventId]))
      .first<{ first: string | null; last: string | null; count: number }>();
    return row?.first && row.last ? { first: row.first, last: row.last, count: Number(row.count) } : null;
  } catch {
    return null;
  }
}

// ---- Commands -------------------------------------------------------------

async function assertTablesExist(db: D1Database) {
  const { available } = await loadTripEvents(db);
  if (!available) {
    throw new TripEventRefusedError("Trips and events need a database update first.");
  }
}

async function assertSplitGroupExists(db: D1Database, splitGroupId: string | null) {
  if (!splitGroupId) return;
  const group = await db
    .prepare("SELECT id FROM split_groups WHERE household_id = ? AND id = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, splitGroupId)
    .first<{ id: string }>();
  if (!group) throw new TripEventRefusedError("That split group was not found.");
}

function assertNameFree(tripEvents: TripEventDto[], name: string, ownId: string | null) {
  const key = tripEventNameKey(name);
  const clash = tripEvents.find((trip) => trip.id !== ownId && tripEventNameKey(trip.name) === key);
  if (clash) throw new TripEventRefusedError(`There is already one called ${clash.name}.`);
}

function insertTripEventStatement(db: D1Database, id: string, input: TripEventInput) {
  return db
    .prepare(`
      INSERT INTO trip_events (id, household_id, name, icon_key, start_date, end_date, currency, split_group_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(id, DEFAULT_HOUSEHOLD_ID, input.name, input.iconKey, input.startDate, input.endDate, input.currency, input.splitGroupId);
}

const newTripEventId = () => `trip-${crypto.randomUUID()}`;
const newUndoId = () => `tripundo-${crypto.randomUUID()}`;

// Make a trip or event, or change one's name, icon, dates, currency or
// split group link.
export async function saveTripEvent(
  db: D1Database,
  body: { tripEventId?: unknown; name?: unknown; iconKey?: unknown; startDate?: unknown; endDate?: unknown; currency?: unknown; splitGroupId?: unknown }
): Promise<{ tripEvent: TripEventDto; created: boolean }> {
  await assertTablesExist(db);
  const input = readTripEventInput(body);
  const { tripEvents } = await loadTripEvents(db);
  const existingId = typeof body.tripEventId === "string" && body.tripEventId ? body.tripEventId : null;
  const existing = existingId ? tripEvents.find((trip) => trip.id === existingId) : null;
  if (existingId && !existing) throw new TripEventRefusedError("That trip or event was not found.");
  assertNameFree(tripEvents, input.name, existingId);
  await assertSplitGroupExists(db, input.splitGroupId);

  const id = existing?.id ?? newTripEventId();
  const write = existing
    ? db
      .prepare(`
        UPDATE trip_events
        SET name = ?, icon_key = ?, start_date = ?, end_date = ?, currency = ?, split_group_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE household_id = ? AND id = ?
      `)
      .bind(input.name, input.iconKey, input.startDate, input.endDate, input.currency, input.splitGroupId, DEFAULT_HOUSEHOLD_ID, id)
    : insertTripEventStatement(db, id, input);
  await db.batch([
    write,
    buildAuditEventStatement(db, {
      entityType: AUDIT_ENTITY,
      entityId: id,
      action: existing ? "trip_event_updated" : "trip_event_created",
      detail: JSON.stringify({ kind: existing ? "update" : "create", tripEventId: id, before: existing ?? null, after: input })
    })
  ]);
  const saved = await loadTripEvent(db, id);
  return { tripEvent: saved!, created: !existing };
}

interface SetChangeDetail {
  entryId: string;
  from: string | null;
  to: string | null;
}

// Put entries on a trip or event, move them to another, or take them off:
// up to MAX_TRIP_EVENT_CHANGE at once. `newTripEvent` makes a trip in the
// same batch; a change whose tripEventId is "new" goes on it (the picker's
// "Make 'Jeju weekend'"). Changes that would change nothing are left out,
// and with `onlyEntriesOnNoTrip` so are entries already on another trip
// (the split group follow rule never moves an entry).
export async function setTripEventEntries(
  db: D1Database,
  input: {
    changes: TripEventEntryChange[];
    addedBy?: TripEventAddedBy;
    newTripEvent?: Parameters<typeof readTripEventInput>[0] | null;
    onlyEntriesOnNoTrip?: boolean;
  }
): Promise<{ undoId: string | null; changed: number; tripEvent: TripEventDto | null; changes: SetChangeDetail[] }> {
  await assertTablesExist(db);
  const changes = input.changes ?? [];
  if (!changes.length) throw new TripEventRefusedError("Pick at least one entry.");
  if (changes.length > MAX_TRIP_EVENT_CHANGE) throw new TripEventRefusedError(`Pick at most ${MAX_TRIP_EVENT_CHANGE} entries at once.`);
  const entryIds = changes.map((change) => change.entryId);
  if (entryIds.some((id) => typeof id !== "string" || !id)) throw new TripEventRefusedError("Pick at least one entry.");
  if (new Set(entryIds).size !== entryIds.length) throw new TripEventRefusedError("An entry is listed twice.");
  const addedBy = input.addedBy ?? "person";

  const { tripEvents } = await loadTripEvents(db);
  const tripIds = new Set(tripEvents.map((trip) => trip.id));
  let created: { id: string; input: TripEventInput } | null = null;
  if (input.newTripEvent) {
    const newInput = readTripEventInput(input.newTripEvent);
    assertNameFree(tripEvents, newInput.name, null);
    await assertSplitGroupExists(db, newInput.splitGroupId);
    created = { id: newTripEventId(), input: newInput };
  }
  const resolved = changes.map((change) => ({
    entryId: change.entryId,
    to: change.tripEventId === "new" ? created?.id ?? "new" : change.tripEventId
  }));
  for (const change of resolved) {
    if (change.to === "new") throw new TripEventRefusedError("Give the new trip or event a name.");
    if (change.to !== null && change.to !== created?.id && !tripIds.has(change.to)) {
      throw new TripEventRefusedError("That trip or event was not found.");
    }
  }

  // The entries, and their trip now: every one must be this household's.
  const current = await db
    .prepare(`
      SELECT transactions.id, trip_event_entries.trip_event_id
      FROM json_each(?) AS picked
      INNER JOIN transactions ON transactions.id = picked.value AND transactions.household_id = ?
      LEFT JOIN trip_event_entries ON trip_event_entries.transaction_id = transactions.id
    `)
    .bind(JSON.stringify(entryIds), DEFAULT_HOUSEHOLD_ID)
    .all<{ id: string; trip_event_id: string | null }>();
  const fromById = new Map(current.results.map((row) => [row.id, row.trip_event_id ?? null]));
  if (fromById.size !== entryIds.length) throw new TripEventRefusedError("Some of these entries were not found. Refresh and try again.");

  const effective: SetChangeDetail[] = resolved
    .map((change) => ({ entryId: change.entryId, from: fromById.get(change.entryId) ?? null, to: change.to }))
    .filter((change) => change.from !== change.to)
    .filter((change) => !input.onlyEntriesOnNoTrip || change.from === null);
  const tripEventId = resolved.every((change) => change.to === resolved[0].to) ? resolved[0].to : null;
  if (!effective.length && !created) {
    return { undoId: null, changed: 0, tripEvent: tripEventId ? await loadTripEvent(db, tripEventId) : null, changes: [] };
  }

  const undoId = newUndoId();
  const putOn = effective.filter((change) => change.to !== null).map((change) => ({ e: change.entryId, t: change.to }));
  const takeOff = effective.filter((change) => change.to === null).map((change) => change.entryId);
  const statements: D1PreparedStatement[] = [];
  if (created) statements.push(insertTripEventStatement(db, created.id, created.input));
  if (takeOff.length) {
    statements.push(db
      .prepare("DELETE FROM trip_event_entries WHERE household_id = ? AND transaction_id IN (SELECT value FROM json_each(?))")
      .bind(DEFAULT_HOUSEHOLD_ID, JSON.stringify(takeOff)));
  }
  if (putOn.length) {
    statements.push(db
      .prepare(`
        INSERT INTO trip_event_entries (transaction_id, trip_event_id, household_id, added_by)
        SELECT json_extract(value, '$.e'), json_extract(value, '$.t'), ?, ?
        FROM json_each(?) WHERE true
        ON CONFLICT (transaction_id) DO UPDATE SET
          trip_event_id = excluded.trip_event_id,
          added_by = excluded.added_by,
          added_at = CURRENT_TIMESTAMP
      `)
      .bind(DEFAULT_HOUSEHOLD_ID, addedBy, JSON.stringify(putOn)));
  }
  statements.push(buildAuditEventStatement(db, {
    entityType: AUDIT_ENTITY,
    entityId: undoId,
    action: "trip_event_entries_set",
    detail: JSON.stringify({ kind: "set", undoId, addedBy, createdTripEventId: created?.id ?? null, changes: effective })
  }));
  await db.batch(statements);
  return {
    undoId,
    changed: effective.length,
    tripEvent: tripEventId ? await loadTripEvent(db, tripEventId) : null,
    changes: effective
  };
}

// Hide an old one from the picker ("Put away"), or bring it back. Nothing
// is deleted and its entries stay on it.
export async function putAwayTripEvent(db: D1Database, input: { tripEventId: string; putAway: boolean }) {
  await assertTablesExist(db);
  const trip = await loadTripEvent(db, input.tripEventId);
  if (!trip) throw new TripEventRefusedError("That trip or event was not found.");
  await db.batch([
    db
      .prepare(`UPDATE trip_events SET put_away_at = ${input.putAway ? "CURRENT_TIMESTAMP" : "NULL"}, updated_at = CURRENT_TIMESTAMP WHERE household_id = ? AND id = ?`)
      .bind(DEFAULT_HOUSEHOLD_ID, trip.id),
    buildAuditEventStatement(db, {
      entityType: AUDIT_ENTITY,
      entityId: trip.id,
      action: input.putAway ? "trip_event_put_away" : "trip_event_brought_back",
      detail: JSON.stringify({ kind: input.putAway ? "put_away" : "bring_back", tripEventId: trip.id })
    })
  ]);
  return { tripEvent: (await loadTripEvent(db, trip.id))! };
}

// Delete a trip or event: its links come off and the entries stay as they
// are. The audit event keeps its fields and entries, so Undo brings it back.
export async function deleteTripEvent(db: D1Database, input: { tripEventId: string }) {
  await assertTablesExist(db);
  const trip = await db
    .prepare("SELECT id, name, icon_key, start_date, end_date, currency, split_group_id, put_away_at, created_at FROM trip_events WHERE household_id = ? AND id = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, input.tripEventId)
    .first<Omit<TripEventRow, "entry_count" | "last_added_at">>();
  if (!trip) throw new TripEventRefusedError("That trip or event was not found.");
  const links = await db
    .prepare("SELECT transaction_id, added_by FROM trip_event_entries WHERE household_id = ? AND trip_event_id = ? ORDER BY added_at, transaction_id")
    .bind(DEFAULT_HOUSEHOLD_ID, trip.id)
    .all<{ transaction_id: string; added_by: TripEventAddedBy }>();
  const undoId = newUndoId();
  await db.batch([
    db.prepare("DELETE FROM trip_event_entries WHERE household_id = ? AND trip_event_id = ?").bind(DEFAULT_HOUSEHOLD_ID, trip.id),
    db.prepare("DELETE FROM trip_events WHERE household_id = ? AND id = ?").bind(DEFAULT_HOUSEHOLD_ID, trip.id),
    buildAuditEventStatement(db, {
      entityType: AUDIT_ENTITY,
      entityId: undoId,
      action: "trip_event_deleted",
      detail: JSON.stringify({ kind: "delete", undoId, trip, links: links.results.map((link) => ({ entryId: link.transaction_id, addedBy: link.added_by })) })
    })
  ]);
  return { undoId, deleted: true as const, tripEventId: trip.id, entriesTakenOff: links.results.length };
}

type UndoDetail =
  | { kind: "set"; undoId: string; addedBy: TripEventAddedBy; createdTripEventId: string | null; changes: SetChangeDetail[] }
  | { kind: "delete"; undoId: string; trip: Omit<TripEventRow, "entry_count" | "last_added_at">; links: Array<{ entryId: string; addedBy: TripEventAddedBy }> };

// Put a change back as it was. An entry that has moved since keeps where it
// is now (it is counted in `skipped`); when nothing can go back, it refuses.
export async function undoTripEventChange(db: D1Database, input: { undoId: string }) {
  await assertTablesExist(db);
  if (!input.undoId) throw new TripEventRefusedError("Nothing to undo.");
  const event = await db
    .prepare(`
      SELECT action, detail FROM audit_events
      WHERE household_id = ? AND entity_type = ? AND entity_id = ? AND action IN ('trip_event_entries_set', 'trip_event_deleted', 'trip_event_change_undone')
      ORDER BY created_at DESC
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, AUDIT_ENTITY, input.undoId)
    .all<{ action: string; detail: string }>();
  if (event.results.some((row) => row.action === "trip_event_change_undone")) throw new TripEventRefusedError("That is already undone.");
  const original = event.results.find((row) => row.action !== "trip_event_change_undone");
  if (!original) throw new TripEventRefusedError("Nothing to undo.");
  const detail = JSON.parse(original.detail) as UndoDetail;

  const { tripEvents } = await loadTripEvents(db);
  const tripIds = new Set(tripEvents.map((trip) => trip.id));
  const statements: D1PreparedStatement[] = [];
  let restored = 0;
  let skipped = 0;

  if (detail.kind === "set") {
    const entryIds = detail.changes.map((change) => change.entryId);
    const now = await linksNow(db, entryIds);
    const back: Array<{ e: string; t: string }> = [];
    const off: string[] = [];
    for (const change of detail.changes) {
      if (!now.exists.has(change.entryId) || (now.links.get(change.entryId) ?? null) !== change.to) {
        skipped += 1;
        continue;
      }
      // A trip deleted since: the entry comes off rather than onto nothing.
      const to = change.from && tripIds.has(change.from) ? change.from : null;
      if (to) back.push({ e: change.entryId, t: to });
      else off.push(change.entryId);
      restored += 1;
    }
    if (!restored && !detail.createdTripEventId) throw new TripEventRefusedError("These entries have changed since, so this can't be undone.");
    if (off.length) {
      statements.push(db
        .prepare("DELETE FROM trip_event_entries WHERE household_id = ? AND transaction_id IN (SELECT value FROM json_each(?))")
        .bind(DEFAULT_HOUSEHOLD_ID, JSON.stringify(off)));
    }
    if (back.length) {
      statements.push(db
        .prepare(`
          INSERT INTO trip_event_entries (transaction_id, trip_event_id, household_id, added_by)
          SELECT json_extract(value, '$.e'), json_extract(value, '$.t'), ?, 'person'
          FROM json_each(?) WHERE true
          ON CONFLICT (transaction_id) DO UPDATE SET trip_event_id = excluded.trip_event_id, added_at = CURRENT_TIMESTAMP
        `)
        .bind(DEFAULT_HOUSEHOLD_ID, JSON.stringify(back)));
    }
    // A trip this change made goes too, once nothing else is on it.
    if (detail.createdTripEventId) {
      statements.push(db
        .prepare(`
          DELETE FROM trip_events WHERE household_id = ? AND id = ?
            AND NOT EXISTS (
              SELECT 1 FROM trip_event_entries
              WHERE trip_event_id = ? AND transaction_id NOT IN (SELECT value FROM json_each(?))
            )
        `)
        .bind(DEFAULT_HOUSEHOLD_ID, detail.createdTripEventId, detail.createdTripEventId, JSON.stringify(off)));
    }
  } else {
    const trip = detail.trip;
    if (tripIds.has(trip.id)) throw new TripEventRefusedError("That is already undone.");
    const now = await linksNow(db, detail.links.map((link) => link.entryId));
    const back = detail.links.filter((link) => now.exists.has(link.entryId) && !now.links.has(link.entryId));
    restored = back.length;
    skipped = detail.links.length - back.length;
    statements.push(db
      .prepare(`
        INSERT INTO trip_events (id, household_id, name, icon_key, start_date, end_date, currency, split_group_id, put_away_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(trip.id, DEFAULT_HOUSEHOLD_ID, trip.name, trip.icon_key, trip.start_date, trip.end_date, trip.currency, trip.split_group_id, trip.put_away_at, trip.created_at));
    if (back.length) {
      statements.push(db
        .prepare(`
          INSERT INTO trip_event_entries (transaction_id, trip_event_id, household_id, added_by)
          SELECT json_extract(value, '$.e'), ?, ?, json_extract(value, '$.a')
          FROM json_each(?)
        `)
        .bind(trip.id, DEFAULT_HOUSEHOLD_ID, JSON.stringify(back.map((link) => ({ e: link.entryId, a: link.addedBy })))));
    }
  }

  statements.push(buildAuditEventStatement(db, {
    entityType: AUDIT_ENTITY,
    entityId: input.undoId,
    action: "trip_event_change_undone",
    detail: JSON.stringify({ kind: "undo", undoId: input.undoId, restored, skipped })
  }));
  await db.batch(statements);
  return { undone: true as const, restored, skipped };
}

async function linksNow(db: D1Database, entryIds: string[]) {
  const result = await db
    .prepare(`
      SELECT transactions.id, trip_event_entries.trip_event_id
      FROM json_each(?) AS picked
      INNER JOIN transactions ON transactions.id = picked.value AND transactions.household_id = ?
      LEFT JOIN trip_event_entries ON trip_event_entries.transaction_id = transactions.id
    `)
    .bind(JSON.stringify(entryIds), DEFAULT_HOUSEHOLD_ID)
    .all<{ id: string; trip_event_id: string | null }>();
  const exists = new Set(result.results.map((row) => row.id));
  const links = new Map(result.results.filter((row) => row.trip_event_id).map((row) => [row.id, row.trip_event_id!]));
  return { exists, links };
}

// ---- Keeping links through corrections -------------------------------------

// When a correction removes one entry in favour of a twin that stays (a
// wrong-card Apple Pay copy, a statement's second copy), the removed entry's
// trip moves to the twin, unless the twin is already on one. Returns the
// statements to add to that correction's own batch, or none when the
// removed entry has no trip (or the tables are missing, so an older
// database's corrections are unchanged).
export async function buildTripEventCarryStatements(
  db: D1Database,
  pairs: Array<{ removedEntryId: string; survivorEntryId: string }>
): Promise<D1PreparedStatement[]> {
  if (!pairs.length) return [];
  let links: Map<string, string>;
  try {
    const result = await db
      .prepare("SELECT transaction_id, trip_event_id FROM trip_event_entries WHERE household_id = ? AND transaction_id IN (SELECT value FROM json_each(?))")
      .bind(DEFAULT_HOUSEHOLD_ID, JSON.stringify(pairs.map((pair) => pair.removedEntryId)))
      .all<{ transaction_id: string; trip_event_id: string }>();
    links = new Map(result.results.map((row) => [row.transaction_id, row.trip_event_id]));
  } catch {
    return [];
  }
  const statements: D1PreparedStatement[] = [];
  for (const pair of pairs) {
    const tripEventId = links.get(pair.removedEntryId);
    if (!tripEventId) continue;
    // Runs before the removal (which takes the removed entry's link with it).
    statements.push(db
      .prepare(`
        INSERT INTO trip_event_entries (transaction_id, trip_event_id, household_id, added_by)
        SELECT ?, ?, ?, 'person'
        WHERE EXISTS (SELECT 1 FROM transactions WHERE id = ? AND household_id = ?)
        ON CONFLICT (transaction_id) DO NOTHING
      `)
      .bind(pair.survivorEntryId, tripEventId, DEFAULT_HOUSEHOLD_ID, pair.survivorEntryId, DEFAULT_HOUSEHOLD_ID));
  }
  return statements;
}

// ---- Suggestions (DOMAIN.md "Trip or Event", "Suggestions") ---------------
// Reads only: nothing joins a trip until the person ticks and taps, and the
// tap goes through setTripEventEntries. Every read is bounded by dates (or a
// split group, or a search window) and a LIMIT.

const SUGGESTION_COLUMNS = `
  SELECT
    transactions.id,
    transactions.transaction_date AS date,
    transactions.description,
    transactions.original_description,
    transactions.amount_minor,
    transactions.original_amount_minor,
    transactions.original_currency,
    categories.name AS category_name,
    accounts.account_name,
    CASE WHEN accounts.is_joint = 1 THEN 'Shared' ELSE COALESCE(owners.display_name, account_owners.display_name) END AS who,
    trip_event_entries.trip_event_id,
    split_expenses.split_group_id
  FROM transactions
  INNER JOIN accounts ON accounts.id = transactions.account_id
  LEFT JOIN people AS owners ON owners.id = transactions.owner_person_id
  LEFT JOIN people AS account_owners ON account_owners.id = accounts.owner_person_id
  LEFT JOIN categories ON categories.id = transactions.category_id
  LEFT JOIN imports ON imports.id = transactions.import_id
  LEFT JOIN trip_event_entries ON trip_event_entries.transaction_id = transactions.id
  LEFT JOIN split_expenses
    ON split_expenses.household_id = transactions.household_id
   AND split_expenses.linked_transaction_id = transactions.id
   AND split_expenses.deleted_at IS NULL
  WHERE transactions.household_id = ?
    AND transactions.entry_type = 'expense'
    AND (transactions.import_id IS NULL OR imports.status = 'completed')
`;

interface SuggestionRow {
  id: string;
  date: string;
  description: string;
  original_description: string | null;
  amount_minor: number;
  original_amount_minor: number | null;
  original_currency: string | null;
  category_name: string | null;
  account_name: string | null;
  who: string | null;
  trip_event_id: string | null;
  split_group_id: string | null;
}

function toSourceRow(row: SuggestionRow): TripSuggestionSourceRow {
  return {
    id: row.id,
    date: row.date,
    description: row.description,
    originalDescription: row.original_description,
    amountMinor: Number(row.amount_minor),
    originalAmountMinor: row.original_amount_minor === null ? null : Number(row.original_amount_minor),
    originalCurrency: row.original_currency,
    categoryName: row.category_name,
    who: row.who,
    accountName: row.account_name,
    tripEventId: row.trip_event_id,
    splitGroupId: row.split_group_id
  };
}

async function readSuggestionRows(db: D1Database, filter: string, binds: unknown[], limit: number, order = "transactions.transaction_date, transactions.created_at, transactions.id") {
  const result = await db
    .prepare(`${SUGGESTION_COLUMNS} ${filter} ORDER BY ${order} LIMIT ${limit + 1}`)
    .bind(DEFAULT_HOUSEHOLD_ID, ...binds)
    .all<SuggestionRow>();
  return { rows: result.results.slice(0, limit).map(toSourceRow), truncated: result.results.length > limit };
}

const NO_SUGGESTIONS: TripSuggestionsDto = { available: false, tripEventId: null, groups: [], homeBillCount: 0, truncated: false };

// What the review list needs about a trip (or a draft from the New sheet):
// its dates, currency and split group (with the group's name).
async function readSuggestionTarget(db: D1Database, input: { tripEventId?: string | null; startDate?: unknown; endDate?: unknown; currency?: unknown; splitGroupId?: unknown }) {
  if (input.tripEventId) {
    const trip = await db
      .prepare(`
        SELECT trip_events.id, trip_events.start_date, trip_events.end_date, trip_events.currency, trip_events.split_group_id, split_groups.group_name
        FROM trip_events
        LEFT JOIN split_groups ON split_groups.household_id = trip_events.household_id AND split_groups.id = trip_events.split_group_id
        WHERE trip_events.household_id = ? AND trip_events.id = ?
      `)
      .bind(DEFAULT_HOUSEHOLD_ID, input.tripEventId)
      .first<{ id: string; start_date: string | null; end_date: string | null; currency: string | null; split_group_id: string | null; group_name: string | null }>();
    if (!trip) throw new TripEventRefusedError("That trip or event was not found.");
    return { tripEventId: trip.id, startDate: trip.start_date, endDate: trip.end_date, currency: trip.currency, splitGroupId: trip.split_group_id, splitGroupName: trip.group_name };
  }
  // A draft: the New sheet's fields, read with the save's own rules.
  const draft = readTripEventInput({ name: "Draft", startDate: input.startDate, endDate: input.endDate, currency: input.currency, splitGroupId: input.splitGroupId });
  const group = draft.splitGroupId
    ? await db.prepare("SELECT group_name FROM split_groups WHERE household_id = ? AND id = ?").bind(DEFAULT_HOUSEHOLD_ID, draft.splitGroupId).first<{ group_name: string }>()
    : null;
  return { tripEventId: null, startDate: draft.startDate, endDate: draft.endDate, currency: draft.currency, splitGroupId: group ? draft.splitGroupId : null, splitGroupName: group?.group_name ?? null };
}

// The review list (design 2d) for a trip, or for the New sheet's draft
// before it is saved (its preview line). Two sequential steps: the trip,
// then the entries in its dates and those on its split group together.
export async function loadTripEventSuggestions(
  db: D1Database,
  input: { tripEventId?: string | null; startDate?: unknown; endDate?: unknown; currency?: unknown; splitGroupId?: unknown }
): Promise<TripSuggestionsDto> {
  let target: Awaited<ReturnType<typeof readSuggestionTarget>>;
  try {
    target = await readSuggestionTarget(db, input);
  } catch (error) {
    if (error instanceof TripEventRefusedError) throw error;
    return NO_SUGGESTIONS;
  }
  try {
    const [inDates, onSplits] = await Promise.all([
      target.startDate && target.endDate
        ? readSuggestionRows(db, "AND transactions.transaction_date >= ? AND transactions.transaction_date <= ?", [target.startDate, target.endDate], MAX_SUGGESTION_ROWS)
        : Promise.resolve({ rows: [], truncated: false }),
      target.splitGroupId
        ? readSuggestionRows(
          db,
          "AND transactions.id IN (SELECT linked_transaction_id FROM split_expenses WHERE household_id = ? AND split_group_id = ? AND deleted_at IS NULL AND linked_transaction_id IS NOT NULL)",
          [DEFAULT_HOUSEHOLD_ID, target.splitGroupId],
          MAX_SPLIT_SUGGESTION_ROWS
        )
        : Promise.resolve({ rows: [], truncated: false })
    ]);
    // Entries already on this trip are not suggestions.
    const notOnThis = (rows: TripSuggestionSourceRow[]) => rows.filter((row) => !target.tripEventId || row.tripEventId !== target.tripEventId);
    return buildTripEventSuggestions({
      ...target,
      inDates: notOnThis(inDates.rows),
      onSplits: notOnThis(onSplits.rows),
      truncated: inDates.truncated || onSplits.truncated
    });
  } catch {
    // The trip tables missing: the feature is off.
    return NO_SUGGESTIONS;
  }
}

// "Booked before you went?": the household's entries whose description or
// note holds every word, in the 12 months before the first day (or before
// today, for a trip with no dates), skipping the trip's own dates. Newest
// first, at most MAX_SEARCH_ROWS.
export async function searchTripEventSuggestions(
  db: D1Database,
  input: { tripEventId: string; query: unknown; today: string }
): Promise<{ available: boolean; group: TripSuggestionGroupDto; before: string; since: string }> {
  const words = readSearchWords(input.query);
  let target: Awaited<ReturnType<typeof readSuggestionTarget>> | null;
  try {
    target = await readSuggestionTarget(db, { tripEventId: input.tripEventId });
  } catch (error) {
    if (error instanceof TripEventRefusedError) throw error;
    target = null;
  }
  const before = target?.startDate ?? input.today;
  const since = monthsBefore(before, SEARCH_MONTHS_BEFORE);
  if (!target || !words.length) {
    return { available: Boolean(target), group: { key: "search", entries: [] }, before, since };
  }
  const wordFilter = words
    .map(() => "AND (lower(transactions.description) LIKE ? OR lower(COALESCE(transactions.note, '')) LIKE ?)")
    .join(" ");
  try {
    const { rows } = await readSuggestionRows(
      db,
      `AND transactions.transaction_date >= ? AND transactions.transaction_date < ? ${wordFilter}`,
      [since, before, ...words.flatMap((word) => [`%${word}%`, `%${word}%`])],
      MAX_SEARCH_ROWS,
      "transactions.transaction_date DESC, transactions.created_at DESC, transactions.id"
    );
    return { available: true, group: buildTripEventSearchResults(rows, target.currency), before, since };
  } catch {
    return { available: false, group: { key: "search", entries: [] }, before, since };
  }
}

// A New sheet started from picked rows: their first and last day and their
// foreign currency (design 2d, smart defaults). One read of those rows.
export async function loadTripEventDefaultsForEntries(db: D1Database, entryIds: string[]) {
  const ids = entryIds.filter((id) => typeof id === "string" && id).slice(0, MAX_TRIP_EVENT_CHANGE);
  if (!ids.length) return { startDate: null, endDate: null, currency: null };
  const result = await db
    .prepare(`
      SELECT transaction_date AS date, description, original_description, original_currency
      FROM transactions
      WHERE household_id = ? AND id IN (SELECT value FROM json_each(?))
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, JSON.stringify(ids))
    .all<{ date: string; description: string; original_description: string | null; original_currency: string | null }>();
  return tripEventDefaultsFromEntries(result.results.map((row) => ({
    date: row.date,
    description: row.description,
    originalDescription: row.original_description,
    originalCurrency: row.original_currency
  })));
}

// The household's split groups for the New sheet's "Start from a split
// group" and "Shared costs", newest activity first.
export async function loadSplitGroupsForTripEvents(db: D1Database) {
  const groups = await db
    .prepare(`
      SELECT split_groups.id, split_groups.group_name, split_groups.icon_key, split_groups.currency,
        COALESCE(MAX(split_expenses.expense_date), substr(split_groups.created_at, 1, 10)) AS last_used_on
      FROM split_groups
      LEFT JOIN split_expenses
        ON split_expenses.household_id = split_groups.household_id
       AND split_expenses.split_group_id = split_groups.id
       AND split_expenses.deleted_at IS NULL
      WHERE split_groups.household_id = ?
      GROUP BY split_groups.id
      ORDER BY last_used_on DESC, split_groups.group_name
      LIMIT ${MAX_TRIP_EVENTS}
    `)
    .bind(DEFAULT_HOUSEHOLD_ID)
    .all<{ id: string; group_name: string; icon_key: string | null; currency: string | null; last_used_on: string | null }>();
  return groups.results.map((group) => ({
    id: group.id,
    name: group.group_name,
    // A trip icon when the group's is one of them; the sheet guesses
    // otherwise.
    ...(isTripEventIcon(group.icon_key) ? { iconKey: group.icon_key } : {}),
    currency: (group.currency ?? HOME_CURRENCY).toUpperCase(),
    lastUsedOn: group.last_used_on ?? ""
  }));
}

// ---- The dashed chip on new entries (design 2f, decision 4 = A) ------------

// The Entries page's trip facts for its rows in one round trip: each row's
// trip (and the chips those trips need) and, when a trip with a currency is
// on today, which of the Shortcut's entries in it get the dashed chip.
// Empty when the tables are missing.
export async function loadTripEventRowFacts(
  db: D1Database,
  rangeStart: string,
  rangeEndExclusive: string,
  today: string
): Promise<{ links: Map<string, string>; chips: Record<string, TripEventChipDto>; suggestions: Map<string, string> }> {
  type FactRow = {
    kind: "link" | "trip" | "candidate" | "recent";
    transaction_id: string | null;
    trip_event_id: string | null;
    name: string | null;
    icon_key: string | null;
    currency: string | null;
    amount_minor: number | null;
    start_date: string | null;
    end_date: string | null;
    account_id: string | null;
    entry_date: string | null;
    n: number | null;
  };
  try {
    const result = await db
      .prepare(`
        WITH active AS (
          SELECT id, name, icon_key, start_date, end_date, currency FROM trip_events
          WHERE household_id = ? AND put_away_at IS NULL AND currency IS NOT NULL AND currency <> '${HOME_CURRENCY}'
            AND start_date IS NOT NULL AND end_date IS NOT NULL AND start_date <= ? AND end_date >= ?
        ),
        candidates AS (
          SELECT transactions.id, transactions.account_id, transactions.transaction_date, transactions.original_currency
          FROM transactions
          WHERE transactions.household_id = ?
            AND transactions.external_reference LIKE 'shortcut:_%'
            -- One lower bound: the earliest active trip's first day, or an
            -- empty range when no trip is on (most page loads).
            AND transactions.transaction_date >= COALESCE((SELECT MIN(start_date) FROM active), '9999-12-31')
            AND transactions.transaction_date <= ?
            AND NOT EXISTS (SELECT 1 FROM trip_event_entries WHERE trip_event_entries.transaction_id = transactions.id)
          LIMIT ${MAX_TRIP_EVENT_CHANGE}
        ),
        recent AS (
          SELECT transactions.id, transactions.account_id, trip_event_entries.trip_event_id,
            ROW_NUMBER() OVER (PARTITION BY transactions.account_id ORDER BY transactions.transaction_date DESC, transactions.created_at DESC, transactions.id DESC) AS n
          FROM transactions
          LEFT JOIN trip_event_entries ON trip_event_entries.transaction_id = transactions.id
          WHERE transactions.household_id = ?
            AND transactions.account_id IN (SELECT account_id FROM candidates)
            AND transactions.transaction_date >= COALESCE((SELECT MIN(start_date) FROM active), '9999-12-31')
            AND transactions.transaction_date <= ?
        )
        SELECT kind, transaction_id, trip_event_id, name, icon_key, currency, amount_minor,
          NULL AS start_date, NULL AS end_date, NULL AS account_id, NULL AS entry_date, NULL AS n
        FROM (${LINKS_IN_RANGE_SQL})
        UNION ALL
        SELECT 'trip', NULL, id, name, icon_key, currency, NULL, start_date, end_date, NULL, NULL, NULL
        FROM active WHERE EXISTS (SELECT 1 FROM candidates)
        UNION ALL
        SELECT 'candidate', id, NULL, NULL, NULL, original_currency, NULL, NULL, NULL, account_id, transaction_date, NULL
        FROM candidates
        UNION ALL
        SELECT 'recent', id, trip_event_id, NULL, NULL, NULL, NULL, NULL, NULL, account_id, NULL, n
        FROM recent WHERE n <= 4
      `)
      .bind(
        DEFAULT_HOUSEHOLD_ID, today, today,
        DEFAULT_HOUSEHOLD_ID, today,
        DEFAULT_HOUSEHOLD_ID, today,
        DEFAULT_HOUSEHOLD_ID, DEFAULT_HOUSEHOLD_ID, rangeStart, rangeEndExclusive
      )
      .all<FactRow>();
    const rows = result.results;
    const { links, chips } = linksFromRows(rows
      .filter((row) => row.kind === "link")
      .map((row) => ({ transaction_id: row.transaction_id!, trip_event_id: row.trip_event_id!, name: row.name!, icon_key: row.icon_key! })));
    const trips: ActiveTripEvent[] = rows.filter((row) => row.kind === "trip").map((row) => ({
      id: row.trip_event_id!,
      name: row.name!,
      iconKey: row.icon_key!,
      startDate: row.start_date!,
      endDate: row.end_date!,
      currency: row.currency!
    }));
    if (!trips.length) return { links, chips, suggestions: new Map() };
    const walletHistory: WalletHistory = new Map();
    for (const row of rows.filter((item) => item.kind === "recent").sort((left, right) => Number(left.n) - Number(right.n))) {
      const list = walletHistory.get(row.account_id!) ?? [];
      list.push({ id: row.transaction_id!, tripEventId: row.trip_event_id });
      walletHistory.set(row.account_id!, list);
    }
    const suggestions = suggestTripEventsForNewEntries({
      today,
      trips,
      candidates: rows.filter((row) => row.kind === "candidate").map((row) => ({
        id: row.transaction_id!,
        date: row.entry_date!,
        accountId: row.account_id!,
        originalCurrency: row.currency
      })),
      walletHistory
    });
    for (const tripEventId of suggestions.values()) {
      const trip = trips.find((item) => item.id === tripEventId)!;
      chips[trip.id] ??= { name: trip.name, iconKey: isTripEventIcon(trip.iconKey) ? trip.iconKey : "star" };
    }
    return { links, chips, suggestions };
  } catch {
    return { links: new Map(), chips: {}, suggestions: new Map() };
  }
}

// ---- Following a linked split group (owner decision 3 = A) ------------------

// After an entry is added to a split group that a trip or event is linked
// to, put the entry on that trip too, unless it is already on one (it is
// never moved). A second all-or-nothing command, run after the split command
// has saved: when it can't run (the tables are missing, or it fails) the
// split stays saved and the entry is simply on no trip. Put-away trips are
// not followed. Returns the change, with its Undo id, or null.
export async function followSplitGroupTripEvent(
  db: D1Database,
  input: { entryId: string; splitGroupId: string | null | undefined }
): Promise<{ undoId: string; tripEvent: TripEventChipDto & { id: string }; changes: SetChangeDetail[] } | null> {
  if (!input.splitGroupId || !input.entryId) return null;
  let trip: { id: string } | null;
  try {
    trip = await db
      .prepare(`
        SELECT trip_events.id FROM trip_events
        WHERE trip_events.household_id = ? AND trip_events.split_group_id = ? AND trip_events.put_away_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM trip_event_entries WHERE trip_event_entries.transaction_id = ?)
        ORDER BY COALESCE(trip_events.start_date, trip_events.created_at) DESC, trip_events.id
        LIMIT 1
      `)
      .bind(DEFAULT_HOUSEHOLD_ID, input.splitGroupId, input.entryId)
      .first<{ id: string }>();
  } catch {
    return null;
  }
  if (!trip) return null;
  const result = await setTripEventEntries(db, {
    changes: [{ entryId: input.entryId, tripEventId: trip.id }],
    addedBy: "person",
    onlyEntriesOnNoTrip: true
  });
  if (!result.undoId || !result.changed || !result.tripEvent) return null;
  return {
    undoId: result.undoId,
    tripEvent: { id: result.tripEvent.id, name: result.tripEvent.name, iconKey: result.tripEvent.iconKey },
    changes: result.changes
  };
}
