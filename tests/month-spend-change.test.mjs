// The note under the Month page's Spending mix total (design.md "Month
// cards"): this month against the month before, with Summary's own rule, from
// figures the Summary tab already holds. No note for the month in progress,
// for a month whose month before is not loaded, or over too small a base; a
// held line while the range's Summary page is still on its way.
import assert from "node:assert/strict";
import test from "node:test";

import { selectMonthSpendChange } from "../src/client/month-spending-mix.js";
import { buildSpendChangeNote } from "../src/client/spend-change-model.js";

const RANGE = [
  { month: "2025-08", realExpensesMinor: 500_000 },
  { month: "2025-09", realExpensesMinor: 400_000 },
  { month: "2025-10", realExpensesMinor: 450_000 }
];
const october = { month: "2025-10", realExpensesMinor: 460_000 };

test("a complete month compares with the month before: the Month page's own total against the range's stored one", () => {
  const { spendChange, pending } = selectMonthSpendChange({ month: "2025-10", monthSummary: october, rangeMonths: RANGE, currentMonth: "2025-11" });
  assert.equal(pending, false);
  assert.deepEqual(spendChange, { months: 1, currentMinor: 460_000, previousMinor: 400_000, partial: false });
  // The note Summary draws for it: up 15%, rose (more spent), "vs the month before".
  assert.deepEqual(buildSpendChangeNote(spendChange), { arrow: "▲", percent: 15, tone: "rose", months: 1, partial: false });
  // Less spent reads mint.
  const lower = selectMonthSpendChange({ month: "2025-09", monthSummary: { month: "2025-09", realExpensesMinor: 400_000 }, rangeMonths: RANGE, currentMonth: "2025-11" });
  assert.deepEqual(buildSpendChangeNote(lower.spendChange), { arrow: "▼", percent: 20, tone: "mint", months: 1, partial: false });
});

test("no note for the month in progress, the range's first month, a small base, or with money hidden", () => {
  assert.deepEqual(selectMonthSpendChange({ month: "2025-11", monthSummary: { month: "2025-11", realExpensesMinor: 1 }, rangeMonths: RANGE, currentMonth: "2025-11" }), { spendChange: undefined, pending: false });
  assert.deepEqual(selectMonthSpendChange({ month: "2025-08", monthSummary: { month: "2025-08", realExpensesMinor: 500_000 }, rangeMonths: RANGE, currentMonth: "2025-11" }), { spendChange: undefined, pending: false });
  const small = [{ month: "2025-09", realExpensesMinor: 9_999 }];
  assert.equal(selectMonthSpendChange({ month: "2025-10", monthSummary: october, rangeMonths: small, currentMonth: "2025-11" }).spendChange, undefined);
  const { spendChange } = selectMonthSpendChange({ month: "2025-10", monthSummary: october, rangeMonths: RANGE, currentMonth: "2025-11" });
  assert.equal(buildSpendChangeNote(spendChange, { hidden: true }), null);
});

test("while the range's Summary page is on its way the line is held; a Month page not loaded yet holds nothing", () => {
  assert.deepEqual(selectMonthSpendChange({ month: "2025-10", monthSummary: october, rangeMonths: null, currentMonth: "2025-11" }), { spendChange: undefined, pending: true });
  assert.deepEqual(selectMonthSpendChange({ month: "2025-10", monthSummary: null, rangeMonths: RANGE, currentMonth: "2025-11" }), { spendChange: undefined, pending: false });
});
