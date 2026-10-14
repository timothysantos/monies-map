// Ask habits: the commands the person runs on habits (delete, forget
// everything, edit, the setting) are all-or-nothing, and an auto action
// that cannot be logged is reversed (Ask never changes data it cannot list
// and undo). Real local D1, demo household.
import assert from "node:assert/strict";
import test from "node:test";

import {
  deleteAskHabit,
  forgetAllAskHabits,
  learnCategoryHabit,
  saveAskHandlesSafeThings,
  updateAskHabit
} from "../src/domain/app-repository-ask-habits.ts";
import { applyHabitsToNewEntry } from "../src/server/ask-auto-apply.ts";
import { todayInAppTimeZone } from "../src/lib/app-calendar.ts";
import {
  assertSameDatabase,
  createEntry,
  createSeededTemplate,
  dumpDatabase,
  failingStatement,
  openSeededDatabase,
  rows
} from "./support/d1-workspace.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

async function seedHabit(db) {
  for (let count = 0; count < 3; count += 1) {
    await learnCategoryHabit(db, { description: "Kopitiam Corner", categoryName: "Groceries", source: "entries" });
  }
}

const commands = [
  ["delete", (db) => deleteAskHabit(db, { id: "category:kopitiam corner" }), /DELETE FROM ask_habits/],
  ["forget everything", (db) => forgetAllAskHabits(db), /DELETE FROM ask_habits/],
  ["edit", (db) => updateAskHabit(db, { id: "category:kopitiam corner", categoryName: "Food & Drinks" }), /UPDATE ask_habits/],
  ["setting", (db) => saveAskHandlesSafeThings(db, { enabled: false }), /INSERT INTO app_settings/]
];

for (const [name, run, pattern] of commands) {
  for (const [what, match] of [["its write", pattern], ["its audit event", /INSERT INTO audit_events/]]) {
    test(`${name}: a failure on ${what} leaves the database as it was`, async (t) => {
      const { db } = await openSeededDatabase(t, template);
      await seedHabit(db);
      const before = await dumpDatabase(db);
      const faulty = failingStatement(db, match);
      await assert.rejects(run(faulty.db), /injected_failure_missing_table/);
      assert.equal(faulty.state.fired, true);
      assertSameDatabase(await dumpDatabase(db), before);
    });
  }

  test(`${name}: success commits the write and its audit event together`, async (t) => {
    const { db } = await openSeededDatabase(t, template);
    await seedHabit(db);
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

test("learning is one upsert: two racing confirmations both count", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  await Promise.all([
    learnCategoryHabit(db, { description: "Kopitiam Corner", categoryName: "Groceries", source: "entries" }),
    learnCategoryHabit(db, { description: "Kopitiam Corner", categoryName: "Groceries", source: "entries" })
  ]);
  const [habit] = await rows(db, "SELECT times_confirmed FROM ask_habits");
  assert.equal(habit.times_confirmed, 2);
});

test("an auto action whose log row cannot be written is reversed: the entry is as it was", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const today = todayInAppTimeZone();
  // Three confirmed splits make the habit high; a fourth entry is the new one.
  for (let count = 0; count < 3; count += 1) {
    const id = await createEntry(api, { date: today, description: "Kopitiam Corner", categoryName: "Food & Drinks", amountMinor: 1_000 });
    const added = await api("/api/splits/expenses/from-entry", { entryId: id, splitGroupId: null });
    assert.equal(added.status, 200);
  }
  // The fourth entry is made with the setting off, so nothing ran by itself;
  // then Ask is asked to handle it while the log row cannot be written.
  assert.equal((await api("/api/ask/habits/setting", { enabled: false })).status, 200);
  const entryId = await createEntry(api, { date: today, description: "Kopitiam Corner", categoryName: "Food & Drinks", amountMinor: 1_000 });
  assert.equal((await api("/api/ask/habits/setting", { enabled: true })).status, 200);
  const activeSplits = async () => (await rows(db, "SELECT COUNT(*) AS n FROM split_expenses WHERE linked_transaction_id = ? AND deleted_at IS NULL", entryId))[0].n;
  assert.equal(await activeSplits(), 0);

  const faulty = failingStatement(db, /INSERT INTO audit_events/);
  const done = await applyHabitsToNewEntry(faulty.db, entryId);
  assert.equal(faulty.state.fired, true, "the log row was the failing write");
  assert.deepEqual(done, []);
  assert.equal(await activeSplits(), 0, "the split was reversed");
  assert.equal((await rows(db, "SELECT COUNT(*) AS n FROM audit_events WHERE entity_type = 'ask_auto'"))[0].n, 0);

  // With the log working, the same call does it.
  const worked = await applyHabitsToNewEntry(db, entryId);
  assert.deepEqual(worked.map((item) => item.kind), ["split"]);
  assert.equal(await activeSplits(), 1);
});
