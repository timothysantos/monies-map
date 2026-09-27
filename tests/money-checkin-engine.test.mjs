// The money check-in engine: ranking, rests, what changed, "sorted", quiet
// visits, and what rotates by period (wording, long view, Just for fun,
// quote). Visits are simulated with explicit clocks and the memory each
// visit leaves behind; tests/money-insights-year-rotation.test.mjs walks
// the year rule over real page signals.
import assert from "node:assert/strict";
import test from "node:test";

import {
  QUIET_LINES,
  composeCheckIn,
  emptyVisitMemory,
  normalizeVisitMemory,
  pickQuote as pickQuoteFrom,
  rankSignals,
  recordVisit
} from "../src/domain/money-signals/checkin.ts";
import { monthPhase } from "../src/domain/money-signals/format.ts";
import { QUOTES, quoteCitation } from "../src/domain/money-signals/quotes.ts";

const pickQuote = (...args) => pickQuoteFrom(QUOTES, ...args);

const DAY = 86_400_000;
const MON = Date.parse("2026-08-03T09:00:00+08:00");

function signal(key, kind, weight, extra = {}) {
  return {
    key,
    kind,
    weight,
    numbers: { primaryMinor: weight },
    primaryText: `$${(weight / 100).toFixed(2)}`,
    phrasings: [
      { fact: `${key} A`, think: `${key} think` },
      { fact: `${key} B`, think: `${key} think` },
      { fact: `${key} C`, think: `${key} think` }
    ],
    ...extra
  };
}

const ROTATION = { columns: Array.from({ length: 12 }, (_, index) => [`type-${index}`]) };

function trivia(type, fact, extra = {}) {
  return { ...signal(`${type}:detail`, "just_for_fun", 0, { phrasings: [{ fact, think: "" }] }), triviaType: type, ...extra };
}

// One visit: compose from the memory, then record what was shown.
function visit(signals, memory, nowMs, { contextKey = "2026-08", seed = "month:person-serene", period = contextKey, triviaRotation = ROTATION } = {}) {
  const today = new Date(nowMs + 8 * 3_600_000).toISOString().slice(0, 10);
  const view = composeCheckIn({ signals, memory, nowMs, today, seed, contextKey, period, triviaRotation, calmLine: "Nothing in August needs a look right now." });
  return { view, memory: recordVisit(memory, view, signals, { nowMs, today, contextKey }) };
}

test("the headline is ranked by kind, then money involved, then not recently seen", () => {
  const signals = [
    signal("going-well", "going_well", 900_000),
    signal("worth-small", "worth_a_look", 2_000),
    signal("worth-big", "worth_a_look", 9_000),
    signal("quick-fix", "quick_fix", 1_000),
    signal("bigger", "bigger_question", 50_000),
    signal("long", "long_view", 5_000_000),
    signal("fun", "just_for_fun", 0)
  ];
  const ranked = rankSignals(signals, emptyVisitMemory(), MON).map((item) => item.key);
  assert.deepEqual(ranked, ["quick-fix", "bigger", "worth-big", "worth-small", "going-well"]);

  // Same kind and money: the one never shown before wins the tie.
  const memory = { ...emptyVisitMemory(), signals: { "tie-a": { at: MON - 10 * DAY, shownAt: MON - 10 * DAY, primaryMinor: 5_000 } } };
  assert.deepEqual(
    rankSignals([signal("tie-a", "worth_a_look", 5_000), signal("tie-b", "worth_a_look", 5_000)], memory, MON).map((item) => item.key),
    ["tie-b", "tie-a"]
  );
});

test("only one bigger question is ever kept, and a moment comes right after the bigger question", () => {
  const ranked = rankSignals([
    signal("bigger-1", "bigger_question", 90_000),
    signal("bigger-2", "bigger_question", 80_000),
    signal("payday", "going_well", 100, { moment: true }),
    signal("worth", "worth_a_look", 70_000),
    signal("fix", "quick_fix", 10)
  ], emptyVisitMemory(), MON).map((item) => item.key);
  assert.deepEqual(ranked, ["fix", "bigger-1", "payday", "worth"]);
});

test("a quick fix that yields to a bigger question goes right after it; without one it still leads", () => {
  const gap = signal("statement-gap:ocbc", "quick_fix", 4_280, { yieldsToBiggerQuestion: true });
  const bills = signal("unlinked-bills", "quick_fix", 18_298);
  const bigger = signal("one-off-over-plan", "bigger_question", 312_814);
  const worth = signal("category-over-plan:b1", "worth_a_look", 7_266);
  assert.deepEqual(
    rankSignals([gap, bigger, worth], emptyVisitMemory(), MON).map((item) => item.key),
    ["one-off-over-plan", "statement-gap:ocbc", "category-over-plan:b1"]
  );
  // Other quick fixes keep their rank ahead of the bigger question.
  assert.deepEqual(
    rankSignals([gap, bills, bigger], emptyVisitMemory(), MON).map((item) => item.key),
    ["unlinked-bills", "one-off-over-plan", "statement-gap:ocbc"]
  );
  // No bigger question: the statement gap leads as before.
  assert.deepEqual(
    rankSignals([gap, worth], emptyVisitMemory(), MON).map((item) => item.key),
    ["statement-gap:ocbc", "category-over-plan:b1"]
  );
});

test("a shown headline rests for a few days so another signal gets a turn, unless its numbers move", () => {
  const signals = [signal("plan-left", "going_well", 108_059), signal("savings", "going_well", 50_000)];
  const first = visit(signals, emptyVisitMemory(), MON);
  assert.equal(first.view.headline.key, "plan-left");

  // Four hours later something else changed (a new signal), so the visit is
  // not quiet: plan-left rests and savings leads.
  const withNew = [...signals, signal("subs", "going_well", 1_000)];
  const second = visit(withNew, first.memory, MON + 4 * 3_600_000);
  assert.equal(second.view.mode, "signal");
  assert.equal(second.view.headline.key, "savings");

  // Plan left moves by more than $50: it comes back early, leading with
  // the change.
  const moved = [signal("plan-left", "going_well", 98_000), signal("savings", "going_well", 50_000), signal("subs", "going_well", 1_000)];
  const third = visit(moved, second.memory, MON + 8 * 3_600_000);
  assert.equal(third.view.headline.key, "plan-left");
  assert.match(third.view.headline.fact, /^Down from \$1080\.59 since your last visit\. plan-left [ABC]$/);

  // After the rest period the first signal is back without any change.
  const later = visit(signals, first.memory, MON + 4 * DAY);
  assert.equal(later.view.headline.key, "plan-left");
});

test("a move under 10% and under $50 keeps a signal resting", () => {
  const first = visit([signal("gap", "worth_a_look", 4_280), signal("other", "worth_a_look", 1_000)], emptyVisitMemory(), MON);
  const nudged = [signal("gap", "worth_a_look", 4_100), signal("other", "worth_a_look", 1_000), signal("new", "going_well", 5)];
  const second = visit(nudged, first.memory, MON + DAY);
  assert.equal(second.view.headline.key, "other");
  assert.doesNotMatch(second.view.also.find((line) => line.key === "gap")?.fact ?? "", /since your last visit/);
});

test("the wording follows the period: the same month keeps its wording, the next month takes the next one", () => {
  const thinks = ["think 1", "think 2", "think 3", "think 4"];
  const only = [signal("plan-left", "going_well", 108_059, { phrasings: ["A", "B", "C"].map((fact) => ({ fact, think: thinks[0], thinks })) })];
  let memory = emptyVisitMemory();
  // Visits 4 days apart (past the rest and quiet windows) to the same month.
  const sameMonth = [];
  for (let index = 0; index < 3; index += 1) {
    const result = visit(only, memory, MON + index * 4 * DAY, { contextKey: "2026-08" });
    sameMonth.push(`${result.view.headline.fact}|${result.view.headline.think}`);
    memory = result.memory;
  }
  assert.equal(new Set(sameMonth).size, 1, sameMonth.join(", "));
  // Twelve consecutive months: twelve different sentences, fact first.
  const months = Array.from({ length: 12 }, (_, index) => `2026-${String(index + 1).padStart(2, "0")}`);
  const sentences = months.map((month) => visit(only, emptyVisitMemory(), MON, { contextKey: month }).view.headline);
  assert.equal(new Set(sentences.map((line) => `${line.fact}|${line.think}`)).size, 12);
  // 2026-01 is month number 24312, 24312 mod 12 = 0: the first wording.
  assert.deepEqual(sentences.slice(0, 4).map((line) => `${line.fact}|${line.think}`), ["A|think 1", "B|think 1", "C|think 1", "A|think 2"]);
});

test("the same inputs always compose the same check-in", () => {
  const signals = [signal("a", "quick_fix", 100), signal("b", "worth_a_look", 200), signal("t", "just_for_fun", 0)];
  const left = composeCheckIn({ signals, memory: emptyVisitMemory(), nowMs: MON, today: "2026-08-03", seed: "s", contextKey: "c", calmLine: "calm" });
  const right = composeCheckIn({ signals, memory: emptyVisitMemory(), nowMs: MON, today: "2026-08-03", seed: "s", contextKey: "c", calmLine: "calm" });
  assert.deepEqual(left, right);
});

test("a cleared quick fix is announced as sorted exactly once", () => {
  const gap = {
    ...signal("statement-gap:ocbc", "quick_fix", 4_280),
    sorted: { fact: "Sorted: your OCBC 365 Card now matches its statement.", think: "That's the part that makes every other number here trustworthy." }
  };
  const planLeft = signal("plan-left", "going_well", 108_059);
  const wednesday = visit([gap, planLeft], emptyVisitMemory(), MON + 2 * DAY);
  assert.equal(wednesday.view.headline.key, "statement-gap:ocbc");

  const friday = visit([planLeft], wednesday.memory, MON + 4 * DAY);
  assert.equal(friday.view.mode, "sorted");
  assert.deepEqual(
    [friday.view.headline.kind, friday.view.headline.fact, friday.view.headline.think],
    ["going_well", "Sorted: your OCBC 365 Card now matches its statement.", "That's the part that makes every other number here trustworthy."]
  );
  assert.deepEqual(friday.view.also.map((line) => line.key), ["plan-left"]);

  const saturday = visit([planLeft], friday.memory, MON + 5 * DAY + 2 * 3_600_000);
  assert.notEqual(saturday.view.mode, "sorted");
  assert.doesNotMatch(saturday.view.headline.fact, /Sorted/);
});

test("a quick fix that disappears in another context, or while data loads, is never called sorted", () => {
  const gap = { ...signal("statement-gap:ocbc", "quick_fix", 4_280), sorted: { fact: "Sorted: fixed.", think: "Good." } };
  const shown = visit([gap], emptyVisitMemory(), MON, { contextKey: "2026-08" });
  const otherMonth = visit([], shown.memory, MON + DAY, { contextKey: "2026-07" });
  assert.notEqual(otherMonth.view.mode, "sorted");

  const loading = composeCheckIn({ signals: [], memory: shown.memory, nowMs: MON + DAY, today: "2026-08-04", seed: "s", contextKey: "2026-08", calmLine: "calm", ready: false });
  assert.equal(loading.mode, "calm");
});

test("a visit soon after the last one with nothing new is one quiet line plus the month's trivia", () => {
  // August is month number 7 of 0 to 11: its column holds type-7.
  const signals = [signal("plan-left", "going_well", 108_059), trivia("type-7", "Most of your dining out this month happened on Fridays.")];
  const friday = visit(signals, emptyVisitMemory(), Date.parse("2026-08-14T12:00:00+08:00"));
  assert.equal(friday.view.mode, "signal");
  assert.deepEqual(friday.view.fun, { key: "type-7:detail", type: "type-7", text: "Most of your dining out this month happened on Fridays." });

  const sunday = visit(signals, friday.memory, Date.parse("2026-08-16T10:00:00+08:00"));
  assert.equal(sunday.view.mode, "quiet");
  assert.equal(sunday.view.headline.kind, null);
  assert.ok(QUIET_LINES.map((line) => line.replace("{when}", "Friday")).includes(sunday.view.headline.fact), sunday.view.headline.fact);
  assert.equal(sunday.view.headline.think, "");
  // The same month keeps its trivia: a revisit is never a new period.
  assert.equal(sunday.view.fun.text, "Most of your dining out this month happened on Fridays.");
  assert.deepEqual(sunday.view.also.map((line) => line.key), ["plan-left"]);

  // Two quiet visits never follow each other: the next one rotates.
  const monday = visit(signals.slice(0, 1), sunday.memory, Date.parse("2026-08-17T10:00:00+08:00"));
  assert.equal(monday.view.mode, "signal");

  // Earlier the same day and yesterday read naturally.
  const sameDay = visit(signals.slice(0, 1), friday.memory, Date.parse("2026-08-14T18:00:00+08:00"));
  assert.match(sameDay.view.headline.fact, /earlier today/);
  const nextDay = visit(signals.slice(0, 1), friday.memory, Date.parse("2026-08-15T09:00:00+08:00"));
  assert.match(nextDay.view.headline.fact, /yesterday/);
});

test("anything new or moved since the last visit means the visit is not quiet", () => {
  const base = [signal("plan-left", "going_well", 108_059)];
  const first = visit(base, emptyVisitMemory(), MON);
  assert.equal(visit([...base, signal("subs", "worth_a_look", 7_609)], first.memory, MON + DAY).view.mode, "signal");
  assert.equal(visit([signal("plan-left", "going_well", 90_000)], first.memory, MON + DAY).view.mode, "signal");
  assert.equal(visit(base, first.memory, MON + 4 * DAY).view.mode, "signal");
});

test("no headline signal gives the page's calm line, with trivia and the long view still shown", () => {
  const result = visit([
    signal("keep-rate", "long_view", 10_000_000),
    trivia("type-7", "About one in every eight dollars in September went to groceries.")
  ], emptyVisitMemory(), MON);
  assert.equal(result.view.mode, "calm");
  assert.deepEqual([result.view.headline.kind, result.view.headline.fact], [null, "Nothing in August needs a look right now."]);
  assert.equal(result.view.longView.key, "keep-rate");
  assert.equal(result.view.fun.type, "type-7");
});

test("the calm line follows the month: twelve months, twelve lines", () => {
  const calmLines = Array.from({ length: 12 }, (_, index) => `Calm ${index}.`);
  const shown = Array.from({ length: 12 }, (_, index) => composeCheckIn({
    signals: [], memory: emptyVisitMemory(), nowMs: MON, today: "2026-08-03", seed: "s", contextKey: "c", period: `2027-${String(index + 1).padStart(2, "0")}`, calmLines
  }).headline.fact);
  assert.deepEqual(shown, calmLines);
});

test("trivia never sits beside a bigger question, and only the month's column may show", () => {
  const fun = trivia("type-7", "Trivia A.");
  const bigger = visit([signal("over", "bigger_question", 312_814), fun], emptyVisitMemory(), MON);
  assert.equal(bigger.view.headline.kind, "bigger_question");
  assert.equal(bigger.view.fun, null);
  assert.equal(bigger.view.quoteTopic, null);

  const calm = [signal("plan-left", "going_well", 100), fun, trivia("type-8", "Trivia B.")];
  assert.equal(visit(calm, emptyVisitMemory(), MON, { contextKey: "2026-08" }).view.fun.type, "type-7");
  assert.equal(visit(calm, emptyVisitMemory(), MON, { contextKey: "2026-09" }).view.fun.type, "type-8");
  // October's type cannot fire and there is no reserve: no trivia rather
  // than another month's.
  assert.equal(visit(calm, emptyVisitMemory(), MON, { contextKey: "2026-10" }).view.fun, null);
  // Without a rotation there is no trivia at all.
  assert.equal(visit(calm, emptyVisitMemory(), MON, { triviaRotation: null }).view.fun, null);
});

test("no quote may show beside a bigger question in the also list either", () => {
  const view = visit([signal("fix", "quick_fix", 100, { topic: "later" }), signal("over", "bigger_question", 312_814)], emptyVisitMemory(), MON).view;
  assert.equal(view.headline.key, "fix");
  assert.equal(view.quoteTopic, null);
  const calm = visit([signal("plan-left", "going_well", 100, { topic: "enjoy" })], emptyVisitMemory(), MON).view;
  assert.equal(calm.quoteTopic, "enjoy");
});

test("the also list holds up to three more signals, each in its plain first phrasing", () => {
  const view = visit([
    signal("a", "quick_fix", 1), signal("b", "worth_a_look", 4), signal("c", "worth_a_look", 3), signal("d", "going_well", 2), signal("e", "going_well", 1)
  ], emptyVisitMemory(), MON).view;
  assert.deepEqual(view.also, [
    { key: "b", kind: "worth_a_look", fact: "b A" },
    { key: "c", kind: "worth_a_look", fact: "c A" },
    { key: "d", kind: "going_well", fact: "d A" }
  ]);
});

test("the long view that leads takes turns by month, and a seasonal moment goes first", () => {
  const longViews = [signal("keep-rate", "long_view", 1), signal("cushion", "long_view", 2), signal("same-season", "long_view", 3)];
  // 2026-12 is month number 24323, and 24323 mod 3 = 2.
  const shown = ["2026-12", "2027-01", "2027-02", "2027-03"].map((month) => visit(longViews, emptyVisitMemory(), MON, { contextKey: month }).view.longView.key);
  assert.deepEqual(shown, ["same-season", "keep-rate", "cushion", "same-season"]);
  // Revisiting a month keeps its long view, whatever the memory says.
  const first = visit(longViews, emptyVisitMemory(), MON, { contextKey: "2027-01" });
  assert.equal(visit(longViews, first.memory, MON + 4 * DAY, { contextKey: "2027-01" }).view.longView.key, "keep-rate");
  const withSeason = visit([...longViews, signal("chinese-new-year:2027", "long_view", 4, { moment: true })], emptyVisitMemory(), MON + 20 * DAY);
  assert.equal(withSeason.view.longView.key, "chinese-new-year:2027");
});

test("the time of month picks the phase: early, mid, late, a past month, a month ahead", () => {
  assert.equal(monthPhase("2026-08", "2026-08-03"), "early");
  assert.equal(monthPhase("2026-08", "2026-08-10"), "early");
  assert.equal(monthPhase("2026-08", "2026-08-12"), "mid");
  assert.equal(monthPhase("2026-08", "2026-08-21"), "late");
  assert.equal(monthPhase("2026-07", "2026-08-03"), "past");
  assert.equal(monthPhase("2026-09", "2026-08-03"), "ahead");
});

test("stored memory that is missing or malformed starts fresh instead of failing", () => {
  for (const stored of [null, undefined, "text", 42, [], { v: 2 }, { v: 1, signals: "x", trivia: [1], quotes: null }]) {
    const memory = normalizeVisitMemory(stored);
    assert.equal(memory.v, 1);
    assert.deepEqual(memory.signals, {});
    assert.deepEqual(memory.quickFixes, {});
  }
  // Older memory kept trivia and quote times and phrasings: all dropped,
  // since what rotates now follows the period.
  const kept = normalizeVisitMemory({ v: 1, lastVisitAt: MON, signals: { a: { at: MON, primaryMinor: 5, phrasing: 1 }, bad: { at: "x" } }, trivia: { t: MON, u: "no" }, quotes: { q: MON } });
  assert.deepEqual(Object.keys(kept.signals), ["a"]);
  assert.deepEqual(kept.signals.a, { at: MON, shownAt: undefined, primaryMinor: 5, primaryText: undefined });
  assert.equal("trivia" in kept, false);
  assert.equal("quotes" in kept, false);
});

test("the quote library has at least 36 sourced, distinct, public-domain quotes, with a calm one in every column", () => {
  assert.ok(QUOTES.length >= 36, `${QUOTES.length} quotes`);
  for (let column = 0; column < 12; column += 1) {
    const inColumn = QUOTES.filter((_quote, index) => index % 12 === column);
    assert.ok(inColumn.length >= 3, `column ${column}: ${inColumn.length} quotes`);
    assert.ok(inColumn.some((quote) => quote.topics.includes("calm")), `column ${column} has no calm quote`);
  }
  assert.equal(new Set(QUOTES.map((quote) => quote.id)).size, QUOTES.length);
  assert.equal(new Set(QUOTES.map((quote) => quote.text)).size, QUOTES.length);
  for (const quote of QUOTES) {
    assert.ok(quote.author && quote.work && quote.year && quote.source && quote.topics.length, quote.id);
    assert.ok(Number(quote.year.replace(/^c\. /, "")) < 1930, `${quote.id} is not clearly public domain`);
  }
  assert.equal(quoteCitation(QUOTES.find((quote) => quote.id === "dickens-micawber")), "Mr Micawber, in Charles Dickens, David Copperfield");
  assert.equal(quoteCitation(QUOTES.find((quote) => quote.id === "thoreau-cost-of-a-thing")), "Henry David Thoreau, Walden");
});

test("a quote comes from the page's column for the month: the topic's quote, else the calm one", () => {
  // Summary reads column (month number + 0) mod 12; 2026-08 is month
  // number 24319, so column 7: Seneca, Austen, Austen.
  const column = QUOTES.filter((_quote, index) => index % 12 === 7);
  assert.deepEqual(column.map((quote) => quote.id), ["seneca-craves-more", "austen-wealth-or-grandeur", "austen-large-income"]);
  assert.equal(pickQuote("enjoy", { page: "summary", period: "2026-08" }).id, "austen-wealth-or-grandeur");
  assert.equal(pickQuote("enough", { page: "summary", period: "2026-08" }).id, "seneca-craves-more");
  // No quote in the column fits: the calm one.
  assert.equal(pickQuote("settle", { page: "summary", period: "2026-08" }).id, "seneca-craves-more");
  // A column with no fitting and no calm quote shows none.
  assert.equal(pickQuoteFrom([{ id: "x", text: "X", author: "A", work: "W", year: "1800", source: "S", topics: ["plan"] }], "enjoy", { page: "summary", period: "2026-01" }), null);
  // Month reads three columns on: a different quote in the same month.
  assert.notEqual(pickQuote("enjoy", { page: "month", period: "2026-08" }).id, pickQuote("enjoy", { page: "summary", period: "2026-08" }).id);
});
