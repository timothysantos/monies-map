// More than usual so far (src/domain/usual-so-far.ts): the month in
// progress against the same day-of-month point of the last 6 months with
// data; a line only above both 20% and $50; never predicts.
import assert from "node:assert/strict";
import test from "node:test";

import { categoriesAboveUsualSoFar, sameDayUsual } from "../src/domain/usual-so-far.ts";

let counter = 0;
const entry = (date, amountMinor, categoryName = "Food & Drinks", entryType = "expense") => ({ id: `s${(counter += 1)}`, date, categoryName, entryType, amountMinor });

// Food: $370 by the 10th in each of May to October, and more after the 10th
// (which must not count); November: $610 by the 10th.
function food(november = 61_000) {
  const list = [];
  for (const month of ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]) {
    list.push(entry(`${month}-04`, 17_000), entry(`${month}-09`, 20_000), entry(`${month}-25`, 90_000));
  }
  list.push(entry("2026-11-03", november - 10_000), entry("2026-11-10", 10_000), entry("2026-11-11", 50_000));
  return list;
}

test("a mid-month day is compared like for like: the 10th with earlier 10ths, never whole months", () => {
  const result = categoriesAboveUsualSoFar(food(), "2026-11-10");
  assert.equal(result.day, 10);
  assert.equal(result.months, 6);
  assert.deepEqual(result.lines.map((line) => [line.key, line.nowMinor, line.usualMinor, line.diffMinor, line.ids.length]), [["Food & Drinks", 61_000, 37_000, 24_000, 2]]);
  // The 31st in a 30-day month is its 30th.
  const late = sameDayUsual([entry("2026-09-30", 1_000), entry("2026-10-31", 1_000), entry("2026-11-30", 5_000)], "2026-12-31", (item) => item.categoryName);
  assert.equal(late.groups[0].usualMinor, Math.round((1_000 + 1_000 + 5_000) / 3));
});

test("no line under either threshold, with fewer than 2 months of history, or for spending below usual", () => {
  // More than 20% but not more than $50.
  assert.equal(categoriesAboveUsualSoFar(food(37_000 + 4_900), "2026-11-10"), null);
  // More than $50 but not more than 20% (a big category).
  // Usual $3,700 by the 10th; this month $4,200: $500 more but only 13.5%.
  const big = food(42_000).map((item) => ({ ...item, amountMinor: item.amountMinor * 10 }));
  const bigResult = categoriesAboveUsualSoFar(big, "2026-11-10");
  assert.equal(bigResult, null);
  // Just over both is a line.
  assert.equal(categoriesAboveUsualSoFar(food(37_000 * 1.2 + 5_100), "2026-11-10").lines.length, 1);
  // One month of history.
  assert.equal(categoriesAboveUsualSoFar([entry("2026-10-04", 1_000), entry("2026-11-04", 90_000)], "2026-11-10"), null);
  // Less than usual.
  assert.equal(categoriesAboveUsualSoFar(food(10_000), "2026-11-10"), null);
});

test("at most 2 lines, the largest differences first", () => {
  const list = food();
  for (const [category, amount] of [["Taxi", 30_000], ["Home", 90_000], ["Shopping", 20_000]]) {
    for (const month of ["2026-09", "2026-10"]) list.push(entry(`${month}-05`, 1_000, category));
    list.push(entry("2026-11-05", amount, category));
  }
  const result = categoriesAboveUsualSoFar(list, "2026-11-10");
  assert.deepEqual(result.lines.map((line) => line.key), ["Home", "Taxi"]);
});
