// Summary's check-in signals: each fires with its numbers and the approved
// wording, and stays silent when its condition is not met.
import assert from "node:assert/strict";
import test from "node:test";

import { formatCurrencyMinor } from "../src/domain/split-currency.ts";
import {
  anniversaryTrivia,
  buildSummarySignals,
  categoryCreepSignal,
  categoryFractionTrivia,
  chineseNewYearSignal,
  cushionSignal,
  keepRateSignal,
  lastYearTopTrivia,
  monthsUnderPlanSignal,
  sameSeasonSignal,
  spendingAboveIncomeSignal,
  subscriptionsSignal,
  yearRecapTrivia
} from "../src/domain/money-signals/summary-signals.ts";
import { statementGapSignal } from "../src/domain/money-signals/shared-signals.ts";

const sgd = (minor) => formatCurrencyMinor(minor, "SGD");
const facts = (signal) => signal.phrasings.map((phrasing) => phrasing.fact);

function month(key, { income = 1_000_000, spend = 600_000, plan = 700_000 } = {}) {
  return { month: key, plannedIncomeMinor: income, actualIncomeMinor: income, estimatedExpensesMinor: plan, realExpensesMinor: spend };
}

const RANGE = ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];

function input(overrides = {}) {
  return {
    audience: "household",
    viewLabel: "Household",
    today: "2026-09-27",
    focusMonth: "",
    months: RANGE.map((key) => month(key)),
    categoryShareByMonth: [],
    accountPills: [],
    accountKinds: {},
    availableMonths: RANGE,
    formatMoney: sgd,
    ...overrides
  };
}

test("statement gap: the wallet furthest from its statement, named for the view", () => {
  const pills = [
    { accountId: "acct-uob", accountName: "UOB One Account", ownerLabel: "Serene", reconciliationStatus: "matched", latestCheckpointDeltaMinor: 0 },
    { accountId: "acct-ocbc-365", accountName: "OCBC 365 Card", ownerLabel: "Serene", reconciliationStatus: "mismatch", latestCheckpointMonth: "2026-07", latestCheckpointDeltaMinor: -4_280 },
    { accountId: "acct-citi", accountName: "Citi Cash Back Card", ownerLabel: "Ethan", reconciliationStatus: "mismatch", latestCheckpointMonth: "2026-07", latestCheckpointDeltaMinor: 1_000 }
  ];
  const household = statementGapSignal({ accountPills: pills, audience: "household", viewLabel: "Household", formatMoney: sgd });
  assert.equal(household.key, "statement-gap:acct-ocbc-365");
  assert.equal(household.kind, "quick_fix");
  assert.equal(household.weight, 4_280);
  assert.deepEqual(facts(household), [
    "Serene's OCBC 365 Card statement is off by $42.80.",
    "Serene's OCBC 365 Card July statement is $42.80 away from the app.",
    "One statement doesn't match yet: Serene's OCBC 365 Card, off by $42.80.",
    "$42.80 separates Serene's OCBC 365 Card statement from the app."
  ]);
  assert.equal(household.phrasings[0].think, "Small gaps are usually one missing or doubled entry. Sorting it keeps every total here trustworthy.");
  assert.deepEqual(household.action, { id: "review-statement", label: "Review statement" });
  assert.deepEqual(household.sorted, { fact: "Sorted: Serene's OCBC 365 Card now matches its statement.", think: "That's the part that makes every other number here trustworthy." });

  // On Summary the statement gap keeps its Quick fix rank.
  assert.equal(household.yieldsToBiggerQuestion, undefined);

  const serene = statementGapSignal({ accountPills: pills, audience: "person", viewLabel: "Serene", formatMoney: sgd });
  assert.equal(facts(serene)[0], "Your OCBC 365 Card statement is off by $42.80.");
  assert.equal(facts(serene)[2], "One statement doesn't match yet: your OCBC 365 Card, off by $42.80.");

  // Matched wallets, or a mismatch of zero, say nothing.
  assert.equal(statementGapSignal({ accountPills: [pills[0], { ...pills[1], latestCheckpointDeltaMinor: 0 }], audience: "household", viewLabel: "Household", formatMoney: sgd }), null);
  assert.equal(statementGapSignal({ accountPills: null, audience: "household", viewLabel: "Household", formatMoney: sgd }), null);
});

test("spending above income: three or more complete months in a row", () => {
  const months = RANGE.map((key, index) => month(key, index >= 8 ? { income: 500_000, spend: 620_000 } : {}));
  // Jun, Jul, Aug spent above income; Sep is in progress and not counted.
  const signal = spendingAboveIncomeSignal(input({ months }));
  assert.equal(signal.kind, "bigger_question");
  assert.equal(signal.weight, 360_000);
  assert.deepEqual(facts(signal), [
    "Spending has been above income for 3 months running.",
    "For 3 months running, more went out than came in: $3,600.00 in all.",
    "The last 3 months each spent more than came in, $3,600.00 altogether."
  ]);
  assert.equal(signal.phrasings[0].think, "Changing one category is easier than changing everything. Which one matters least to you?");

  // Two months is not a pattern; a range with no income at all says nothing.
  assert.equal(spendingAboveIncomeSignal(input({ months: RANGE.map((key, index) => month(key, index >= 9 ? { income: 500_000, spend: 620_000 } : {})) })), null);
  assert.equal(spendingAboveIncomeSignal(input({ months: RANGE.map((key) => month(key, { income: 0 })) })), null);
});

function shares(byMonth) {
  return Object.entries(byMonth).map(([key, data]) => ({ month: key, data: Object.entries(data).map(([label, valueMinor]) => ({ label, valueMinor, entryCount: 10 })) }));
}

test("category creep: risen several months in a row and well above its average", () => {
  const dining = { "2025-10": 42_000, "2025-11": 41_000, "2025-12": 43_000, "2026-01": 40_000, "2026-02": 42_000, "2026-03": 41_000, "2026-04": 43_000, "2026-05": 42_000, "2026-06": 44_000, "2026-07": 50_000, "2026-08": 60_000, "2026-09": 70_000 };
  const byMonth = Object.fromEntries(Object.entries(dining).map(([key, value]) => [key, { "Food & Drinks": value, Savings: value * 3, Groceries: 50_000 }]));
  // Aug is the latest complete month: 3 rises (May→Jun→Jul→Aug).
  const signal = categoryCreepSignal(input({ categoryShareByMonth: shares(byMonth) }));
  assert.equal(signal.key, "category-creep:Food & Drinks");
  assert.equal(signal.kind, "worth_a_look");
  assert.deepEqual(facts(signal), [
    "Food & Drinks has risen 3 months in a row and is $172 above its 10-month average.",
    "Food & Drinks is $172 above its usual month, after 3 rises in a row.",
    "3 months ago Food & Drinks was $420; now it's $600."
  ]);
  assert.equal(signal.phrasings[0].think, "Rises like this usually happen without anyone deciding. If it's spending you enjoy, keep it; just make it a choice.");

  // Savings rising is not lifestyle creep; a flat category says nothing.
  const flat = Object.fromEntries(RANGE.map((key) => [key, { "Food & Drinks": 42_000 }]));
  assert.equal(categoryCreepSignal(input({ categoryShareByMonth: shares(flat) })), null);
  const onlySavings = Object.fromEntries(Object.entries(dining).map(([key, value]) => [key, { Savings: value * 3 }]));
  assert.equal(categoryCreepSignal(input({ categoryShareByMonth: shares(onlySavings) })), null);
});

test("subscriptions: the month's total at its yearly and daily cost", () => {
  const byMonth = { "2026-08": { Subscriptions: 7_609, Groceries: 60_000 }, "2026-09": { Subscriptions: 7_609 } };
  const signal = subscriptionsSignal(input({ categoryShareByMonth: shares(byMonth) }));
  assert.equal(signal.weight, 91_308);
  assert.deepEqual(facts(signal), [
    "Subscriptions came to $76.09 in August, about $913 a year.",
    "$913 a year goes to subscriptions. Still using all of them?",
    "Your subscriptions cost about $2.50 a day."
  ]);
  assert.equal(signal.phrasings[0].think, "Automatic payments are easy to stop noticing. Judge each one by its yearly cost.");
  assert.equal(signal.phrasings[1].think, "Automatic payments are easy to stop noticing.");
  // A focused month speaks about that month.
  assert.match(facts(subscriptionsSignal(input({ focusMonth: "2026-09", categoryShareByMonth: shares(byMonth) })))[0], /in September/);
  assert.equal(subscriptionsSignal(input({ categoryShareByMonth: shares({ "2026-08": { Groceries: 60_000 } }) })), null);
});

test("months under plan: most of the last 12 complete months", () => {
  const months = RANGE.map((key, index) => month(key, index === 9 ? { spend: 1_012_814, plan: 700_000 } : { spend: 600_000, plan: 700_000 }));
  const signal = monthsUnderPlanSignal(input({ months }));
  assert.equal(signal.kind, "going_well");
  assert.deepEqual(facts(signal), [
    "10 of the last 11 months came in under plan.",
    "Under plan in 10 of the last 11 months, $10,000.00 below plan in all.",
    "$10,000.00 stayed inside the plan across 10 of the last 11 months."
  ]);
  assert.equal(signal.phrasings[0].think, "Consistency matters more than any single month. This is what a working plan looks like.");
  const mostlyOver = RANGE.map((key, index) => month(key, index % 2 ? { spend: 800_000 } : {}));
  assert.equal(monthsUnderPlanSignal(input({ months: mostlyOver })), null);
  assert.equal(monthsUnderPlanSignal(input({ months: RANGE.map((key) => month(key, { plan: 0 })) })), null);
});

test("keep rate: the share of income kept, with the amount beside the percentage", () => {
  const signal = keepRateSignal(input());
  assert.equal(signal.kind, "long_view");
  assert.deepEqual(facts(signal), [
    "Over the last 11 months the household kept 40% of what came in ($44,000.00).",
    "For every $10 that came in over the last 11 months, about $4 stayed.",
    "$44,000.00 kept over the last 11 months. One heavy month barely moves that.",
    "Kept over the last 11 months: $44,000.00, about 40% of what came in."
  ]);
  assert.equal(signal.phrasings[0].think, "One heavy month barely moves a year; the year is the fairer scorecard.");
  assert.match(facts(keepRateSignal(input({ audience: "person", viewLabel: "Ethan" })))[0], /^Over the last 11 months you kept 40%/);
  // Nothing kept, or no income: silent.
  assert.equal(keepRateSignal(input({ months: RANGE.map((key) => month(key, { spend: 1_100_000 })) })), null);
  assert.equal(keepRateSignal(input({ months: RANGE.map((key) => month(key, { income: 0 })) })), null);
});

test("cushion: bank accounts only, against the range's usual spending", () => {
  const pills = [
    { accountId: "bank-1", accountName: "OCBC 360 Account", balanceMinor: 9_000_000 },
    { accountId: "bank-2", accountName: "POSB Joint Account", balanceMinor: 3_600_000 },
    { accountId: "card-1", accountName: "Citi Cash Back Card", balanceMinor: -250_000 }
  ];
  const kinds = { "bank-1": "bank", "bank-2": "bank", "card-1": "credit_card" };
  const signal = cushionSignal(input({ accountPills: pills, accountKinds: kinds }));
  assert.equal(signal.kind, "long_view");
  assert.deepEqual(facts(signal), [
    "Bank balances would cover about 21 months of your usual spending.",
    "At your usual spending of about $6,000 a month, bank balances would last about 21 months.",
    "$126,000 in bank accounts is about 21 months of your usual spending."
  ]);
  assert.equal(signal.phrasings[0].think, "A cushion turns surprises into inconveniences. How big feels right is your call.");
  // No bank balance, only cards, or no spending: silent.
  assert.equal(cushionSignal(input({ accountPills: [pills[2]], accountKinds: kinds })), null);
  assert.equal(cushionSignal(input({ accountPills: pills, accountKinds: {} })), null);
  assert.equal(cushionSignal(input({ accountPills: pills, accountKinds: kinds, months: RANGE.map((key) => month(key, { spend: 0 })) })), null);
});

test("same season: only when last year's month is already in the range", () => {
  const months = [month("2025-08", { spend: 651_230 }), ...RANGE.map((key) => month(key, key === "2026-08" ? { spend: 542_230 } : {}))];
  const signal = sameSeasonSignal(input({ months }));
  assert.deepEqual(facts(signal), [
    "August spending was about $1,090 lower than August last year.",
    "Compared with August last year, spending was about $1,090 lower.",
    "August last year: $6,512.30. This August: $5,422.30."
  ]);
  assert.equal(signal.phrasings[0].think, "The same month last year is the fair comparison: holidays, bonuses and school terms line up.");
  // No August 2025 in a 12-month range: silent (no extra month is fetched).
  assert.equal(sameSeasonSignal(input()), null);
  // The month in progress is never compared.
  assert.equal(sameSeasonSignal(input({ months: [month("2025-09"), ...months], focusMonth: "2026-09" })), null);
});

test("Chinese New Year: last year's festive month, in the month before or of the new year", () => {
  const months = [month("2026-02", { spend: 812_300 }), month("2026-12"), month("2027-01")];
  const signal = chineseNewYearSignal(input({ today: "2027-01-12", months }));
  assert.equal(signal.key, "chinese-new-year:2027");
  assert.equal(signal.moment, true);
  assert.equal(facts(signal)[0], "Chinese New Year falls in February. Last year's Chinese New Year month, February 2026, came to $8,123.00 of spending.");
  assert.equal(chineseNewYearSignal(input({ today: "2026-09-27", months })), null);
  assert.equal(chineseNewYearSignal(input({ today: "2027-01-12", months: [month("2026-12")] })), null);
});

test("trivia: a category as a plain fraction, last year's top category, a year recap and an anniversary", () => {
  const byMonth = {
    "2025-08": { Travel: 300_000, Groceries: 50_000 },
    "2026-08": { Groceries: 72_600, Housing: 30_000, "Food & Drinks": 60_000, Transport: 50_000, Travel: 40_000, Shopping: 40_000, Utilities: 30_000, Health: 20_000, Other: 257_400 }
  };
  const months = [month("2025-08"), ...RANGE.map((key) => month(key))];
  const fraction = categoryFractionTrivia(input({ categoryShareByMonth: shares(byMonth), months }));
  assert.equal(fraction.kind, "just_for_fun");
  // Other is the largest here, but "went to other" says nothing: Groceries
  // at 12.1% is about one in every eight dollars.
  assert.deepEqual(facts(fraction), ["About one in every eight dollars in August went to groceries."]);
  // A loan is not a fun fact: the next category is used.
  assert.deepEqual(facts(categoryFractionTrivia(input({ categoryShareByMonth: shares({ "2026-08": { Loans: 40_000, Dining: 35_000, Groceries: 25_000 } }) }))), ["About one in every three dollars in August went to dining."]);
  // More than half in one category is not "one in every N".
  assert.equal(categoryFractionTrivia(input({ categoryShareByMonth: shares({ "2026-08": { Travel: 90_000, Groceries: 10_000 } }) })), null);

  assert.deepEqual(facts(lastYearTopTrivia(input({ categoryShareByMonth: shares(byMonth) }))), ["A year ago, Travel was your biggest category."]);
  assert.equal(lastYearTopTrivia(input({ categoryShareByMonth: shares({ "2026-08": { Groceries: 1 } }) })), null);

  const recapShares = shares({ "2026-01": { Groceries: 50_000 }, "2026-02": { Groceries: 50_000, Travel: 10_000 }, "2026-03": { Travel: 20_000 } });
  // A moment only for a range that ends in December, so at most one
  // period in any twelve.
  const toDecember = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"].map((key) => month(key));
  const recap = yearRecapTrivia(input({ today: "2027-01-05", months: toDecember, categoryShareByMonth: recapShares }));
  assert.deepEqual(facts(recap), ["2026 in numbers: 40 entries, and Groceries was the biggest category."]);
  assert.equal(recap.moment, true);
  assert.equal(yearRecapTrivia(input({ today: "2026-12-05", categoryShareByMonth: recapShares })), null);
  assert.equal(yearRecapTrivia(input({ today: "2027-01-05", months: toDecember, categoryShareByMonth: recapShares.slice(0, 2) })), null);

  assert.deepEqual(facts(anniversaryTrivia(input({ availableMonths: ["2025-09", "2025-10"] }))), ["A year of Monie's Map: your first month here was September 2025."]);
  assert.equal(anniversaryTrivia(input({ availableMonths: ["2025-10"] })), null);
  // Only on a range that ends this month.
  assert.equal(anniversaryTrivia(input({ today: "2026-10-02", availableMonths: ["2025-10"] })), null);
});

test("buildSummarySignals returns only the signals that fire", () => {
  const signals = buildSummarySignals(input());
  assert.deepEqual(signals.filter((signal) => signal.kind !== "just_for_fun").map((signal) => signal.key), ["months-under-plan", "keep-rate"]);
  // Twelve identical months tie for biggest, quietest and busiest, so only
  // the trivia that needs no winner fires.
  assert.deepEqual(signals.filter((signal) => signal.kind === "just_for_fun").map((signal) => signal.triviaType), ["average-month", "daily-average", "range-total", "income-months"]);
});
