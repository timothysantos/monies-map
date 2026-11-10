// "What changed?" (src/domain/ask-changed.ts): a month against the one
// before (or its usual), by category, with the shops behind each change;
// increases first, then decreases, at most 5 each. Every figure is the app's.
import assert from "node:assert/strict";
import test from "node:test";

import { buildChangedCard, buildChangedFacts, buildChangedWording } from "../src/domain/ask-changed.ts";
import { readAnswerIntent } from "../src/domain/ask-answer-intent.ts";

const money = (minor) => `$${(Math.abs(minor) / 100).toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const TRACKED = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
let counter = 0;
const entry = (date, description, amountMinor, categoryName) => ({ id: `c${(counter += 1)}`, date, description, categoryName, entryType: "expense", amountMinor });

function entries() {
  return [
    entry("2026-09-04", "GRAB*TRIP", 8_000, "Taxi"),
    entry("2026-09-05", "NTUC FAIRPRICE", 52_000, "Groceries"),
    entry("2026-09-06", "KOUFU", 12_000, "Food & Drinks"),
    entry("2026-10-04", "GRAB*TRIP", 15_440, "Taxi"),
    entry("2026-10-08", "GOJEK", 1_000, "Taxi"),
    entry("2026-10-05", "NTUC FAIRPRICE", 40_000, "Groceries"),
    entry("2026-10-06", "KOUFU", 12_000, "Food & Drinks"),
    entry("2026-10-07", "COOLBREEZE AIRCON", 48_000, "Home")
  ];
}

test("October against September: rises first with the shops behind them, then falls; an unchanged category is left out", () => {
  const facts = buildChangedFacts({ month: "2026-10", base: "previous", viewId: "household", scope: "direct_plus_shared", entries: entries(), trackedMonths: TRACKED });
  assert.equal(facts.amountMinor, 116_440);
  assert.equal(facts.baseMinor, 72_000);
  assert.deepEqual(facts.increases.map((row) => [row.category, row.amountMinor, row.baseMinor, row.diffMinor, row.shops.map((shop) => [shop.name, shop.diffMinor])]), [
    ["Home", 48_000, 0, 48_000, [["Coolbreeze Aircon", 48_000]]],
    ["Taxi", 16_440, 8_000, 8_440, [["Grab Trip", 7_440], ["Gojek", 1_000]]]
  ]);
  assert.deepEqual(facts.decreases.map((row) => [row.category, row.diffMinor]), [["Groceries", -12_000]]);
  assert.equal(buildChangedWording(facts, money), "October came to $1,164.40, $444.40 more than September. The biggest rises were Home (+$480.00, mostly Coolbreeze Aircon) and Taxi (+$84.40, mostly Grab Trip). The biggest falls were Groceries (-$120.00, mostly NTUC Fairprice).");
  const card = buildChangedCard(facts, money);
  assert.equal(card.title, "What changed in October");
  assert.deepEqual(card.lines.map((line) => [line.label, line.amountMinor, line.figure.ids.length, line.figure.period]), [
    ["Home", 48_000, 1, "2026-10:2026-10"],
    ["Taxi", 16_440, 2, "2026-10:2026-10"],
    ["Groceries", 40_000, 1, "2026-10:2026-10"]
  ]);
});

test("at most 5 increases and 5 decreases; against the usual, each category's own usual month", () => {
  const many = [];
  for (let index = 0; index < 7; index += 1) {
    many.push(entry("2026-09-10", `SHOP ${index}`, 1_000, `Cat ${index}`), entry("2026-10-10", `SHOP ${index}`, 2_000 + index, `Cat ${index}`));
    many.push(entry("2026-09-11", `OTHER ${index}`, 5_000, `Down ${index}`), entry("2026-10-11", `OTHER ${index}`, 1_000, `Down ${index}`));
  }
  const facts = buildChangedFacts({ month: "2026-10", base: "previous", viewId: "household", scope: "direct_plus_shared", entries: many, trackedMonths: TRACKED });
  assert.equal(facts.increases.length, 5);
  assert.equal(facts.decreases.length, 5);
  assert.equal(facts.increases[0].category, "Cat 6");
  const usual = buildChangedFacts({ month: "2026-10", base: "usual", viewId: "household", scope: "direct_plus_shared", entries: entries(), trackedMonths: TRACKED });
  assert.equal(usual.baseLabel, "Usual");
  // Taxi's usual month: Apr to Aug had none, September $80: the middle is $0.
  assert.equal(usual.increases.find((row) => row.category === "Taxi").baseMinor, 0);
});

test("the rules reader: what changed, and why did we spend more, with the month as a word", () => {
  const context = { today: "2026-11-10", month: "2026-11", people: [], vocabulary: ["Taxi", "Groceries"] };
  assert.deepEqual(readAnswerIntent("what changed this month?", context), { kind: "changed", month: "2026-11", base: "previous" });
  assert.deepEqual(readAnswerIntent("why did we spend more in October?", context), { kind: "changed", month: "2026-10", base: "previous" });
  assert.deepEqual(readAnswerIntent("wat changed in october", context), { kind: "changed", month: "2026-10", base: "previous" });
  assert.deepEqual(readAnswerIntent("what changed in October against usual?", context), { kind: "changed", month: "2026-10", base: "usual" });
  // Still the existing answers.
  assert.equal(readAnswerIntent("why was October so expensive?", context).kind, "spending");
  assert.equal(readAnswerIntent("compare October with September", context).kind, "compare");
});
