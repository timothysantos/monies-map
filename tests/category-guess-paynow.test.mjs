// PayNow company code as a shop key (DOMAIN.md "PayNow Reference"): the UEN on
// a UOB PayNow line is a steadier key than its description, whose reference and
// payee text vary line to line. The pure guess first, then the route through
// the real Worker and a real local D1 (still one bounded read, one round trip).
import assert from "node:assert/strict";
import test from "node:test";

import { habitMerchantKey } from "../src/domain/ask-habits.ts";
import { guessCategory } from "../src/domain/category-guess.ts";
import { buildCategoryGuess } from "../src/domain/pages/category-guess.ts";
import { countingDatabase } from "./support/d1-counting.mjs";
import { createEntry, createSeededTemplate, openSeededDatabase } from "./support/d1-workspace.mjs";

const NAMES = ["Food & Drinks", "Groceries", "Taxi", "Shopping", "Other", "Transfer", "Travel"];
const TODAY = "2026-10-15";
const PAYNOW = (reference, payee, uen = "202627699C") => `PAYNOW-FAST OTHR SBA-${uen} PIB${reference} 86 ${payee}`;
const PAYNOW_LINE = PAYNOW("26100120520761", "SLEEK TECH PTE LTD");

const rule = (pattern, categoryName) => ({ id: `r-${pattern}`, pattern, categoryId: "c", categoryName, priority: 100, isActive: true });
const habit = (categoryName) => ({ id: "h", kind: "category", key: "k", value: { categoryName }, timesConfirmed: 3, timesOverridden: 0, lastUsed: "2026-10-01", source: "entries" });
const past = (categoryName, date, description) => ({ description, categoryName, date });
const guess = (overrides = {}) => guessCategory({ description: PAYNOW_LINE, categoryNames: NAMES, rules: [], habit: null, history: [], today: TODAY, ...overrides });

test("history at the same company code answers though the payee text and reference differ", () => {
  const result = guess({
    history: [past("Taxi", "2026-08-01", PAYNOW("26080111000001", "SLEEK TECH ORCHARD")), past("Taxi", "2026-08-09", PAYNOW("26080912000002", "SLEEKTECH SG"))]
  });
  assert.deepEqual(result, { categoryName: "Taxi", source: "history" });
});

test("a code with fewer than 2 entries, another code, or no code is no history", () => {
  assert.equal(guess({ history: [past("Taxi", "2026-08-01", PAYNOW("26080111000001", "OTHER NAME"))] }), null);
  const otherCode = [past("Taxi", "2026-08-01", PAYNOW("26080111000001", "A", "202699999E")), past("Taxi", "2026-08-02", PAYNOW("26080211000001", "B", "202699999E"))];
  assert.equal(guess({ history: otherCode }), null);
  const sameCode = [past("Taxi", "2026-08-01", PAYNOW("26080111000001", "A")), past("Taxi", "2026-08-02", PAYNOW("26080211000001", "B"))];
  assert.equal(guess({ description: "PAYNOW OTHR LI LITING", history: sameCode }), null, "a line with no code does not borrow the code's history");
});

test("the code's history counts the most used category and never Other; a rule or habit still goes first", () => {
  const history = [
    past("Taxi", "2026-08-01", PAYNOW("26080111000001", "A")),
    past("Shopping", "2026-08-02", PAYNOW("26080211000001", "B")),
    past("Shopping", "2026-08-03", PAYNOW("26080311000001", "C")),
    past("Other", "2026-08-04", PAYNOW("26080411000001", "D")),
    past("Other", "2026-08-05", PAYNOW("26080511000001", "E")),
    past("Other", "2026-08-06", PAYNOW("26080611000001", "F"))
  ];
  assert.deepEqual(guess({ history }), { categoryName: "Shopping", source: "history" });
  assert.equal(guess({ history, rules: [rule("sleek tech", "Travel")] }).source, "rule");
  assert.equal(guess({ history, habit: habit("Groceries") }).source, "habit");
});

test("an Ask habit key for a PayNow line is its company code, steady across payee text and reference", () => {
  const a = habitMerchantKey(PAYNOW("26100120520761", "SLEEK TECH PTE LTD"));
  const b = habitMerchantKey(PAYNOW("26091512000002", "SLEEKTECH ORCHARD"));
  assert.equal(a, "paynow 202627699c");
  assert.equal(b, a);
  assert.notEqual(habitMerchantKey(PAYNOW("26100120520761", "X", "202699999E")), a);
  assert.equal(habitMerchantKey("PAYNOW OTHR LI LITING"), "paynow othr li liting", "a line without a code keeps its text key");
});

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

test("the route finds same-code history under different payee text in its one bounded read", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const dates = ["2026-09-10", "2026-09-11"];
  for (const [index, date] of dates.entries()) {
    await createEntry(api, { description: PAYNOW(`2609${10 + index}12000000`, `SHOP NAME ${index}`), categoryName: "Entertainment", amountMinor: 1200 + index, date });
  }
  await createEntry(api, { description: PAYNOW("26091312000000", "ELSEWHERE", "202699999E"), categoryName: "Travel", amountMinor: 900, date: "2026-09-13" });
  await db.prepare("DELETE FROM ask_habits").run();

  const counting = countingDatabase(db);
  const answer = await buildCategoryGuess(counting.db, { description: PAYNOW_LINE });
  assert.deepEqual(answer, { categoryName: "Entertainment", source: "history" });
  assert.deepEqual(counting.calls.map((call) => call.sql), ["BATCH of 4"], "still one round trip: categories, rules, history and the shop's habit");

  const other = await buildCategoryGuess(db, { description: PAYNOW("26100120520761", "SLEEK TECH PTE LTD", "202611111A") });
  assert.equal(other, null, "an unseen code has no history");
});

test("the route ignores a code seen only once", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await createEntry(api, { description: PAYNOW("26091012000000", "ONLY ONCE"), categoryName: "Entertainment", amountMinor: 1200, date: "2026-09-10" });
  await db.prepare("DELETE FROM ask_habits").run();
  assert.equal(await buildCategoryGuess(db, { description: PAYNOW_LINE }), null);
});
