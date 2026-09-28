#!/usr/bin/env node
// Writes docs/money-insights-copy.md: every line Money insights can say, from
// the copy catalogues in src/domain/money-signals, so the owner can review
// all of it in one place, with each page's year rotation. tests/money-insights-copy.test.mjs
// fails when the doc is out of date or a catalogue entry has no description here.
//
//   npx tsx scripts/money-insights-copy.mjs          rewrite docs/money-insights-copy.md
import { writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { CALM_LINE_TEMPLATES, QUIET_LINES } from "../src/domain/money-signals/checkin.ts";
import { ENTRIES_CALM_LINE, ENTRIES_COPY, ENTRIES_TRIVIA_ROTATION } from "../src/domain/money-signals/entries-signals.ts";
import { MONTH_COPY, MONTH_TRIVIA_ROTATION, monthCalmLine } from "../src/domain/money-signals/month-signals.ts";
import { QUOTES, quoteCitation } from "../src/domain/money-signals/quotes.ts";
import { QUOTE_PAGE_OFFSETS, YEAR_MONTHS } from "../src/domain/money-signals/rotation.ts";
import { SHARED_COPY } from "../src/domain/money-signals/shared-signals.ts";
import { SPLITS_CALM_LINE, SPLITS_COPY, SPLITS_TRIVIA_ROTATION } from "../src/domain/money-signals/splits-signals.ts";
import { SUMMARY_CALM_LINE, SUMMARY_COPY, SUMMARY_TRIVIA_ROTATION } from "../src/domain/money-signals/summary-signals.ts";
import { AVOID_WORDS } from "../src/domain/money-signals/tone.ts";
import { SIGNAL_KIND_LABELS } from "../src/domain/money-signals/types.ts";

export const DOC_PATH = "docs/money-insights-copy.md";

// Which page shows each catalogue, and what each entry is: its kind, when
// it fires and, for Just for fun, the trivia type its page's rotation
// schedules. Every catalogue entry must be described here.
export const CATALOGUES = [
  {
    title: "Summary and Month (shared)",
    copy: SHARED_COPY,
    entries: {
      statementGap: ["quick_fix", "A wallet's latest statement does not match the app (the largest gap). Summary and Month."]
    }
  },
  {
    title: "Summary",
    copy: SUMMARY_COPY,
    rotation: SUMMARY_TRIVIA_ROTATION,
    period: "the range's last month",
    entries: {
      spendingAboveIncome: ["bigger_question", "Spending was above income for 3 or more complete months in a row (once the range records income)."],
      categoryCreep: ["worth_a_look", "A category rose 3 or more complete months in a row and is $50 or more above its average."],
      subscriptions: ["worth_a_look", "Subscriptions in the focus month (or the latest complete month), at their yearly and daily cost."],
      monthsUnderPlan: ["going_well", "At least two thirds (and 3 or more) of the last 12 complete months came in under plan."],
      keepRate: ["long_view", "Income kept over the last (up to 12) complete months, when positive."],
      cushion: ["long_view", "Bank account balances (never cards) against the range's average monthly spend; skipped with no bank balance, no spending, or under a month."],
      sameSeason: ["long_view", "The month against the same month last year, only when both are complete and already in the range."],
      chineseNewYear: ["long_view", "Seasonal: in the month before or of Chinese New Year, last year's Chinese New Year month, when it is in the range. Shown ahead of the other long views."],
      categoryFraction: ["just_for_fun", "The month's biggest category (not Other, loans, rent, bills, insurance, tax, savings or transfers) as a plain fraction, between one in two and one in twelve.", "category-fraction"],
      halfOfSpending: ["just_for_fun", "How few categories made up half of the focus (or latest complete) month's spending (two or more, and fewer than all).", "half-of-spending"],
      lastYearTop: ["just_for_fun", "The biggest category of the same month last year, when it is in the range.", "last-year-top"],
      everyMonthCategory: ["just_for_fun", "Of the categories in every complete month of the range (3 or more months), the steadiest, with its monthly average.", "every-month-category"],
      mostEntriesMonth: ["just_for_fun", "The complete month with the most entries (3 or more months, no tie).", "most-entries-month"],
      quietestMonth: ["just_for_fun", "The complete month with the least spending (3 or more months, no tie).", "quietest-month"],
      biggestMonth: ["just_for_fun", "The complete month with the most spending (3 or more months, no tie).", "biggest-month"],
      averageMonth: ["just_for_fun", "An average complete month's spending (3 or more months).", "average-month"],
      weeklyCategory: ["just_for_fun", "The range's biggest everyday category (not Other, loans, rent, bills, insurance, tax, savings or transfers), per week.", "weekly-category"],
      categoriesCount: ["just_for_fun", "How many categories the range's complete months used (3 or more).", "categories-count"],
      topCategoryMonths: ["just_for_fun", "The category that was biggest in the most complete months (2 or more, no tie).", "top-category-months"],
      topCategoryEntries: ["just_for_fun", "The category with the most entries in the focus (or latest complete) month (2 or more, no tie, not Other).", "top-category-entries"],
      entriesTotal: ["just_for_fun", "The entries across the range's complete months (2 or more months).", "entries-total"],
      mostIncomeMonth: ["just_for_fun", "The complete month with the most income (3 or more months with income, no tie).", "most-income-month"],
      categoryPeak: ["just_for_fun", "The largest single everyday category-month in the range (3 or more complete months, no tie).", "category-peak"],
      dailyAverage: ["just_for_fun", "The range's spending per day (2 or more complete months).", "daily-average"],
      rangeTotal: ["just_for_fun", "The range's spending in all (2 or more complete months).", "range-total"],
      rangeShare: ["just_for_fun", "The range's biggest everyday category as one in every N dollars (between one in two and one in twelve).", "range-share"],
      secondCategory: ["just_for_fun", "The everyday category in second place across the range (no tie).", "second-category"],
      incomeMonths: ["just_for_fun", "How many complete months had income come in (1 or more, of 2 or more months).", "income-months"],
      yearRecap: ["just_for_fun", "Moment: a range ending in December recaps that year (3 or more of its months in the range).", "year-recap"],
      anniversary: ["just_for_fun", "Moment: a range ending this month, 12, 24, ... months after the first month with data.", "anniversary"]
    }
  },
  {
    title: "Month",
    copy: MONTH_COPY,
    rotation: MONTH_TRIVIA_ROTATION,
    period: "the month",
    entries: {
      unlinkedBills: ["quick_fix", "Planned bills dated before today with no entry linked."],
      oneOffOverPlan: ["bigger_question", "The month went over plan and one or two entries made up at least half of it."],
      categoryOverPlan: ["worth_a_look", "The category budget furthest over its plan (by $1 or more)."],
      incomeAbovePlan: ["worth_a_look", "A moment (a bonus): income $500 and 10% or more above its plan."],
      incomeArrived: ["going_well", "A moment (payday): income dated in the last 3 days of the month in progress."],
      planLeft: ["going_well", "Plan still unspent in the month in progress."],
      planLeftPast: ["going_well", "Wrap-up: a finished month that came in under plan."],
      savingsOnPlan: ["going_well", "Every savings row in the plan is met."],
      upcomingBills: ["worth_a_look", "Early in the month (days 1 to 10): unlinked planned bills due in the next 10 days."],
      paceSteady: ["going_well", "Mid-month (days 11 to 20): spending is at or behind the calendar's share of the plan."],
      paceAhead: ["worth_a_look", "Mid-month (days 11 to 20): spending is ahead of the calendar but still under plan."],
      fixedCosts: ["long_view", "Planned bills and subscriptions against the month's income (actual, or planned before it arrives)."],
      regularSpot: ["just_for_fun", "The place visited most often, at least 3 times (not transport, bills or transfers).", "regular-spot"],
      quietWeekday: ["just_for_fun", "The weekday with the fewest expenses, once the month has reached every weekday (no tie).", "quiet-weekday"],
      weekdayPattern: ["just_for_fun", "More than half of the dining out (at least 3) on one weekday.", "dining-weekday"],
      busiestWeekday: ["just_for_fun", "The weekday with the most expenses (2 or more, no tie).", "busiest-weekday"],
      noSpendDays: ["just_for_fun", "Days with no expense in a finished month.", "no-spend-days"],
      noSpendDaysSoFar: ["just_for_fun", "Days with no expense so far in the month in progress.", "no-spend-days"],
      longestRun: ["just_for_fun", "The longest run of days in a row with nothing spent (2 or more; the earliest when two are as long).", "longest-run"],
      biggestDay: ["just_for_fun", "The date with the most spending (not savings, transfers or routine bills), and its largest named entry.", "biggest-day"],
      busiestWeek: ["just_for_fun", "The week (Monday to Sunday, within the month) with the most spending (no tie).", "busiest-week"],
      halfway: ["just_for_fun", "The date by which half of the month's spending had gone (3 or more expenses on 2 or more days).", "halfway"],
      dayAverage: ["just_for_fun", "Spending per day of the month (so far, in the month in progress).", "day-average"],
      weekendShare: ["just_for_fun", "Weekend spending as one in every N dollars (between one in two and one in twelve).", "weekend-share"],
      categoryShare: ["just_for_fun", "The biggest everyday category (not savings, bills, insurance, loans, rent or tax) as one in every N dollars.", "category-share"],
      topTwoCategories: ["just_for_fun", "The month's two biggest everyday categories (not bills, insurance, loans, rent, tax or savings; no tie).", "top-two-categories"],
      categoriesCount: ["just_for_fun", "How many categories the month's spending touched (3 or more).", "categories-count"],
      categoryDays: ["just_for_fun", "The category that showed up on the most different days (3 or more).", "category-days"],
      categoryLargest: ["just_for_fun", "The largest named entry of the biggest everyday category.", "category-largest"],
      planCount: ["just_for_fun", "How many planned bills and category budgets the month's plan holds (2 or more rows).", "plan-count"],
      biggestBill: ["just_for_fun", "The largest planned bill (2 or more bills, no tie).", "biggest-bill"]
    }
  },
  {
    title: "Entries",
    copy: ENTRIES_COPY,
    rotation: ENTRIES_TRIVIA_ROTATION,
    period: "the month",
    entries: {
      uncategorized: ["quick_fix", "Expenses still in Other this month."],
      possibleDuplicate: ["worth_a_look", "The same amount from the same place twice within 7 days."],
      topFive: ["worth_a_look", "The five largest entries are 40% or more of the month's spending (6 or more expenses)."],
      smallestEntry: ["just_for_fun", "The smallest purchase with a readable name (never a fee, interest, adjustment, or a PayNow or transfer reference).", "smallest"],
      largestEntry: ["just_for_fun", "The largest purchase at a place (not a bill, subscription, insurance or transfer).", "largest"],
      placesCount: ["just_for_fun", "How many different places the month's purchases came from (3 or more).", "places"],
      oneOffPlaces: ["just_for_fun", "Places that show up only once (2 or more, from 3 or more places).", "one-off-places"],
      topPlace: ["just_for_fun", "The place with the most spent over two or more entries (no tie).", "top-place"],
      topAccount: ["just_for_fun", "The account or card with the most entries (2 or more, no tie).", "top-account"],
      accountsCount: ["just_for_fun", "How many accounts and cards the month's entries used (2 or more).", "accounts-count"],
      averageEntry: ["just_for_fun", "The average expense (3 or more expenses).", "average"],
      medianEntry: ["just_for_fun", "The median purchase: at least half came to this or less (4 or more).", "median"],
      firstEntry: ["just_for_fun", "The first date with spending, when it has one entry.", "first-day"],
      firstDay: ["just_for_fun", "The first date with spending, when it has several: the largest named one leads.", "first-day"],
      firstDayCount: ["just_for_fun", "The first date with spending, when nothing that day has a readable name (a PayNow, a GIRO).", "first-day"],
      entrySpan: ["just_for_fun", "The first and last dates in the list and the number of days with entries (2 or more).", "span"],
      repeatedAmount: ["just_for_fun", "The amount that appears most often (twice or more, no tie).", "repeated-amount"],
      categoryCount: ["just_for_fun", "The category with the most expenses (2 or more, no tie, not Other).", "category-count"],
      busiestDate: ["just_for_fun", "The date with the most entries (2 or more, no tie).", "busiest-date"],
      weekendEntries: ["just_for_fun", "Entries dated on a Saturday or Sunday (2 or more, from 5 or more entries).", "weekend-entries"],
      roundAmounts: ["just_for_fun", "Expenses in whole dollars (2 or more).", "round-amounts"],
      sharedEntries: ["just_for_fun", "Shared entries in the list (2 or more, not all of them).", "shared"],
      incomeEntries: ["just_for_fun", "The month's income entries and their total.", "income"]
    }
  },
  {
    title: "Splits",
    copy: SPLITS_COPY,
    rotation: SPLITS_TRIVIA_ROTATION,
    period: "the current month, for the selected group",
    entries: {
      owedToYou: ["quick_fix", "Person view: the group's balance is owed to you."],
      youOwe: ["quick_fix", "Person view: you owe the group's balance."],
      openBetweenYou: ["quick_fix", "Household view: the group's open balance, never naming who owes whom."],
      settleRegularly: ["quick_fix", "The think lines for a balance in a group that is not a trip."],
      bankMatch: ["quick_fix", "Bank payments that may match a split entered by hand."],
      shareOfCosts: ["long_view", "Person views only: the share of the group's costs you paid (last 3 months, or the open batch)."],
      tripInNumbers: ["just_for_fun", "A trip group's costs and its priciest.", "in-numbers"],
      groupInNumbers: ["just_for_fun", "Any other group's costs and its priciest.", "in-numbers"],
      payerCount: ["just_for_fun", "Person views only: how many of the costs you paid for, and how much. The household view never compares partners.", "payer"],
      busiestDay: ["just_for_fun", "The date with the most shared costs (2 or more, no tie).", "busiest-day"],
      weekdayMost: ["just_for_fun", "The weekday with the most shared costs (3 or more costs, no tie).", "weekday-most"],
      busiestMonth: ["just_for_fun", "The month with the most shared costs (2 or more months, no tie).", "busiest-month"],
      sharedTotal: ["just_for_fun", "What the shared costs add up to (2 or more, in the group's currency).", "total"],
      averageCost: ["just_for_fun", "The average shared cost, in whole units (3 or more).", "average-cost"],
      priciestDay: ["just_for_fun", "The date with the most money in shared costs (2 or more dates, no tie).", "priciest-day"],
      smallestCost: ["just_for_fun", "The smallest shared cost with a readable name (3 or more).", "smallest-cost"],
      firstCost: ["just_for_fun", "The first shared cost, when no other shares its date.", "first-cost"],
      firstDay: ["just_for_fun", "The first day of shared costs, when several share that date.", "first-cost"],
      latestCost: ["just_for_fun", "The latest shared cost, when no other shares its date.", "latest-cost"],
      repeatedCost: ["just_for_fun", "The cost entered most often (twice or more, no tie).", "repeated-cost"],
      costSpan: ["just_for_fun", "The days from the first shared cost to the last (2 or more dates).", "span"],
      currencies: ["just_for_fun", "The currencies the costs came in (2 or more).", "currencies"],
      topCategory: ["just_for_fun", "The biggest category (2 or more categories, no tie).", "top-category"],
      categoriesCount: ["just_for_fun", "How many categories the costs spread across (2 or more).", "categories"],
      paymentMix: ["just_for_fun", "How the costs were paid: by card, in cash, by bank transfer (2 or more ways).", "payment-mix"],
      largestSettlement: ["just_for_fun", "The largest settle-up.", "largest-settlement"],
      settleCount: ["just_for_fun", "How many settle-ups there have been (2 or more).", "settle-count"]
    }
  }
];

const ALSO_LABELS = [
  ["Summary", "Also in this range"],
  ["Month", "Also this month"],
  ["Entries", "Also this month"],
  ["Splits", "Also in this group"]
];

const CALM_PLACES = [
  ["Summary", "this range", SUMMARY_CALM_LINE],
  ["Month", "{month}", monthCalmLine("2026-08").replace("August", "{month}")],
  ["Entries", "this list", ENTRIES_CALM_LINE],
  ["Splits", "this group", SPLITS_CALM_LINE]
];

const MONTH_LABELS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function thinkLines(think) {
  return Array.isArray(think) ? think : think ? [think] : [];
}

function phrasingLines(phrasings) {
  return phrasings.map((phrasing) => {
    if (typeof phrasing === "string") {
      return `- ${phrasing}`;
    }
    const own = thinkLines(phrasing.think);
    return own.length === 1
      ? `- ${phrasing.fact}\n  - Think line for this phrasing: ${own[0]}`
      : `- ${phrasing.fact}\n  - Think lines for this phrasing, in turn:\n${own.map((line) => `    - ${line}`).join("\n")}`;
  });
}

function thinkBlock(label, think) {
  const lines = thinkLines(think);
  if (!lines.length) {
    return [];
  }
  return lines.length === 1
    ? [`${label}: ${lines[0]}`, ""]
    : [`${label}, in turn:`, "", ...lines.map((line) => `- ${line}`), ""];
}

function renderEntry(name, entry, [kind, when, triviaType]) {
  const lines = [`### ${name} (${SIGNAL_KIND_LABELS[kind]})`, "", when, ""];
  if (triviaType) {
    lines.push(`Trivia type: \`${triviaType}\`.`, "");
  }
  if (entry.phrasings.length) {
    lines.push(kind === "just_for_fun" ? "Line:" : "Phrasings:", "", ...phrasingLines(entry.phrasings), "");
  }
  if (entry.phrasingsOne) {
    lines.push("When the count is 1:", "", ...phrasingLines(entry.phrasingsOne), "");
  }
  lines.push(...thinkBlock("Way to think about it", entry.think));
  lines.push(...thinkBlock("Way to think about it (count of 1)", entry.thinkOne));
  if (entry.sorted) {
    lines.push(`Said once when it clears (Going well): ${entry.sorted.fact} / ${entry.sorted.think}`, "");
  }
  if (entry.action) {
    lines.push(`Action: ${entry.action}`, "");
  }
  return lines;
}

function renderRotation(catalogue) {
  const lines = [`Just for fun follows ${catalogue.period}. Month number, then the type tried first and its reserves:`, ""];
  catalogue.rotation.columns.forEach((column, index) => {
    lines.push(`- ${MONTH_LABELS[index]}: ${column.map((type) => `\`${type}\``).join(", then ")}`);
  });
  if (catalogue.rotation.moments?.length) {
    lines.push("", `Moments, tried before the month's column: ${catalogue.rotation.moments.map((type) => `\`${type}\``).join(", ")}.`);
  }
  lines.push("");
  return lines;
}

export function renderCheckInCopyMarkdown() {
  const lines = [
    "# Money insights copy",
    "",
    "Every line Money insights can show, generated from the copy",
    "catalogues in `src/domain/money-signals/` by `npx tsx scripts/money-insights-copy.mjs`.",
    "Do not edit this file by hand: change the catalogue and regenerate it",
    "(`tests/money-insights-copy.test.mjs` fails when it is out of date).",
    "Placeholders in braces are filled from computed numbers, for example",
    "`{amount}` is a money amount and `{month}` a month name.",
    "",
    "## Tone",
    "",
    "Facts first; curious, not judging; enjoying money is allowed; zoom out;",
    "wins count; one hard question at a time; no blame between partners; fun",
    "stays kind; perspective, not advice. No exclamation marks, no emoji, and",
    "no percentage without the money amount beside it.",
    "",
    `Words the tone lint rejects: ${AVOID_WORDS.join(", ")}.`,
    "",
    "## Kinds and order",
    "",
    "The headline is the first of: Quick fix, Bigger question (at most one),",
    "a moment (payday, a bonus, bills coming up, pace), Worth a look, Going",
    "well; ties go to the larger amount, then to what was not seen recently.",
    "On Month, a statement gap (a Quick fix about a wallet, not the month)",
    "goes right after the month's own Bigger question, so the Bigger question",
    "leads and the gap is listed under \"Also this month\"; other Month quick",
    "fixes (planned bills with no entry) keep their place, and Summary still",
    "leads with a statement gap.",
    "Long view is a separate quieter line; Just for fun is one line shown only",
    "when the headline is not a Bigger question. \"See all insights\" adds up",
    "to three more signals and one quote (never beside a Bigger question);",
    "Splits also keeps its link to review bank matches there.",
    "",
    "## The year rule",
    "",
    "What rotates follows the period being viewed, never the time of the visit",
    "or the browser's memory: Month and Entries use their month, Summary the",
    "range's last month, Splits the current month for the selected group. For",
    "one page and view, nothing shown for a period comes back in the eleven",
    "periods before or after it:",
    "",
    "- Just for fun: each trivia type sits in one of twelve columns, one per",
    "  month number; a period tries its column's types in turn (the first one",
    "  changes each year) and shows none rather than borrow from another",
    "  column. Moments (a year recap, an anniversary) go first and fire in at",
    "  most one period of any twelve. Month and Entries have different types,",
    "  so they never say the same thing for a month.",
    "- A signal's wording: every phrasing with every think line it may pair",
    "  with, taken in turn by month (12 or more pairs per signal), all with the",
    "  same numbers. The \"also\" list uses each signal's first phrasing.",
    "- Long view: a seasonal moment leads; otherwise the long views that fire",
    "  take turns by month, each in its own wording turn.",
    `- Quote: the library is in ${YEAR_MONTHS} columns (a quote's place in the list, mod ${YEAR_MONTHS}); each page reads a`,
    `  different column in the same month (Summary +${QUOTE_PAGE_OFFSETS.summary}, Month +${QUOTE_PAGE_OFFSETS.month}, Entries +${QUOTE_PAGE_OFFSETS.entries}, Splits +${QUOTE_PAGE_OFFSETS.splits}) and`,
    "  moves on one column a month. In its column it shows the quote that fits",
    "  the headline's topic, else the calm one, else none.",
    "- Calm line: twelve lines, one per month in turn.",
    "",
    "Browser memory may only add: a headline shown in the last three days",
    "rests, a number that moved leads with what changed, a cleared quick fix",
    "says \"Sorted\" once, and a revisit with nothing new is a quiet line.",
    "",
    "## Lines the engine adds",
    "",
    "When a signal's number moved by 10% or $50 since the last visit, its",
    "headline starts with: `Down from {previous} since your last visit.` or",
    "`Up from {previous} since your last visit.`",
    "",
    "Quiet visit (nothing new since a visit in the last 3 days; never twice in",
    "a row). `{when}` is \"earlier today\", \"yesterday\", a weekday, or \"your",
    "last visit\":",
    "",
    ...QUIET_LINES.map((line) => `- ${line}`),
    "",
    "Calm lines when no signal fires, one per month in turn. `{place}` is",
    `${CALM_PLACES.map(([page, place]) => `\`${place}\` on ${page}`).join(", ")}; each page keeps its own first line:`,
    "",
    ...CALM_PLACES.map(([page, , first]) => `- ${page}, first line: ${first}`),
    ...CALM_LINE_TEMPLATES.slice(1).map((line) => `- ${line}`),
    "",
    "Heading of the expanded list:",
    "",
    ...ALSO_LABELS.map(([page, label]) => `- ${page}: ${label}`),
    ""
  ];
  for (const catalogue of CATALOGUES) {
    lines.push(`## ${catalogue.title}`, "");
    if (catalogue.rotation) {
      lines.push(...renderRotation(catalogue));
    }
    for (const [name, entry] of Object.entries(catalogue.copy)) {
      lines.push(...renderEntry(name, entry, catalogue.entries[name]));
    }
  }
  lines.push("## Quotes", "", `Public domain; wording copied exactly from the source named. Shown only in the expanded view, at most one, never beside a Bigger question. Column is the quote's place in the list, mod ${YEAR_MONTHS}.`, "");
  QUOTES.forEach((quote, index) => {
    lines.push(`- Column ${(index % YEAR_MONTHS) + 1}: “${quote.text}” ${quoteCitation(quote)} (${quote.year}). Source: ${quote.source}. Fits: ${quote.topics.join(", ")}.`);
  });
  lines.push("");
  return lines.join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await writeFile(path.resolve(DOC_PATH), renderCheckInCopyMarkdown());
  console.log(`Wrote ${DOC_PATH}`);
}
