// "What changed this month" (src/domain/summary-changed.ts): the month so far
// against the same point of last month, from the same-day engine Ask uses.
// Rows are the 3 biggest rises then the 3 biggest falls; a category above its
// usual carries the mark and is added even outside those 3 (at most 2); a
// quiet month has no rows; it never predicts.
import assert from "node:assert/strict";
import test from "node:test";

import { buildSummaryChanged } from "../src/domain/summary-changed.ts";

let counter = 0;
const entry = (date, description, amountMinor, categoryName, entryType = "expense") => ({ id: `w${(counter += 1)}`, date, description, categoryName, entryType, amountMinor });
const TODAY = "2026-11-10";
const input = (entries, today = TODAY) => ({ viewId: "household", scope: "direct_plus_shared", today, entries });

// Two earlier months of a category's small usual, so "more than usual" can apply.
const history = (category) => ["2026-09", "2026-10"].map((month) => entry(`${month}-04`, `${category.toUpperCase()} SHOP`, 1_000, category));

function food() {
  return [
    ...["2026-08", "2026-09"].map((month) => entry(`${month}-05`, "KOUFU", 20_000, "Food & Drinks")),
    entry("2026-10-04", "KOUFU", 12_000, "Food & Drinks"),
    entry("2026-10-08", "CAFE", 8_000, "Food & Drinks"),
    entry("2026-11-02", "KOUFU", 12_000, "Food & Drinks"),
    entry("2026-11-05", "BURNT ENDS", 48_000, "Food & Drinks"),
    // After today's day in last month: never counted.
    entry("2026-10-20", "BIG LUNCH", 90_000, "Food & Drinks"),
    entry("2026-11-11", "TOMORROW", 70_000, "Food & Drinks"),
    entry("2026-10-05", "NTUC FAIRPRICE", 40_000, "Groceries"),
    entry("2026-11-06", "NTUC FAIRPRICE", 25_000, "Groceries"),
    entry("2026-10-06", "GRAB", 5_000, "Taxi"),
    entry("2026-11-06", "GRAB", 5_500, "Taxi"),
    // Money put aside is not spending.
    entry("2026-10-07", "TO BROKER", 300_000, "Investments"),
    entry("2026-11-07", "TO BROKER", 900_000, "Investments")
  ];
}

test("the 10th is compared with last month's 10th: rises first, then falls, with the shops behind each", () => {
  const card = buildSummaryChanged(input(food()));
  assert.equal(card.month, "2026-11");
  assert.equal(card.day, 10);
  assert.equal(card.baseMonth, "2026-10");
  assert.deepEqual(card.rows.map((row) => [row.category, row.direction, row.diffMinor, row.amountMinor, row.baseMinor, row.moreThanUsual]), [
    ["Food & Drinks", "up", 40_000, 60_000, 20_000, true],
    // Down on last month, yet above its usual (about $133 by the 10th): both are true.
    ["Groceries", "down", -15_000, 25_000, 40_000, true]
  ]);
  const [foodRow, groceries] = card.rows;
  assert.equal(foodRow.ids.length, 2, "only entries up to the 10th");
  assert.equal(foodRow.baseIds.length, 2, "last month's 4th and 8th, not its 20th");
  assert.deepEqual(foodRow.shops.map((shop) => [shop.name, shop.diffMinor, shop.amountMinor, shop.ids.length]), [["Burnt Ends", 48_000, 48_000, 1]], "only shops that moved the same way");
  assert.deepEqual(groceries.shops.map((shop) => [shop.name, shop.diffMinor]), [["NTUC Fairprice", -15_000]]);
  assert.ok(!card.rows.some((row) => row.category === "Investments"), "investments is not spending");
  assert.ok(!card.rows.some((row) => row.category === "Taxi"), "a small move is left out");
});

test("at most 3 rises and 3 falls; a category above its usual joins them with the mark, at most 2 such", () => {
  const list = [];
  for (const [index, category] of ["A", "B", "C", "D", "E", "F"].entries()) {
    list.push(...history(category), entry("2026-11-03", `${category} SHOP`, 90_000 - index * 10_000, category));
  }
  // Four falls, none above usual.
  for (const [index, category] of ["W", "X", "Y", "Z"].entries()) {
    list.push(entry("2026-10-03", `${category} SHOP`, 100_000 + index * 10_000, category));
  }
  list.push(entry("2026-11-04", "NOTHING", 100, "Nothing"));
  const card = buildSummaryChanged(input(list));
  const rises = card.rows.filter((row) => row.direction === "up");
  const falls = card.rows.filter((row) => row.direction === "down");
  assert.deepEqual(rises.map((row) => row.category), ["A", "B", "C", "D", "E"], "3 biggest, then the 2 marked ones");
  assert.ok(rises.every((row) => row.moreThanUsual));
  assert.deepEqual(falls.map((row) => row.category), ["Z", "Y", "X"], "only the 3 biggest falls");
  assert.ok(falls.every((row) => !row.moreThanUsual));
});

test("a rise that is not above its usual has no mark", () => {
  // Usual by the 10th is $700 in 5 of the 6 months and $100 last month
  // (about $600 together): $700 this month is $600 over last month, but not
  // 20% over the usual.
  const list = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"].map((month) => entry(`${month}-04`, "KOUFU", 70_000, "Food & Drinks"));
  list.push(entry("2026-10-04", "KOUFU", 10_000, "Food & Drinks"), entry("2026-11-04", "KOUFU", 70_000, "Food & Drinks"));
  const card = buildSummaryChanged(input(list));
  assert.deepEqual(card.rows.map((row) => [row.category, row.diffMinor, row.moreThanUsual]), [["Food & Drinks", 60_000, false]]);
});

test("a quiet month has no rows, and nothing to compare gives no card", () => {
  const quiet = buildSummaryChanged(input([
    entry("2026-10-04", "KOUFU", 10_000, "Food & Drinks"),
    entry("2026-11-04", "KOUFU", 11_000, "Food & Drinks"),
    entry("2026-10-05", "GRAB", 5_000, "Taxi"),
    entry("2026-11-05", "GRAB", 4_000, "Taxi")
  ]));
  assert.deepEqual(quiet.rows, []);
  assert.equal(buildSummaryChanged(input([entry("2026-11-04", "KOUFU", 10_000, "Food & Drinks")])), null, "no last month");
  assert.equal(buildSummaryChanged(input([entry("2026-10-04", "KOUFU", 10_000, "Food & Drinks")])), null, "nothing yet this month");
  assert.equal(buildSummaryChanged(input([])), null);
});

test("the card is a look back: no field forecasts, and money in under a category lowers it", () => {
  const card = buildSummaryChanged(input([
    entry("2026-10-04", "KOUFU", 50_000, "Food & Drinks"),
    entry("2026-11-04", "KOUFU", 50_000, "Food & Drinks"),
    entry("2026-11-05", "FRIEND PAID BACK", 30_000, "Food & Drinks", "income")
  ]));
  assert.deepEqual(card.rows.map((row) => [row.category, row.diffMinor, row.amountMinor]), [["Food & Drinks", -30_000, 20_000]]);
  assert.deepEqual(Object.keys(card).sort(), ["baseMonth", "day", "month", "rows", "scope", "viewId"]);
});
