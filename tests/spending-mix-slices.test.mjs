import assert from "node:assert/strict";
import test from "node:test";

import { buildMonthSliceFacts } from "../src/client/month-slice-facts.js";
import { figureMenu } from "../src/client/figure-menu-model.js";

// A Spending Mix slice's menu (design.md "Summary body", "Openable
// figures"): the Month page's own facts for the category (its plan, where
// most of it went) and the menu's choices. Its View entries total is the
// slice: tests/openable-figures.test.mjs proves the `category` figure on the
// real Worker for every slice of the Month and Summary charts.

const entries = [
  { id: "1", categoryName: "Groceries", entryType: "expense", description: "FairPrice", amountMinor: 12_000 },
  { id: "2", categoryName: "Groceries", entryType: "expense", description: "FairPrice", amountMinor: 3_000 },
  { id: "3", categoryName: "Groceries", entryType: "expense", description: "Cold Storage", amountMinor: 9_000 },
  { id: "4", categoryName: "Groceries", entryType: "expense", description: "Sheng Siong", amountMinor: 2_000 },
  // A refund lowers its merchant's spending.
  { id: "5", categoryName: "Groceries", entryType: "income", description: "Cold Storage", amountMinor: 1_000 },
  { id: "6", categoryName: "Taxi", entryType: "expense", description: "Grab", amountMinor: 4_000 }
];
const planRows = [
  { label: "Groceries", categoryName: "Groceries", plannedMinor: 30_000 },
  { label: "Savings", categoryName: "Savings", plannedMinor: 50_000 }
];

test("a slice's facts: spent against its plan and the two biggest merchants, in whole dollars", () => {
  const facts = buildMonthSliceFacts({ planRows, entries });
  assert.deepEqual(facts({ label: "Groceries", valueMinor: 25_000 }, false), {
    hasPlan: true,
    lines: ["$250 of $300 planned", "Most at FairPrice $150, Cold Storage $80"]
  });
  // No plan line: no plan fact and no Open plan.
  assert.deepEqual(facts({ label: "Taxi", valueMinor: 4_000 }, false), { hasPlan: false, lines: ["Most at Grab $40"] });
});

test("hidden money: no fact with an amount, the plan choice still there", () => {
  const facts = buildMonthSliceFacts({ planRows, entries });
  assert.deepEqual(facts({ label: "Groceries", valueMinor: 25_000 }, true), { hasPlan: true, lines: [] });
});

test("a slice's menu: View entries for the category over the period, Open plan only with a plan line, Ask", () => {
  const period = { startMonth: "2026-05", endMonth: "2026-05" };
  const withPlan = figureMenu({ fig: "category", arg: "Groceries", plan: "", period, search: "?view=household&month=2026-05" });
  assert.deepEqual(withPlan.items.map((item) => item.action), ["entries", "plan", "ask"]);
  assert.equal(withPlan.label, "Groceries: what next");
  assert.match(withPlan.items[0].location.search, /entry_category=Groceries&entry_figure=spent/);
  assert.equal(withPlan.items[2].question, "How much did I spend on Groceries in May 2026?");
  const noPlan = figureMenu({ fig: "category", arg: "Taxi", plan: null, period, search: "" });
  assert.deepEqual(noPlan.items.map((item) => item.action), ["entries", "ask"]);
});
