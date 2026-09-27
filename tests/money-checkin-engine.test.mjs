// The money check-in engine: ranking, rests, phrasing rotation, what
// changed, "sorted", quiet visits and the Just for fun line. Visits are
// simulated with explicit clocks and the memory each visit leaves behind.
import assert from "node:assert/strict";
import test from "node:test";

import {
  QUIET_LINES,
  composeCheckIn,
  emptyVisitMemory,
  normalizeVisitMemory,
  pickQuote as pickQuoteFrom,
  rankSignals,
  recordQuote,
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

// One visit: compose from the memory, then record what was shown.
function visit(signals, memory, nowMs, { contextKey = "2026-08", seed = "month:person-serene" } = {}) {
  const today = new Date(nowMs + 8 * 3_600_000).toISOString().slice(0, 10);
  const view = composeCheckIn({ signals, memory, nowMs, today, seed, contextKey, calmLine: "Nothing in August needs a look right now." });
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

test("the phrasing seen last time is never repeated on the next visit", () => {
  const only = [signal("plan-left", "going_well", 108_059)];
  let memory = emptyVisitMemory();
  const facts = [];
  // Visits 4 days apart: past the rest and quiet windows every time.
  for (let index = 0; index < 6; index += 1) {
    const result = visit(only, memory, MON + index * 4 * DAY);
    facts.push(result.view.headline.fact);
    memory = result.memory;
  }
  for (let index = 1; index < facts.length; index += 1) {
    assert.notEqual(facts[index], facts[index - 1], `visit ${index + 1} repeated "${facts[index]}"`);
  }
  assert.equal(new Set(facts).size, 3);
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

test("a visit soon after the last one with nothing new is one quiet line plus trivia", () => {
  const signals = [signal("plan-left", "going_well", 108_059), signal("fun:fridays", "just_for_fun", 0, { phrasings: [{ fact: "Most of your dining out this month happened on Fridays.", think: "" }] })];
  const friday = visit(signals, emptyVisitMemory(), Date.parse("2026-08-14T12:00:00+08:00"));
  assert.equal(friday.view.mode, "signal");
  assert.deepEqual(friday.view.fun, { key: "fun:fridays", text: "Most of your dining out this month happened on Fridays." });

  const sunday = visit(signals.filter((item) => item.kind !== "just_for_fun").concat(signal("fun:regular", "just_for_fun", 0, { phrasings: [{ fact: "Your regular spot: Kopitiam, 9 visits in August.", think: "" }] })), friday.memory, Date.parse("2026-08-16T10:00:00+08:00"));
  assert.equal(sunday.view.mode, "quiet");
  assert.equal(sunday.view.headline.kind, null);
  assert.ok(QUIET_LINES.map((line) => line.replace("{when}", "Friday")).includes(sunday.view.headline.fact), sunday.view.headline.fact);
  assert.equal(sunday.view.headline.think, "");
  assert.equal(sunday.view.fun.text, "Your regular spot: Kopitiam, 9 visits in August.");
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
    signal("fun", "just_for_fun", 0, { phrasings: [{ fact: "About one in every eight dollars in September went to groceries.", think: "" }] })
  ], emptyVisitMemory(), MON);
  assert.equal(result.view.mode, "calm");
  assert.deepEqual([result.view.headline.kind, result.view.headline.fact], [null, "Nothing in August needs a look right now."]);
  assert.equal(result.view.longView.key, "keep-rate");
  assert.equal(result.view.fun.key, "fun");
});

test("trivia never sits beside a bigger question and does not repeat within 14 days", () => {
  const fun = signal("fun:a", "just_for_fun", 0, { phrasings: [{ fact: "Trivia A.", think: "" }] });
  const bigger = visit([signal("over", "bigger_question", 312_814), fun], emptyVisitMemory(), MON);
  assert.equal(bigger.view.headline.kind, "bigger_question");
  assert.equal(bigger.view.fun, null);
  assert.equal(bigger.view.quoteTopic, null);

  const calm = [signal("plan-left", "going_well", 100), fun];
  let result = visit(calm, emptyVisitMemory(), MON);
  assert.equal(result.view.fun.key, "fun:a");
  for (const day of [4, 8, 12]) {
    result = visit(calm, result.memory, MON + day * DAY);
    assert.equal(result.view.fun, null, `day ${day}`);
  }
  result = visit(calm, result.memory, MON + 15 * DAY);
  assert.equal(result.view.fun.key, "fun:a");
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

test("the long view rotates to the one shown least recently, and a seasonal moment goes first", () => {
  const longViews = [signal("keep-rate", "long_view", 1), signal("cushion", "long_view", 2), signal("same-season", "long_view", 3)];
  let memory = emptyVisitMemory();
  const shown = [];
  for (let index = 0; index < 3; index += 1) {
    const result = visit(longViews, memory, MON + index * 4 * DAY);
    shown.push(result.view.longView.key);
    memory = result.memory;
  }
  assert.deepEqual(shown, ["keep-rate", "cushion", "same-season"]);
  const withSeason = visit([...longViews, signal("chinese-new-year:2027", "long_view", 4, { moment: true })], memory, MON + 20 * DAY);
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
    assert.deepEqual(memory.trivia, {});
  }
  const kept = normalizeVisitMemory({ v: 1, lastVisitAt: MON, signals: { a: { at: MON, primaryMinor: 5, phrasing: 1 }, bad: { at: "x" } }, trivia: { t: MON, u: "no" } });
  assert.deepEqual(Object.keys(kept.signals), ["a"]);
  assert.deepEqual(kept.trivia, { t: MON });
});

test("the quote library has at least 20 sourced, distinct, public-domain quotes", () => {
  assert.ok(QUOTES.length >= 20, `${QUOTES.length} quotes`);
  assert.equal(new Set(QUOTES.map((quote) => quote.id)).size, QUOTES.length);
  assert.equal(new Set(QUOTES.map((quote) => quote.text)).size, QUOTES.length);
  for (const quote of QUOTES) {
    assert.ok(quote.author && quote.work && quote.year && quote.source && quote.topics.length, quote.id);
    assert.ok(Number(quote.year.replace(/^c\. /, "")) < 1930, `${quote.id} is not clearly public domain`);
  }
  assert.equal(quoteCitation(QUOTES.find((quote) => quote.id === "dickens-micawber")), "Mr Micawber, in Charles Dickens, David Copperfield");
  assert.equal(quoteCitation(QUOTES.find((quote) => quote.id === "thoreau-cost-of-a-thing")), "Henry David Thoreau, Walden");
});

test("a quote fits the topic and does not repeat within 28 days", () => {
  const first = pickQuote("small-costs", emptyVisitMemory(), MON, "seed");
  assert.ok(first.topics.includes("small-costs"));
  let memory = recordQuote(emptyVisitMemory(), first.id, MON);
  const second = pickQuote("small-costs", memory, MON + DAY, "seed");
  assert.notEqual(second.id, first.id);
  memory = recordQuote(memory, second.id, MON + DAY);
  // Every small-costs quote shown: a calm one instead.
  const third = pickQuote("small-costs", memory, MON + 2 * DAY, "seed");
  assert.ok(third.topics.includes("calm"));
  // After 28 days the first may come back.
  const allCalmShown = QUOTES.filter((quote) => quote.topics.includes("calm") || quote.topics.includes("small-costs"))
    .reduce((current, quote) => recordQuote(current, quote.id, MON), emptyVisitMemory());
  assert.equal(pickQuote("small-costs", allCalmShown, MON + 27 * DAY, "seed"), null);
  assert.ok(pickQuote("small-costs", allCalmShown, MON + 28 * DAY, "seed"));
});
