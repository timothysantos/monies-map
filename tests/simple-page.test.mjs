import assert from "node:assert/strict";
import test from "node:test";

import { PLAN_SIGNAL_KEYS, isPlanSignal, withoutPlanSignals } from "../src/domain/money-signals/plan-signals.ts";
import { withoutPlanSignals as summaryFilter } from "../src/domain/money-signals/summary-signals.ts";
import { buildMoneyIn } from "../src/client/month-money-in-model.js";

// The Simple page mode (design.md "Plan or Simple"): Money insights leave out
// the insights about the plan; Month shows what came in by source.

test("Simple drops every plan insight, keyed or prefixed, and keeps the rest in order", () => {
  const signals = [
    { key: "statement-gap:acct-1" },
    { key: "months-under-plan" },
    { key: "category-over-plan:row-7" },
    { key: "spending-above-income" },
    { key: "plan-pace" },
    { key: "subscriptions" },
    { key: "upcoming-bills" },
    { key: "income-arrived:2026-05-25" },
    { key: "fixed-costs" },
    { key: "keep-rate" }
  ];
  assert.deepEqual(withoutPlanSignals(signals).map((signal) => signal.key), [
    "statement-gap:acct-1", "spending-above-income", "subscriptions", "income-arrived:2026-05-25", "keep-rate"
  ]);
  // Summary's lazy insights module hands out the same filter.
  assert.equal(summaryFilter, withoutPlanSignals);
  // Negatives: a key that only contains a plan word is not a plan insight.
  assert.equal(isPlanSignal({ key: "planet-trivia" }), false);
  assert.equal(isPlanSignal({ key: "plan-left" }), true);
  assert.equal(PLAN_SIGNAL_KEYS.length, 11);
  assert.deepEqual(withoutPlanSignals([]), []);
});

test("Money in: one row per source with its total and entries, biggest first; paybacks and spending are not income", () => {
  const entries = [
    { id: "e1", description: "Salary", categoryName: "Salary", entryType: "income", amountMinor: 500_000, offsetsCategory: false },
    { id: "e2", description: " salary ", categoryName: "Salary", entryType: "income", amountMinor: 20_000, offsetsCategory: false },
    { id: "e3", description: "Dividends", categoryName: "Extra Income", entryType: "income", amountMinor: 30_000, offsetsCategory: false },
    { id: "e4", description: "Refund from shop", categoryName: "Shopping", entryType: "income", amountMinor: 4_000, offsetsCategory: true },
    { id: "e5", description: "Lunch", categoryName: "Food & Drinks", entryType: "expense", amountMinor: 1_500, offsetsCategory: false },
    { id: "e6", description: "", categoryName: "Extra Income", entryType: "income", amountMinor: 1_000, offsetsCategory: false }
  ];
  assert.deepEqual(buildMoneyIn(entries), {
    rows: [
      { label: "Salary", categoryName: "Salary", amountMinor: 520_000, entryIds: ["e1", "e2"] },
      { label: "Dividends", categoryName: "Extra Income", amountMinor: 30_000, entryIds: ["e3"] },
      { label: "Extra Income", categoryName: "Extra Income", amountMinor: 1_000, entryIds: ["e6"] }
    ],
    totalMinor: 551_000
  });
  assert.deepEqual(buildMoneyIn([]), { rows: [], totalMinor: 0 });
  assert.deepEqual(buildMoneyIn([entries[4]]), { rows: [], totalMinor: 0 });
});
