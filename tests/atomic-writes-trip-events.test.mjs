// Trips and events: every command is all-or-nothing (docs/code-spec.md
// "Persistence Atomicity Contract"). A failure on any of its writes or its
// audit event leaves the database exactly as it was, and a success commits
// them in one db.batch(). Real local D1, demo household.
import assert from "node:assert/strict";
import test from "node:test";

import {
  deleteTripEvent,
  putAwayTripEvent,
  saveTripEvent,
  setTripEventEntries,
  undoTripEventChange
} from "../src/domain/app-repository-trip-events.ts";
import {
  assertSameDatabase,
  createEntry,
  createSeededTemplate,
  dumpDatabase,
  failingStatement,
  openSeededDatabase
} from "./support/d1-workspace.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

// Three entries: the first moved from Bali trip to Seoul trip and the
// second put on Bali trip in one change (the change to undo), and the third
// on Mum's 70th, which is then deleted (the delete to undo).
async function seed(db, api) {
  const first = await createEntry(api, { date: "2026-05-04", description: "Gwangjang Market", categoryName: "Food & Drinks", amountMinor: 3_680 });
  const second = await createEntry(api, { date: "2026-05-05", description: "T-money top up", categoryName: "Groceries", amountMinor: 4_840 });
  const third = await createEntry(api, { date: "2026-05-06", description: "Birthday cake", categoryName: "Groceries", amountMinor: 6_500 });
  const seoul = (await saveTripEvent(db, { name: "Seoul trip" })).tripEvent;
  const bali = (await saveTripEvent(db, { name: "Bali trip" })).tripEvent;
  const mum = (await saveTripEvent(db, { name: "Mum's 70th" })).tripEvent;
  await setTripEventEntries(db, { changes: [{ entryId: first, tripEventId: bali.id }, { entryId: third, tripEventId: mum.id }] });
  const change = await setTripEventEntries(db, { changes: [{ entryId: first, tripEventId: seoul.id }, { entryId: second, tripEventId: bali.id }] });
  const deleted = await deleteTripEvent(db, { tripEventId: mum.id });
  return { first, second, seoul, bali, undoSetId: change.undoId, undoDeleteId: deleted.undoId };
}

const COMMANDS = [
  ["make one", () => (db) => saveTripEvent(db, { name: "Jeju weekend", startDate: "2026-05-02", endDate: "2026-05-03" }), [/INSERT INTO trip_events/]],
  ["change one", (s) => (db) => saveTripEvent(db, { tripEventId: s.seoul.id, name: "Seoul and Busan trip", currency: "KRW" }), [/UPDATE trip_events/]],
  ["put entries on, moving one and taking one off", (s) => (db) => setTripEventEntries(db, {
    changes: [{ entryId: s.first, tripEventId: s.bali.id }, { entryId: s.second, tripEventId: null }]
  }), [/DELETE FROM trip_event_entries/, /INSERT INTO trip_event_entries/]],
  ["make one while choosing", (s) => (db) => setTripEventEntries(db, {
    changes: [{ entryId: s.second, tripEventId: "new" }],
    newTripEvent: { name: "Jeju weekend" }
  }), [/INSERT INTO trip_events/, /INSERT INTO trip_event_entries/]],
  ["put one away", (s) => (db) => putAwayTripEvent(db, { tripEventId: s.bali.id, putAway: true }), [/UPDATE trip_events SET put_away_at/]],
  ["delete one", (s) => (db) => deleteTripEvent(db, { tripEventId: s.seoul.id }), [/DELETE FROM trip_event_entries/, /DELETE FROM trip_events/]],
  ["undo a change", (s) => (db) => undoTripEventChange(db, { undoId: s.undoSetId }), [/DELETE FROM trip_event_entries/, /INSERT INTO trip_event_entries/]],
  ["undo a delete", (s) => (db) => undoTripEventChange(db, { undoId: s.undoDeleteId }), [/INSERT INTO trip_events/, /INSERT INTO trip_event_entries/]]
];

for (const [name, build, patterns] of COMMANDS) {
  for (const pattern of [...patterns, /INSERT INTO audit_events/]) {
    test(`${name}: a failure on ${pattern.source.slice(0, 40)} leaves the database as it was`, async (t) => {
      const { db, api } = await openSeededDatabase(t, template);
      const run = build(await seed(db, api));
      const before = await dumpDatabase(db);
      const faulty = failingStatement(db, pattern);
      await assert.rejects(run(faulty.db), /injected_failure_missing_table/);
      assert.equal(faulty.state.fired, true, "the fault was reached");
      assertSameDatabase(await dumpDatabase(db), before);
    });
  }

  test(`${name}: success commits its writes and its audit event in one batch`, async (t) => {
    const { db, api } = await openSeededDatabase(t, template);
    const run = build(await seed(db, api));
    const batches = [];
    const counting = new Proxy(db, {
      get(target, property) {
        if (property === "batch") {
          return (statements) => {
            batches.push(statements.length);
            return target.batch(statements);
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
    await run(counting);
    assert.equal(batches.length, 1, `one batch, not ${JSON.stringify(batches)}`);
    assert.ok(batches[0] >= 2, "the write and its audit event together");
  });
}
