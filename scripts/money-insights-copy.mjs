#!/usr/bin/env node
// Writes docs/money-insights-copy.md: every line Money insights can say, from
// the copy catalogues in src/domain/money-signals, so the owner can review
// all of it in one place. tests/money-insights-copy.test.mjs fails when the
// doc is out of date or a catalogue entry has no description here.
//
//   npx tsx scripts/money-insights-copy.mjs          rewrite docs/money-insights-copy.md
import { writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { QUIET_LINES } from "../src/domain/money-signals/checkin.ts";
import { ENTRIES_CALM_LINE, ENTRIES_COPY } from "../src/domain/money-signals/entries-signals.ts";
import { MONTH_COPY, monthCalmLine } from "../src/domain/money-signals/month-signals.ts";
import { QUOTES, quoteCitation } from "../src/domain/money-signals/quotes.ts";
import { SHARED_COPY } from "../src/domain/money-signals/shared-signals.ts";
import { SPLITS_CALM_LINE, SPLITS_COPY } from "../src/domain/money-signals/splits-signals.ts";
import { SUMMARY_CALM_LINE, SUMMARY_COPY } from "../src/domain/money-signals/summary-signals.ts";
import { AVOID_WORDS } from "../src/domain/money-signals/tone.ts";
import { SIGNAL_KIND_LABELS } from "../src/domain/money-signals/types.ts";

export const DOC_PATH = "docs/money-insights-copy.md";

// Which page shows each catalogue, and what each entry is: its kind and
// when it fires. Every catalogue entry must be described here.
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
    entries: {
      spendingAboveIncome: ["bigger_question", "Spending was above income for 3 or more complete months in a row (once the range records income)."],
      categoryCreep: ["worth_a_look", "A category rose 3 or more complete months in a row and is $50 or more above its average."],
      subscriptions: ["worth_a_look", "Subscriptions in the focus month (or the latest complete month), at their yearly and daily cost."],
      monthsUnderPlan: ["going_well", "At least two thirds (and 3 or more) of the last 12 complete months came in under plan."],
      keepRate: ["long_view", "Income kept over the last (up to 12) complete months, when positive."],
      cushion: ["long_view", "Bank account balances (never cards) against the range's average monthly spend; skipped with no bank balance, no spending, or under a month."],
      sameSeason: ["long_view", "The month against the same month last year, only when both are complete and already in the range."],
      chineseNewYear: ["long_view", "Seasonal: in the month before or of Chinese New Year, last year's Chinese New Year month, when it is in the range. Shown ahead of the other long views."],
      categoryFraction: ["just_for_fun", "The month's biggest category (not Other, loans, rent, bills, insurance, tax, savings or transfers) as a plain fraction, between one in two and one in twelve."],
      lastYearTop: ["just_for_fun", "The biggest category of the same month last year, when it is in the range."],
      yearRecap: ["just_for_fun", "Seasonal: December (the year so far) and January (last year)."],
      anniversary: ["just_for_fun", "Milestone: 12, 24, ... months after the first month with data."]
    }
  },
  {
    title: "Month",
    copy: MONTH_COPY,
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
      regularSpot: ["just_for_fun", "The place visited most often, at least 3 times (not transport, bills or transfers)."],
      weekdayPattern: ["just_for_fun", "More than half of the dining out (at least 3) on one weekday."],
      noSpendDays: ["just_for_fun", "Days with no expense in a finished month."],
      noSpendDaysSoFar: ["just_for_fun", "Days with no expense so far in the month in progress."],
      biggestDay: ["just_for_fun", "The date with the most spending (not savings, transfers or routine bills), and its largest entry."]
    }
  },
  {
    title: "Entries",
    copy: ENTRIES_COPY,
    entries: {
      uncategorized: ["quick_fix", "Expenses still in Other this month."],
      possibleDuplicate: ["worth_a_look", "The same amount from the same place twice within 7 days."],
      topFive: ["worth_a_look", "The five largest entries are 40% or more of the month's spending (6 or more expenses)."],
      smallestEntry: ["just_for_fun", "The smallest purchase (never a fee, interest or adjustment)."]
    }
  },
  {
    title: "Splits",
    copy: SPLITS_COPY,
    entries: {
      owedToYou: ["quick_fix", "Person view: the group's balance is owed to you."],
      youOwe: ["quick_fix", "Person view: you owe the group's balance."],
      openBetweenYou: ["quick_fix", "Household view: the group's open balance, never naming who owes whom."],
      settleRegularly: ["quick_fix", "The think line for a balance in a group that is not a trip."],
      bankMatch: ["quick_fix", "Bank payments that may match a split entered by hand."],
      shareOfCosts: ["long_view", "Person views only: the share of the group's costs you paid (last 3 months, or the open batch)."],
      tripInNumbers: ["just_for_fun", "A trip group's costs; right after a trip ends (2 to 30 days) it is the moment's line."],
      groupInNumbers: ["just_for_fun", "Any other group's costs."]
    }
  }
];

const ALSO_LABELS = [
  ["Summary", "Also in this range"],
  ["Month", "Also this month"],
  ["Entries", "Also this month"],
  ["Splits", "Also in this group"]
];

function phrasingLines(phrasings, baseThink) {
  return phrasings.map((phrasing) => typeof phrasing === "string"
    ? `- ${phrasing}`
    : `- ${phrasing.fact}\n  - Think line for this phrasing: ${phrasing.think}`);
}

function renderEntry(name, entry, [kind, when]) {
  const lines = [`### ${name} (${SIGNAL_KIND_LABELS[kind]})`, "", when, ""];
  if (entry.phrasings.length) {
    lines.push(kind === "just_for_fun" ? "Line:" : "Phrasings:", "", ...phrasingLines(entry.phrasings), "");
  }
  if (entry.phrasingsOne) {
    lines.push("When the count is 1:", "", ...phrasingLines(entry.phrasingsOne), "");
  }
  if (entry.think) {
    lines.push(`Way to think about it: ${entry.think}`, "");
  }
  if (entry.thinkOne) {
    lines.push(`Way to think about it (count of 1): ${entry.thinkOne}`, "");
  }
  if (entry.sorted) {
    lines.push(`Said once when it clears (Going well): ${entry.sorted.fact} / ${entry.sorted.think}`, "");
  }
  if (entry.action) {
    lines.push(`Action: ${entry.action}`, "");
  }
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
    "to three more signals, one quote (never beside a Bigger question) and",
    "the Money consequence map.",
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
    "Calm line when no signal fires:",
    "",
    `- Summary: ${SUMMARY_CALM_LINE}`,
    `- Month: ${monthCalmLine("2026-08").replace("August", "{month}")}`,
    `- Entries: ${ENTRIES_CALM_LINE}`,
    `- Splits: ${SPLITS_CALM_LINE}`,
    "",
    "Heading of the expanded list:",
    "",
    ...ALSO_LABELS.map(([page, label]) => `- ${page}: ${label}`),
    ""
  ];
  for (const catalogue of CATALOGUES) {
    lines.push(`## ${catalogue.title}`, "");
    for (const [name, entry] of Object.entries(catalogue.copy)) {
      lines.push(...renderEntry(name, entry, catalogue.entries[name]));
    }
  }
  lines.push("## Quotes", "", "Public domain; wording copied exactly from the source named. Shown only in the expanded view, at most one, never beside a Bigger question, and not again within 28 days.", "");
  for (const quote of QUOTES) {
    lines.push(`- “${quote.text}” ${quoteCitation(quote)} (${quote.year}). Source: ${quote.source}. Fits: ${quote.topics.join(", ")}.`);
  }
  lines.push("");
  return lines.join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await writeFile(path.resolve(DOC_PATH), renderCheckInCopyMarkdown());
  console.log(`Wrote ${DOC_PATH}`);
}
