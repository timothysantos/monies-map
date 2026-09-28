// Notability: a signal that is true almost every month (the five largest
// entries' share, the subscriptions total, months under plan, plan left) is
// `steady` unless its numbers are unusual this period. A steady signal
// never leads the check-in, except in its turn (one month of each quarter,
// by the period), and shows at most under "Also". A month with nothing
// notable leads with a Going well that fires, otherwise the calm line.
import assert from "node:assert/strict";
import test from "node:test";

import { composeCheckIn, emptyVisitMemory } from "../src/domain/money-signals/checkin.ts";
import { ENTRIES_CALM_LINES, topFiveSignal } from "../src/domain/money-signals/entries-signals.ts";
import { categoryOverPlanSignal, planLeftSignal, savingsOnPlanSignal } from "../src/domain/money-signals/month-signals.ts";
import { consecutiveMonths } from "./support/insight-year-fixture.mjs";
import { monthsUnderPlanSignal, subscriptionsSignal } from "../src/domain/money-signals/summary-signals.ts";
import { formatCurrencyMinor } from "../src/domain/split-currency.ts";

const sgd = (minor) => formatCurrencyMinor(minor, "SGD");
const NOW = Date.parse("2026-09-28T10:00:00+08:00");

function signal(key, kind, weight, extra = {}) {
  return {
    key,
    kind,
    weight,
    numbers: { primaryMinor: weight },
    phrasings: [{ fact: `${key} fact`, think: `${key} think` }],
    ...extra
  };
}

function compose(signals, period = "2026-08", calmLines = ENTRIES_CALM_LINES) {
  return composeCheckIn({ signals, memory: emptyVisitMemory(), nowMs: NOW, today: "2026-09-28", seed: "test", contextKey: period, period, calmLines });
}

// ---------------------------------------------------------------------------
// The engine

test("a steady signal never leads; a notable one does, and the steady one follows under Also", () => {
  const steadyWorth = signal("top-five", "worth_a_look", 900_000, { steady: true });
  const goingWell = signal("savings-on-plan", "going_well", 5_000);
  const view = compose([steadyWorth, goingWell]);
  assert.equal(view.mode, "signal");
  assert.equal(view.headline.key, "savings-on-plan");
  assert.deepEqual(view.also.map((line) => line.key), ["top-five"]);

  // The same signal, notable this month, leads as its kind ranks it.
  const notable = compose([{ ...steadyWorth, steady: false }, goingWell]);
  assert.equal(notable.headline.key, "top-five");
  assert.deepEqual(notable.also.map((line) => line.key), ["savings-on-plan"]);
});

test("a month with only steady signals leads with the calm line and lists nothing under Also", () => {
  const view = compose([signal("top-five", "worth_a_look", 900_000, { steady: true }), signal("plan-left", "going_well", 50_000, { steady: true })]);
  assert.equal(view.mode, "calm");
  assert.equal(view.headline.kind, null);
  assert.ok(ENTRIES_CALM_LINES.includes(view.headline.fact));
  assert.deepEqual(view.also, []);
});

test("a steady signal with a turn leads in one month of each quarter, never two months running", () => {
  const months = consecutiveMonths("2025-01", 24);
  for (const turn of [0, 1, 2]) {
    const leads = months.filter((period) => compose([signal("subscriptions", "worth_a_look", 1_000, { steady: true, turn })], period).headline.key === "subscriptions");
    assert.equal(leads.length, 8, `turn ${turn}: ${leads.join(", ")}`);
    for (let index = 0; index + 11 < months.length; index += 1) {
      const window = months.slice(index, index + 12);
      assert.equal(window.filter((period) => leads.includes(period)).length, 4);
    }
    assert.ok(leads.every((period, index) => index === 0 || consecutiveMonths(leads[index - 1], 4)[3] === period), `turn ${turn} is every third month`);
  }
  // Quarter-end months take turn 2.
  assert.equal(compose([signal("subscriptions", "worth_a_look", 1_000, { steady: true, turn: 2 })], "2026-09").headline.key, "subscriptions");
  assert.equal(compose([signal("subscriptions", "worth_a_look", 1_000, { steady: true, turn: 2 })], "2026-08").mode, "calm");
});

test("in its turn a steady signal ranks as its kind; out of turn a Going well leads and it waits under Also", () => {
  const view = compose([signal("subscriptions", "worth_a_look", 90_000, { steady: true, turn: 2 }), signal("plan-left", "going_well", 1_000)], "2026-09");
  // In its turn a steady Worth a look ranks as a Worth a look.
  assert.equal(view.headline.key, "subscriptions");
  const outOfTurn = compose([signal("subscriptions", "worth_a_look", 90_000, { steady: true, turn: 2 }), signal("plan-left", "going_well", 1_000)], "2026-08");
  assert.equal(outOfTurn.headline.key, "plan-left");
  assert.deepEqual(outOfTurn.also.map((line) => line.key), ["subscriptions"]);
});

// ---------------------------------------------------------------------------
// Entries: the five largest

let nextId = 0;
function entry(description, amountMinor, categoryName) {
  nextId += 1;
  return { id: `e${nextId}`, date: `2026-08-${String(1 + (nextId % 28)).padStart(2, "0")}`, description, amountMinor, categoryName, entryType: "expense" };
}

// A person's month as the showcase keeps it: the parents' allowance, an
// insurance premium and the bills are always the largest entries, so the
// five largest are about 70% of spending every month.
function routineMonth() {
  return [
    entry("PAYNOW TRANSFER - PARENTS ALLOWANCE", 50_000, "Family & Personal"),
    entry("PRUDENTIAL ASSURANCE GIRO", 24_500, "Insurance"),
    entry("SP DIGITAL PTE LTD", 8_375, "Bills"),
    entry("SINGTEL BILL PAYMENT", 6_640, "Bills"),
    entry("PS.CAFE DEMPSEY", 5_834, "Food & Drinks"),
    ...Array.from({ length: 18 }, (_, index) => entry(`KOPITIAM ${index}`, 2_200, "Food & Drinks"))
  ];
}

const entriesInput = (list) => ({ audience: "person", month: "2026-08", today: "2026-09-28", entries: list, formatMoney: sgd });

test("the five largest are steady when they are the usual obligations, even above 65% of spending", () => {
  const signal = topFiveSignal(entriesInput(routineMonth()));
  assert.ok(signal.numbers.rate >= 65, `rate ${signal.numbers.rate}`);
  assert.equal(signal.steady, true);
  assert.equal(signal.numbers.oneOffMinor, 5_834);
  // It does not lead: the month is calm on Entries.
  const view = compose([signal], "2026-08");
  assert.equal(view.mode, "calm");
  assert.doesNotMatch(view.headline.fact, /five/i);
});

test("the five largest are notable when one-off purchases among them are a quarter or more of spending", () => {
  const furniture = [
    entry("COURTS MEGASTORE TAMPINES", 164_000, "Home"),
    entry("CASTLERY PTE LTD", 109_500, "Home"),
    ...routineMonth()
  ];
  const signal = topFiveSignal(entriesInput(furniture));
  assert.equal(signal.steady, false);
  assert.equal(signal.numbers.oneOffMinor, 273_500);
  assert.ok(signal.numbers.oneOffMinor >= signal.numbers.totalMinor * 0.25);
  const view = compose([signal], "2026-08");
  assert.equal(view.headline.key, "top-five");
  assert.match(view.headline.fact, /five/i);
  assert.equal(view.headline.action.id, "show-entries");

  // A one-off that is not a quarter of the month stays steady.
  const small = topFiveSignal(entriesInput([entry("IKEA TAMPINES", 20_000, "Home"), ...routineMonth()]));
  assert.equal(small.steady, true);
});

// ---------------------------------------------------------------------------
// Summary: subscriptions and months under plan

const RANGE = consecutiveMonths("2025-10", 12);
function summaryInput(subscriptions, overrides = {}) {
  return {
    audience: "household",
    viewLabel: "Household",
    today: "2026-09-27",
    focusMonth: "",
    months: RANGE.map((month) => ({ month, plannedIncomeMinor: 1_000_000, actualIncomeMinor: 1_000_000, estimatedExpensesMinor: 700_000, realExpensesMinor: 600_000 })),
    categoryShareByMonth: Object.entries(subscriptions).map(([month, valueMinor]) => ({ month, data: [{ label: "Subscriptions", valueMinor, entryCount: 3 }, { label: "Groceries", valueMinor: 60_000, entryCount: 12 }] })),
    accountPills: [],
    accountKinds: {},
    availableMonths: RANGE,
    formatMoney: sgd,
    ...overrides
  };
}

test("subscriptions lead when they changed by 10% or $20 from the month before", () => {
  // August is the latest complete month; July is loaded beside it.
  for (const [july, august] of [[7_609, 9_609], [3_000, 3_300], [0, 1_098]]) {
    const signal = subscriptionsSignal(summaryInput({ "2026-07": july, "2026-08": august }));
    assert.equal(signal.steady, false, `${july} -> ${august}`);
    assert.equal(signal.numbers.previousMinor, july);
  }
});

test("unchanged subscriptions, or a month with nothing to compare, take a turn once a quarter", () => {
  for (const [label, byMonth] of [
    ["unchanged", { "2026-07": 7_609, "2026-08": 7_609 }],
    ["a small change", { "2026-07": 30_000, "2026-08": 31_500 }],
    ["no July", { "2026-08": 7_609 }]
  ]) {
    const signal = subscriptionsSignal(summaryInput(byMonth));
    assert.equal(signal.steady, true, label);
    assert.equal(signal.turn, 2, label);
  }
  // A range ending in August is not their turn; one ending in September is.
  const signal = subscriptionsSignal(summaryInput({ "2026-07": 7_609, "2026-08": 7_609 }));
  assert.equal(compose([signal], "2026-08").mode, "calm");
  assert.equal(compose([signal], "2026-09").headline.key, "subscriptions");
});

test("months under plan is steady, except the month that comes back under plan", () => {
  const steady = monthsUnderPlanSignal(summaryInput({}));
  assert.equal(steady.steady, true);
  assert.equal(steady.turn, 0);
  // July went over plan and August came back under: that is news.
  const months = RANGE.map((month) => ({ month, plannedIncomeMinor: 1_000_000, actualIncomeMinor: 1_000_000, estimatedExpensesMinor: 700_000, realExpensesMinor: month === "2026-07" ? 900_000 : 600_000 }));
  const back = monthsUnderPlanSignal(summaryInput({}, { months }));
  assert.equal(back.steady, false);
  assert.equal(compose([back], "2026-08").headline.key, "months-under-plan");
  assert.equal(compose([steady], "2026-08").mode, "calm");
});

// ---------------------------------------------------------------------------
// Month: category over plan, plan left, savings on plan

function monthInput(overrides = {}) {
  return {
    audience: "person",
    viewLabel: "Serene",
    month: "2026-08",
    today: "2026-09-27",
    entries: [],
    planSections: [{ key: "planned_items", rows: [] }, { key: "budget_buckets", rows: [] }],
    incomeRows: [],
    summary: { estimatedExpensesMinor: 500_000, realExpensesMinor: 391_941, plannedIncomeMinor: 800_000, actualIncomeMinor: 800_000 },
    accountPills: [],
    formatMoney: sgd,
    ...overrides
  };
}

const bucket = (id, label, plannedMinor, actualMinor) => ({ id, label, categoryName: label, plannedMinor, actualMinor });

test("a category over plan leads when it is 10% and $20 over; a few dollars over is steady", () => {
  const over = categoryOverPlanSignal(monthInput({ planSections: [{ key: "budget_buckets", rows: [bucket("b1", "Groceries", 60_000, 76_118)] }] }));
  assert.equal(over.steady, false);
  assert.equal(over.numbers.plannedMinor, 60_000);
  for (const actualMinor of [60_119, 61_900, 65_000]) {
    // $1.19, $19 and $50 (8%) over a $600 plan.
    const small = categoryOverPlanSignal(monthInput({ planSections: [{ key: "budget_buckets", rows: [bucket("b1", "Groceries", 60_000, actualMinor)] }] }));
    assert.equal(small.steady, true, String(actualMinor));
    assert.equal(small.turn, undefined);
  }
});

test("plan left and savings on plan are steady Going well lines with their own turns", () => {
  const left = planLeftSignal(monthInput());
  assert.equal(left.steady, true);
  assert.equal(left.turn, 1);
  const savings = savingsOnPlanSignal(monthInput({ planSections: [{ key: "planned_items", rows: [{ id: "s1", label: "Savings", categoryName: "Savings", plannedMinor: 100_000, actualMinor: 100_000 }] }] }));
  assert.equal(savings.steady, true);
  assert.equal(savings.turn, 2);
  // August (turn 1) leads with plan left; September with savings; July with
  // neither: the calm line.
  assert.equal(compose([left, savings], "2026-08").headline.key, "plan-left");
  assert.equal(compose([left, savings], "2026-09").headline.key, "savings-on-plan");
  assert.equal(compose([left, savings], "2026-07").mode, "calm");
});
