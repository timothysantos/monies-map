// The year rule for Money insights: for one page and view, nothing that
// rotates (the Just for fun line, a recurring signal's wording, the long
// view, the quote, the calm line) repeats within twelve consecutive
// periods, chosen from the period itself rather than visit time or browser
// memory. Walks two years of realistic months on every page.
import assert from "node:assert/strict";
import test from "node:test";

import * as checkin from "../src/domain/money-signals/checkin.ts";
import * as entriesSignals from "../src/domain/money-signals/entries-signals.ts";
import { buildMonthSignals, MONTH_TRIVIA_ROTATION, monthCalmLines } from "../src/domain/money-signals/month-signals.ts";
import { QUOTES } from "../src/domain/money-signals/quotes.ts";
import { periodIndex, pickTrivia, scheduledTriviaTypes, wordingsOf, YEAR_MONTHS } from "../src/domain/money-signals/rotation.ts";
import { buildSplitsSignals, SPLITS_CALM_LINES, SPLITS_TRIVIA_ROTATION } from "../src/domain/money-signals/splits-signals.ts";
import { buildSummarySignals, SUMMARY_CALM_LINES, SUMMARY_TRIVIA_ROTATION } from "../src/domain/money-signals/summary-signals.ts";
import { readVisitMemory } from "../src/client/checkin-visit-memory.js";
import { consecutiveMonths, entriesInput, monthInput, splitsInput, summaryInput } from "./support/insight-year-fixture.mjs";

const { composeCheckIn, emptyVisitMemory, pickQuote, recordVisit } = checkin;
const { buildEntriesSignals, ENTRIES_CALM_LINES, ENTRIES_TRIVIA_ROTATION } = entriesSignals;
const NOW = Date.parse("2028-06-01T10:00:00+08:00");

// Someone stepping back month after month on Entries in one sitting, each
// visit remembered in the browser as the page does.
test("Entries: twelve consecutive months show twelve different Just for fun lines (the reported bug)", () => {
  const today = "2026-09-27";
  let memory = emptyVisitMemory();
  const shown = consecutiveMonths("2025-09", 12).reverse().map((month, index) => {
    const nowMs = Date.parse(`${today}T10:00:00+08:00`) + index * 60_000;
    const signals = entriesSignals.buildEntriesSignals(entriesInput(month, { today }));
    const input = {
      signals,
      memory,
      nowMs,
      today,
      seed: `entries:household|${month}|all`,
      contextKey: `${month}|all`,
      calmLines: entriesSignals.ENTRIES_CALM_LINES,
      calmLine: entriesSignals.ENTRIES_CALM_LINE,
      page: "entries",
      period: month,
      triviaRotation: entriesSignals.ENTRIES_TRIVIA_ROTATION
    };
    const view = composeCheckIn(input);
    memory = recordVisit(memory, view, signals, { nowMs, today, contextKey: input.contextKey });
    return { month, type: view.fun?.type ?? view.fun?.key?.split(":")[0] ?? null, text: view.fun?.text ?? null };
  });
  const missing = shown.filter((line) => !line.text).map((line) => line.month);
  assert.deepEqual(missing, [], "every month with entries has a Just for fun line");
  const types = shown.map((line) => line.type);
  assert.equal(new Set(types).size, 12, `types shown: ${types.join(", ")}`);
  assert.equal(new Set(shown.map((line) => line.text)).size, 12);
});

// Each page's view of a period, composed the way the page does, with no
// browser memory at all.
const PAGES = {
  summary: {
    rotation: SUMMARY_TRIVIA_ROTATION,
    calmLines: () => SUMMARY_CALM_LINES,
    build: (period, { flat, reconciled }) => {
      const input = summaryInput(period, { flat, reconciled });
      return { signals: buildSummarySignals(input), today: input.today };
    }
  },
  month: {
    rotation: MONTH_TRIVIA_ROTATION,
    calmLines: (period) => monthCalmLines(period),
    build: (period, { flat, reconciled, today = "2027-02-15" }) => ({ signals: buildMonthSignals(monthInput(period, { flat, reconciled, today })), today })
  },
  entries: {
    rotation: ENTRIES_TRIVIA_ROTATION,
    calmLines: () => ENTRIES_CALM_LINES,
    build: (period, { flat, today = "2027-02-15" }) => ({ signals: buildEntriesSignals(entriesInput(period, { flat, today })), today })
  },
  splits: {
    rotation: SPLITS_TRIVIA_ROTATION,
    calmLines: () => SPLITS_CALM_LINES,
    build: (period, { audience = "person" }) => {
      const today = `${period}-15`;
      const view = audience === "person" ? {} : { audience: "household", viewId: "household", viewLabel: "Household" };
      return { signals: buildSplitsSignals(splitsInput(today, view)), today };
    }
  }
};

function viewFor(page, period, options = {}, memory = emptyVisitMemory(), nowMs = NOW) {
  const { rotation, calmLines, build } = PAGES[page];
  const { signals, today } = build(period, options);
  const view = composeCheckIn({ signals, memory, nowMs, today, seed: `${page}:household|${period}`, contextKey: period, period, triviaRotation: rotation, calmLines: calmLines(period) });
  const quote = view.quoteTopic ? pickQuote(QUOTES, view.quoteTopic, { page, period }) : null;
  return { view, signals, quote };
}

// Everything that rotates, as the strings the rule compares. A signal's
// wording is keyed by its family (the key before ":") and the wording
// number, and also compared as the exact sentence shown.
function rotatingItems({ view, quote }) {
  const family = (key) => key.split(":")[0];
  return {
    trivia: view.fun?.type ?? null,
    triviaText: view.fun?.text ?? null,
    quote: quote?.id ?? null,
    longView: view.longView ? `${family(view.longView.key)}#${view.longViewWording}` : null,
    longViewText: view.longView ? `${view.longView.fact} ${view.longView.think}` : null,
    headline: view.mode === "signal" ? `${family(view.headline.key)}#${view.headlineWording}` : null,
    headlineText: view.mode === "signal" ? `${view.headline.fact} ${view.headline.think}` : null,
    calm: view.mode === "calm" ? view.headline.fact : null
  };
}

// Every window of twelve consecutive periods: no item appears twice.
function repeatsWithinAYear(series) {
  const repeats = [];
  series.forEach((item, index) => {
    if (item === null) {
      return;
    }
    const earlier = series.slice(Math.max(0, index - (YEAR_MONTHS - 1)), index);
    const at = earlier.lastIndexOf(item);
    if (at >= 0) {
      repeats.push(`${item} at periods ${index - earlier.length + at} and ${index}`);
    }
  });
  return repeats;
}

const WALK = consecutiveMonths("2025-01", 24);

// What makes a headline notable on its own facts, restated from the
// thresholds (docs/developer-guide.md, "Notability"). A quick fix or a
// bigger question needs attention every time it fires. Anything else that
// leads more than 4 of 12 consecutive months must be notable each time.
const MAX_ROUTINE_LEADS = 4;
const NOTABLE = {
  "category-over-plan": (signal) => signal.numbers.primaryMinor >= 2_000 && signal.numbers.primaryMinor >= signal.numbers.plannedMinor * 0.1,
  "top-five": (signal) => signal.numbers.oneOffMinor >= signal.numbers.totalMinor * 0.25,
  subscriptions: (signal) => signal.numbers.previousMinor !== undefined
    && (signal.numbers.previousMinor === 0 || Math.abs(signal.numbers.primaryMinor - signal.numbers.previousMinor) >= 2_000 || Math.abs(signal.numbers.primaryMinor - signal.numbers.previousMinor) / signal.numbers.previousMinor >= 0.1),
  "months-under-plan": (signal) => signal.numbers.backUnder === 1
};
const family = (key) => key.split(":")[0];

function isNotableLead(view, signals) {
  if (view.mode !== "signal") {
    return true;
  }
  const signal = signals.find((candidate) => candidate.key === view.headline.key);
  if (["quick_fix", "bigger_question"].includes(signal.kind)) {
    return true;
  }
  return NOTABLE[family(signal.key)]?.(signal) ?? false;
}

// Families that lead more than 4 of some 12 consecutive months without
// being notable each of those times.
function routineLeaders(walk) {
  const found = new Set();
  for (let start = 0; start + YEAR_MONTHS <= walk.length; start += 1) {
    const window = walk.slice(start, start + YEAR_MONTHS);
    const byFamily = new Map();
    for (const { view, signals } of window) {
      if (view.mode === "signal") {
        const key = family(view.headline.key);
        byFamily.set(key, [...(byFamily.get(key) ?? []), isNotableLead(view, signals)]);
      }
    }
    for (const [key, notable] of byFamily) {
      if (notable.length > MAX_ROUTINE_LEADS && notable.some((value) => !value)) {
        found.add(`${key}: ${notable.length} of 12 from ${WALK[start]}, ${notable.filter((value) => !value).length} not notable`);
      }
    }
  }
  return [...found];
}

for (const [page, variants] of [
  ["summary", [{}, { reconciled: true }]],
  ["month", [{}, { reconciled: true }]],
  ["entries", [{}]],
  ["splits", [{ audience: "person" }, { audience: "household" }]]
]) {
  for (const options of variants) {
    for (const flat of [false, true]) {
      const label = `${page}${options.audience ? ` (${options.audience})` : ""}${options.reconciled ? ", every wallet reconciled" : ""}${flat ? ", the same data every month" : ""}`;
      test(`${label}: over 24 months nothing that rotates repeats within any 12`, () => {
        const views = WALK.map((period) => viewFor(page, period, { ...options, flat }));
        const walk = views.map(rotatingItems);
        for (const field of ["trivia", "triviaText", "quote", "longView", "longViewText", "headline", "headlineText", "calm"]) {
          assert.deepEqual(repeatsWithinAYear(walk.map((item) => item[field])), [], `${label} ${field}`);
        }
        // The rule is not met by showing nothing: trivia and quotes show
        // in almost every month.
        const withTrivia = walk.filter((item) => item.trivia).length;
        const withQuote = walk.filter((item) => item.quote).length;
        assert.ok(withTrivia >= 22, `${label}: trivia in ${withTrivia} of 24 months`);
        assert.ok(withQuote >= 22, `${label}: a quote in ${withQuote} of 24 months`);
        // Nothing that is true every month leads every month.
        assert.deepEqual(routineLeaders(views), [], `${label}: ${views.map(({ view }) => (view.mode === "signal" ? family(view.headline.key) : view.mode)).join(" ")}`);
      });
    }
  }
}

// The negative: with notability switched off (every signal counted as
// notable, as before), the same walk finds the always-true signals leading
// month after month, so the assertion above has teeth.
test("without notability, always-true signals lead month after month", () => {
  const unsteady = (signals) => signals.map((signal) => ({ ...signal, steady: false }));
  const walkWithout = (page, options) => WALK.map((period) => {
    const { rotation, calmLines, build } = PAGES[page];
    const { signals, today } = build(period, options);
    const all = unsteady(signals);
    return { view: composeCheckIn({ signals: all, memory: emptyVisitMemory(), nowMs: NOW, today, seed: `${page}:household|${period}`, contextKey: period, period, triviaRotation: rotation, calmLines: calmLines(period) }), signals: all };
  });
  const summary = routineLeaders(walkWithout("summary", { reconciled: true, flat: false }));
  assert.ok(summary.some((line) => line.startsWith("subscriptions:")), summary.join(" | "));
  // The reported bug: the five largest entries led Entries most months.
  const entries = routineLeaders(walkWithout("entries", { flat: false }));
  assert.ok(entries.some((line) => line.startsWith("top-five:")), entries.join(" | "));
});

test("every recurring signal the pages build over two years has at least 12 wordings", () => {
  const short = new Set();
  for (const page of Object.keys(PAGES)) {
    for (const period of WALK) {
      for (const flat of [false, true]) {
        for (const signal of viewFor(page, period, { flat }).signals) {
          if (signal.kind !== "just_for_fun" && wordingsOf(signal).length < YEAR_MONTHS) {
            short.add(`${page} ${signal.key}: ${wordingsOf(signal).length}`);
          }
        }
      }
    }
  }
  assert.deepEqual([...short], []);
});

test("Month and Entries never show the same trivia or quote for the same month and view", () => {
  for (const period of WALK) {
    const month = rotatingItems(viewFor("month", period));
    const entries = rotatingItems(viewFor("entries", period));
    assert.ok(month.triviaText && entries.triviaText, period);
    assert.notEqual(month.triviaText, entries.triviaText, period);
    assert.notEqual(month.trivia, entries.trivia, period);
    assert.notEqual(month.quote, entries.quote, period);
  }
});

test("the four pages never show the same quote in the same month", () => {
  for (const period of WALK) {
    const quotes = Object.keys(PAGES).map((page) => rotatingItems(viewFor(page, period)).quote).filter(Boolean);
    assert.equal(new Set(quotes).size, quotes.length, `${period}: ${quotes.join(", ")}`);
  }
});

// The proof, by exhaustion over the schedule itself: whatever types can
// fire in each period (every subset, chosen at random for ten years of
// periods, many times over), the type shown never comes back within
// twelve periods, because two periods less than twelve apart read
// different columns and every type sits in one column only.
test("the schedule itself cannot repeat a trivia type within a year, whatever can fire", () => {
  let seed = 7;
  const random = () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };
  for (const [page, rotation] of [["summary", SUMMARY_TRIVIA_ROTATION], ["month", MONTH_TRIVIA_ROTATION], ["entries", ENTRIES_TRIVIA_ROTATION], ["splits", SPLITS_TRIVIA_ROTATION]]) {
    const types = rotation.columns.flat();
    assert.equal(rotation.columns.length, YEAR_MONTHS, page);
    assert.ok(types.length >= YEAR_MONTHS, `${page}: ${types.length} types`);
    assert.equal(new Set(types).size, types.length, `${page}: a type sits in two columns`);
    assert.ok((rotation.moments ?? []).every((type) => !types.includes(type)), `${page}: a moment sits in a column`);
    for (let run = 0; run < 50; run += 1) {
      const shown = consecutiveMonths("2024-01", 120).map((period) => {
        const signals = types.filter(() => random() < 0.6).map((type) => ({ key: type, kind: "just_for_fun", triviaType: type, weight: 0, numbers: { primaryMinor: 0 }, phrasings: [{ fact: type, think: "" }] }));
        return pickTrivia(signals, rotation, period)?.triviaType ?? null;
      });
      assert.deepEqual(repeatsWithinAYear(shown), [], `${page} run ${run}`);
    }
  }
});

test("a scheduled type that cannot fire falls to its column's reserve, and with none left there is no trivia", () => {
  // Entries, August 2026 (month number 24319; column 7 is
  // "category-count" alone; column 0 is "smallest" then "one-off-places").
  assert.deepEqual(scheduledTriviaTypes(ENTRIES_TRIVIA_ROTATION, "2026-08"), ["category-count"]);
  assert.deepEqual(scheduledTriviaTypes(ENTRIES_TRIVIA_ROTATION, "2026-01"), ["smallest", "one-off-places"]);
  // The next year the reserve goes first, so January is not always the
  // same type.
  assert.deepEqual(scheduledTriviaTypes(ENTRIES_TRIVIA_ROTATION, "2027-01"), ["one-off-places", "smallest"]);

  // Every type in the page can fire in this made-up month.
  const everyType = ENTRIES_TRIVIA_ROTATION.columns.flat().map((type) => ({ key: `${type}:x`, kind: "just_for_fun", triviaType: type, weight: 0, numbers: { primaryMinor: 0 }, phrasings: [{ fact: type, think: "" }] }));
  assert.equal(pickTrivia(everyType, ENTRIES_TRIVIA_ROTATION, "2026-01").triviaType, "smallest");
  const withoutSmallest = everyType.filter((signal) => signal.triviaType !== "smallest");
  assert.equal(pickTrivia(withoutSmallest, ENTRIES_TRIVIA_ROTATION, "2026-01").triviaType, "one-off-places");
  // Neither can fire: no trivia, even though ten other types could.
  const neither = withoutSmallest.filter((signal) => signal.triviaType !== "one-off-places");
  assert.equal(neither.length, 16);
  assert.equal(pickTrivia(neither, ENTRIES_TRIVIA_ROTATION, "2026-01"), null);
  // A reserve used in January is in no other column: it cannot come back
  // in the eleven months either side.
  const otherColumns = ENTRIES_TRIVIA_ROTATION.columns.filter((_column, index) => index !== 0).flat();
  assert.equal(otherColumns.includes("one-off-places"), false);

  // In real data: the Japan trip's first date has two costs, so June's
  // "first shared cost" says the first day instead; with only one cost
  // that day it names it.
  const june = viewFor("splits", "2026-06");
  assert.equal(june.view.fun.type, "first-cost");
  assert.equal(june.view.fun.text, "Shared costs on the Japan trip began on Sat 4 Apr, with 2 that day.");

  // Splits' household view never compares partners, so February's payer
  // line falls to its reserve.
  const household = viewFor("splits", "2026-02", { audience: "household" });
  const person = viewFor("splits", "2026-02", { audience: "person" });
  assert.equal(person.view.fun.type, "payer");
  assert.equal(household.view.fun.type, "weekday-most");
});

test("moments fire in at most one period of any twelve and go ahead of the column", () => {
  // A year recap only for a range ending in December.
  const recaps = WALK.filter((period) => buildSummarySignals(summaryInput(period)).some((signal) => signal.triviaType === "year-recap"));
  assert.deepEqual(recaps, ["2025-12", "2026-12"]);
  assert.equal(viewFor("summary", "2025-12").view.fun.type, "year-recap");
  // An anniversary only on a range ending this month.
  const anniversaryToday = "2026-01-10";
  const anniversaries = WALK.filter((period) => buildSummarySignals(summaryInput(period, { today: anniversaryToday })).some((signal) => signal.triviaType === "anniversary"));
  assert.deepEqual(anniversaries, ["2026-01"]);
});

test("the same period gives the same check-in with storage missing, throwing or full of other visits", () => {
  const throwing = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.deepEqual(readVisitMemory("entries:household", throwing), emptyVisitMemory());
  assert.deepEqual(readVisitMemory("entries:household", null), emptyVisitMemory());
  for (const page of Object.keys(PAGES)) {
    // A browser that visited the eleven months before, all this morning.
    let memory = emptyVisitMemory();
    for (const [index, period] of consecutiveMonths("2025-09", 11).entries()) {
      const { view, signals } = viewFor(page, period, {}, memory, NOW - (12 - index) * 60_000);
      memory = recordVisit(memory, view, signals, { nowMs: NOW - (12 - index) * 60_000, today: "2028-06-01", contextKey: period });
    }
    const fresh = viewFor(page, "2026-08", {}, emptyVisitMemory());
    const remembered = viewFor(page, "2026-08", {}, memory);
    const blocked = viewFor(page, "2026-08", {}, readVisitMemory(`${page}:household`, throwing));
    assert.deepEqual(blocked.view, fresh.view, page);
    // Memory may add a rest to the headline, never change what rotates.
    assert.deepEqual(remembered.view.fun, fresh.view.fun, page);
    assert.deepEqual(remembered.view.longView, fresh.view.longView, page);
    assert.deepEqual(remembered.quote?.id, fresh.quote?.id, page);
    if (remembered.view.headline.key === fresh.view.headline.key) {
      assert.equal(remembered.view.headlineWording, fresh.view.headlineWording, page);
    }
  }
});

test("revisiting the same month keeps the same-visit rules: rest, quiet, sorted", () => {
  const period = "2026-08";
  const { signals, today } = PAGES.month.build(period, {});
  const compose = (memory, nowMs, list = signals) => composeCheckIn({ signals: list, memory, nowMs, today, seed: "month:household", contextKey: period, period, triviaRotation: MONTH_TRIVIA_ROTATION, calmLines: monthCalmLines(period) });
  const first = compose(emptyVisitMemory(), NOW);
  const afterFirst = recordVisit(emptyVisitMemory(), first, signals, { nowMs: NOW, today, contextKey: period });
  // An hour later, nothing new: one quiet line, the same trivia.
  const quiet = compose(afterFirst, NOW + 3_600_000);
  assert.equal(quiet.mode, "quiet");
  assert.deepEqual(quiet.fun, first.fun);
  // Something new a day later: the headline shown yesterday rests.
  const afterQuiet = recordVisit(afterFirst, quiet, signals, { nowMs: NOW + 3_600_000, today, contextKey: period });
  const extra = { key: "extra", kind: "going_well", weight: 1, numbers: { primaryMinor: 1 }, phrasings: [{ fact: "Extra.", think: "More.", thinks: ["More."] }] };
  const rested = compose(afterQuiet, NOW + 86_400_000, [...signals, extra]);
  assert.equal(rested.mode, "signal");
  assert.notEqual(rested.headline.key, first.headline.key);
  // The card's statement matches again: "Sorted" once.
  const afterRested = recordVisit(afterQuiet, rested, [...signals, extra], { nowMs: NOW + 86_400_000, today, contextKey: period });
  const sorted = compose(afterRested, NOW + 2 * 86_400_000, signals.filter((signal) => !signal.key.startsWith("statement-gap")));
  assert.equal(sorted.mode, "sorted");
  assert.match(sorted.headline.fact, /^Sorted: Serene's OCBC 365 Card now matches its statement\.$/);
});

test("periods are running month numbers", () => {
  assert.equal(periodIndex("2026-01"), 2026 * 12);
  assert.equal(periodIndex("2026-12") + 1, periodIndex("2027-01"));
  assert.equal(periodIndex(undefined), 0);
});
