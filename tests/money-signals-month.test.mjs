// Month's check-in signals: each fires with its numbers and the approved
// wording, and stays silent when its condition is not met. The time of
// month decides the moment's signals.
import assert from "node:assert/strict";
import test from "node:test";

import { formatCurrencyMinor } from "../src/domain/split-currency.ts";
import { composeCheckIn, emptyVisitMemory } from "../src/domain/money-signals/checkin.ts";
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
    "3 bills you planned for August, $182.98 in all, aren't matched to a payment yet.",
    "3 bills you planned for August were due by now, $182.98 in all, and none is matched to a payment yet.",
    "No payment is matched yet to 3 bills planned for August. They come to $182.98 and were due by now."
  ]);
  assert.equal(signal.phrasings[0].think, "They may still be coming, or they never went out. Matching each to its payment (\"linking\") shows which.");
  assert.deepEqual(signal.sorted, { fact: "Sorted: every bill you planned so far is matched to its payment.", think: "Each one now shows what it really cost next to what you planned." });

  const one = unlinkedBillsSignal(input({ planSections: [{ key: "planned_items", rows: [rows[0], rows[3]] }] }));
  assert.deepEqual(facts(one), [
    "Singtel mobile, a bill you planned for August at $45.00, isn't matched to a payment yet.",
    "Singtel mobile was due by now, planned at $45.00, and isn't matched to a payment yet.",
    "No payment is matched yet to Singtel mobile, the $45.00 bill you planned for August."
  ]);
  assert.equal(one.phrasings[0].think, "It may still be coming, or it never went out. Matching it to its payment (\"linking\") shows which.");

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
    "Courts Megastore Tampines made up most of the $3,128.14 that July went past what you planned to spend.",
    "July's spending came to $3,128.14 more than you planned, mostly from Courts Megastore Tampines.",
    "July went $3,128.14 past what you planned to spend. Most of that was Courts Megastore Tampines."
  ]);
  assert.equal(signal.phrasings[0].think, "Big one-offs happen. Was it truly a one-off, or something to plan for next year?");
  assert.deepEqual(signal.action, { id: "show-entries", label: "Show these costs", entryIds: [aircon.id] });

  // Two items needed to reach most of the overrun: both are named.
  const both = oneOffOverPlanSignal(input({ month: "2026-07", today: "2026-09-27", entries: [expense("2026-07-11", "COURTS MEGASTORE TAMPINES", 150_000), expense("2026-07-19", "CASTLERY PTE LTD", 120_000), ...entries.slice(2)], summary: { ...summary, realExpensesMinor: 1_000_000, estimatedExpensesMinor: 600_000 } }));
  assert.equal(facts(both)[0], "Courts Megastore Tampines and Castlery made up most of the $4,000.00 that July went past what you planned to spend.");

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
    "Dining came to $713.19, $63.19 more than the $650 you planned.",
    "You planned $650 for Dining, and $713.19 has gone on it.",
    "Dining spending went $63.19 past the $650 you planned for it."
  ]);
  assert.equal(signal.phrasings[0].think, "If it was worth it, raise next month's plan. If not, next month starts fresh.");
  assert.deepEqual(signal.action, { id: "open-category", label: "Review Food & Drinks", categoryName: "Food & Drinks" });
  assert.equal(categoryOverPlanSignal(input({ planSections: [{ key: "budget_buckets", rows: [rows[2]] }] })), null);
});

test("income above plan: a moment when a bonus lands", () => {
  const signal = incomeAbovePlanSignal(input({ summary: { estimatedExpensesMinor: 500_000, realExpensesMinor: 300_000, plannedIncomeMinor: 800_000, actualIncomeMinor: 2_000_000 } }));
  assert.equal(signal.moment, true);
  assert.deepEqual(facts(signal), [
    "Income this month was $12,000.00 more than you planned.",
    "$12,000.00 more than you planned arrived this month.",
    "More money came in than you planned this month: $12,000.00 extra."
  ]);
  assert.equal(signal.phrasings[0].think, "Extra money blends into everyday spending quickly. Deciding early how much to put aside leaves the rest to enjoy on purpose.");
  assert.match(facts(incomeAbovePlanSignal(input({ month: "2026-01", summary: { plannedIncomeMinor: 800_000, actualIncomeMinor: 2_000_000 } })))[0], /^Income in January was \$12,000\.00 more than you planned\.$/);
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
  assert.deepEqual(facts(signal), ["$6,500.00 of income came in on Wed 12 Aug.", "Payday: $6,500.00 came in on Wed 12 Aug.", "$6,500.00 landed on Wed 12 Aug."]);
  assert.equal(incomeArrivedSignal(input({ entries: [salary], today: "2026-08-20" })), null);
  assert.equal(incomeArrivedSignal(input({ entries: [salary], month: "2026-08", today: "2026-09-02" })), null);
});

test("payday: a friend paying back their share of a court booking is not income", () => {
  const payback = { id: "payback", date: "2026-08-13", description: "PAYNOW FROM CHRIS", amountMinor: 475, entryType: "income", categoryName: "Sports & Hobbies" };
  assert.equal(incomeArrivedSignal(input({ entries: [payback] })), null);
  const salary = { id: "salary", date: "2026-08-12", description: "SALARY", amountMinor: 650_000, entryType: "income", categoryName: "Salary" };
  assert.equal(incomeArrivedSignal(input({ entries: [payback, salary] })).numbers.primaryMinor, 650_000);
});

test("plan left: going well, with a wrap-up for a finished month", () => {
  const signal = planLeftSignal(input({ summary: { estimatedExpensesMinor: 500_000, realExpensesMinor: 391_941 } }));
  assert.deepEqual(facts(signal), [
    "$1,080.59 of what you planned to spend this month hasn't been spent yet.",
    "$1,080.59 is still left to spend in this month's plan. It's worth deciding what it's for.",
    "You have $1,080.59 left in this month's plan. Savings, next month, or something you've been looking forward to?",
    "So far you've spent $1,080.59 less than you planned. Nice. Deciding where it goes now keeps it a choice."
  ]);
  assert.equal(signal.phrasings[0].think, "Until it's spent, it can still go anywhere: savings, next month, or something you've been looking forward to.");
  assert.equal(signal.phrasings[2].think, "Until it's spent, it can still go anywhere you choose.");
  const past = planLeftSignal(input({ today: "2026-09-27", summary: { estimatedExpensesMinor: 500_000, realExpensesMinor: 391_941 } }));
  assert.deepEqual(facts(past), ["August finished $1,080.59 under what you planned to spend.", "You spent $1,080.59 less than you planned in August.", "August came in $1,080.59 under your plan."]);
  assert.equal(planLeftSignal(input({ summary: { estimatedExpensesMinor: 500_000, realExpensesMinor: 600_000 } })), null);
});

test("savings on plan: every savings row met", () => {
  const rows = [{ id: "s", label: "Savings allocation", categoryName: "Savings", plannedMinor: 180_000, actualMinor: 180_000 }];
  const signal = savingsOnPlanSignal(input({ planSections: [{ key: "planned_items", rows }] }));
  assert.deepEqual(facts(signal), ["You saved what you planned this month.", "$1,800 went to savings this month, as planned.", "You planned to save $1,800 and saved $1,800."]);
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
    "4 bills you planned are due in the next 10 days, $612.00 in all.",
    "Coming up in the next 10 days: 4 planned bills, $612.00 in all.",
    "$612.00 in planned bills goes out over the next 10 days."
  ]);
  assert.equal(signal.phrasings[0].think, "A fresh month is the easiest time to set things up. Anything to move or cancel before it goes out?");
  // Mid-month looks at pace instead.
  assert.equal(upcomingBillsSignal(input({ today: "2026-08-14", planSections: [{ key: "planned_items", rows }] })), null);
});

test("mid-month: spending against the plan and the calendar", () => {
  const steady = planPaceSignal(input({ today: "2026-08-14", summary: { estimatedExpensesMinor: 500_000, realExpensesMinor: 180_000 } }));
  assert.equal(steady.kind, "going_well");
  assert.deepEqual(facts(steady), [
    "$1,800.00 of the $5,000 you planned is spent, with 17 days of August to go.",
    "Mid-month: $1,800.00 spent so far, out of the $5,000 you planned for August.",
    "$3,200.00 of the $5,000 you planned is still left for the last 17 days of August."
  ]);
  assert.equal(steady.phrasings[0].think, "Spending is on pace with what you planned. A calm middle of the month usually makes for a calm end.");
  const ahead = planPaceSignal(input({ today: "2026-08-14", summary: { estimatedExpensesMinor: 500_000, realExpensesMinor: 400_000 } }));
  assert.equal(ahead.kind, "worth_a_look");
  assert.equal(ahead.phrasings[0].think, "That's a bit faster than the days gone by. Nothing is fixed yet. The rest of the month decides where it lands.");
  assert.equal(planPaceSignal(input({ today: "2026-08-03" })), null);
  assert.equal(planPaceSignal(input({ today: "2026-08-14", summary: { estimatedExpensesMinor: 500_000, realExpensesMinor: 520_000 } })), null);
});

test("fixed costs: the long view, with the amount beside the percentage", () => {
  const rows = [bill("r1", "Rent", "2026-08-01", 200_000), bill("r2", "Insurance", "2026-08-10", 48_000)];
  const signal = fixedCostsSignal(input({ planSections: [{ key: "planned_items", rows }] }));
  assert.equal(signal.kind, "long_view");
  assert.deepEqual(facts(signal), [
    "Bills and subscriptions in your plan take 31% of this month's income ($2,480.00).",
    "$2,480.00 of this month's $8,000.00 income is already set aside for planned bills and subscriptions.",
    "Planned bills and subscriptions come to $2,480.00, out of $8,000.00 of income."
  ]);
  assert.equal(signal.phrasings[0].think, "\"Fixed costs\", the bills and subscriptions that come every month, set how much room is left. The lower they are, the more freedom for everything else.");
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
  assert.deepEqual(facts(biggestDayTrivia(august)), ["Your biggest spending day was Tue 11 Aug, led by Castlery."]);
  // Money moved to savings is not a biggest day.
  assert.deepEqual(facts(biggestDayTrivia(input({ today: "2026-09-27", entries: [...entries, expense("2026-08-01", "Savings allocation", 500_000, "Savings")] }))), ["Your biggest spending day was Tue 11 Aug, led by Castlery."]);

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

// Month leads with the month's own bigger question; an account's statement
// gap (a Quick fix about a wallet, not the month) is listed under "Also this
// month". Summary keeps leading with the statement gap.
test("Month: a bigger question leads ahead of a statement gap, which moves to Also this month", () => {
  const pills = [{ accountId: "acct-ocbc-365", accountName: "OCBC 365 Card", ownerLabel: "Serene", reconciliationStatus: "mismatch", latestCheckpointMonth: "2026-07", latestCheckpointDeltaMinor: -4_280 }];
  const july = input({
    audience: "household",
    viewLabel: "Household",
    month: "2026-07",
    today: "2026-09-27",
    entries: [expense("2026-07-11", "COURTS MEGASTORE TAMPINES", 328_000, "Home"), expense("2026-07-03", "NTUC FAIRPRICE", 18_000, "Groceries")],
    summary: { estimatedExpensesMinor: 650_000, realExpensesMinor: 962_814, plannedIncomeMinor: 1_351_000, actualIncomeMinor: 1_351_000 },
    accountPills: pills
  });
  const compose = (signals) => composeCheckIn({ signals, memory: emptyVisitMemory(), nowMs: Date.parse("2026-09-27T10:00:00+08:00"), today: "2026-09-27", seed: "month:household|2026-07", contextKey: "2026-07", calmLine: monthCalmLine("2026-07") });
  const signals = buildMonthSignals(july);
  assert.equal(signals.find((signal) => signal.key === "statement-gap:acct-ocbc-365").yieldsToBiggerQuestion, true);
  const view = compose(signals);
  assert.equal(view.headline.kind, "bigger_question");
  assert.match(view.headline.fact, /Courts Megastore Tampines/);
  assert.deepEqual(view.also[0], { key: "statement-gap:acct-ocbc-365", kind: "quick_fix", fact: "Serene's OCBC 365 Card statement differs from what's recorded here by $42.80." });

  // Negative: under plan there is no bigger question, so the gap leads.
  const calm = compose(buildMonthSignals({ ...july, summary: { ...july.summary, realExpensesMinor: 600_000 } }));
  assert.equal(calm.headline.key, "statement-gap:acct-ocbc-365");
  assert.equal(calm.headline.kind, "quick_fix");
});
