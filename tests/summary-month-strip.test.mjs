// The glance at Summary's month list: the latest 6 months, newest first, each
// with its spend and how far over or under its plan in the money tones; a
// link that targets one month opens the full cards.
import assert from "node:assert/strict";
import test from "node:test";

import { buildMonthStrip, monthListStartsOpen } from "../src/client/summary-intent-outcome-model.js";

const month = (key, spent, planned) => ({
  month: key,
  estimatedExpensesMinor: planned,
  realExpensesMinor: spent,
  plannedIncomeMinor: 600000,
  actualIncomeMinor: 0,
  realizedSavingsMinor: 0,
  savingsGoalMinor: 0
});

const YEAR = ["2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01"].map((key, index) => month(key, 100000 + index, 100000));

test("the strip is the latest 6 months, newest first, whatever order they arrive in", () => {
  const strip = buildMonthStrip([...YEAR].reverse());
  assert.deepEqual(strip.map((item) => item.month), ["2026-01", "2025-12", "2025-11", "2025-10", "2025-09", "2025-08"]);
  assert.equal(buildMonthStrip(YEAR.slice(0, 2)).length, 2);
  assert.deepEqual(buildMonthStrip([]), []);
});

test("each month shows its spend and how far over or under its plan, in the money tones", () => {
  const [over, under, exact, noPlan] = buildMonthStrip([
    month("2026-04", 120050, 100000),
    month("2026-03", 90000, 100000),
    month("2026-02", 100000, 100000),
    month("2026-01", 5000, 0)
  ]);
  assert.equal(over.spent.amountMinor, 120050);
  assert.equal(over.spent.tone, "short");
  assert.equal(over.headroom.isOver, true);
  assert.equal(over.headroom.amountMinor, 20050);
  assert.equal(under.headroom.isOver, false);
  assert.equal(under.headroom.amountMinor, 10000);
  assert.notEqual(under.headroom.tone, over.headroom.tone);
  assert.equal(exact.headroom.isOver, false);
  assert.equal(exact.headroom.amountMinor, 0);
  assert.equal(noPlan.headroom.isOver, true);
});

test("a month with nothing spent and nothing planned has no over or under", () => {
  assert.equal(buildMonthStrip([month("2026-01", 0, 0)])[0].headroom, null);
});

test("only a link that targets one month opens the full cards", () => {
  assert.equal(monthListStartsOpen("#month-2026-05"), true);
  for (const hash of ["", "#", "#month-", "#month-2026-13", "#month-2026-5", "#months", "#month-2026-05-01", undefined]) {
    assert.equal(monthListStartsOpen(hash), false, String(hash));
  }
});
