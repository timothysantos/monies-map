// Trips and events (DOMAIN.md "Trip or Event"), through the real Worker on a
// local D1 seeded with the demo household: making one, putting entries on
// it (at most one trip each), moving and taking them off, Undo through the
// audit event, put away, delete keeping the entries, the 200 limit, and a
// database without the tables (the feature is off, nothing else breaks).
import assert from "node:assert/strict";
import test from "node:test";

import { createEntry, createSeededTemplate, openSeededDatabase, rows } from "./support/d1-workspace.mjs";
import { guessTripEventIcon, orderTripEventsForPicker, readTripEventInput } from "../src/domain/trip-events.ts";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

async function ok(api, path, body) {
  const response = await api(path, body);
  assert.equal(response.status, 200, `${path}: ${JSON.stringify(response.payload)}`);
  return response.payload;
}

async function refused(api, path, body, message) {
  const response = await api(path, body);
  assert.equal(response.status, 400, `${path}: ${JSON.stringify(response.payload)}`);
  assert.match(response.payload.error, message);
  return response.payload;
}

const linkOf = async (db, entryId) => (await rows(db, "SELECT trip_event_id FROM trip_event_entries WHERE transaction_id = ?", entryId))[0]?.trip_event_id ?? null;

async function seedEntries(api, count, { date = "2026-05-04", prefix = "Seoul" } = {}) {
  const ids = [];
  for (let index = 0; index < count; index += 1) {
    ids.push(await createEntry(api, { date, description: `${prefix} shop ${index + 1}`, categoryName: "Food & Drinks", amountMinor: 1_000 + index }));
  }
  return ids;
}

test("the name suggests the icon and the picker puts the trip on now first, then recent, then A to Z", () => {
  assert.equal(guessTripEventIcon("Seoul trip"), "plane");
  assert.equal(guessTripEventIcon("Mum's 70th"), "cake");
  assert.equal(guessTripEventIcon("New flat"), "house");
  assert.equal(guessTripEventIcon("Jeju weekend"), "star");
  assert.deepEqual(readTripEventInput({ name: "  Seoul   trip ", startDate: "2026-10-03", endDate: "2026-10-09", currency: "krw" }), {
    name: "Seoul trip", iconKey: "plane", startDate: "2026-10-03", endDate: "2026-10-09", currency: "KRW", splitGroupId: null
  });
  // One date is a one-day event.
  assert.deepEqual(readTripEventInput({ name: "Mum's 70th", startDate: "2026-08-16" }).endDate, "2026-08-16");
  const trip = (id, name, extra = {}) => ({ id, name, iconKey: "star", entryCount: 0, lastUsedAt: "2026-01-01 00:00:00", ...extra });
  const order = orderTripEventsForPicker([
    trip("a", "Alpha", { lastUsedAt: "2026-09-01 00:00:00" }),
    trip("b", "Bali trip", { lastUsedAt: "2026-06-20 00:00:00" }),
    trip("c", "Seoul trip", { startDate: "2026-10-03", endDate: "2026-10-09" }),
    trip("d", "Delta", { lastUsedAt: "2026-07-01 00:00:00" }),
    trip("e", "Echo"),
    trip("f", "Foxtrot", { putAway: true, lastUsedAt: "2026-10-01 00:00:00" })
  ], "2026-10-05");
  assert.deepEqual(order.now.map((item) => item.id), ["c"]);
  assert.deepEqual(order.recent.map((item) => item.id), ["a", "d", "b"]);
  assert.deepEqual(order.rest.map((item) => item.id), ["e"]);
});

test("a save is refused for a missing name, a clash, days in the wrong order, an unknown currency or split group", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  await ok(api, "/api/trip-events/save", { name: "Seoul trip" });
  await refused(api, "/api/trip-events/save", { name: "   " }, /Give it a name/);
  await refused(api, "/api/trip-events/save", { name: "seoul  TRIP" }, /already one called Seoul trip/);
  await refused(api, "/api/trip-events/save", { name: "Bali", startDate: "2026-06-19", endDate: "2026-06-12" }, /last day can't be before the first/);
  await refused(api, "/api/trip-events/save", { name: "Bali", startDate: "2026-02-30" }, /real days/);
  await refused(api, "/api/trip-events/save", { name: "Bali", currency: "rupiah" }, /currency/);
  await refused(api, "/api/trip-events/save", { name: "Bali", splitGroupId: "split-group-nowhere" }, /split group was not found/);
  await refused(api, "/api/trip-events/save", { tripEventId: "trip-nowhere", name: "Bali" }, /was not found/);
});

test("making a trip, putting entries on it, moving one and taking one off, with exact results", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  const [first, second, third] = await seedEntries(api, 3);
  const seoul = (await ok(api, "/api/trip-events/save", { name: "Seoul trip", startDate: "2026-10-03", endDate: "2026-10-09", currency: "KRW" })).tripEvent;
  assert.deepEqual({ ...seoul, id: "", lastUsedAt: "" }, {
    id: "", name: "Seoul trip", iconKey: "plane", startDate: "2026-10-03", endDate: "2026-10-09", currency: "KRW", entryCount: 0, lastUsedAt: ""
  });
  const mum = (await ok(api, "/api/trip-events/save", { name: "Mum's 70th", startDate: "2026-08-16" })).tripEvent;

  const put = await ok(api, "/api/trip-events/entries/set", { entryIds: [first, second, third], tripEventId: seoul.id });
  assert.equal(put.changed, 3);
  assert.match(put.undoId, /^tripundo-/);
  assert.equal(put.tripEvent.entryCount, 3);
  assert.deepEqual(put.changes, [first, second, third].map((entryId) => ({ entryId, from: null, to: seoul.id })));

  // Putting them on again changes nothing and needs no Undo.
  const again = await ok(api, "/api/trip-events/entries/set", { entryIds: [first, second], tripEventId: seoul.id });
  assert.deepEqual({ undoId: again.undoId, changed: again.changed, changes: again.changes }, { undoId: null, changed: 0, changes: [] });

  // An entry is on at most one: putting it on Mum's 70th moves it.
  const moved = await ok(api, "/api/trip-events/entries/set", { changes: [{ entryId: second, tripEventId: mum.id }, { entryId: third, tripEventId: null }] });
  assert.deepEqual(moved.changes, [{ entryId: second, from: seoul.id, to: mum.id }, { entryId: third, from: seoul.id, to: null }]);
  assert.deepEqual([await linkOf(db, first), await linkOf(db, second), await linkOf(db, third)], [seoul.id, mum.id, null]);
  assert.equal((await rows(db, "SELECT COUNT(*) AS n FROM trip_event_entries WHERE transaction_id = ?", second))[0].n, 1);

  const list = await ok(api, "/api/trip-events");
  assert.equal(list.available, true);
  assert.deepEqual(list.tripEvents.map((trip) => [trip.name, trip.entryCount]), [["Seoul trip", 1], ["Mum's 70th", 1]]);

  // The audit event holds each entry's trip before and after.
  const [event] = await rows(db, "SELECT action, detail FROM audit_events WHERE entity_id = ?", moved.undoId);
  assert.equal(event.action, "trip_event_entries_set");
  assert.deepEqual(JSON.parse(event.detail).changes, moved.changes);
});

test("Undo puts mixed earlier trips back exactly, once, and keeps an entry that moved since", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  const [a, b, c, d] = await seedEntries(api, 4);
  const bali = (await ok(api, "/api/trip-events/save", { name: "Bali trip" })).tripEvent;
  const mum = (await ok(api, "/api/trip-events/save", { name: "Mum's 70th" })).tripEvent;
  const seoul = (await ok(api, "/api/trip-events/save", { name: "Seoul trip" })).tripEvent;
  await ok(api, "/api/trip-events/entries/set", { changes: [{ entryId: a, tripEventId: bali.id }, { entryId: b, tripEventId: mum.id }] });

  const all = await ok(api, "/api/trip-events/entries/set", { entryIds: [a, b, c, d], tripEventId: seoul.id });
  assert.equal(all.changed, 4);
  // d moves on after the change, so Undo leaves it where it is now.
  await ok(api, "/api/trip-events/entries/set", { entryIds: [d], tripEventId: bali.id });

  const undone = await ok(api, "/api/trip-events/undo", { undoId: all.undoId });
  assert.deepEqual({ restored: undone.restored, skipped: undone.skipped }, { restored: 3, skipped: 1 });
  assert.deepEqual([await linkOf(db, a), await linkOf(db, b), await linkOf(db, c), await linkOf(db, d)], [bali.id, mum.id, null, bali.id]);
  await refused(api, "/api/trip-events/undo", { undoId: all.undoId }, /already undone/);
  await refused(api, "/api/trip-events/undo", { undoId: "tripundo-nothing" }, /Nothing to undo/);
});

test("a new trip made while choosing holds the entry, and Undo takes both away", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  const [entry] = await seedEntries(api, 1);
  const made = await ok(api, "/api/trip-events/entries/set", {
    changes: [{ entryId: entry, tripEventId: "new" }],
    newTripEvent: { name: "Jeju weekend", startDate: "2026-05-04" }
  });
  assert.equal(made.tripEvent.name, "Jeju weekend");
  assert.equal(made.tripEvent.iconKey, "star");
  assert.equal(made.tripEvent.startDate, "2026-05-04");
  assert.equal(made.tripEvent.entryCount, 1);
  assert.equal(await linkOf(db, entry), made.tripEvent.id);

  await ok(api, "/api/trip-events/undo", { undoId: made.undoId });
  assert.equal(await linkOf(db, entry), null);
  assert.deepEqual(await rows(db, "SELECT id FROM trip_events WHERE name = 'Jeju weekend'"), []);
  await refused(api, "/api/trip-events/entries/set", { changes: [{ entryId: entry, tripEventId: "new" }] }, /Give the new trip or event a name/);
});

test("set is refused over 200 entries, for an entry twice, an unknown trip, and an entry that is not this household's", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  const [entry] = await seedEntries(api, 1);
  const seoul = (await ok(api, "/api/trip-events/save", { name: "Seoul trip" })).tripEvent;
  const many = Array.from({ length: 201 }, (_, index) => `txn-fake-${index}`);
  await refused(api, "/api/trip-events/entries/set", { entryIds: many, tripEventId: seoul.id }, /at most 200 entries/);
  await refused(api, "/api/trip-events/entries/set", { entryIds: [entry, entry], tripEventId: seoul.id }, /listed twice/);
  await refused(api, "/api/trip-events/entries/set", { entryIds: [entry], tripEventId: "trip-nowhere" }, /was not found/);
  await refused(api, "/api/trip-events/entries/set", { entryIds: [], tripEventId: seoul.id }, /Pick at least one entry/);

  // Another household's entry (a copy of this one under a second household).
  await db.prepare("INSERT INTO households (id, name, base_currency) VALUES ('household-other', 'Other', 'SGD')").run();
  await db.prepare(`
    INSERT INTO transactions (id, household_id, account_id, transaction_date, description, amount_minor, currency, entry_type, category_id)
    SELECT 'txn-other-household', 'household-other', account_id, transaction_date, description, amount_minor, currency, entry_type, category_id
    FROM transactions WHERE id = ?
  `).bind(entry).run();
  await refused(api, "/api/trip-events/entries/set", { entryIds: [entry, "txn-other-household"], tripEventId: seoul.id }, /were not found/);
  assert.equal(await linkOf(db, entry), null, "nothing was written");
});

test("put away hides nothing it holds; delete takes the links off, keeps the entries, and Undo brings it all back", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  const ids = await seedEntries(api, 2);
  const seoul = (await ok(api, "/api/trip-events/save", { name: "Seoul trip", currency: "KRW" })).tripEvent;
  await ok(api, "/api/trip-events/entries/set", { entryIds: ids, tripEventId: seoul.id });

  const away = await ok(api, "/api/trip-events/put-away", { tripEventId: seoul.id, putAway: true });
  assert.equal(away.tripEvent.putAway, true);
  assert.equal(away.tripEvent.entryCount, 2);
  const back = await ok(api, "/api/trip-events/put-away", { tripEventId: seoul.id, putAway: false });
  assert.equal(back.tripEvent.putAway, undefined);

  const deleted = await ok(api, "/api/trip-events/delete", { tripEventId: seoul.id });
  assert.deepEqual({ deleted: deleted.deleted, entriesTakenOff: deleted.entriesTakenOff }, { deleted: true, entriesTakenOff: 2 });
  assert.equal((await rows(db, `SELECT COUNT(*) AS n FROM transactions WHERE id IN (?, ?)`, ...ids))[0].n, 2);
  assert.deepEqual(await rows(db, "SELECT * FROM trip_event_entries"), []);
  await refused(api, "/api/trip-events/delete", { tripEventId: seoul.id }, /was not found/);

  await ok(api, "/api/trip-events/undo", { undoId: deleted.undoId });
  const list = await ok(api, "/api/trip-events");
  assert.deepEqual(list.tripEvents.map((trip) => [trip.id, trip.name, trip.currency, trip.entryCount]), [[seoul.id, "Seoul trip", "KRW", 2]]);
});

test("deleting an entry takes its link with it", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  const [entry] = await seedEntries(api, 1);
  const seoul = (await ok(api, "/api/trip-events/save", { name: "Seoul trip" })).tripEvent;
  await ok(api, "/api/trip-events/entries/set", { entryIds: [entry], tripEventId: seoul.id });
  await ok(api, "/api/entries/delete", { entryId: entry });
  assert.deepEqual(await rows(db, "SELECT * FROM trip_event_entries"), []);
  assert.equal((await ok(api, "/api/trip-events")).tripEvents[0].entryCount, 0);
});

test("without the tables the feature is off: the list says so, a change is refused in plain words, and Entries still loads", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  const [entry] = await seedEntries(api, 1);
  await db.prepare("DROP TABLE trip_event_entries").run();
  await db.prepare("DROP TABLE trip_events").run();
  assert.deepEqual(await ok(api, "/api/trip-events"), { ok: true, available: false, tripEvents: [] });
  await refused(api, "/api/trip-events/save", { name: "Seoul trip" }, /database update/);
  await refused(api, "/api/trip-events/entries/set", { entryIds: [entry], tripEventId: "trip-x" }, /database update/);
  const page = await ok(api, "/api/entries-page?view=household&month=2026-05");
  assert.ok(page.monthPage.entries.some((row) => row.id === entry));
  // A plain entry delete still works.
  await ok(api, "/api/entries/delete", { entryId: entry });
});
