// Month's plan-balance To do: a month whose plan spends more than the income
// it expects fires with exact wording; a balanced plan stays silent. The
// plan's savings rows are part of its planned spend, so they are never
// added a second time (src/client/month-helpers.js, "Remaining budget").
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { composeCheckIn, emptyVisitMemory } from "../src/domain/money-signals/checkin.ts";
import { buildMonthSignals, monthCalmLine, planShortfallSignal } from "../src/domain/money-signals/month-signals.ts";
import { formatCurrencyMinor } from "../src/domain/split-currency.ts";
import { buildMonthPage } from "../src/domain/month-projection.ts";
import { buildSummaryPage } from "../src/domain/summary-projection.ts";

// Components import their stylesheets (as Vite expects); load CSS as empty.
register("data:text/javascript," + encodeURIComponent(
  "export async function load(url, context, next) { return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context); }"
));
globalThis.React = React;
const { MoneyPrivacyProvider } = await import("../src/client/money-privacy.jsx");
const { FinancialInsight } = await import("../src/client/financial-insight.jsx");

const sgd = (minor) => formatCurrencyMinor(minor, "SGD");
const facts = (signal) => signal.phrasings.map((phrasing) => phrasing.fact);

function row(id, label, plannedMinor, section = "budget_buckets") {
  return { id, label, categoryName: label, plannedMinor, actualMinor: 0, section };
}

// The showcase household's March shape: a 13,500 income, a plan that
// totals 14,700 with the 2,500 savings line inside it, so it is 1,200 short.
function shortPlan() {
  return {
    incomeRows: [{ plannedMinor: 830_000, actualMinor: 0 }, { plannedMinor: 520_000, actualMinor: 0 }],
    planSections: [
      { key: "planned_items", rows: [row("p1", "HDB loan", 148_000, "planned_items"), row("p2", "Savings", 250_000, "planned_items")] },
      { key: "budget_buckets", rows: [row("b1", "Food & Drinks", 700_000), row("b2", "Shopping", 372_000)] }
    ]
  };
}

function input(overrides = {}) {
  return {
    audience: "household",
    viewLabel: "Household",
    month: "2026-09",
    today: "2026-09-14",
    entries: [],
    ...shortPlan(),
    summary: null,
    accountPills: [],
    formatMoney: sgd,
    ...overrides
  };
}

// The same plan with its spend moved so it is `gapMinor` short (negative: spare).
function planShortBy(gapMinor, { incomeMinor = 1_350_000, savingsMinor = 250_000 } = {}) {
  return {
    incomeRows: [{ plannedMinor: incomeMinor, actualMinor: 0 }],
    planSections: [
      { key: "planned_items", rows: savingsMinor ? [row("p2", "Savings", savingsMinor, "planned_items")] : [] },
      { key: "budget_buckets", rows: [row("b1", "Food & Drinks", incomeMinor + gapMinor - savingsMinor)] }
    ]
  };
}

test("plan balance: a plan that spends more than it expects to earn names the shortfall, the plan's total and the savings that still fit", () => {
  const signal = planShortfallSignal(input());
  assert.equal(signal.key, "plan-shortfall");
  assert.equal(signal.kind, "quick_fix");
  assert.equal(signal.weight, 120_000);
  assert.deepEqual(signal.numbers, { primaryMinor: 120_000, plannedMinor: 1_470_000, incomeMinor: 1_350_000 });
  assert.equal(signal.primaryText, "$1,200.00");
  assert.equal(signal.action, undefined);
  assert.equal(signal.topic, "plan");
  assert.deepEqual(facts(signal), [
    "Your September plan spends $1,200.00 more than it expects to earn, so only $1,300.00 of the $2,500.00 savings goal fits.",
    "In September you planned to spend $1,200.00 more than you expect to earn, which leaves room for only $1,300.00 of the $2,500.00 you planned to save.",
    "September's plan spends $14,700.00 against $13,500.00 of expected income, so only $1,300.00 of the $2,500.00 savings goal fits.",
    "The September plan is $1,200.00 short, so only $1,300.00 of the $2,500.00 you planned to save fits."
  ]);
  assert.deepEqual(signal.phrasings[0].thinks, [
    "Raising the income you expect, or trimming a budget line, brings the plan back to even.",
    "A plan that spends more than it brings in can't all happen. Raising the income you expect, or trimming a budget line, fixes that.",
    "Changing the plan now is easier than finding the gap at the end of the month.",
    "Either the income you expect is too low or a budget line is too high. If a bonus or extra pay is coming, adding it may close the gap."
  ]);
  assert.deepEqual(signal.sorted, {
    fact: "Sorted: the plan now covers what you planned to spend.",
    think: "The income you expect matches what you planned to spend."
  });
});

test("plan balance: a plan with no savings goal, or one the shortfall swallows, uses the plain wording", () => {
  const plain = planShortfallSignal(input(planShortBy(120_000, { savingsMinor: 0 })));
  assert.equal(plain.weight, 120_000);
  assert.deepEqual(facts(plain), [
    "In September you planned to spend $1,200.00 more than you expect to earn.",
    "Your September plan spends $1,200.00 more than it expects to earn.",
    "September's plan spends $14,700.00 but only expects $13,500.00 to come in, $1,200.00 less.",
    "The September plan doesn't balance: $14,700.00 planned to go out, $13,500.00 expected to come in."
  ]);

  // A savings goal of $1,000 against a $1,200 shortfall: none of it fits, so
  // the line speaks of the shortfall alone rather than promise part of it.
  const swallowed = planShortfallSignal(input(planShortBy(120_000, { savingsMinor: 100_000 })));
  assert.equal(swallowed.phrasings[0].fact, "In September you planned to spend $1,200.00 more than you expect to earn.");
  assert.ok(facts(swallowed).every((fact) => !/savings goal|plan(ned)? to save/.test(fact)));

  // The shortfall equal to the goal leaves $0 of it: also the plain line.
  assert.doesNotMatch(planShortfallSignal(input(planShortBy(250_000))).phrasings[0].fact, /savings goal/);
});

test("plan balance: savings are inside the planned spend and are not added a second time", () => {
  // Income 13,500 against 13,500 of planned spend, 2,500 of it savings: even.
  assert.equal(planShortfallSignal(input(planShortBy(0))), null);
  // Planned spend 1,000 under income: spare, not short.
  assert.equal(planShortfallSignal(input(planShortBy(-100_000))), null);
});

test("plan balance: it fires only above $50 and 2% of the planned income", () => {
  // 2% of $13,500 is $270: the threshold is the larger of that and $50.
  assert.equal(planShortfallSignal(input(planShortBy(27_000))), null);
  assert.equal(planShortfallSignal(input(planShortBy(27_001))).weight, 27_001);
  // A small income: 2% of $1,000 is $20, so the $50 floor decides.
  const small = (gapMinor) => planShortBy(gapMinor, { incomeMinor: 100_000, savingsMinor: 0 });
  assert.equal(planShortfallSignal(input(small(5_000))), null);
  assert.equal(planShortfallSignal(input(small(5_001))).weight, 5_001);
  assert.equal(planShortfallSignal(input(small(4_000))), null);
});

test("plan balance: silent without an income plan, without a spending plan and for a month already over", () => {
  assert.equal(planShortfallSignal(input({ incomeRows: [] })), null);
  assert.equal(planShortfallSignal(input({ incomeRows: [{ plannedMinor: 0, actualMinor: 0 }] })), null);
  assert.equal(planShortfallSignal(input({ planSections: [{ key: "planned_items", rows: [] }, { key: "budget_buckets", rows: [] }] })), null);
  // August is past on 14 Sep: the plan is history, so there is nothing to fix.
  assert.equal(planShortfallSignal(input({ month: "2026-08" })), null);
  // The month in progress and a month ahead both fire.
  assert.equal(planShortfallSignal(input({ month: "2026-09", today: "2026-09-30" })).weight, 120_000);
  assert.equal(planShortfallSignal(input({ month: "2026-10" })).weight, 120_000);
  assert.equal(
    planShortfallSignal(input({ month: "2026-10" })).phrasings[0].fact,
    "Your October plan spends $1,200.00 more than it expects to earn, so only $1,300.00 of the $2,500.00 savings goal fits."
  );
});

test("plan balance: it sits in the Month signals and leads ahead of a bigger question", () => {
  const signals = buildMonthSignals(input({
    summary: { estimatedExpensesMinor: 1_470_000, realExpensesMinor: 1_900_000, plannedIncomeMinor: 1_350_000, actualIncomeMinor: 1_350_000 },
    entries: [{ id: "e1", date: "2026-09-03", description: "COURTS MEGASTORE TAMPINES", amountMinor: 900_000, categoryName: "Home", entryType: "expense" }]
  }));
  assert.ok(signals.some((signal) => signal.key === "one-off-over-plan"), "a bigger question fires too");
  const view = composeCheckIn({ signals, memory: emptyVisitMemory(), nowMs: Date.parse("2026-09-14T10:00:00+08:00"), today: "2026-09-14", seed: "month:household|2026-09", contextKey: "2026-09", calmLine: monthCalmLine("2026-09") });
  assert.equal(view.headline.key, "plan-shortfall");
  assert.equal(view.headline.kind, "quick_fix");
  assert.match(view.headline.fact, /^(?:Your September plan spends|In September you planned|September's plan spends|The September plan is) /);
  // A balanced plan has no such line at all.
  assert.ok(!buildMonthSignals(input(planShortBy(0))).some((signal) => signal.key === "plan-shortfall"));
});

test("plan balance: its words pass the same checks as every Month line over a year of months", () => {
  const seen = new Set();
  for (const month of ["2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06", "2027-07", "2027-08"]) {
    const signal = planShortfallSignal(input({ month }));
    const view = composeCheckIn({ signals: [signal], memory: emptyVisitMemory(), nowMs: Date.parse("2026-09-14T10:00:00+08:00"), today: "2026-09-14", seed: `month:household|${month}`, contextKey: month, period: month, calmLine: monthCalmLine(month) });
    seen.add(`${view.headline.fact} ${view.headline.think}`);
  }
  assert.equal(seen.size, 12, "twelve months, twelve different wordings");
});

test("plan balance: with money hidden the line shows neither amounts nor its sign", () => {
  const signals = [planShortfallSignal(input())];
  const checkIn = {
    memoryKey: "month|household",
    contextKey: "2026-09|direct_plus_shared",
    signals,
    page: "month",
    period: "2026-09",
    calmLines: [monthCalmLine("2026-09")],
    clock: { nowMs: Date.parse("2026-09-14T10:00:00+08:00"), today: "2026-09-14" }
  };
  function render(visible) {
    globalThis.window = { localStorage: { getItem: (key) => (key === "monies-map:money-totals-visible" ? String(visible) : null), setItem() {} } };
    globalThis.document = { documentElement: { dataset: {} } };
    try {
      return renderToStaticMarkup(React.createElement(MoneyPrivacyProvider, null, React.createElement(FinancialInsight, { checkIn })));
    } finally {
      delete globalThis.window;
      delete globalThis.document;
    }
  }
  const hidden = render(false);
  assert.match(hidden, /Reveal money totals to read these insights\./);
  assert.doesNotMatch(hidden, /\$|1,200|2,500|more than it expects|spends|short|savings goal|To do/);
  // Negative: with totals visible the same signal reads in full.
  const shown = render(true);
  assert.match(shown, /spends \$1,200\.00 more than it expects to earn|planned to spend \$1,200\.00 more|\$1,200\.00 short|against \$13,500\.00/);
  assert.match(shown, /To do/);
});

// The aggregation behind the cards: planned spend counts every non-income
// plan row once, savings included, and planned income only income rows.
test("projection: planned spend includes the savings rows and planned income only the income rows, for the month and the range", () => {
  const plan = (id, label, section, plannedMinor, personId = "p-ethan") => ({
    id, section, categoryName: label, label, plannedMinor, actualMinor: 0, personId, ownerName: "Ethan",
    ownershipType: "direct", splits: [], note: "", dayLabel: undefined, accountName: undefined
  });
  const planRows = [
    plan("r1", "Savings", "planned_items", 250_000),
    plan("r2", "Groceries", "budget_buckets", 620_000, null),
    plan("r3", "Rent", "planned_items", 600_000)
  ];
  const incomeRows = [{ id: "i1", categoryName: "Salary", label: "Salary", plannedMinor: 1_350_000, actualMinor: 0, personId: "p-ethan" }];
  const month = buildMonthPage("household", "direct_plus_shared", incomeRows, [], planRows, [], "2026-09", null);
  const card = (label) => month.metricCards.find((item) => item.label === label).amountMinor;
  assert.equal(card("Planned spend"), 1_470_000, "savings is inside planned spend");
  assert.equal(card("Savings target"), 250_000);
  assert.equal(month.incomeRows.reduce((sum, item) => sum + item.plannedMinor, 0), 1_350_000);

  const snapshot = { month: "2026-09", plannedIncomeMinor: 1_350_000, actualIncomeMinor: 0, estimatedExpensesMinor: 1_470_000, realExpensesMinor: 0, savingsGoalMinor: 250_000, realizedSavingsMinor: 0, estimatedDiffMinor: -120_000, realDiffMinor: 0, note: "" };
  const range = buildSummaryPage("household", [], { household: [snapshot, { ...snapshot, month: "2026-10", plannedIncomeMinor: 1_400_000, estimatedExpensesMinor: 1_000_000, savingsGoalMinor: 100_000 }] }, {}, [], "2026-10", ["2026-09", "2026-10"], ["2026-09", "2026-10"], {});
  const total = (label) => range.metricCards.find((item) => item.label === label).amountMinor;
  assert.equal(total("Planned income"), 2_750_000);
  assert.equal(total("Planned spend"), 2_470_000);
  assert.equal(total("Savings target"), 350_000);
  // Negative: a range is the plain sum of its months, so a short month is
  // hidden inside a range that is balanced overall.
  assert.ok(total("Planned income") > total("Planned spend"));
  assert.equal(range.months[0].estimatedDiffMinor, -120_000);
});
