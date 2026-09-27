// Every Just for fun type on every page: the exact line from a small
// hand-made month, and silence when the data it needs is missing. Names of
// places are cleaned from raw bank descriptions (reference numbers, the
// city and country, card and unit codes go) or skipped.
import assert from "node:assert/strict";
import test from "node:test";

import * as entries from "../src/domain/money-signals/entries-signals.ts";
import * as month from "../src/domain/money-signals/month-signals.ts";
import * as splits from "../src/domain/money-signals/splits-signals.ts";
import * as summary from "../src/domain/money-signals/summary-signals.ts";
import { ENTRIES_AUGUST, MONTH_AUGUST, MONTH_PLAN, row, sgd } from "./support/insight-trivia-months.mjs";
import { JAPAN_ACTIVITY, JAPAN_TRIP, splitsInput, summaryInput } from "./support/insight-year-fixture.mjs";

const trivia = (signals) => Object.fromEntries(signals.filter((signal) => signal.kind === "just_for_fun").map((signal) => [signal.triviaType, signal.phrasings[0].fact]));
const fact = (signal) => signal?.phrasings[0].fact ?? null;

test("the smallest entry never prints a reference number or a PayNow", () => {
  const list = [
    row("2026-08-02", "BUS/MRT 912263684 SINGAPORE SG", 128, "Public Transport"),
    row("2026-08-03", "PAYNOW TRANSFER OTHR PIB2508120123456789 TO TAN AH KOW", 100, "Gifts"),
    row("2026-08-04", "NTUC FP-TAMPINES #01-23 SINGAPORE SG", 5_000, "Groceries")
  ];
  const line = fact(entries.smallestEntryTrivia({ audience: "household", month: "2026-08", today: "2026-09-27", entries: list, formatMoney: sgd }));
  assert.equal(line, "Smallest entry in August: $1.28 at Bus/MRT.");
  assert.doesNotMatch(line, /\d{4}|Singapore|Sg\b|PayNow/i);
});

const entriesInput = (list = ENTRIES_AUGUST) => ({ audience: "household", month: "2026-08", today: "2026-09-27", entries: list, formatMoney: sgd });

test("Entries: every trivia type's exact line for a hand-made August", () => {
  assert.deepEqual(trivia(entries.buildEntriesSignals(entriesInput())), {
    smallest: "Smallest entry in August: $1.28 at Bus/MRT.",
    largest: "Largest entry in August: $98.00 at Din Tai Fung.",
    places: "Entries in August came from 6 different places.",
    "one-off-places": "4 places show up just once in August.",
    "top-place": "Most spent at one place in August: NTUC FP-Tampines, $105.60 over 2 entries.",
    "top-account": "Most-used account or card in August: OCBC 365 Card, with 5 entries.",
    "accounts-count": "Entries in August used 3 different accounts and cards.",
    average: "The average entry in August came to $29.42, across 10 expenses.",
    median: "Half of the purchases in August came to $6.50 or less.",
    "first-day": "First day with spending in August: Sat 1 Aug, led by NTUC FP-Tampines at $42.50.",
    span: "Entries in August run from Sat 1 Aug to Fri 28 Aug, across 8 different days.",
    "repeated-amount": "The most repeated amount in August: $6.50, twice.",
    "category-count": "Dining had the most entries in August: 4 of them.",
    "busiest-date": "Busiest day in August: Wed 5 Aug, with 3 entries.",
    "weekend-entries": "3 of the 11 entries in August fell on a weekend.",
    "round-amounts": "3 entries in August were round amounts, with no cents.",
    shared: "3 of the 11 entries in August were shared costs.",
    income: "Income in August: $6,500.00 across 1 entry."
  });
  // One entry on the first day names it; the month in progress says "this month".
  const single = [row("2026-09-02", "TOAST BOX", 580, "Dining"), row("2026-09-03", "KOPITIAM", 650, "Dining"), row("2026-09-04", "SHOPEE SG", 2_000, "Shopping")];
  assert.equal(fact(entries.firstDayTrivia({ ...entriesInput(single), month: "2026-09" })), "First entry this month: Toast Box, $5.80, on Wed 2 Sep.");
});

test("Entries: each trivia type stays silent when its data is missing", () => {
  const two = ENTRIES_AUGUST.slice(0, 2);
  const unnamed = [row("2026-08-02", "PAYNOW TO 91234567", 500, "Gifts"), row("2026-08-03", "CARD FEE", 50, "Bank fees"), row("2026-08-04", "912263684", 700, "Other")];
  const bills = [row("2026-08-02", "SPOTIFY", 1_098, "Subscriptions"), row("2026-08-03", "SP GROUP", 11_450, "Utilities"), row("2026-08-04", "AIA", 25_000, "Insurance")];
  const onceEach = [row("2026-08-02", "KOPITIAM", 650, "Dining"), row("2026-08-03", "TOAST BOX", 580, "Dining"), row("2026-08-04", "SHOPEE", 2_010, "Shopping")];
  const twiceEach = [...onceEach, ...onceEach.map((item) => ({ ...item, id: `${item.id}b`, date: "2026-08-10" }))];
  const noAccounts = ENTRIES_AUGUST.map((item) => ({ ...item, accountName: undefined }));
  const oneAccount = ENTRIES_AUGUST.map((item) => ({ ...item, accountName: "OCBC 365 Card" }));
  const oneDate = ENTRIES_AUGUST.map((item) => ({ ...item, date: "2026-08-05" }));
  const spreadDates = onceEach.map((item, index) => ({ ...item, date: `2026-08-0${index + 3}` }));
  const weekdays = ENTRIES_AUGUST.map((item) => ({ ...item, date: item.date === "2026-08-01" || item.date === "2026-08-15" ? "2026-08-04" : item.date }));
  const cents = ENTRIES_AUGUST.map((item) => ({ ...item, amountMinor: item.amountMinor % 100 === 0 ? item.amountMinor + 1 : item.amountMinor }));
  const categoryTie = [row("2026-08-02", "KOPITIAM", 650, "Dining"), row("2026-08-03", "TOAST BOX", 580, "Dining"), row("2026-08-04", "SHOPEE", 2_000, "Shopping"), row("2026-08-05", "LAZADA", 1_500, "Shopping")];
  const silent = [
    ["smallest", entries.smallestEntryTrivia, unnamed],
    ["smallest (under 3 expenses)", entries.smallestEntryTrivia, two],
    ["largest", entries.largestEntryTrivia, bills],
    ["places", entries.placesCountTrivia, two],
    ["one-off-places", entries.oneOffPlacesTrivia, twiceEach],
    ["top-place", entries.topPlaceTrivia, onceEach],
    ["top-account", entries.topAccountTrivia, noAccounts],
    ["accounts-count", entries.accountsCountTrivia, oneAccount],
    ["average", entries.averageEntryTrivia, two],
    ["median", entries.medianEntryTrivia, onceEach],
    ["first-day", entries.firstDayTrivia, unnamed],
    ["span", entries.entrySpanTrivia, oneDate],
    ["repeated-amount", entries.repeatedAmountTrivia, onceEach],
    ["category-count", entries.categoryCountTrivia, categoryTie],
    ["busiest-date", entries.busiestDateTrivia, spreadDates],
    ["weekend-entries", entries.weekendEntriesTrivia, weekdays],
    ["round-amounts", entries.roundAmountsTrivia, cents],
    ["shared", entries.sharedEntriesTrivia, onceEach],
    ["income", entries.incomeEntriesTrivia, onceEach]
  ];
  for (const [type, builder, list] of silent) {
    assert.equal(builder(entriesInput(list)), null, type);
  }
  assert.deepEqual(trivia(entries.buildEntriesSignals(entriesInput([]))), {});
});

const monthInput = (overrides = {}) => ({ audience: "household", viewLabel: "Household", month: "2026-08", today: "2026-09-27", entries: MONTH_AUGUST, planSections: MONTH_PLAN, incomeRows: [], summary: null, accountPills: [], formatMoney: sgd, ...overrides });

test("Month: every trivia type's exact line for a hand-made August", () => {
  assert.deepEqual(trivia(month.buildMonthSignals(monthInput())), {
    "regular-spot": "Your regular spot: Kopitiam, 3 visits in August.",
    "quiet-weekday": "Thursday was the quietest day of the week in August.",
    "busiest-weekday": "Saturday was the busiest day of the week in August, with 4 entries.",
    "no-spend-days": "21 days in August with nothing spent.",
    "longest-run": "Longest stretch without spending in August: 6 days, Sun 23 Aug to Fri 28 Aug.",
    "biggest-day": "Your biggest day was Tue 11 Aug: Courts Megastore Tampines.",
    "busiest-week": "The biggest week in August began Mon 10 Aug, with $788 spent.",
    halfway: "Half of the spending in August had happened by Tue 11 Aug.",
    "day-average": "Spending in August averaged about $34 a day.",
    "weekend-share": "Weekends in August came to $144.90, about one in every seven dollars spent.",
    "category-share": "Home took about one in every two dollars spent in August.",
    "top-two-categories": "Home and food & drinks were the two biggest categories in August.",
    "categories-count": "Spending in August spread across 6 categories.",
    "category-days": "Food & Drinks showed up on 5 different days in August.",
    "category-largest": "Largest home entry in August: Courts Megastore Tampines, $649.00.",
    "plan-count": "The plan for August holds 3 planned bills and 2 category budgets.",
    "biggest-bill": "The biggest planned bill in August: AIA insurance, $250.00."
  });
  // Dining out mostly on Fridays: the reserve for the category share.
  const fridays = ["2026-08-07", "2026-08-14", "2026-08-21", "2026-08-05"].map((date) => row(date, "KOPITIAM", 700, "Food & Drinks"));
  assert.equal(fact(month.weekdayPatternTrivia(monthInput({ entries: fridays }))), "Most of your dining out in August happened on Fridays.");
  // So far, in the month in progress.
  assert.equal(fact(month.noSpendDaysTrivia(monthInput({ today: "2026-08-15" }))), "9 days so far in August with nothing spent.");
});

test("Month: each trivia type stays silent when its data is missing", () => {
  const two = MONTH_AUGUST.slice(0, 2);
  const everyDay = Array.from({ length: 31 }, (_, index) => row(`2026-08-${String(index + 1).padStart(2, "0")}`, "KOPITIAM", 650, "Food & Drinks"));
  const tiedDays = [row("2026-08-01", "A SHOP", 1_000, "Shopping"), row("2026-08-02", "B SHOP", 1_000, "Shopping"), row("2026-08-03", "C SHOP", 1_000, "Shopping")];
  const oneCategory = [row("2026-08-01", "KOPITIAM", 650, "Food & Drinks"), row("2026-08-02", "TOAST BOX", 700, "Food & Drinks"), row("2026-08-04", "KOPITIAM", 650, "Food & Drinks")];
  const weekdaysOnly = MONTH_AUGUST.filter((item) => ![0, 6].includes(new Date(`${item.date}T00:00:00Z`).getUTCDay()));
  const billsOnly = [row("2026-08-01", "SP GROUP", 11_450, "Utilities"), row("2026-08-05", "AIA", 25_000, "Insurance"), row("2026-08-09", "HDB LOAN", 90_000, "Loan")];
  const silent = [
    ["regular-spot", month.regularSpotTrivia, monthInput({ entries: MONTH_AUGUST.filter((item) => item.description !== "KOPITIAM") })],
    ["quiet-weekday (month not through every weekday)", month.quietWeekdayTrivia, monthInput({ today: "2026-08-05" })],
    ["quiet-weekday (tie)", month.quietWeekdayTrivia, monthInput({ entries: everyDay })],
    ["busiest-weekday", month.busiestWeekdayTrivia, monthInput({ entries: everyDay.slice(0, 7) })],
    ["dining-weekday", month.weekdayPatternTrivia, monthInput()],
    ["no-spend-days", month.noSpendDaysTrivia, monthInput({ entries: everyDay })],
    ["no-spend-days (a month ahead)", month.noSpendDaysTrivia, monthInput({ today: "2026-07-20" })],
    ["longest-run", month.longestRunTrivia, monthInput({ entries: everyDay })],
    ["biggest-day", month.biggestDayTrivia, monthInput({ entries: billsOnly })],
    ["busiest-week", month.busiestWeekTrivia, monthInput({ entries: [row("2026-08-04", "A SHOP", 1_000, "Shopping"), row("2026-08-11", "B SHOP", 1_000, "Shopping")] })],
    ["halfway", month.halfwayTrivia, monthInput({ entries: [row("2026-08-04", "A SHOP", 1_000, "Shopping"), row("2026-08-04", "B SHOP", 1_000, "Shopping"), row("2026-08-04", "C SHOP", 1_000, "Shopping")] })],
    ["day-average", month.dayAverageTrivia, monthInput({ entries: two })],
    ["weekend-share", month.weekendShareTrivia, monthInput({ entries: weekdaysOnly })],
    ["category-share", month.categoryShareTrivia, monthInput({ entries: oneCategory })],
    ["top-two-categories", month.topTwoCategoriesTrivia, monthInput({ entries: tiedDays })],
    ["categories-count", month.categoriesCountTrivia, monthInput({ entries: oneCategory })],
    ["category-days", month.categoryDaysTrivia, monthInput({ entries: two })],
    ["category-largest", month.categoryLargestTrivia, monthInput({ entries: billsOnly })],
    ["plan-count", month.planCountTrivia, monthInput({ planSections: [] })],
    ["biggest-bill", month.biggestBillTrivia, monthInput({ planSections: MONTH_PLAN.filter((section) => section.key !== "planned_items") })]
  ];
  for (const [type, builder, input] of silent) {
    assert.equal(builder(input), null, type);
  }
  assert.deepEqual(trivia(month.buildMonthSignals(monthInput({ entries: [], planSections: [] }))), {});
});

test("Splits: every trivia type's exact line for a finished Japan trip", () => {
  const withYen = [...JAPAN_ACTIVITY, { id: "trip-sgd", kind: "expense", date: "2026-04-12", description: "Airport taxi", totalAmountMinor: 4_500, paidByPersonName: "Ethan", categoryName: "Transport", paymentMethod: "card", currency: "SGD" }];
  assert.deepEqual(trivia(splits.buildSplitsSignals(splitsInput("2026-09-27"))), {
    "in-numbers": "The trip in numbers: 11 shared costs, and the priciest was the Tokyo hotel (JP¥168,000).",
    payer: "You paid for 5 of the 11 shared costs on the Japan trip, JP¥254,720 in all.",
    "weekday-most": "Saturday saw the most shared costs on the Japan trip.",
    total: "Shared costs on the Japan trip add up to JP¥357,420.",
    "average-cost": "The average shared cost on the Japan trip: about JP¥32,493.",
    "smallest-cost": "The smallest shared cost on the Japan trip: Onsen towels, JP¥1,200.",
    "first-cost": "Shared costs on the Japan trip began on Sat 4 Apr, with 2 that day.",
    "priciest-day": "The priciest day on the Japan trip: Sat 4 Apr, with JP¥174,120 of shared costs.",
    "latest-cost": "The latest shared cost on the Japan trip: Duty free, JP¥23,800, on Sat 11 Apr.",
    "repeated-cost": "The most repeated shared cost on the Japan trip: Ramen, twice.",
    span: "Shared costs on the Japan trip span 8 days, from Sat 4 Apr to Sat 11 Apr.",
    "top-category": "Travel was the biggest category on the Japan trip, at JP¥244,000.",
    categories: "Shared costs on the Japan trip spread across 4 categories.",
    "payment-mix": "Shared costs on the Japan trip: 6 by card and 5 in cash.",
    "largest-settlement": "The largest settle-up on the Japan trip: JP¥10,000 on Mon 20 Apr.",
    "settle-count": "2 settle-ups so far on the Japan trip."
  });
  // A second currency: named, and never added into the yen totals.
  const mixed = splitsInput("2026-09-27", { activity: withYen });
  assert.equal(fact(splits.currenciesTrivia(mixed)), "Shared costs on the Japan trip came in 2 currencies: JPY and SGD.");
  assert.equal(fact(splits.sharedTotalTrivia(mixed)), "Shared costs on the Japan trip add up to JP¥357,420.");
  // A home group reads "in the Home group"; one cost on the first date is named.
  const home = splitsInput("2026-09-27", { group: { id: "home", name: "Home", balanceMinor: 0 }, activity: JAPAN_ACTIVITY.slice(1) });
  assert.equal(fact(splits.firstCostTrivia(home)), "The first shared cost in the Home group: Tokyo hotel on Sat 4 Apr.");
  const oneBusyDay = JAPAN_ACTIVITY.filter((item) => !["trip-1", "trip-7"].includes(item.id));
  assert.equal(fact(splits.busiestDayTrivia(splitsInput("2026-09-27", { activity: oneBusyDay }))), "Busiest day on the Japan trip: Mon 6 Apr, with 2 shared costs.");
});

test("Splits: each trivia type stays silent when its data is missing, and the household view never compares partners", () => {
  const one = JAPAN_ACTIVITY.slice(0, 1);
  const two = JAPAN_ACTIVITY.slice(0, 2);
  const household = splitsInput("2026-09-27", { audience: "household", viewId: "household", viewLabel: "Household" });
  const onlyExpenses = JAPAN_ACTIVITY.filter((item) => item.kind === "expense");
  const oneMethod = onlyExpenses.map((item) => ({ ...item, paymentMethod: "card" }));
  const noCategories = onlyExpenses.map((item) => ({ ...item, categoryName: undefined }));
  const distinctDays = onlyExpenses.map((item, index) => ({ ...item, date: `2026-04-${String(index + 10).padStart(2, "0")}`, description: `Cost ${index}` }));
  const silent = [
    ["in-numbers", splits.groupInNumbersTrivia, splitsInput("2026-09-27", { activity: one })],
    ["payer (household)", splits.payerTrivia, household],
    ["payer (paid for nothing)", splits.payerTrivia, splitsInput("2026-09-27", { viewId: "person-serene", viewLabel: "Nobody" })],
    ["busiest-day", splits.busiestDayTrivia, splitsInput("2026-09-27", { activity: distinctDays })],
    ["weekday-most", splits.weekdayMostTrivia, splitsInput("2026-09-27", { activity: two })],
    ["busiest-month", splits.busiestMonthTrivia, splitsInput("2026-09-27")],
    ["total", splits.sharedTotalTrivia, splitsInput("2026-09-27", { activity: one })],
    ["average-cost", splits.averageCostTrivia, splitsInput("2026-09-27", { activity: two })],
    ["smallest-cost", splits.smallestCostTrivia, splitsInput("2026-09-27", { activity: two })],
    ["first-cost", splits.firstCostTrivia, splitsInput("2026-09-27", { activity: one })],
    ["priciest-day", splits.priciestDayTrivia, splitsInput("2026-09-27", { activity: JAPAN_ACTIVITY.slice(0, 2) })],
    ["latest-cost", splits.latestCostTrivia, splitsInput("2026-09-27", { activity: [...onlyExpenses, { ...onlyExpenses.at(-1), id: "same-day" }] })],
    ["repeated-cost", splits.repeatedCostTrivia, splitsInput("2026-09-27", { activity: distinctDays })],
    ["span", splits.costSpanTrivia, splitsInput("2026-09-27", { activity: two })],
    ["currencies", splits.currenciesTrivia, splitsInput("2026-09-27")],
    ["top-category", splits.topCategoryTrivia, splitsInput("2026-09-27", { activity: noCategories })],
    ["categories", splits.categoriesCountTrivia, splitsInput("2026-09-27", { activity: noCategories })],
    ["payment-mix", splits.paymentMixTrivia, splitsInput("2026-09-27", { activity: oneMethod })],
    ["largest-settlement", splits.largestSettlementTrivia, splitsInput("2026-09-27", { activity: onlyExpenses })],
    ["settle-count", splits.settleCountTrivia, splitsInput("2026-09-27", { activity: JAPAN_ACTIVITY.slice(0, -1) })]
  ];
  for (const [type, builder, input] of silent) {
    assert.equal(builder(input), null, type);
  }
  // The household view's trivia never names who paid.
  for (const line of Object.values(trivia(splits.buildSplitsSignals(household)))) {
    assert.doesNotMatch(line, /Ethan|Serene|You paid/, line);
  }
  assert.deepEqual(trivia(splits.buildSplitsSignals(splitsInput("2026-09-27", { group: null }))), {});
  assert.deepEqual(trivia(splits.buildSplitsSignals(splitsInput("2026-09-27", { group: JAPAN_TRIP, activity: [] }))), {});
});

test("Summary: every trivia type's exact line for a year ending August 2026", () => {
  assert.deepEqual(trivia(summary.buildSummarySignals(summaryInput("2026-08"))), {
    "category-fraction": "About one in every two dollars in August went to groceries.",
    "half-of-spending": "Two categories made up half of August's spending.",
    "every-month-category": "Groceries showed up in all 12 months of this range, about $711 a month on average.",
    "quietest-month": "The quietest month for spending in this range: November 2025, at $1,389.52.",
    "biggest-month": "The biggest month for spending in this range: August 2026, at $2,135.79.",
    "average-month": "An average month in this range came to about $1,679 of spending.",
    "weekly-category": "Groceries came to about $164 a week across this range.",
    "categories-count": "10 different categories show up across this range.",
    "top-category-months": "Groceries was the biggest category in 11 of the 12 months here.",
    "top-category-entries": "Dining had the most entries in August: 15.",
    "entries-total": "This range in numbers: 518 entries across 12 months.",
    "category-peak": "The biggest single category month in this range: Groceries in March 2026, at $1,130.01.",
    "daily-average": "Across this range, spending averaged about $55 a day.",
    "range-total": "Spending across this range came to about $20,151 over 12 months.",
    "range-share": "Groceries took about one in every two dollars across this range.",
    "second-category": "Dining came second across this range, after groceries.",
    "income-months": "Income came in during 12 of the 12 months here."
  });
  // A 13-month range reaches last year's month, and ties give no winner.
  const long = summaryInput("2026-08");
  const withLastYear = { ...long, categoryShareByMonth: [{ month: "2025-08", data: [{ label: "Travel", valueMinor: 300_000, entryCount: 4 }] }, ...long.categoryShareByMonth], months: [{ month: "2025-08", realExpensesMinor: 300_000, actualIncomeMinor: 650_000 }, ...long.months] };
  assert.equal(fact(summary.lastYearTopTrivia(withLastYear)), "A year ago, Travel was your biggest category.");
  // One month with more entries than any other.
  const busier = { ...long, categoryShareByMonth: long.categoryShareByMonth.map((item) => (item.month === "2026-03" ? { ...item, data: [...item.data, { label: "Gifts", valueMinor: 1_000, entryCount: 30 }] } : item)) };
  const count = busier.categoryShareByMonth.find((item) => item.month === "2026-03").data.reduce((total, datum) => total + datum.entryCount, 0);
  assert.equal(fact(summary.mostEntriesMonthTrivia(busier)), `The month with the most entries in this range: March 2026, with ${count}.`);
});

test("Summary: each trivia type stays silent when its data is missing", () => {
  const twoMonths = summaryInput("2026-08");
  const short = { ...twoMonths, months: twoMonths.months.slice(-2), categoryShareByMonth: twoMonths.categoryShareByMonth.slice(-2) };
  const noCategories = { ...twoMonths, categoryShareByMonth: [] };
  const flat = summaryInput("2026-08", { flat: true });
  const noIncome = { ...twoMonths, months: twoMonths.months.map((item) => ({ ...item, actualIncomeMinor: 0 })) };
  const silent = [
    ["category-fraction", summary.categoryFractionTrivia, noCategories],
    ["half-of-spending", summary.halfOfSpendingTrivia, noCategories],
    ["last-year-top", summary.lastYearTopTrivia, twoMonths],
    ["every-month-category", summary.everyMonthCategoryTrivia, short],
    ["most-entries-month", summary.mostEntriesMonthTrivia, flat],
    ["quietest-month", summary.quietestMonthTrivia, flat],
    ["biggest-month", summary.biggestMonthTrivia, flat],
    ["average-month", summary.averageMonthTrivia, short],
    ["weekly-category", summary.weeklyCategoryTrivia, noCategories],
    ["categories-count", summary.categoriesCountTrivia, noCategories],
    ["top-category-months", summary.topCategoryMonthsTrivia, noCategories],
    ["top-category-entries", summary.topCategoryEntriesTrivia, noCategories],
    ["entries-total", summary.entriesTotalTrivia, noCategories],
    ["most-income-month", summary.mostIncomeMonthTrivia, noIncome],
    ["category-peak", summary.categoryPeakTrivia, flat],
    ["daily-average", summary.dailyAverageTrivia, { ...short, months: short.months.slice(-1) }],
    ["range-total", summary.rangeTotalTrivia, { ...short, months: short.months.slice(-1) }],
    ["range-share", summary.rangeShareTrivia, noCategories],
    ["second-category", summary.secondCategoryTrivia, noCategories],
    ["income-months", summary.incomeMonthsTrivia, noIncome],
    ["year-recap", summary.yearRecapTrivia, twoMonths],
    ["anniversary", summary.anniversaryTrivia, twoMonths]
  ];
  for (const [type, builder, input] of silent) {
    assert.equal(builder(input), null, type);
  }
});
