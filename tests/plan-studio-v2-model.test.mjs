// Plan Studio v2's model (DOMAIN.md "Plan Studio", "Plan history"): one list
// grouped by what the money does, the slider popover's facts for a row, income
// by row with the money that arrived outside the plan, and where a new line
// is stored. October 2026, day 19, as in the v1 model test: Tim and Joyce plan
// $9,200 in and $8,870 out.
import assert from "node:assert/strict";
import test from "node:test";

import { planTotals, buildStudioRows, dayOfMonthFor } from "../src/client/plan-studio-model.js";
import {
  classifyNewLine,
  dueTagParts,
  incomeSegments,
  rowInfo,
  studioGroups,
  unplannedIncome
} from "../src/client/plan-studio-v2-model.js";
import { currentPlan } from "../src/client/plan-studio-edit.js";

const d = (dollars) => Math.round(dollars * 100);

function plannedRow(id, label, section, plannedDollars, actualDollars, extra = {}) {
  return {
    id, section, label, categoryName: extra.categoryName ?? label,
    plannedMinor: d(plannedDollars), actualMinor: d(actualDollars),
    ownershipType: extra.ownershipType ?? "shared", ownerName: extra.ownerName,
    sourceRowIds: [id], planDate: extra.planDate, splits: [], actualEntryIds: [],
    history: extra.history
  };
}
const incomeRow = (id, label, plannedDollars, actualDollars, ownerName) => ({
  id, label, categoryName: "Salary", plannedMinor: d(plannedDollars), actualMinor: d(actualDollars), ownerName, sourceRowIds: [id], isDerived: false
});

const incomeRows = [
  incomeRow("tim-sal", "Tim, salary", 5400, 5400, "Tim"),
  incomeRow("joy-sal", "Joyce, salary", 3200, 3200, "Joyce"),
  incomeRow("joy-bonus", "Joyce, bonus", 600, 0, "Joyce")
];
const planSections = [
  {
    key: "planned_items",
    rows: [
      plannedRow("bills", "Bills", "planned_items", 1450, 1210, { planDate: "2026-10-08" }),
      plannedRow("loan", "House loan", "planned_items", 2200, 2200, { planDate: "2026-10-02", history: [d(2200), d(2200), d(2200), 3] }),
      plannedRow("invest", "Investments", "planned_items", 1200, 800, { categoryName: "Investments", planDate: "2026-10-05" }),
      plannedRow("save", "Savings", "planned_items", 1500, 0, { categoryName: "Savings" })
    ]
  },
  {
    key: "budget_buckets",
    rows: [
      plannedRow("food", "Food", "budget_buckets", 1300, 910, { history: [d(1200), d(1180), d(1100), 3] }),
      plannedRow("travel", "Travel", "budget_buckets", 600, 640, { ownershipType: "direct", ownerName: "Tim" }),
      // A Savings line kept in the buckets section still saves.
      plannedRow("save2", "Savings", "budget_buckets", 100, 0, { categoryName: "Savings" }),
      // An undated investment bucket still invests.
      plannedRow("etf", "ETF top-up", "budget_buckets", 300, 0, { categoryName: "Investments" })
    ]
  }
];
const rows = buildStudioRows({ incomeRows, planSections, month: "2026-10" });
const byKey = Object.fromEntries(rows.map((row) => [row.key, row]));
const saved = currentPlan(rows, {});
const when = dayOfMonthFor("2026-10", "2026-10-19");

test("one list grouped by money job: dated spending items sit with the budgets, in due-date order first", () => {
  const groups = studioGroups(rows);
  assert.deepEqual(groups.map((group) => group.job), ["income", "spend", "save", "invest"]);
  assert.deepEqual(groups[0].rows.map((row) => row.key), ["tim-sal", "joy-sal", "joy-bonus"]);
  // House loan (due 2 Oct) and Bills (due 8 Oct) come first by date, then the undated budgets in page order.
  assert.deepEqual(groups[1].rows.map((row) => row.key), ["loan", "bills", "food", "travel"]);
  // Savings rows from either section are one Save group; investments from either section one Invest group.
  assert.deepEqual(groups[2].rows.map((row) => row.key), ["save", "save2"]);
  assert.deepEqual(groups[3].rows.map((row) => row.key), ["invest", "etf"]);
});

test("a group that has no rows is left out", () => {
  const onlySpend = buildStudioRows({ incomeRows: [], planSections: [{ key: "budget_buckets", rows: [plannedRow("food", "Food", "budget_buckets", 100, 0)] }], month: "2026-10" });
  assert.deepEqual(studioGroups(onlySpend).map((group) => group.job), ["spend"]);
});

test("a dated line shows a due tag from its date; an undated one has none; a date from another month has none", () => {
  assert.deepEqual(dueTagParts(byKey.loan), { day: 2, monthIndex: 9 });
  assert.equal(dueTagParts(byKey.food), null);
  const lastMonthDate = buildStudioRows({ incomeRows: [], planSections: [{ key: "planned_items", rows: [plannedRow("old", "Old", "planned_items", 10, 0, { planDate: "2026-09-30" })] }], month: "2026-10" })[0];
  assert.equal(dueTagParts(lastMonthDate), null, "a date outside the month shown is not a due date for it");
});

test("the popover facts for a flexible row: last month, the average, spent so far, what is left", () => {
  const info = rowInfo({ row: byKey.food, plannedMinor: d(1300), totals: planTotals(rows, saved), when });
  assert.equal(info.lastPlannedMinor, d(1200));
  assert.equal(info.lastActualMinor, d(1180));
  assert.equal(info.averageActualMinor, d(1100));
  assert.equal(info.averageMonths, 3);
  assert.equal(info.spentMinor, d(910));
  assert.equal(info.leftMinor, d(390));
  assert.equal(info.overMinor, 0);
});

test("a row with no past has no last month or average, and an over-plan row says how far over", () => {
  const info = rowInfo({ row: byKey.travel, plannedMinor: d(600), totals: planTotals(rows, saved), when });
  assert.equal(info.lastPlannedMinor, null);
  assert.equal(info.lastActualMinor, null);
  assert.equal(info.averageActualMinor, null);
  assert.equal(info.overMinor, d(40));
  assert.equal(info.leftMinor, 0);
});

test("pace for a flexible row follows a straight line: $910 spent by day 19 of 31 on $1,300 is ahead of $797", () => {
  const info = rowInfo({ row: byKey.food, plannedMinor: d(1300), totals: planTotals(rows, saved), when });
  // 1300 * 19 / 31 = 796.77; $910 is $113 above it, past the $104 margin (8%).
  assert.equal(info.pace.kind, "ahead");
  assert.equal(info.pace.amountMinor, d(910) - Math.round((d(1300) * 19) / 31));
  assert.equal(info.pace.dated, false);
});

test("pace for a dated row follows its due date: paid in full is on pace, unpaid after the date is behind, before the date is on pace", () => {
  const paid = rowInfo({ row: byKey.loan, plannedMinor: d(2200), totals: planTotals(rows, saved), when });
  assert.equal(paid.pace.kind, "on_pace");
  assert.equal(paid.pace.dated, true);
  const unpaid = rowInfo({ row: { ...byKey.bills, actualMinor: 0 }, plannedMinor: d(1450), totals: planTotals(rows, saved), when });
  assert.equal(unpaid.pace.kind, "behind");
  assert.equal(unpaid.pace.amountMinor, d(1450));
  assert.equal(unpaid.pace.dated, true);
  const early = rowInfo({ row: { ...byKey.bills, actualMinor: 0 }, plannedMinor: d(1450), totals: planTotals(rows, saved), when: dayOfMonthFor("2026-10", "2026-10-03") });
  assert.equal(early.pace.kind, "on_pace");
});

test("income, savings and a month that is not the current one have no pace", () => {
  const totals = planTotals(rows, saved);
  assert.equal(rowInfo({ row: byKey["tim-sal"], plannedMinor: d(5400), totals, when }).pace, null);
  assert.equal(rowInfo({ row: byKey.save, plannedMinor: d(1500), totals, when }).pace, null);
  assert.equal(rowInfo({ row: byKey.food, plannedMinor: d(1300), totals, when: dayOfMonthFor("2026-10", "2026-11-05") }).pace, null);
  assert.equal(rowInfo({ row: byKey.food, plannedMinor: d(1300), totals, when: dayOfMonthFor("2026-10", "2026-09-05") }).pace, null);
});

test("the live effect of a pending change on Left over: raising a spend row by $40 lowers Left over by $40", () => {
  const before = planTotals(rows, saved);
  assert.equal(before.left, d(9200) - d(1450 + 2200 + 1200 + 1500 + 1300 + 600 + 100 + 300));
  const held = { ...saved, food: d(1340) };
  const totals = planTotals(rows, held);
  const info = rowInfo({ row: byKey.food, plannedMinor: d(1340), totals, when });
  assert.deepEqual(info.effect, { changeMinor: d(40), leftOverMinor: before.left - d(40), leftOverWasMinor: before.left });
});

test("raising an income row raises Left over; lowering a row gives it back; no pending change has no effect line", () => {
  const before = planTotals(rows, saved);
  const incomeHeld = { ...saved, "joy-bonus": d(900) };
  const income = rowInfo({ row: byKey["joy-bonus"], plannedMinor: d(900), totals: planTotals(rows, incomeHeld), when });
  assert.equal(income.effect.changeMinor, d(300));
  assert.equal(income.effect.leftOverMinor, before.left + d(300));
  const lowered = rowInfo({ row: byKey.food, plannedMinor: d(1200), totals: planTotals(rows, { ...saved, food: d(1200) }), when });
  assert.equal(lowered.effect.changeMinor, -d(100));
  assert.equal(lowered.effect.leftOverMinor, before.left + d(100));
  assert.equal(rowInfo({ row: byKey.food, plannedMinor: d(1300), totals: before, when }).effect, null);
});

test("Planned in by income row: each row with money in it, in order, with its owner", () => {
  assert.deepEqual(incomeSegments(rows, saved), [
    { key: "tim-sal", label: "Tim, salary", ownerName: "Tim", amountMinor: d(5400) },
    { key: "joy-sal", label: "Joyce, salary", ownerName: "Joyce", amountMinor: d(3200) },
    { key: "joy-bonus", label: "Joyce, bonus", ownerName: "Joyce", amountMinor: d(600) }
  ]);
  assert.deepEqual(incomeSegments(rows, { ...saved, "joy-bonus": 0 }).map((segment) => segment.key), ["tim-sal", "joy-sal"], "a row planned at nothing has no segment");
});

test("money that arrived beyond the plan is the actual minus the planned money in, and never negative", () => {
  assert.equal(unplannedIncome({ receivedMinor: d(9500), plannedInMinor: d(9200) }), d(300));
  assert.equal(unplannedIncome({ receivedMinor: d(9200), plannedInMinor: d(9200) }), 0);
  assert.equal(unplannedIncome({ receivedMinor: d(8000), plannedInMinor: d(9200) }), 0, "less than planned is not extra");
  assert.equal(unplannedIncome({ receivedMinor: 0, plannedInMinor: 0 }), 0);
});

test("a new line is stored by its date and job: dated spending in planned items, undated in budget buckets, savings and investing as the rules classify them", () => {
  assert.deepEqual(classifyNewLine({ label: "House loan", categoryName: "Housing", planDate: "2026-10-02" }), { job: "spend", sectionKey: "planned_items" });
  assert.deepEqual(classifyNewLine({ label: "Eating out", categoryName: "Food", planDate: "" }), { job: "spend", sectionKey: "budget_buckets" });
  assert.deepEqual(classifyNewLine({ label: "ETF", categoryName: "Investments", planDate: null }), { job: "invest", sectionKey: "budget_buckets" });
  assert.deepEqual(classifyNewLine({ label: "ETF", categoryName: "Investments", planDate: "2026-10-05" }), { job: "invest", sectionKey: "planned_items" });
  assert.deepEqual(classifyNewLine({ label: "Savings", categoryName: "Savings", planDate: null }), { job: "save", sectionKey: "budget_buckets" });
  assert.deepEqual(classifyNewLine({ label: "Salary", categoryName: "Salary", kind: "income" }), { job: "income", sectionKey: "income" });
});

test("a line stays in the job the rules give it whichever section it lives in", () => {
  // The same classification the studio rows use, so what is created lands in the group the row will show.
  for (const key of ["save", "save2"]) assert.equal(byKey[key].job, "save");
  for (const key of ["invest", "etf"]) assert.equal(byKey[key].job, "invest");
  assert.equal(classifyNewLine({ label: byKey.etf.label, categoryName: byKey.etf.categoryName, planDate: null }).job, byKey.etf.job);
});
