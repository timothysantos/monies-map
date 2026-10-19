// The column + line chart in Summary's month-by-month card
// (earned-spent-chart-model.js, design.md "Plan or Simple"): its series come
// from the figures the card's list already shows, so the chart and the list
// can never disagree.
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildChartMonths,
  chartGeometry,
  chartScales,
  chartSeries,
  compactMoney,
  niceScale,
  pointFigure,
  toggleSeries
} from "../src/client/earned-spent-chart-model.js";
import { buildEarnedSpentMonths } from "../src/client/summary-earned-spent-model.js";

const month = (key, over = {}) => ({
  month: key,
  plannedIncomeMinor: 500000,
  actualIncomeMinor: 480000,
  estimatedExpensesMinor: 300000,
  realExpensesMinor: 250000,
  savingsGoalMinor: 100000,
  realizedSavingsMinor: 230000,
  estimatedDiffMinor: 0,
  realDiffMinor: 0,
  note: "",
  ...over
});

const MONTHS = [
  month("2026-03"),
  month("2026-01", { actualIncomeMinor: 100000, realExpensesMinor: 160000, estimatedExpensesMinor: 0 }),
  month("2026-02", { actualIncomeMinor: 300000, realExpensesMinor: 200000, estimatedExpensesMinor: 250000 })
];

test("Simple: oldest month first, earned, spent and kept are the list's own figures", () => {
  const rows = buildChartMonths({ mode: "simple", months: MONTHS });
  assert.deepEqual(rows.map((row) => row.month), ["2026-01", "2026-02", "2026-03"]);
  const list = buildEarnedSpentMonths(MONTHS).reverse();
  assert.deepEqual(rows.map((row) => [row.earnedMinor, row.spentMinor, row.lineMinor]), list.map((row) => [row.earnedMinor, row.spentMinor, row.keptMinor]));
  // Kept can be negative: January spent more than it earned.
  assert.equal(rows[0].lineMinor, -60000);
  assert.equal(rows[1].lineMinor, 100000);
});

test("Plan: the line is the month's planned spending; a month without a plan has no point", () => {
  const rows = buildChartMonths({ mode: "plan", months: MONTHS });
  assert.deepEqual(rows.map((row) => row.month), ["2026-01", "2026-02", "2026-03"]);
  assert.deepEqual(rows.map((row) => row.lineMinor), [null, 250000, 300000]);
  // Spent so far, adding up: a running total over the months shown, not a
  // copy of each month's Spent column (087b4637 drew the column's own figure).
  assert.deepEqual(rows.map((row) => row.runningMinor), [160000, 360000, 610000]);
  assert.equal(rows.some((row) => "actualMinor" in row), false);
  // Earned and spent are the Intent vs Outcome card's figures.
  assert.deepEqual(rows.map((row) => [row.earnedMinor, row.spentMinor]), [[100000, 160000], [300000, 200000], [480000, 250000]]);
});

test("Plan and Simple name different series; the line is the only one that differs", () => {
  const simple = chartSeries("simple");
  const plan = chartSeries("plan");
  assert.deepEqual(simple.map((series) => [series.key, series.kind, series.label]), [["earned", "bar", "Earned"], ["spent", "bar", "Spent"], ["kept", "line", "Kept"]]);
  assert.deepEqual(plan.map((series) => [series.key, series.kind, series.label]), [["earned", "bar", "Earned"], ["spent", "bar", "Spent"], ["plan", "line", "Planned spending"], ["running", "line", "Spent so far, adding up"]]);
  // The running total reads off its own axis on the right, so the columns
  // keep their height; every other series shares the left one.
  assert.deepEqual(plan.map((series) => series.axis ?? "left"), ["left", "left", "left", "right"]);
});

test("Plan: the running total has its own scale; the columns' scale never includes it", () => {
  const rows = buildChartMonths({ mode: "plan", months: MONTHS });
  assert.deepEqual(chartScales(rows).left, niceScale([100000, 160000, null, 300000, 200000, 250000, 480000, 250000, 300000]));
  assert.deepEqual(chartScales(rows).right, niceScale([160000, 360000, 610000]));
  assert.equal(chartScales(buildChartMonths({ mode: "simple", months: MONTHS })).right, null);
});

test("toggleSeries hides and shows a series but never the last one", () => {
  const all = ["earned", "spent", "kept"];
  let hidden = new Set();
  hidden = toggleSeries(hidden, "spent", all);
  assert.deepEqual([...hidden], ["spent"]);
  hidden = toggleSeries(hidden, "earned", all);
  assert.deepEqual([...hidden].sort(), ["earned", "spent"]);
  // Hiding the last visible series is refused: the chart would be empty.
  const refused = toggleSeries(hidden, "kept", all);
  assert.deepEqual([...refused].sort(), ["earned", "spent"]);
  assert.deepEqual([...toggleSeries(hidden, "spent", all)], ["earned"]);
});

test("niceScale: zero is always on the scale and the ticks are round numbers", () => {
  const scale = niceScale([480000, 250000, 300000]);
  assert.equal(scale.min, 0);
  assert.ok(scale.max >= 480000);
  assert.deepEqual(scale.ticks.slice(0, 2), [0, scale.step]);
  assert.equal(scale.ticks.at(-1), scale.max);
  assert.ok(scale.ticks.length >= 3 && scale.ticks.length <= 7);
  for (const tick of scale.ticks) assert.equal(tick % 100, 0);
  // A negative kept reaches below zero and the baseline stays on a tick.
  const negative = niceScale([100000, -60000]);
  assert.ok(negative.min <= -60000);
  assert.ok(negative.ticks.includes(0));
  // Nothing at all still has a scale.
  const empty = niceScale([0, 0]);
  assert.equal(empty.min, 0);
  assert.ok(empty.max > 0);
});

test("compactMoney writes short axis labels", () => {
  assert.equal(compactMoney(0), "$0");
  assert.equal(compactMoney(80000), "$800");
  assert.equal(compactMoney(800000), "$8k");
  assert.equal(compactMoney(150000), "$1.5k");
  assert.equal(compactMoney(-200000), "-$2k");
  assert.equal(compactMoney(99960), "$1k");
  assert.equal(compactMoney(250000000), "$2.5M");
});

test("chartGeometry fits 12 months at a phone's width and scrolls only past 12", () => {
  const phone = chartGeometry({ width: 366, monthCount: 12, barCount: 2 });
  assert.equal(phone.scrolls, false);
  assert.ok(phone.plotWidth <= 366 - phone.axisWidth);
  assert.ok(phone.barWidth >= 6, "columns stay readable");
  assert.ok(phone.groupWidth <= phone.band);
  const many = chartGeometry({ width: 366, monthCount: 18, barCount: 2 });
  assert.equal(many.scrolls, true);
  assert.ok(many.plotWidth >= 18 * 36);
  // A right axis (the running total) takes its width from the plot, never
  // from the page: 12 months still fit at a phone's width.
  const phoneRight = chartGeometry({ width: 366, monthCount: 12, barCount: 2, rightAxis: true });
  assert.equal(phoneRight.scrolls, false);
  assert.equal(phoneRight.rightAxisWidth, phoneRight.axisWidth);
  assert.ok(phoneRight.plotWidth <= 366 - phoneRight.axisWidth - phoneRight.rightAxisWidth);
  assert.equal(phone.rightAxisWidth, 0);
  const wide = chartGeometry({ width: 900, monthCount: 3, barCount: 2 });
  assert.ok(wide.barWidth <= 28, "few months do not make fat columns");
  // Bars sit inside their band, in series order.
  const [first, second] = [wide.barX(1, 0), wide.barX(1, 1)];
  assert.ok(second > first);
  assert.ok(first >= wide.bandStart(1) && second + wide.barWidth <= wide.bandStart(1) + wide.band);
});

test("pointFigure: each point's menu names the month and series and keeps the list's figures", () => {
  const rows = buildChartMonths({ mode: "simple", months: MONTHS });
  const january = rows[0];
  const spent = pointFigure("simple", chartSeries("simple")[1], january);
  assert.equal(spent.fig, "spending");
  assert.equal(spent.period, "2026-01:2026-01");
  assert.match(spent.label, /^Jan 2026 spent \$1,600\.00$/);
  assert.deepEqual(spent.note, ["$1,600.00", "160% of what came in"]);
  const kept = pointFigure("simple", chartSeries("simple")[2], january);
  assert.equal(kept.fig, "kept");
  assert.equal(kept.ask, "spentMore");
  assert.match(kept.label, /^Jan 2026 overspent \$600\.00$/);
  const earned = pointFigure("simple", chartSeries("simple")[0], january);
  assert.equal(earned.fig, "earned");
  assert.match(earned.label, /^Jan 2026 earned \$1,000\.00$/);

  const planRows = buildChartMonths({ mode: "plan", months: MONTHS });
  const planned = pointFigure("plan", chartSeries("plan")[2], planRows[1]);
  assert.equal(planned.fig, "spent");
  assert.equal(planned.plan, "");
  assert.equal(planned.name, "Planned spending");
  assert.equal(planned.ask, "plan");
  assert.match(planned.label, /^Feb 2026 planned spending \$2,500\.00$/);
  assert.deepEqual(planned.note, ["$2,500.00 planned", "$2,000.00 spent"]);
  // The running point's figure is the spending from the first month shown to
  // its own: View entries over that period totals the running figure.
  const running = pointFigure("plan", chartSeries("plan")[3], planRows[1], planRows[0].month);
  assert.equal(running.fig, "spent");
  assert.equal(running.period, "2026-01:2026-02");
  assert.equal(running.name, "Spent so far, adding up");
  assert.equal(running.plan, null);
  assert.match(running.label, /^Feb 2026 spent so far, adding up \$3,600\.00$/);
  assert.deepEqual(running.note, ["$3,600.00 spent from Jan 2026 to Feb 2026"]);
  const firstRunning = pointFigure("plan", chartSeries("plan")[3], planRows[0], planRows[0].month);
  assert.equal(firstRunning.period, "2026-01:2026-01");
  assert.deepEqual(firstRunning.note, ["$1,600.00 spent in Jan 2026"]);
  const planSpent = pointFigure("plan", chartSeries("plan")[1], planRows[1]);
  assert.equal(planSpent.fig, "spent");
  assert.equal(planSpent.plan, "");
  assert.deepEqual(planSpent.note, ["$2,000.00", "$500.00 under plan"]);
  const over = pointFigure("plan", chartSeries("plan")[1], buildChartMonths({ mode: "plan", months: [month("2026-04", { realExpensesMinor: 350000 })] })[0]);
  assert.deepEqual(over.note, ["$3,500.00", "$500.00 over plan"]);
  assert.equal(over.ask, "spentOverPlan");
  const noPlan = pointFigure("plan", chartSeries("plan")[1], planRows[0]);
  assert.deepEqual(noPlan.note, ["$1,600.00", "No plan for this month"]);
  assert.equal(noPlan.plan, null);
});
