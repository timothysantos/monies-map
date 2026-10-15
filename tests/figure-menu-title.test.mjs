import assert from "node:assert/strict";
import test from "node:test";

import { figureMenu } from "../src/client/figure-menu-model.js";

// Every openable figure's menu leads with what it is (design.md "Openable
// figures", the menu's title): a category's name, or a figure's name and
// period ("Invested · Jun 2025 – May 2026"), so a small slice or a bare
// number is never ambiguous.

const MONTH = { startMonth: "2026-05", endMonth: "2026-05" };
const YEAR = { startMonth: "2025-06", endMonth: "2026-05" };

test("a category's menu is titled with the category, whatever the slice's size, and no period", () => {
  for (const name of ["Church", "Groceries", "Parking & tolls"]) {
    const { title } = figureMenu({ fig: "category", arg: name, period: MONTH, plan: null });
    assert.deepEqual(title, { name, period: "" });
  }
});

test("a figure's menu is titled with its name and its period", () => {
  assert.deepEqual(figureMenu({ fig: "invested", period: YEAR, plan: "" }).title, { name: "Invested", period: "Jun 2025 – May 2026" });
  assert.deepEqual(figureMenu({ fig: "earned", period: MONTH, plan: "income" }).title, { name: "Earned", period: "May 2026" });
  assert.deepEqual(figureMenu({ fig: "spending", period: MONTH }).title, { name: "Spent", period: "May 2026" });
  assert.deepEqual(figureMenu({ fig: "kept", period: MONTH }).title, { name: "Kept", period: "May 2026" });
  assert.deepEqual(figureMenu({ fig: "plan", period: MONTH, plan: "" }).title, { name: "Plan", period: "May 2026" });
});

test("without a period of its own a figure takes the page's month", () => {
  assert.deepEqual(figureMenu({ fig: "outflow", period: null, search: "?month=2026-03" }).title, { name: "Outflow", period: "Mar 2026" });
});

test("a plan row's spent figure is titled with its category; a split balance with its group", () => {
  assert.equal(figureMenu({ fig: "spent", arg: "Utilities", period: MONTH, plan: "" }).title.name, "Utilities");
  assert.equal(figureMenu({ fig: "splits", arg: "group-1", name: "Bali trip", period: null, search: "?month=2026-05" }).title.name, "Bali trip");
  assert.equal(figureMenu({ fig: "splits", arg: "group-1", period: null, search: "?month=2026-05" }).title.name, "Splits");
});

test("hidden money keeps the title and the question never holds an amount", () => {
  const menu = figureMenu({ fig: "invested", period: YEAR, plan: "", hidden: true });
  assert.deepEqual(menu.title, { name: "Invested", period: "Jun 2025 – May 2026" });
  assert.doesNotMatch(JSON.stringify(menu), /\$\d/);
});

test("an insight line's menu offers only Ask about this, with no title, and says nothing of its money", () => {
  for (const hidden of [false, true]) {
    const menu = figureMenu({ fig: "insight", period: null, search: "?month=2026-05", hidden });
    assert.deepEqual(menu.items, [{ action: "ask-insight", label: "Ask about this" }]);
    assert.deepEqual(menu.title, { name: "", period: "" });
    assert.equal(menu.label, "Insight: what next");
    assert.doesNotMatch(JSON.stringify(menu), /\$\d|entries|plan/i);
  }
});

test("a long category name is passed through whole (the menu wraps it)", () => {
  const name = "Childcare, education and after-school enrichment classes for the children";
  assert.equal(figureMenu({ fig: "category", arg: name, period: MONTH }).title.name, name);
});
