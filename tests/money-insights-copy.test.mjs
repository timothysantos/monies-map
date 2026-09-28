// The tone lint over every line the money check-in can show: the approved
// phrasings, think lines, sorted lines, trivia, quiet and calm lines, the
// and the quotes. It also keeps
// docs/money-insights-copy.md in step with the copy catalogues.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { CATALOGUES, DOC_PATH, renderCheckInCopyMarkdown, thinkLines } from "../scripts/money-insights-copy.mjs";
import { CALM_LINE_TEMPLATES, QUIET_LINES } from "../src/domain/money-signals/checkin.ts";
import { ENTRIES_CALM_LINES } from "../src/domain/money-signals/entries-signals.ts";
import { monthCalmLines } from "../src/domain/money-signals/month-signals.ts";
import { QUOTES } from "../src/domain/money-signals/quotes.ts";
import { YEAR_MONTHS } from "../src/domain/money-signals/rotation.ts";
import { SPLITS_CALM_LINES, SPLITS_COPY } from "../src/domain/money-signals/splits-signals.ts";
import { SUMMARY_CALM_LINES } from "../src/domain/money-signals/summary-signals.ts";
import { findPercentWithoutMoney, findToneProblems } from "../src/domain/money-signals/tone.ts";

function catalogueLines() {
  const lines = [];
  for (const catalogue of CATALOGUES) {
    for (const [name, entry] of Object.entries(catalogue.copy)) {
      const where = `${catalogue.title} ${name}`;
      for (const phrasing of [...entry.phrasings, ...(entry.phrasingsOne ?? [])]) {
        if (typeof phrasing === "string") {
          lines.push([where, phrasing]);
        } else {
          lines.push([where, phrasing.fact], ...thinkLines(phrasing.think).map((line) => [`${where} think`, line]));
        }
      }
      for (const [label, text] of [["think", entry.think], ["thinkOne", entry.thinkOne], ["action", entry.action], ["sorted", entry.sorted?.fact], ["sorted think", entry.sorted?.think]]) {
        for (const line of thinkLines(text)) {
          lines.push([`${where} ${label}`, line]);
        }
      }
    }
  }
  return lines;
}

// How many fact and think pairs a set of phrasings gives: each phrasing
// with each think line it may pair with.
function wordingCount(phrasings, baseThink) {
  return phrasings.reduce((total, phrasing) => total + (typeof phrasing === "string" ? thinkLines(baseThink).length : thinkLines(phrasing.think).length), 0);
}

const CALM_LINES = [
  ["Summary", SUMMARY_CALM_LINES],
  ["Month", monthCalmLines("2026-08")],
  ["Entries", ENTRIES_CALM_LINES],
  ["Splits", SPLITS_CALM_LINES]
];

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
    ...CALM_LINES.flatMap(([page, calm]) => calm.map((line) => [`calm ${page}`, line])),
    ["change lead", "Down from $42.80 since your last visit."]
  ];
  assert.ok(lines.length > 350, `${lines.length} lines`);
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

// The year rule for a recurring signal: its fact and think pairs rotate by
// month, so 12 or more of them never repeat a sentence within a year.
test("every signal that can recur has at least 12 wordings, for a count of 1 and for a group that is not a trip too", () => {
  const short = [];
  for (const catalogue of CATALOGUES) {
    for (const [name, entry] of Object.entries(catalogue.copy)) {
      const [kind] = catalogue.entries[name];
      if (kind === "just_for_fun" || !entry.phrasings.length) {
        continue;
      }
      const counts = [["phrasings", wordingCount(entry.phrasings, entry.think)]];
      if (entry.phrasingsOne) {
        counts.push(["count of 1", wordingCount(entry.phrasingsOne, entry.thinkOne ?? entry.think)]);
      }
      if (catalogue.copy === SPLITS_COPY && ["owedToYou", "youOwe", "openBetweenYou"].includes(name)) {
        counts.push(["not a trip", wordingCount(entry.phrasings, SPLITS_COPY.settleRegularly.think)]);
      }
      short.push(...counts.filter(([, count]) => count < YEAR_MONTHS).map(([label, count]) => `${catalogue.title} ${name} (${label}): ${count}`));
    }
  }
  assert.deepEqual(short, []);
});

test("each page has twelve different calm lines, one per month", () => {
  assert.equal(CALM_LINE_TEMPLATES.length, YEAR_MONTHS);
  for (const [page, lines] of CALM_LINES) {
    assert.equal(lines.length, YEAR_MONTHS, page);
    assert.equal(new Set(lines).size, YEAR_MONTHS, page);
    assert.ok(lines.every((line) => /^[A-Z]/.test(line) && !line.includes("{")), page);
  }
  assert.equal(SPLITS_CALM_LINES[0], "Nothing needs a look in this group right now.");
  assert.equal(monthCalmLines("2026-08")[3], "August looks settled. Nothing to check.");
});

test("every Just for fun line has a trivia type its page schedules, and every scheduled type has a line", () => {
  const typesByPage = new Map();
  for (const catalogue of CATALOGUES.filter((item) => item.rotation)) {
    const scheduled = [...catalogue.rotation.columns.flat(), ...(catalogue.rotation.moments ?? [])];
    const described = Object.values(catalogue.entries).filter(([kind]) => kind === "just_for_fun").map(([, , type]) => type);
    assert.ok(described.every(Boolean), `${catalogue.title}: a Just for fun entry has no trivia type`);
    assert.deepEqual([...new Set(described)].sort(), [...scheduled].sort(), catalogue.title);
    typesByPage.set(catalogue.title, new Set(scheduled));
  }
  // Month and Entries never share a trivia type, so they never say the
  // same thing for the same month.
  const shared = [...typesByPage.get("Month")].filter((type) => typesByPage.get("Entries").has(type));
  assert.deepEqual(shared, []);
});

test("the quotes carry no exclamation marks, emoji or avoid-list words", () => {
  for (const quote of QUOTES) {
    assert.deepEqual(findToneProblems(quote.text), [], quote.id);
  }
});

test("docs/money-insights-copy.md lists every line and is up to date", async () => {
  const doc = await readFile(DOC_PATH, "utf8");
  assert.equal(doc, renderCheckInCopyMarkdown(), "Run: npx tsx scripts/money-insights-copy.mjs");
  for (const quote of QUOTES) {
    assert.ok(doc.includes(quote.text), quote.id);
  }
});
