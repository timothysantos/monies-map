import assert from "node:assert/strict";
import test from "node:test";

import { buildSpendChange } from "../src/domain/summary-spend-change.ts";

const month = (key, realExpensesMinor) => ({ month: key, realExpensesMinor });
const history = (from, amounts) => amounts.map((amount, index) => {
  const [year, number] = from.split("-").map(Number);
  const at = year * 12 + (number - 1) + index;
  return month(`${Math.floor(at / 12)}-${String((at % 12) + 1).padStart(2, "0")}`, amount);
});

// Six months of history, then a three-month range after it.
const stored = history("2026-01", [100_000, 100_000, 100_000, 100_000, 100_000, 100_000, 120_000, 110_000, 130_000]);

test("a range of complete months against the same number of months before it", () => {
  const range = ["2026-07", "2026-08", "2026-09"];
  const change = buildSpendChange(range, history("2026-07", [120_000, 110_000, 130_000]), stored, "2026-11");
  assert.deepEqual(change, { months: 3, currentMinor: 360_000, previousMinor: 300_000, partial: false });
});

test("the month in progress is left out of both sides and the note says so", () => {
  const range = ["2026-07", "2026-08", "2026-09", "2026-10"];
  const change = buildSpendChange(range, history("2026-07", [120_000, 110_000, 130_000, 40_000]), stored, "2026-10");
  assert.deepEqual(change, { months: 3, currentMinor: 360_000, previousMinor: 300_000, partial: true });
});

test("not enough history: an earlier month with no stored total gives no comparison", () => {
  const range = ["2026-01", "2026-02", "2026-03"];
  assert.equal(buildSpendChange(range, history("2026-01", [1, 1, 1]), stored, "2026-11"), undefined);
  // Only part of the earlier months is stored.
  const gap = stored.filter((item) => item.month !== "2026-05");
  assert.equal(buildSpendChange(["2026-07", "2026-08", "2026-09"], history("2026-07", [1, 1, 1]), gap, "2026-11"), undefined);
});

test("a range that is only the month in progress, or has gaps, gives no comparison", () => {
  assert.equal(buildSpendChange(["2026-10"], history("2026-10", [5_000]), stored, "2026-10"), undefined);
  assert.equal(buildSpendChange(["2026-07", "2026-09"], history("2026-07", [1, 1, 1]), stored, "2026-11"), undefined);
});

test("an earlier total under $100 is too small a base for a percentage", () => {
  const small = history("2026-04", [2_000, 3_000, 4_000, 120_000, 110_000, 130_000]);
  assert.equal(buildSpendChange(["2026-07", "2026-08", "2026-09"], history("2026-07", [120_000, 110_000, 130_000]), small, "2026-11"), undefined);
});
