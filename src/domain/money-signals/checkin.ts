// Composes one visit's money check-in from a page's signals and the visit
// memory kept in the browser: ranking, rests, phrasing rotation, "what
// changed", "sorted", quiet visits and the Just for fun line. Pure and
// deterministic: `nowMs`, `today`, the memory and a stable seed are inputs,
// so the same inputs always give the same check-in.
import { fill, stableHash, weekdayName, daysBetween } from "./format";
import { HEADLINE_KIND_ORDER, type CheckInAction, type MoneySignal, type QuoteTopic, type SignalKind } from "./types";
import type { CheckInQuote } from "./quotes";

const DAY_MS = 86_400_000;
// A signal shown as the headline steps aside for a few days...
export const REST_MS = 3 * DAY_MS;
// ...unless its numbers move by 10% or $50.
export const MOVE_RATIO = 0.1;
export const MOVE_MINOR = 5_000;
// A visit within this window with nothing new is a quiet visit.
export const QUIET_MS = 3 * DAY_MS;
export const TRIVIA_REPEAT_MS = 14 * DAY_MS;
export const QUOTE_REPEAT_MS = 28 * DAY_MS;
const FORGET_MS = 90 * DAY_MS;
const MAX_ALSO = 3;

export interface SignalMemory {
  // Last visit the signal was present at.
  at: number;
  // Last time it led the check-in (headline or long view line).
  shownAt?: number;
  phrasing?: number;
  primaryMinor: number;
  primaryText?: string;
}

// What one browser remembers about one page + view (+ group): kept only in
// localStorage, never sent to the server or to AI.
export interface VisitMemory {
  v: 1;
  lastVisitAt?: number;
  lastVisitDay?: string;
  lastContextKey?: string;
  lastMode?: CheckInMode;
  lastKeys?: string[];
  quiet?: number;
  signals: Record<string, SignalMemory>;
  // Quick fixes seen and not yet announced as sorted, with what to say.
  quickFixes: Record<string, { fact: string; think: string }>;
  trivia: Record<string, number>;
  quotes: Record<string, number>;
}

export type CheckInMode = "signal" | "sorted" | "quiet" | "calm";

export interface CheckInLine {
  key: string;
  kind: SignalKind | null;
  fact: string;
  think: string;
  action?: CheckInAction;
}

export interface CheckInView {
  mode: CheckInMode;
  headline: CheckInLine;
  also: Array<{ key: string; kind: SignalKind; fact: string }>;
  longView: CheckInLine | null;
  fun: { key: string; text: string } | null;
  // The quote topic for the expanded view, or null when no quote may show
  // (never beside a bigger question).
  quoteTopic: QuoteTopic | null;
  // Internal choices recordVisit needs.
  headlinePhrasing: number | null;
  longViewPhrasing: number | null;
  sortedKey: string | null;
  quietIndex: number | null;
}

// Approved quiet-visit lines. {when} is "earlier today", "yesterday", a
// weekday, or "your last visit".
export const QUIET_LINES = [
  "Nothing new since {when}. The numbers here match your last visit.",
  "All quiet since {when}. Nothing here has moved.",
  "Same picture as {when}. Nothing new needs a look."
];

export function emptyVisitMemory(): VisitMemory {
  return { v: 1, signals: {}, quickFixes: {}, trivia: {}, quotes: {} };
}

// Stored memory is untrusted: anything malformed starts fresh.
export function normalizeVisitMemory(value: unknown): VisitMemory {
  if (!value || typeof value !== "object" || (value as { v?: unknown }).v !== 1) {
    return emptyVisitMemory();
  }
  const input = value as Record<string, unknown>;
  const record = (candidate: unknown) => (candidate && typeof candidate === "object" && !Array.isArray(candidate) ? candidate as Record<string, never> : {});
  const number = (candidate: unknown) => (typeof candidate === "number" && Number.isFinite(candidate) ? candidate : undefined);
  const signals: Record<string, SignalMemory> = {};
  for (const [key, entry] of Object.entries(record(input.signals))) {
    const item = entry as Record<string, unknown>;
    const at = number(item?.at);
    const primaryMinor = number(item?.primaryMinor);
    if (at === undefined || primaryMinor === undefined) {
      continue;
    }
    signals[key] = {
      at,
      shownAt: number(item.shownAt),
      phrasing: number(item.phrasing),
      primaryMinor,
      primaryText: typeof item.primaryText === "string" ? item.primaryText : undefined
    };
  }
  const quickFixes: VisitMemory["quickFixes"] = {};
  for (const [key, entry] of Object.entries(record(input.quickFixes))) {
    const item = entry as Record<string, unknown>;
    if (typeof item?.fact === "string" && typeof item?.think === "string") {
      quickFixes[key] = { fact: item.fact, think: item.think };
    }
  }
  const times = (candidate: unknown) => Object.fromEntries(
    Object.entries(record(candidate)).filter(([, at]) => number(at) !== undefined)
  ) as Record<string, number>;
  const modes: CheckInMode[] = ["signal", "sorted", "quiet", "calm"];
  return {
    v: 1,
    lastVisitAt: number(input.lastVisitAt),
    lastVisitDay: typeof input.lastVisitDay === "string" ? input.lastVisitDay : undefined,
    lastContextKey: typeof input.lastContextKey === "string" ? input.lastContextKey : undefined,
    lastMode: modes.includes(input.lastMode as CheckInMode) ? input.lastMode as CheckInMode : undefined,
    lastKeys: Array.isArray(input.lastKeys) ? input.lastKeys.filter((key): key is string => typeof key === "string") : undefined,
    quiet: number(input.quiet),
    signals,
    quickFixes,
    trivia: times(input.trivia),
    quotes: times(input.quotes)
  };
}

export function hasMoved(previous: SignalMemory | undefined, signal: MoneySignal) {
  if (!previous) {
    return false;
  }
  const change = Math.abs(signal.numbers.primaryMinor - previous.primaryMinor);
  if (change === 0) {
    return false;
  }
  return change >= MOVE_MINOR || previous.primaryMinor === 0 || change / Math.abs(previous.primaryMinor) >= MOVE_RATIO;
}

function isRested(signal: MoneySignal, memory: VisitMemory, nowMs: number) {
  const previous = memory.signals[signal.key];
  return Boolean(previous?.shownAt !== undefined && nowMs - previous.shownAt < REST_MS && !hasMoved(previous, signal));
}

function kindRank(signal: MoneySignal) {
  const rank = HEADLINE_KIND_ORDER.indexOf(signal.kind);
  // A moment (payday, a bonus, bills coming up) comes right after the
  // quick fixes and the bigger question.
  return signal.moment && rank > 1 ? 1.5 : rank;
}

// Headline candidates in order: kind (quick fix, bigger question, worth a
// look, going well), then the money involved, then signals not seen
// recently. A signal resting after being shown goes after the rest. Only
// one bigger question is kept.
export function rankSignals(signals: MoneySignal[], memory: VisitMemory, nowMs: number): MoneySignal[] {
  const ranked = signals
    .filter((signal) => HEADLINE_KIND_ORDER.includes(signal.kind) && signal.phrasings.length > 0)
    .map((signal) => ({ signal, rested: isRested(signal, memory, nowMs), shownAt: memory.signals[signal.key]?.shownAt ?? -Infinity }))
    .sort((left, right) => Number(left.rested) - Number(right.rested)
      || kindRank(left.signal) - kindRank(right.signal)
      || right.signal.weight - left.signal.weight
      || left.shownAt - right.shownAt
      || left.signal.key.localeCompare(right.signal.key))
    .map((item) => item.signal);
  let biggerQuestionSeen = false;
  return ranked.filter((signal) => {
    if (signal.kind !== "bigger_question") {
      return true;
    }
    if (biggerQuestionSeen) {
      return false;
    }
    biggerQuestionSeen = true;
    return true;
  });
}

// The wording skipped last time is never repeated: the next phrasing in
// turn, starting from a seed-based one on the first visit.
export function selectPhrasing(signal: MoneySignal, memory: VisitMemory, seed: number) {
  const count = signal.phrasings.length;
  const previous = memory.signals[signal.key]?.phrasing;
  return previous === undefined ? seed % count : (previous + 1) % count;
}

export function describeLastVisit(lastVisitDay: string | undefined, today: string) {
  if (!lastVisitDay) {
    return "your last visit";
  }
  const days = daysBetween(lastVisitDay, today);
  if (days === 0) {
    return "earlier today";
  }
  if (days === 1) {
    return "yesterday";
  }
  return days > 1 && days < 7 ? weekdayName(lastVisitDay) : "your last visit";
}

function changedLead(signal: MoneySignal, memory: VisitMemory) {
  const previous = memory.signals[signal.key];
  if (!previous?.primaryText || !signal.primaryText || !hasMoved(previous, signal)) {
    return "";
  }
  return `${signal.numbers.primaryMinor < previous.primaryMinor ? "Down" : "Up"} from ${previous.primaryText} since your last visit. `;
}

function somethingChanged(signals: MoneySignal[], memory: VisitMemory) {
  const lastKeys = new Set(memory.lastKeys ?? []);
  const currentKeys = signals.filter((signal) => signal.kind !== "just_for_fun").map((signal) => signal.key);
  if (currentKeys.length !== lastKeys.size || currentKeys.some((key) => !lastKeys.has(key))) {
    return true;
  }
  return signals.some((signal) => hasMoved(memory.signals[signal.key], signal));
}

export function composeCheckIn(input: {
  signals: MoneySignal[];
  memory: VisitMemory;
  nowMs: number;
  today: string;
  seed: string;
  contextKey: string;
  calmLine: string;
  // False while part of the page's data is still loading: nothing may be
  // called sorted or quiet from a partial picture.
  ready?: boolean;
}): CheckInView {
  const { signals, memory, nowMs, today, contextKey } = input;
  const seed = stableHash(input.seed);
  const ranked = rankSignals(signals, memory, nowMs);
  const sameContext = input.ready !== false && memory.lastContextKey === contextKey;
  const currentKeys = new Set(signals.map((signal) => signal.key));
  const sortedKey = sameContext
    ? Object.keys(memory.quickFixes).find((key) => !currentKeys.has(key)) ?? null
    : null;
  const isQuiet = !sortedKey
    && ranked.length > 0
    && memory.lastVisitAt !== undefined
    && nowMs - memory.lastVisitAt < QUIET_MS
    && sameContext
    && memory.lastMode !== "quiet"
    && !somethingChanged(signals, memory);

  let mode: CheckInMode;
  let headline: CheckInLine;
  let headlinePhrasing: number | null = null;
  let quietIndex: number | null = null;
  let also: MoneySignal[];
  if (sortedKey) {
    mode = "sorted";
    headline = { key: `sorted:${sortedKey}`, kind: "going_well", ...memory.quickFixes[sortedKey] };
    also = ranked;
  } else if (isQuiet) {
    mode = "quiet";
    quietIndex = memory.quiet === undefined ? seed % QUIET_LINES.length : (memory.quiet + 1) % QUIET_LINES.length;
    headline = { key: "quiet", kind: null, fact: fill(QUIET_LINES[quietIndex], { when: describeLastVisit(memory.lastVisitDay, today) }), think: "" };
    also = ranked;
  } else if (ranked.length) {
    mode = "signal";
    const top = ranked[0];
    headlinePhrasing = selectPhrasing(top, memory, seed);
    const phrasing = top.phrasings[headlinePhrasing];
    headline = { key: top.key, kind: top.kind, fact: `${changedLead(top, memory)}${phrasing.fact}`, think: phrasing.think, action: top.action };
    also = ranked.slice(1);
  } else {
    mode = "calm";
    headline = { key: "calm", kind: null, fact: input.calmLine, think: "" };
    also = [];
  }

  const alsoLines = also.slice(0, MAX_ALSO).map((signal) => ({ key: signal.key, kind: signal.kind, fact: signal.phrasings[0].fact }));

  const longViews = signals
    .map((signal, index) => ({ signal, index }))
    .filter(({ signal }) => signal.kind === "long_view" && signal.phrasings.length > 0)
    .sort((left, right) => Number(Boolean(right.signal.moment)) - Number(Boolean(left.signal.moment))
      || (memory.signals[left.signal.key]?.shownAt ?? -Infinity) - (memory.signals[right.signal.key]?.shownAt ?? -Infinity)
      || left.index - right.index);
  const longViewSignal = longViews[0]?.signal ?? null;
  const longViewPhrasing = longViewSignal ? selectPhrasing(longViewSignal, memory, seed) : null;
  const longView = longViewSignal && longViewPhrasing !== null
    ? { key: longViewSignal.key, kind: "long_view" as const, ...longViewSignal.phrasings[longViewPhrasing] }
    : null;

  // Just for fun: never beside a bigger question, and never the same line
  // within two weeks.
  const trivia = signals.filter((signal) => signal.kind === "just_for_fun" && signal.phrasings.length > 0);
  let fun: CheckInView["fun"] = null;
  if (headline.kind !== "bigger_question" && trivia.length) {
    const start = seed % trivia.length;
    const ordered = [...trivia.slice(start), ...trivia.slice(0, start)]
      .sort((left, right) => Number(Boolean(right.moment)) - Number(Boolean(left.moment)));
    const pick = ordered.find((signal) => {
      const shownAt = memory.trivia[signal.key];
      return shownAt === undefined || nowMs - shownAt >= TRIVIA_REPEAT_MS;
    });
    fun = pick ? { key: pick.key, text: pick.phrasings[0].fact } : null;
  }

  const besideBiggerQuestion = headline.kind === "bigger_question" || alsoLines.some((line) => line.kind === "bigger_question");
  const headlineSignal = mode === "signal" ? ranked[0] : null;
  const quoteTopic = besideBiggerQuestion
    ? null
    : headlineSignal?.topic ?? (mode === "sorted" ? "later" : longViewSignal?.topic ?? "calm");

  return {
    mode,
    headline,
    also: alsoLines,
    longView,
    fun,
    quoteTopic,
    headlinePhrasing,
    longViewPhrasing,
    sortedKey,
    quietIndex
  };
}

// The memory after this visit: what was present and shown, the phrasings
// used, quick fixes still to announce, trivia shown. Merged into the latest
// stored memory so several writes in one visit add up.
export function recordVisit(memory: VisitMemory, view: CheckInView, signals: MoneySignal[], input: { nowMs: number; today: string; contextKey: string }): VisitMemory {
  const { nowMs } = input;
  const next: VisitMemory = {
    ...memory,
    signals: { ...memory.signals },
    quickFixes: input.contextKey === memory.lastContextKey ? { ...memory.quickFixes } : {},
    trivia: { ...memory.trivia },
    quotes: { ...memory.quotes }
  };
  for (const signal of signals) {
    if (signal.kind === "just_for_fun") {
      continue;
    }
    const previous = next.signals[signal.key];
    const isHeadline = view.mode === "signal" && view.headline.key === signal.key;
    const isLongView = view.longView?.key === signal.key;
    next.signals[signal.key] = {
      at: nowMs,
      shownAt: isHeadline || isLongView ? nowMs : previous?.shownAt,
      phrasing: isHeadline ? view.headlinePhrasing ?? undefined : isLongView ? view.longViewPhrasing ?? undefined : previous?.phrasing,
      primaryMinor: signal.numbers.primaryMinor,
      primaryText: signal.primaryText
    };
    if (signal.kind === "quick_fix" && signal.sorted) {
      next.quickFixes[signal.key] = signal.sorted;
    }
  }
  if (view.sortedKey) {
    delete next.quickFixes[view.sortedKey];
  }
  if (view.fun) {
    next.trivia[view.fun.key] = nowMs;
  }
  if (view.quietIndex !== null) {
    next.quiet = view.quietIndex;
  }
  next.lastVisitAt = nowMs;
  next.lastVisitDay = input.today;
  next.lastContextKey = input.contextKey;
  next.lastMode = view.mode;
  next.lastKeys = signals.filter((signal) => signal.kind !== "just_for_fun").map((signal) => signal.key);
  return forgetOld(next, nowMs);
}

// A quote for the topic not shown in the last 28 days, falling back to a
// calm one; null when every fitting quote was shown recently. The library
// (quotes.ts) is passed in because it loads on demand.
export function pickQuote(quotes: CheckInQuote[], topic: QuoteTopic, memory: VisitMemory, nowMs: number, seed: string): CheckInQuote | null {
  const fresh = (quote: CheckInQuote) => {
    const shownAt = memory.quotes[quote.id];
    return shownAt === undefined || nowMs - shownAt >= QUOTE_REPEAT_MS;
  };
  for (const wanted of [topic, "calm" as const]) {
    const fitting = quotes.filter((quote) => quote.topics.includes(wanted));
    const start = fitting.length ? stableHash(`${seed}|${wanted}`) % fitting.length : 0;
    const pick = [...fitting.slice(start), ...fitting.slice(0, start)].find(fresh);
    if (pick) {
      return pick;
    }
  }
  return null;
}

export function recordQuote(memory: VisitMemory, quoteId: string, nowMs: number): VisitMemory {
  return { ...memory, quotes: { ...memory.quotes, [quoteId]: nowMs } };
}

function forgetOld(memory: VisitMemory, nowMs: number): VisitMemory {
  const keepSince = nowMs - FORGET_MS;
  return {
    ...memory,
    signals: Object.fromEntries(Object.entries(memory.signals).filter(([, entry]) => entry.at >= keepSince)),
    trivia: Object.fromEntries(Object.entries(memory.trivia).filter(([, at]) => at >= nowMs - TRIVIA_REPEAT_MS * 2)),
    quotes: Object.fromEntries(Object.entries(memory.quotes).filter(([, at]) => at >= nowMs - QUOTE_REPEAT_MS * 2))
  };
}
