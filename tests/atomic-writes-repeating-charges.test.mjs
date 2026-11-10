// Subscriptions and bills' choices (keep, take off, show again, rename,
// restore): each writes its row and its audit event in one db.batch(), so
// a failure on either leaves the database as it was. Real local D1, demo
// household.
import assert from "node:assert/strict";
import test from "node:test";

import { chooseRepeatingCharge } from "../src/domain/app-repository-repeating-charges.ts";
import {
  assertSameDatabase,
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

const KEY = "NETFLIX COM|monthly";
// A choice already there, so show again and restore write (not a no-op).
const seed = (db) => chooseRepeatingCharge(db, { seriesKey: KEY, action: "keep" });

const commands = [
  ["keep", (db) => chooseRepeatingCharge(db, { seriesKey: "SPOTIFY|monthly", action: "keep" }), /INSERT INTO repeating_charge_choices/],
  ["take off", (db) => chooseRepeatingCharge(db, { seriesKey: KEY, action: "take_off" }), /INSERT INTO repeating_charge_choices/],
  ["show again", (db) => chooseRepeatingCharge(db, { seriesKey: KEY, action: "show_again" }), /DELETE FROM repeating_charge_choices/],
  ["rename", (db) => chooseRepeatingCharge(db, { seriesKey: KEY, action: "rename", displayName: "Netflix" }), /INSERT INTO repeating_charge_choices/],
  ["restore", (db) => chooseRepeatingCharge(db, { seriesKey: KEY, action: "restore", choice: null, displayName: null }), /DELETE FROM repeating_charge_choices/]
];

for (const [name, run, pattern] of commands) {
  for (const [what, match] of [["its write", pattern], ["its audit event", /INSERT INTO audit_events/]]) {
    test(`${name}: a failure on ${what} leaves the database as it was`, async (t) => {
      const { db } = await openSeededDatabase(t, template);
      await seed(db);
      const before = await dumpDatabase(db);
      const faulty = failingStatement(db, match);
      await assert.rejects(run(faulty.db), /injected_failure_missing_table/);
      assert.equal(faulty.state.fired, true);
      assertSameDatabase(await dumpDatabase(db), before);
    });
  }

  test(`${name}: success commits the write and its audit event in one batch`, async (t) => {
    const { db } = await openSeededDatabase(t, template);
    await seed(db);
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
    assert.deepEqual(batches, [2]);
  });
}
