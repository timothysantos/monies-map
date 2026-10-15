// The category list's best guess (DOMAIN.md "Category Guess"): rule beats
// Ask habit beats the household's own history beats everyday words; never
// Other; deterministic. The pure rule first, then POST
// /api/entries/category-guess through the real Worker and a real local D1.
import assert from "node:assert/strict";
import test from "node:test";

import { everydayWordsFor } from "../src/domain/category-everyday-words.ts";
import { CATEGORY_GUESS_POLICY, guessCategory } from "../src/domain/category-guess.ts";
import { buildCategoryGuess, CATEGORY_GUESS_HISTORY_ROW_LIMIT } from "../src/domain/pages/category-guess.ts";
import { countingDatabase } from "./support/d1-counting.mjs";
import {
  assertSameDatabase,
  createEntry,
  createSeededTemplate,
  dumpDatabase,
  openSeededDatabase,
  rows
} from "./support/d1-workspace.mjs";

const NAMES = ["Food & Drinks", "Groceries", "Taxi", "Shopping", "Other", "Transfer", "Travel"];
const TODAY = "2026-10-15";

const rule = (pattern, categoryName, overrides = {}) => ({ id: `r-${pattern}`, pattern, categoryId: "c", categoryName, priority: 100, isActive: true, ...overrides });
const habit = (categoryName, overrides = {}) => ({ id: "h", kind: "category", key: "blue bottle", value: { categoryName }, timesConfirmed: 3, timesOverridden: 0, lastUsed: "2026-10-01", source: "entries", ...overrides });
const past = (categoryName, date = "2026-08-01", description = "Blue Bottle") => ({ description, categoryName, date });
const guess = (overrides = {}) => guessCategory({ description: "Blue Bottle", categoryNames: NAMES, rules: [], habit: null, history: [], today: TODAY, ...overrides });

test("a household rule beats a habit, history and everyday words", () => {
  const result = guess({
    description: "Blue Bottle Coffee",
    rules: [rule("blue bottle", "Shopping")],
    habit: habit("Travel"),
    history: [past("Taxi", "2026-08-01", "Blue Bottle Coffee"), past("Taxi", "2026-08-02", "Blue Bottle Coffee")]
  });
  assert.deepEqual(result, { categoryName: "Shopping", source: "rule" });
});

test("the first matching active rule by priority wins; an inactive rule is skipped", () => {
  const rules = [rule("blue", "Taxi", { isActive: false }), rule("blue", "Groceries", { priority: 5 }), rule("bottle", "Shopping", { priority: 9 })];
  assert.equal(guess({ rules }).categoryName, "Groceries");
});

test("a rule that files into Other is no guess, and the next layer answers", () => {
  const result = guess({ rules: [rule("blue bottle", "Other")], habit: habit("Groceries") });
  assert.deepEqual(result, { categoryName: "Groceries", source: "habit" });
});

test("an Ask habit beats history and words; it needs high or suggest confidence", () => {
  const history = [past("Taxi"), past("Taxi", "2026-08-02")];
  assert.deepEqual(guess({ habit: habit("Groceries", { timesConfirmed: 2 }), history }), { categoryName: "Groceries", source: "habit" });
  assert.deepEqual(guess({ habit: habit("Groceries", { timesConfirmed: 1 }), history }), { categoryName: "Taxi", source: "history" });
  assert.equal(guess({ habit: habit("Groceries", { lastUsed: "2025-01-01" }), history: [] }), null, "an idle habit is no habit");
  assert.equal(guess({ habit: habit("Other"), history: [] }), null);
});

test("history needs 2 entries at the same shop, ignores Other, and takes the most used category", () => {
  assert.equal(guess({ history: [past("Taxi")] }), null, "one entry is not a pattern");
  assert.deepEqual(guess({ history: [past("Taxi"), past("Taxi", "2026-08-02")] }), { categoryName: "Taxi", source: "history" });
  assert.equal(guess({ history: [past("Other"), past("Other", "2026-08-02"), past("Other", "2026-08-03")] }), null);
  assert.equal(guess({ history: [past("Other"), past("Other", "2026-08-02"), past("Shopping", "2026-08-03")] }), null, "Other never counts toward or against");
  assert.equal(guess({ history: [past("Taxi"), past("Taxi", "2026-08-02"), past("Shopping", "2026-08-03"), past("Shopping", "2026-08-04"), past("Shopping", "2026-08-05")] }).categoryName, "Shopping");
  assert.equal(guess({ history: [past("Taxi", "2026-08-01", "Someone Else"), past("Taxi", "2026-08-02", "Someone Else")] }), null, "another shop is another shop");
});

test("a history tie goes to the newest entry, then to the name", () => {
  const newest = guess({ history: [past("Taxi", "2026-05-01"), past("Taxi", "2026-05-02"), past("Shopping", "2026-09-01"), past("Shopping", "2026-06-01")] });
  assert.equal(newest.categoryName, "Shopping");
  const byName = guess({ history: [past("Taxi"), past("Taxi"), past("Shopping"), past("Shopping")] });
  assert.equal(byName.categoryName, "Shopping");
});

test("everyday words are the last layer; unknown shops and Other give no guess", () => {
  assert.deepEqual(guess({ description: "Kopi with friends" }), { categoryName: "Food & Drinks", source: "words" });
  assert.equal(guess({ description: "Zzyzx Holdings" }), null);
  assert.equal(guess({ description: "  " }), null);
  assert.equal(guess({ description: "kopi", categoryNames: ["Other", "Taxi"] }), null, "a word never names a category the household lacks");
});

test("the everyday-word aliases of a category cover the household's own spelling", () => {
  assert.ok(everydayWordsFor("Food and Drinks").includes("kopi"));
  assert.ok(everydayWordsFor("Food & Drinks").includes("coffee"));
  assert.deepEqual(everydayWordsFor("Mortgage"), []);
  assert.equal(CATEGORY_GUESS_POLICY.minHistoryEntries, 2);
});

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

async function categoryOf(db, name) {
  return (await rows(db, "SELECT id FROM categories WHERE name = ?", name))[0];
}

test("the route answers from the household's own history in one round trip, reading nothing but its indexed reads", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  for (const day of ["2026-09-10", "2026-09-11", "2026-09-12"]) {
    await createEntry(api, { accountName: "Citi Rewards", description: "Zzyzx Studio", categoryName: "Entertainment", amountMinor: 1200, date: day });
  }
  await createEntry(api, { accountName: "Citi Rewards", description: "Zzyzx Studio", categoryName: "Other", amountMinor: 1200, date: "2026-09-13" });
  // Saving entries taught Ask this shop; with the habit forgotten the shop's
  // own history answers.
  const learned = await api("/api/entries/category-guess", { description: "ZZYZX STUDIO" });
  assert.deepEqual(learned.payload.guess, { categoryName: "Entertainment", source: "habit" });
  await db.prepare("DELETE FROM ask_habits").run();
  const before = await dumpDatabase(db);

  const counting = countingDatabase(db);
  const answer = await api("/api/entries/category-guess", { description: "ZZYZX STUDIO" }, { database: counting.db });
  assert.deepEqual([answer.status, answer.payload], [200, { ok: true, guess: { categoryName: "Entertainment", source: "history" } }]);
  // (The Worker adds its own schema checks on a cold request; the guess itself is below.)

  const none = await api("/api/entries/category-guess", { description: "Qqq Unknown Shop" });
  assert.deepEqual(none.payload, { ok: true, guess: null });
  assertSameDatabase(await dumpDatabase(db), before);
});

test("the route rejects a bad body and a GET, and the history read is an index range with a cap", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  assert.equal((await api("/api/entries/category-guess", { description: "" })).status, 400);
  assert.equal((await api("/api/entries/category-guess", { description: "x".repeat(241) })).status, 400);
  assert.equal((await api("/api/entries/category-guess")).status, 405);

  const counting = countingDatabase(db);
  await buildCategoryGuess(counting.db, { description: "Zzyzx Studio" });
  assert.deepEqual(counting.calls.map((call) => call.sql), ["BATCH of 4"], "one round trip: categories, rules, history and the shop's habit");
  const history = "SELECT transactions.description FROM transactions WHERE transactions.household_id = ? AND transactions.transaction_date BETWEEN date(?, ?) AND ?";
  const plan = await rows(db, `EXPLAIN QUERY PLAN ${history}`.replace(/\?/g, "'2026-10-15'"));
  assert.match(plan.map((row) => row.detail).join(" | "), /idx_transactions_household_date/);
  assert.ok(CATEGORY_GUESS_HISTORY_ROW_LIMIT <= 500);
  assert.ok((await categoryOf(db, "Other")).id);
});
