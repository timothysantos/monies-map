// Month's check-in signals: each fires with its numbers and the approved
// wording, and stays silent when its condition is not met. The time of
// month decides the moment's signals.
import assert from "node:assert/strict";
import test from "node:test";

import { formatCurrencyMinor } from "../src/domain/split-currency.ts";
import {
  biggestDayTrivia,
  buildMonthSignals,
  categoryOverPlanSignal,
  fixedCostsSignal,
  incomeAbovePlanSignal,
  incomeArrivedSignal,
  monthCalmLine,
  noSpendDaysTrivia,
  oneOffOverPlanSignal,
  planLeftSignal,
  planPaceSignal,
  regularSpotTrivia,
  savingsOnPlanSignal,
  unlinkedBillsSignal,
  upcomingBillsSignal,
  weekdayPatternTrivia
} from "../src/domain/money-signals/month-signals.ts";

const sgd = (minor) => formatCurrencyMinor(minor, "SGD");
const facts = (signal) => signal.phrasings.map((phrasing) => phrasing.fact);

let nextId = 0;
function expense(date, description, amountMinor, categoryName = "Shopping") {
  nextId += 1;
  return { id: `entry-${nextId}`, date, description, amountMinor, categoryName, entryType: "expense" };
}

function bill(id, label, planDate, plannedMinor, { actualMinor = 0, linked = 0, categoryName = "Bills" } = {}) {
  return { id, label, categoryName, planDate, plannedMinor, actualMinor, linkedEntryCount: linked };
}

function input(overrides = {}) {
  return {
    audience: "person",
    viewLabel: "Serene",
    month: "2026-08",
    today: "2026-08-14",
    entries: [],
    planSections: [{ key: "planned_items", rows: [] }, { key: "budget_buckets", rows: [] }],
    incomeRows: [],
    summary: { estimatedExpensesMinor: 500_000, realExpensesMinor: 391_941, plannedIncomeMinor: 800_000, actualIncomeMinor: 800_000 },
    accountPills: [],
    formatMoney: sgd,
    ...overrides
  };
}

test("unlinked planned bills: dated before today with no entry linked", () => {
  const rows = [
    bill("r1", "Singtel mobile", "2026-08-02", 4_500),
    bill("r2", "SP Group", "2026-08-05", 12_000),
    bill("r3", "Netflix", "2026-08-09", 1_798),
    bill("r4", "Rent", "2026-08-01", 250_000, { actualMinor: 250_000, linked: 1 }),
    bill("r5", "Insurance", "2026-08-20", 30_000)
  ];
  const signal = unlinkedBillsSignal(input({ planSections: [{ key: "planned_items", rows }] }));
  assert.equal(signal.kind, "quick_fix");
  assert.equal(signal.weight, 18_298);
  assert.deepEqual(facts(signal), [
    "3 planned bills dated before today have no entry linked yet.",
    "3 planned bills, $182.98 in all, are still waiting for an entry.",
    "Still unlinked: 3 planned bills dated before today, $182.98 in total."
  ]);
  assert.equal(signal.phrasings[0].think, "Linking them keeps the plan honest and catches anything that didn't go out.");
  assert.deepEqual(signal.sorted, { fact: "Sorted: every planned bill dated so far has an entry linked.", think: "The plan and the entries agree again, so the numbers here tell the whole story." });

  const one = unlinkedBillsSignal(input({ planSections: [{ key: "planned_items", rows: [rows[0], rows[3]] }] }));
  assert.deepEqual(facts(one), [
    "1 planned bill dated before today has no entry linked yet: Singtel mobile.",
    "Singtel mobile, planned at $45.00, is still waiting for an entry.",
    "Still unlinked: Singtel mobile, $45.00, dated before today."
  ]);
  assert.equal(one.phrasings[0].think, "Linking it keeps the plan honest and catches anything that didn't go out.");

  // Every dated bill linked, or only future dates: silent.
  assert.equal(unlinkedBillsSignal(input({ planSections: [{ key: "planned_items", rows: [rows[3], rows[4]] }] })), null);
  assert.equal(unlinkedBillsSignal(input({ month: "2026-09", planSections: [{ key: "planned_items", rows }] })), null);
});

test("one-off over plan: a bigger question when one or two entries made up most of it", () => {
  const aircon = expense("2026-07-11", "COURTS MEGASTORE TAMPINES", 328_000, "Home");
  const sofa = expense("2026-07-19", "CASTLERY PTE LTD", 219_000, "Home");
  const entries = [aircon, sofa, expense("2026-07-03", "NTUC FAIRPRICE", 18_000, "Groceries")];
  const summary = { estimatedExpensesMinor: 650_000, realExpensesMinor: 962_814, plannedIncomeMinor: 1_600_000, actualIncomeMinor: 1_600_000 };
  const signal = oneOffOverPlanSignal(input({ audience: "household", month: "2026-07", today: "2026-09-27", entries, summary }));
  assert.equal(signal.kind, "bigger_question");
  assert.equal(signal.weight, 312_814);
  assert.deepEqual(facts(signal), [
    "Courts Megastore Tampines made up most of July's $3,128.14 over plan.",
    "July went $3,128.14 over plan, mostly Courts Megastore Tampines.",
    "Most of July's $3,128.14 over plan came from Courts Megastore Tampines."
  ]);
  assert.equal(signal.phrasings[0].think, "Big one-offs happen. Worth deciding: truly one-off, or something to plan for next year?");
  assert.deepEqual(signal.action, { id: "show-entries", label: "Show those entries", entryIds: [aircon.id] });

  // Two items needed to reach most of the overrun: both are named.
  const both = oneOffOverPlanSignal(input({ month: "2026-07", today: "2026-09-27", entries: [expense("2026-07-11", "COURTS MEGASTORE TAMPINES", 150_000), expense("2026-07-19", "CASTLERY PTE LTD", 120_000), ...entries.slice(2)], summary: { ...summary, realExpensesMinor: 1_000_000, estimatedExpensesMinor: 600_000 } }));
  assert.equal(facts(both)[0], "Courts Megastore Tampines and Castlery made up most of July's $4,000.00 over plan.");

  // Many small entries, or under plan: silent.
  const small = Array.from({ length: 20 }, (_, index) => expense("2026-07-05", `Shop ${index}`, 20_000));
  assert.equal(oneOffOverPlanSignal(input({ month: "2026-07", today: "2026-09-27", entries: small, summary })), null);
  assert.equal(oneOffOverPlanSignal(input({ entries })), null);
});

test("category over plan: the budget furthest over its plan, with the category review action", () => {
  const rows = [
    { id: "b1", label: "Dining", categoryName: "Food & Drinks", plannedMinor: 65_000, actualMinor: 71_319 },
    { id: "b2", label: "Groceries", categoryName: "Groceries", plannedMinor: 80_000, actualMinor: 81_000 },
    { id: "b3", label: "Transport", categoryName: "Transport", plannedMinor: 20_000, actualMinor: 12_000 }
  ];
  const signal = categoryOverPlanSignal(input({ planSections: [{ key: "budget_buckets", rows }] }));
  assert.equal(signal.key, "category-over-plan:b1");
  assert.deepEqual(facts(signal), [
    "Dining went $63.19 over its $650 plan.",
    "Dining is at $713.19 against a $650 plan.",
    "The Dining plan was $650; spending came to $713.19."
  ]);
  assert.equal(signal.phrasings[0].think, "Plans are guesses made in advance. Adjust the plan or the spending; either is fine as long as it's a choice.");
  assert.deepEqual(signal.action, { id: "open-category", label: "Review Food & Drinks", categoryName: "Food & Drinks" });
  assert.equal(categoryOverPlanSignal(input({ planSections: [{ key: "budget_buckets", rows: [rows[2]] }] })), null);
});

test("income above plan: a moment when a bonus lands", () => {
  const signal = incomeAbovePlanSignal(input({ summary: { estimatedExpensesMinor: 500_000, realExpensesMinor: 300_000, plannedIncomeMinor: 800_000, actualIncomeMinor: 2_000_000 } }));
  assert.equal(signal.moment, true);
  assert.deepEqual(facts(signal), [
    "Income was $12,000.00 above plan this month.",
    "$12,000.00 more came in than planned this month.",
    "More came in than planned this month: $12,000.00 above plan."
  ]);
  assert.equal(signal.phrasings[0].think, "Extra money blends into everyday spending quickly. Deciding early how much goes to future you keeps the rest yours to enjoy on purpose.");
  assert.match(facts(incomeAbovePlanSignal(input({ month: "2026-01", summary: { plannedIncomeMinor: 800_000, actualIncomeMinor: 2_000_000 } })))[0], /above plan in January\.$/);
  // A small difference is not a windfall.
  assert.equal(incomeAbovePlanSignal(input({ summary: { plannedIncomeMinor: 800_000, actualIncomeMinor: 810_000 } })), null);
  // A $360 raise on a $7,200 plan is a pay rise, not a windfall.
  assert.equal(incomeAbovePlanSignal(input({ summary: { plannedIncomeMinor: 720_000, actualIncomeMinor: 756_000 } })), null);
});

test("payday: income that arrived in the last few days of the month in progress", () => {
  const salary = { id: "salary", date: "2026-08-12", description: "SALARY", amountMinor: 650_000, entryType: "income", categoryName: "Salary" };
  const signal = incomeArrivedSignal(input({ entries: [salary] }));
  assert.equal(signal.kind, "going_well");
  assert.equal(signal.moment, true);
  assert.deepEqual(facts(signal), ["$6,500.00 of income arrived on Wed 12 Aug.", "Payday: $6,500.00 came in on Wed 12 Aug.", "$6,500.00 landed on Wed 12 Aug."]);
  assert.equal(incomeArrivedSignal(input({ entries: [salary], today: "2026-08-20" })), null);
  assert.equal(incomeArrivedSignal(input({ entries: [salary], month: "2026-08", today: "2026-09-02" })), null);
});

test("plan left: going well, with a wrap-up for a finished month", () => {
  const signal = planLeftSignal(input({ summary: { estimatedExpensesMinor: 500_000, realExpensesMinor: 391_941 } }));
  assert.deepEqual(facts(signal), [
    "$1,080.59 of this month's plan is still unspent.",
    "$1,080.59 of this month's plan is still unspent. Give it a job before it drifts.",
    "You have $1,080.59 of plan left. Savings, next month, or something you've been looking forward to?",
    "Under plan by $1,080.59 so far. Nice; decide where it goes while it's still a choice."
  ]);
  assert.equal(signal.phrasings[0].think, "Unspent plan isn't spent money yet. Give it a job: savings, next month, or something you've been looking forward to.");
  assert.equal(signal.phrasings[2].think, "Unspent plan isn't spent money yet.");
  const past = planLeftSignal(input({ today: "2026-09-27", summary: { estimatedExpensesMinor: 500_000, realExpensesMinor: 391_941 } }));
  assert.deepEqual(facts(past), ["August finished $1,080.59 under plan.", "August came in $1,080.59 under plan.", "Under plan by $1,080.59 in August."]);
  assert.equal(planLeftSignal(input({ summary: { estimatedExpensesMinor: 500_000, realExpensesMinor: 600_000 } })), null);
});

test("savings on plan: every savings row met", () => {
  const rows = [{ id: "s", label: "Savings allocation", categoryName: "Savings", plannedMinor: 180_000, actualMinor: 180_000 }];
  const signal = savingsOnPlanSignal(input({ planSections: [{ key: "planned_items", rows }] }));
  assert.deepEqual(facts(signal), ["Savings are on plan this month.", "$1,800 went to savings this month, as planned.", "Savings came to $1,800 against a $1,800 plan."]);
  assert.equal(signal.phrasings[0].think, "With savings covered, spending on what you enjoy is part of the plan, not a slip from it.");
  assert.equal(savingsOnPlanSignal(input({ planSections: [{ key: "planned_items", rows: [{ ...rows[0], actualMinor: 100_000 }] }] })), null);
});

test("early in the month: bills coming up in the next 10 days", () => {
  const rows = [
    bill("r1", "Singtel mobile", "2026-08-05", 4_500),
    bill("r2", "SP Group", "2026-08-07", 12_000),
    bill("r3", "Great Eastern", "2026-08-10", 30_000),
    bill("r4", "Netflix", "2026-08-12", 14_700),
    bill("r5", "Rent", "2026-08-20", 250_000)
  ];
  const signal = upcomingBillsSignal(input({ today: "2026-08-03", planSections: [{ key: "planned_items", rows }] }));
  assert.equal(signal.kind, "worth_a_look");
  assert.equal(signal.moment, true);
  assert.deepEqual(facts(signal), [
    "4 planned bills are due in the next 10 days, $612.00 in total.",
    "Coming up in the next 10 days: 4 planned bills, $612.00 in all.",
    "$612.00 of planned bills goes out over the next 10 days."
  ]);
  assert.equal(signal.phrasings[0].think, "A fresh month is the easiest time to set things up. Anything to move or cancel before it goes out?");
  // Mid-month looks at pace instead.
  assert.equal(upcomingBillsSignal(input({ today: "2026-08-14", planSections: [{ key: "planned_items", rows }] })), null);
});

test("mid-month: spending against the plan and the calendar", () => {
  const steady = planPaceSignal(input({ today: "2026-08-14", summary: { estimatedExpensesMinor: 500_000, realExpensesMinor: 180_000 } }));
  assert.equal(steady.kind, "going_well");
  assert.deepEqual(facts(steady), [
    "$1,800.00 of the $5,000 plan is used, with 17 days of August to go.",
    "Mid-month check: $1,800.00 spent against a $5,000 plan.",
    "$3,200.00 of the plan is left for the last 17 days of August."
  ]);
  assert.equal(steady.phrasings[0].think, "Spending is keeping pace with the plan so far. A calm middle of the month usually makes for a calm end.");
  const ahead = planPaceSignal(input({ today: "2026-08-14", summary: { estimatedExpensesMinor: 500_000, realExpensesMinor: 400_000 } }));
  assert.equal(ahead.kind, "worth_a_look");
  assert.equal(ahead.phrasings[0].think, "Spending is running ahead of the calendar. Nothing is fixed yet; the rest of the month decides where it lands.");
  assert.equal(planPaceSignal(input({ today: "2026-08-03" })), null);
  assert.equal(planPaceSignal(input({ today: "2026-08-14", summary: { estimatedExpensesMinor: 500_000, realExpensesMinor: 520_000 } })), null);
});

test("fixed costs: the long view, with the amount beside the percentage", () => {
  const rows = [bill("r1", "Rent", "2026-08-01", 200_000), bill("r2", "Insurance", "2026-08-10", 48_000)];
  const signal = fixedCostsSignal(input({ planSections: [{ key: "planned_items", rows }] }));
  assert.equal(signal.kind, "long_view");
  assert.deepEqual(facts(signal), [
    "Planned bills and subscriptions take 31% of this month's income ($2,480.00).",
    "$2,480.00 of this month's $8,000.00 income is already spoken for by planned bills and subscriptions.",
    "Planned bills and subscriptions: $2,480.00, against $8,000.00 of income."
  ]);
  assert.equal(signal.phrasings[0].think, "Fixed costs set how much room every month has. The lower they are, the more freedom for everything else.");
  assert.equal(fixedCostsSignal(input({ summary: { plannedIncomeMinor: 0, actualIncomeMinor: 0 }, planSections: [{ key: "planned_items", rows }] })), null);
});

test("trivia: a regular spot, a weekday pattern, no-spend days and the biggest day", () => {
  const entries = [
    expense("2026-08-07", "KOPITIAM", 650, "Food & Drinks"),
    expense("2026-08-14", "KOPITIAM", 700, "Food & Drinks"),
    expense("2026-08-21", "KOPITIAM", 820, "Food & Drinks"),
    expense("2026-08-12", "GRAB", 1_500, "Transport"),
    expense("2026-08-12", "GRAB", 1_500, "Transport"),
    expense("2026-08-12", "GRAB", 1_500, "Transport"),
    expense("2026-08-11", "CASTLERY PTE LTD", 219_000, "Home")
  ];
  const august = input({ today: "2026-09-27", entries });
  assert.deepEqual(facts(regularSpotTrivia(august)), ["Your regular spot: Kopitiam, 3 visits in August."]);
  assert.deepEqual(facts(weekdayPatternTrivia(august)), ["Most of your dining out in August happened on Fridays."]);
  assert.deepEqual(facts(noSpendDaysTrivia(august)), ["26 days in August with nothing spent."]);
  assert.deepEqual(facts(noSpendDaysTrivia(input({ today: "2026-08-15", entries }))), ["11 days so far in August with nothing spent."]);
  assert.deepEqual(facts(biggestDayTrivia(august)), ["Your biggest day was Tue 11 Aug: Castlery."]);
  // Money moved to savings is not a biggest day.
  assert.deepEqual(facts(biggestDayTrivia(input({ today: "2026-09-27", entries: [...entries, expense("2026-08-01", "Savings allocation", 500_000, "Savings")] }))), ["Your biggest day was Tue 11 Aug: Castlery."]);

  // Routine transport is not a regular spot; two dinners on a Friday are
  // not "most".
  assert.equal(regularSpotTrivia(input({ entries: entries.slice(3, 6) })), null);
  assert.equal(weekdayPatternTrivia(input({ entries: entries.slice(0, 2) })), null);
});

test("buildMonthSignals and the calm line", () => {
  assert.equal(monthCalmLine("2026-08"), "Nothing in August needs a look right now.");
  const signals = buildMonthSignals(input({ summary: null }));
  assert.deepEqual(signals, []);
});
