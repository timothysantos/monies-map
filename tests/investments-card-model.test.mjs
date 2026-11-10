// The Investments card's chart and answer reader (investments-chart-model.js,
// summary-cards-api.js): worth only at statement months, never a line across
// a month with no statement, the money put in as a stepped line, and an
// answer the card cannot read is no answer.
import assert from "node:assert/strict";
import test from "node:test";

import { buildInvestmentsChart, shortDollars } from "../src/client/investments-chart-model.js";
import { readInvestmentsOverTime } from "../src/client/summary-cards-api.js";

const months = [
  { month: "2026-01", worthMinor: null, putInMinor: 1_000_000 },
  { month: "2026-02", worthMinor: 1_210_000, putInMinor: 1_200_000 },
  { month: "2026-03", worthMinor: 1_250_000, putInMinor: 1_200_000 },
  { month: "2026-04", worthMinor: null, putInMinor: 1_150_000 },
  { month: "2026-05", worthMinor: 1_480_000, putInMinor: 1_430_000 }
];

test("worth is a dot at each statement month and a line only between two months next to each other", () => {
  const chart = buildInvestmentsChart(months, { width: 500, height: 200, left: 40, bottom: 24, ticks: 4 });
  assert.deepEqual(chart.dots.map((dot) => dot.month), ["2026-02", "2026-03", "2026-05"]);
  // Feb to Mar is drawn; Mar to May (April has no statement) is not.
  assert.equal(chart.segments.length, 1);
  const [from, to] = chart.segments[0].split(" ");
  assert.equal(from, `${chart.dots[0].x},${chart.dots[0].y}`);
  assert.equal(to, `${chart.dots[1].x},${chart.dots[1].y}`);
  // A higher worth sits higher on the chart.
  assert.ok(chart.dots[2].y < chart.dots[0].y);
});

test("the money put in steps: flat through a month, then straight up or down at the next", () => {
  const chart = buildInvestmentsChart(months, { width: 500, height: 200 });
  const points = chart.putIn.split(" ").map((point) => point.split(",").map(Number));
  // Two points a month after the first (the step and the level), and one to the right edge.
  assert.equal(points.length, 1 + (months.length - 1) * 2 + 1);
  for (let index = 1; index < points.length - 1; index += 2) {
    assert.equal(points[index][0], points[index + 1][0], "a step is vertical");
  }
  assert.equal(points.at(-1)[1], points.at(-2)[1], "the last month runs flat to the edge");
});

test("axis ticks are round amounts that cover every value, and labels are short", () => {
  const chart = buildInvestmentsChart(months, { width: 500, height: 200, left: 40, bottom: 24, ticks: 4 });
  assert.equal(chart.yTicks.length, 4);
  const values = chart.yTicks.map((tick) => tick.valueMinor);
  assert.ok(values[0] >= 1_480_000 && values.at(-1) <= 1_000_000);
  assert.deepEqual([shortDollars(5_000_000), shortDollars(123_456_789), shortDollars(80_000)], ["$50k", "$1.2m", "$800"]);
  assert.equal(buildInvestmentsChart([], { width: 10, height: 10 }), null);
});

test("an answer the card cannot read is no answer; no account is nothing to show", () => {
  assert.equal(readInvestmentsOverTime(null), null);
  assert.equal(readInvestmentsOverTime({ accounts: [] }), null);
  assert.deepEqual(readInvestmentsOverTime({ viewId: "household", today: "2026-11-10", accounts: [] }), { viewId: "household", today: "2026-11-10", accounts: [] });
  // A row without its put in is dropped; with none left, nothing shows.
  const broken = readInvestmentsOverTime({ today: "2026-11-10", accounts: [{ accountId: "a", name: "A", worthMinor: 1, grewMinor: 0 }], putIn: { amountMinor: 0, ids: [] }, months: [] });
  assert.deepEqual(broken.accounts, []);
  const good = readInvestmentsOverTime({
    viewId: "person-tim", today: "2026-11-10", year: "2026", asOfDate: "2026-09-30", worthMinor: 10, startWorthMinor: 0, grewMinor: 2, paidOutMinor: 0,
    putIn: { amountMinor: 8, ids: ["e1"] },
    months: [{ month: "2026-09", worthMinor: 10, putInMinor: 8 }, { month: "bad", putInMinor: 1 }],
    accounts: [{ accountId: "a", name: "A", provider: "A", personName: "Tim", worthMinor: 10, grewMinor: 2, putIn: { amountMinor: 8, ids: ["e1"] }, asOfDate: "2026-09-30" }]
  });
  assert.equal(good.months.length, 1);
  assert.equal(good.accounts.length, 1);
});
