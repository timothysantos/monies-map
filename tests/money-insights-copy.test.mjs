// The tone lint over every line the money check-in can show: the approved
// phrasings, think lines, sorted lines, trivia, quiet and calm lines, the
// quotes and the Money consequence map's lanes. It also keeps
// docs/money-insights-copy.md in step with the copy catalogues.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { CATALOGUES, DOC_PATH, renderCheckInCopyMarkdown } from "../scripts/money-insights-copy.mjs";
import { buildFinancialInsightFacts } from "../src/domain/ai-assistance-insights.ts";
import { QUIET_LINES } from "../src/domain/money-signals/checkin.ts";
import { ENTRIES_CALM_LINE } from "../src/domain/money-signals/entries-signals.ts";
import { monthCalmLine } from "../src/domain/money-signals/month-signals.ts";
import { QUOTES } from "../src/domain/money-signals/quotes.ts";
import { SPLITS_CALM_LINE } from "../src/domain/money-signals/splits-signals.ts";
import { SUMMARY_CALM_LINE } from "../src/domain/money-signals/summary-signals.ts";
import { findPercentWithoutMoney, findToneProblems } from "../src/domain/money-signals/tone.ts";
import { formatCurrencyMinor } from "../src/domain/split-currency.ts";

function catalogueLines() {
  const lines = [];
  for (const catalogue of CATALOGUES) {
    for (const [name, entry] of Object.entries(catalogue.copy)) {
      const where = `${catalogue.title} ${name}`;
      for (const phrasing of [...entry.phrasings, ...(entry.phrasingsOne ?? [])]) {
        if (typeof phrasing === "string") {
          lines.push([where, phrasing]);
        } else {
          lines.push([where, phrasing.fact], [`${where} think`, phrasing.think]);
        }
      }
      for (const [label, text] of [["think", entry.think], ["thinkOne", entry.thinkOne], ["action", entry.action], ["sorted", entry.sorted?.fact], ["sorted think", entry.sorted?.think]]) {
        if (text) {
          lines.push([`${where} ${label}`, text]);
        }
      }
    }
  }
  return lines;
}

test("the tone lint catches every word on the avoid list, exclamation marks, emoji and bare percentages", () => {
  for (const bad of ["You overspent on dining.", "You blew the budget.", "A bad month.", "Time to cut back.", "You should save.", "A non-essential buy.", "A guilty pleasure.", "A small sacrifice.", "Warning: rent.", "Budget alert.", "A problem with groceries.", "Nice work!", "Well done \u{1F389}"]) {
    assert.ok(findToneProblems(bad).length > 0, bad);
  }
  for (const fine of ["Dining went $63.19 over its $650 plan.", "Worth a look: subscriptions.", "Spending you enjoy is part of the plan."]) {
    assert.deepEqual(findToneProblems(fine), [], fine);
  }
  assert.deepEqual(findPercentWithoutMoney("Planned bills take 31% of this month's income."), ["Planned bills take 31% of this month's income."]);
  assert.deepEqual(findPercentWithoutMoney("Planned bills take 31% of this month's income ($2,480.00)."), []);
  assert.deepEqual(findPercentWithoutMoney("You paid for {rate}% of shared costs ({paid} of {total})."), []);
});

test("every approved phrasing, think line, sorted line, trivia, quiet and calm line passes the tone rules", () => {
  const lines = [
    ...catalogueLines(),
    ...QUIET_LINES.map((line) => ["quiet", line]),
    ["calm Summary", SUMMARY_CALM_LINE],
    ["calm Month", monthCalmLine("2026-08")],
    ["calm Entries", ENTRIES_CALM_LINE],
    ["calm Splits", SPLITS_CALM_LINE],
    ["change lead", "Down from $42.80 since your last visit."]
  ];
  assert.ok(lines.length > 150, `${lines.length} lines`);
  const problems = lines.flatMap(([where, text]) => [
    ...findToneProblems(text).map((problem) => `${where}: "${text}" ${problem}`),
    ...findPercentWithoutMoney(text).map((sentence) => `${where}: "${sentence}" shows a percentage without the money amount`)
  ]);
  assert.deepEqual(problems, []);
});

test("every signal has 3 to 5 phrasings with the same numbers; trivia has one line", () => {
  for (const catalogue of CATALOGUES) {
    for (const [name, entry] of Object.entries(catalogue.copy)) {
      const [kind] = catalogue.entries[name] ?? [];
      assert.ok(kind, `${catalogue.title} ${name} is not described in scripts/money-insights-copy.mjs`);
      if (!entry.phrasings.length) {
        continue;
      }
      if (kind === "just_for_fun") {
        assert.equal(entry.phrasings.length, 1, name);
        continue;
      }
      assert.ok(entry.phrasings.length >= 3 && entry.phrasings.length <= 5, `${name}: ${entry.phrasings.length} phrasings`);
      if (entry.phrasingsOne) {
        assert.ok(entry.phrasingsOne.length >= 3, `${name}: ${entry.phrasingsOne.length} one-phrasings`);
      }
    }
  }
});

test("the quotes carry no exclamation marks, emoji or avoid-list words", () => {
  for (const quote of QUOTES) {
    assert.deepEqual(findToneProblems(quote.text), [], quote.id);
  }
});

test("the Money consequence map's lanes pass the tone rules in every state", () => {
  const formatMoney = (minor) => formatCurrencyMinor(minor, "SGD");
  const records = (income, spend) => [
    ...(income ? [{ entryType: "income", amountMinor: income, description: "Salary" }] : []),
    ...(spend ? [{ entryType: "expense", amountMinor: spend, categoryName: "Home", description: "Castlery" }] : [])
  ];
  const lanes = [];
  for (const perspective of ["cash_flow", "partial_view", "split_obligation"]) {
    for (const [income, spend] of [[0, 5_000], [10_000, 5_000], [5_000, 10_000], [5_000, 5_000]]) {
      for (const plannedSpendMinor of [0, 4_000, 8_000]) {
        for (const confidence of [{ evaluated: false }, { evaluated: true }, { evaluated: true, reconciliationMismatchCount: 1, needsCheckpointCount: 2, unresolvedTransferCount: 1 }]) {
          const facts = buildFinancialInsightFacts({
            contextLabel: "August 2026",
            records: records(income, spend),
            formatMoney,
            perspective,
            decisionMapContext: { plannedSpendMinor, confidence, sameSeason: { label: "August 2025", spendMinor: 6_000, incomeMinor: 9_000 } }
          });
          lanes.push(...facts.decisionMap.lanes);
        }
      }
    }
  }
  const problems = lanes.flatMap((lane) => [lane.label, lane.value, lane.detail]
    .flatMap((text) => findToneProblems(text).map((problem) => `${lane.id}: "${text}" ${problem}`)));
  assert.deepEqual(problems, []);
});

test("docs/money-insights-copy.md lists every line and is up to date", async () => {
  const doc = await readFile(DOC_PATH, "utf8");
  assert.equal(doc, renderCheckInCopyMarkdown(), "Run: npx tsx scripts/money-insights-copy.mjs");
  for (const quote of QUOTES) {
    assert.ok(doc.includes(quote.text), quote.id);
  }
});
