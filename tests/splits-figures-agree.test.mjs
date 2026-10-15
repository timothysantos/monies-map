import assert from "node:assert/strict";
import test from "node:test";

import { formatCurrencyMinor } from "../src/domain/split-currency.ts";
import { buildSplitsPage } from "../src/domain/splits-projection.ts";
import { buildOpenPeriodDonut, deriveGroupFigures, summariseOpenPeriod } from "../src/domain/split-open-period.ts";
import {
  averageCostTrivia,
  buildSplitsSignals,
  busiestDayTrivia,
  groupInNumbersTrivia,
  shareOfCostsSignal,
  sharedTotalTrivia
} from "../src/domain/money-signals/splits-signals.ts";
import { findAppJargon } from "../src/domain/money-signals/tone.ts";
import { buildSplitsLead } from "../src/client/splits-lead-model.js";

// Every Splits figure for a group uses ONE set: the open period (expenses no
// settle-up has covered). A figure that is deliberately about the whole group
// says so in its own words. The fixture is one group settled once: three old
// expenses covered by a checkpoint ($2,251.85) and two open ones ($300.00).

const people = { "person-tim": "Tim", "person-joyce": "Joyce" };
const peopleList = [{ id: "person-tim", name: "Tim" }, { id: "person-joyce", name: "Joyce" }];
const groupId = "split-group-okaeri";
const otherGroupId = "split-group-bali";
const sgd = (minor) => formatCurrencyMinor(minor, "SGD");

function expense(id, date, totalAmountMinor, overrides = {}) {
  const half = totalAmountMinor / 2;
  return {
    id,
    groupId,
    groupName: "Okaeri",
    date,
    description: `Expense ${id}`,
    categoryName: "Food & Drinks",
    payerPersonId: "person-joyce",
    payerPersonName: "Joyce",
    totalAmountMinor,
    currency: "SGD",
    paymentMethod: "cash",
    paymentStatus: "recorded",
    shares: [
      { personId: "person-tim", personName: "Tim", ratioBasisPoints: 5000, amountMinor: half },
      { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 5000, amountMinor: half }
    ],
    ...overrides
  };
}

const settledExpenses = [
  expense("e-old-1", "2026-04-02", 100_000, { description: "Rent" }),
  expense("e-old-2", "2026-06-24", 105_184, { description: "Flights", categoryName: "Travel" }),
  expense("e-old-3", "2026-08-20", 20_000, { description: "Groceries" })
];
const openExpenses = [
  expense("e-new-1", "2026-08-23", 10_000, { description: "Dinner", payerPersonId: "person-tim", payerPersonName: "Tim" }),
  expense("e-new-2", "2026-10-13", 20_000, { description: "Taxi", categoryName: "Transport" })
];
const elsewhere = expense("e-bali", "2026-10-10", 50_000, { groupId: otherGroupId, groupName: "Bali", description: "Villa", categoryName: "Travel" });
const checkpoint = {
  id: "cp-1",
  amountMinor: 1,
  currency: "SGD",
  settlementDate: "2026-08-27",
  status: "matched",
  matchedAmountMinor: 0,
  matchedTransfers: [],
  includedRecordCount: 3,
  includedRecordIds: settledExpenses.map((item) => item.id)
};
const categories = [{ id: "cat-food", name: "Food & Drinks" }, { id: "cat-travel", name: "Travel" }, { id: "cat-transport", name: "Transport" }];

function build({ expenses = [...settledExpenses, ...openExpenses, elsewhere], checkpoints = [checkpoint], viewId = "person-tim", searchQuery = "" } = {}) {
  const page = buildSplitsPage(
    viewId,
    [
      { id: groupId, name: "Okaeri", sortOrder: 1, currency: "SGD", expenseSource: "mixed" },
      { id: otherGroupId, name: "Bali", sortOrder: 2, currency: "SGD", expenseSource: "mixed" }
    ],
    expenses,
    [],
    [],
    categories,
    "2026-10",
    people,
    checkpoints
  );
  // What buildSplitsPanelModel (splits-selectors.js) hands the page: the
  // group's whole activity, and the part on screen after the search.
  const groupActivity = page.activity.filter((item) => item.groupId === groupId);
  const shownActivity = groupActivity.filter((item) => !item.isArchived && item.description.toLowerCase().includes(searchQuery));
  const figures = deriveGroupFigures({ groupActivity, shownActivity, categories, viewId });
  const activeGroup = page.groups.find((group) => group.id === groupId);
  const model = {
    activeGroup,
    groupBalanceMinor: activeGroup.balanceMinor,
    totalExpenseMinor: figures.spendMinor,
    hasSettledBefore: figures.hasSettledBefore,
    donutChart: figures.donutChart,
    groupActivity
  };
  const lead = buildSplitsLead({
    group: model.activeGroup,
    viewId,
    people: peopleList,
    areTotalsVisible: true,
    spendMinor: model.totalExpenseMinor,
    hasSettledBefore: model.hasSettledBefore
  });
  const signalInput = {
    audience: viewId === "household" ? "household" : "person",
    viewId,
    viewLabel: viewId === "household" ? "Household" : people[viewId],
    people: peopleList,
    group: { id: groupId, name: "Okaeri", balanceMinor: model.groupBalanceMinor, currency: "SGD" },
    activity: model.groupActivity,
    pendingMatchCount: 0,
    today: "2026-10-15",
    formatMoney: sgd
  };
  return { page, model, lead, signalInput };
}

const facts = (signal) => signal.phrasings.map((phrasing) => phrasing.fact);

test("the donut is the group's own open expenses: not other groups, not settled ones", () => {
  const { model, lead } = build({ viewId: "household" });
  const total = model.donutChart.reduce((sum, item) => sum + item.valueMinor, 0);
  const entries = model.donutChart.reduce((sum, item) => sum + item.entryCount, 0);
  assert.equal(lead.spendMinor, 30_000);
  assert.equal(total, 30_000);
  assert.equal(entries, 2);
  assert.deepEqual(model.donutChart.map(({ label, valueMinor }) => [label, valueMinor]), [["Transport", 20_000], ["Food & Drinks", 10_000]]);
  // Negative: Bali's $500.00 villa and the settled $2,251.85 are not charted.
  assert.ok(!model.donutChart.some((item) => item.label === "Travel"));
});

test("the donut follows the search like the chip does", () => {
  const { model, lead } = build({ viewId: "household", searchQuery: "taxi" });
  assert.equal(lead.spendMinor, 20_000);
  assert.equal(model.donutChart.reduce((sum, item) => sum + item.valueMinor, 0), 20_000);
});

test("a person view charts that person's own share, whoever paid, and says so", () => {
  const tim = build({ viewId: "person-tim" });
  // Tim's half of each open expense, whether he paid it (dinner) or not (taxi).
  assert.equal(tim.model.donutChart.reduce((sum, item) => sum + item.valueMinor, 0), 15_000);
  assert.equal(tim.lead.spendMinor, 30_000);
  assert.equal(tim.lead.spendLabel, "Spent since last settle-up");
  assert.equal(tim.lead.donutLabel, "Your share since last settle-up");
  const joyce = build({ viewId: "person-joyce" });
  assert.equal(joyce.model.donutChart.reduce((sum, item) => sum + item.valueMinor, 0), 15_000);
  // Negative: Tim paid the $100.00 dinner. The old rule charted Joyce's half of it
  // (what she owes him) and Tim's half of the taxi: $5,000 + $10,000 either way here,
  // so the split of Food & Drinks and Transport is what proves the own-share rule.
  assert.deepEqual(tim.model.donutChart.map(({ label, valueMinor }) => [label, valueMinor]), [["Transport", 10_000], ["Food & Drinks", 5_000]]);
  const everyone = build({ viewId: "household" });
  assert.equal(everyone.lead.donutLabel, "Since last settle-up");
  assert.equal(everyone.lead.spendLabel, "Spent since last settle-up");
  assert.equal(everyone.model.donutChart.reduce((sum, item) => sum + item.valueMinor, 0), everyone.lead.spendMinor);
});

test("a never-settled group says Group spend and Your share, and its figures are everything", () => {
  const never = build({ checkpoints: [], viewId: "person-tim" });
  assert.equal(never.lead.spendMinor, 255_184);
  assert.equal(never.lead.spendLabel, "Group spend");
  assert.equal(never.lead.donutLabel, "Your share");
  assert.equal(never.model.donutChart.reduce((sum, item) => sum + item.valueMinor, 0), 127_592);
});

test("the household lead names its spend figure the way the chip does", () => {
  const { lead } = build({ viewId: "household" });
  assert.equal(lead.spendLabel, "Spent since last settle-up");
  // The card shows lead.spendLabel under the household figure (not "Total spend").
  assert.equal(lead.caption, "");
});

test("share of costs counts the open period: 33% of $300.00, not a mix with settled costs", () => {
  const { signalInput, lead } = build();
  const signal = shareOfCostsSignal(signalInput);
  // Tim paid the $100.00 dinner of the $300.00 open period.
  assert.equal(facts(signal)[0], "You paid for 33% of shared costs over the last 3 months ($100.00 of $300.00).");
  assert.match(facts(signal)[0], new RegExp(`of ${sgd(lead.spendMinor).replace(/[$.]/g, "\\$&")}\\)`));
  assert.equal(signal.weight, lead.spendMinor);
  // Negative: the old reading mixed in the settled groceries ($400.00 total, 25%).
  assert.ok(!facts(signal)[0].includes("$400.00"));
});

test("share of costs for a quiet group says since the last settle-up, and the open spend is the total", () => {
  const { signalInput, lead } = build();
  const quiet = { ...signalInput, today: "2027-03-01" };
  const signal = shareOfCostsSignal(quiet);
  assert.equal(facts(signal)[0], `You paid for 33% of shared costs since the last settle-up ($100.00 of ${sgd(lead.spendMinor)}).`);
  const never = build({ checkpoints: [] });
  const neverSignal = shareOfCostsSignal({ ...never.signalInput, today: "2027-03-01" });
  assert.match(facts(neverSignal)[0], /in this group \(/);
  // Everything is open when nothing was settled, so the total is the chip's.
  assert.ok(facts(neverSignal)[0].includes(sgd(never.lead.spendMinor)));
});

test("an all-time fun fact on a settled group says it counts everything, with the first day", () => {
  const { signalInput } = build();
  const total = sharedTotalTrivia(signalInput);
  assert.equal(facts(total)[0], "Shared costs in the Okaeri group (settled or not, since 2 Apr) add up to $2,551.84.");
  const numbers = groupInNumbersTrivia(signalInput);
  assert.equal(facts(numbers)[0], "This group in numbers (settled or not, since 2 Apr): 5 shared costs, and the priciest was the Flights ($1,051.84).");
  const average = averageCostTrivia(signalInput);
  assert.match(facts(average)[0], /\(settled or not, since 2 Apr\)/);
  const busiest = busiestDayTrivia({ ...signalInput, activity: [...signalInput.activity, { ...signalInput.activity[0], id: "dup", kind: "expense" }] });
  if (busiest) {
    assert.match(facts(busiest)[0], /\(settled or not, since 2 Apr\)/);
  }
  // Every Just for fun line of a settled group carries the label.
  const fun = buildSplitsSignals(signalInput).filter((signal) => signal.kind === "just_for_fun");
  assert.ok(fun.length >= 5);
  for (const signal of fun) {
    for (const fact of facts(signal)) {
      assert.match(fact, /settled or not, since 2 Apr/, fact);
    }
  }
});

test("the first day carries its year when it is not this year", () => {
  const { signalInput } = build();
  const lastYear = { ...signalInput, activity: signalInput.activity.map((item) => (item.date === "2026-04-02" ? { ...item, date: "2025-10-03" } : item)) };
  assert.equal(facts(sharedTotalTrivia(lastYear))[0], "Shared costs in the Okaeri group (settled or not, since 3 Oct 2025) add up to $2,551.84.");
  assert.equal(facts(sharedTotalTrivia(signalInput))[0], "Shared costs in the Okaeri group (settled or not, since 2 Apr) add up to $2,551.84.");
});

test("a trip says the whole trip, and a group that was never settled adds no label at all", () => {
  const { signalInput } = build();
  const trip = { ...signalInput, group: { ...signalInput.group, name: "Japan trip" } };
  assert.equal(facts(sharedTotalTrivia(trip))[0], "Shared costs on the Japan trip (settled or not, since 2 Apr) add up to $2,551.84.");
  assert.equal(facts(groupInNumbersTrivia(trip))[0], "The trip in numbers (settled or not, since 2 Apr): 5 shared costs, and the priciest was the Flights ($1,051.84).");
  const never = build({ checkpoints: [] });
  assert.equal(facts(sharedTotalTrivia(never.signalInput))[0], "Shared costs in the Okaeri group add up to $2,551.84.");
  for (const signal of buildSplitsSignals(never.signalInput)) {
    for (const fact of facts(signal)) {
      assert.doesNotMatch(fact, /settled or not/, fact);
    }
  }
});

test("a figure that says the whole group and one that says now never share a set silently", () => {
  const { signalInput, lead } = build();
  const open = summariseOpenPeriod(signalInput.activity);
  assert.equal(open.spendMinor, lead.spendMinor);
  assert.equal(open.expenseCount, 2);
  const allTime = signalInput.activity.filter((item) => item.kind === "expense").reduce((sum, item) => sum + item.totalAmountMinor, 0);
  assert.equal(allTime, 255_184);
  // The all-time total is labelled; the open one is the chip's.
  assert.match(facts(sharedTotalTrivia(signalInput))[0], /settled or not/);
  assert.match(facts(shareOfCostsSignal(signalInput))[0], /\$300\.00\)/);
});

test("the new words are plain: no app jargon in the labels or the scope line", () => {
  const { lead, signalInput } = build();
  const lines = [lead.spendLabel, lead.donutLabel, ...buildSplitsSignals(signalInput).flatMap((signal) => facts(signal))];
  for (const line of lines) {
    assert.deepEqual(findAppJargon(line), [], line);
  }
});

test("buildOpenPeriodDonut skips settlements, settled expenses and zero shares", () => {
  const activity = [
    { kind: "expense", totalAmountMinor: 900, settlementStatus: "open", categoryName: "A", shares: [{ personId: "p1", amountMinor: 400 }, { personId: "p2", amountMinor: 500 }] },
    { kind: "expense", totalAmountMinor: 700, settlementStatus: "settled", categoryName: "A", shares: [{ personId: "p1", amountMinor: 700 }] },
    { kind: "settlement", totalAmountMinor: 300, settlementStatus: "open" },
    { kind: "expense", totalAmountMinor: 100, settlementStatus: "open", categoryName: "B", shares: [{ personId: "p2", amountMinor: 100 }] }
  ];
  assert.deepEqual(buildOpenPeriodDonut(activity, [], "p1").map(({ label, valueMinor, entryCount }) => ({ label, valueMinor, entryCount })), [{ label: "A", valueMinor: 400, entryCount: 1 }]);
  assert.deepEqual(buildOpenPeriodDonut(activity, [], "household").map(({ label, valueMinor }) => [label, valueMinor]), [["A", 900], ["B", 100]]);
});
