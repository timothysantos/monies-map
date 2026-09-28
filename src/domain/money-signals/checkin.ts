// Composes one visit's money check-in from a page's signals, the period
// being viewed and the visit memory kept in the browser. What rotates (the
// wording, the long view's lead, the Just for fun line, the quote, the calm
// line) follows the period, so nothing repeats within a year of months for
// the same page and view (rotation.ts). The memory only adds: rests,
// "what changed", "sorted" and quiet visits. Pure and deterministic:
// `nowMs`, `today`, the period, the memory and a stable seed are inputs, so
// the same inputs always give the same check-in.
import { isQuarterTurn, pickByPeriod, pickLongView, pickTrivia, quoteColumn, selectWording, YEAR_MONTHS, type CheckInPage, type TriviaRotation } from "./rotation";
import { HEADLINE_KIND_ORDER, type CheckInAction, type MoneySignal, type QuoteTopic, type SignalKind } from "./types";
import type { CheckInQuote } from "./quotes";

// The engine's own small text and date helpers. format.ts has the same
// ones for the signal builders; the engine keeps these copies so the
// first screen's check-in shares no module with Summary's signals, which
// load beside it (money-insights-loader.js): a shared module would become
// one more first-screen file. tests/money-checkin-engine.test.mjs keeps
// the two in step.
export const engineText = {
  fill(template: string, values: Record<string, string | number>) {
    return template.replace(/\{(\w+)\}/g, (_match, token: string) => String(values[token] ?? ""));
  },
  stableHash(value: string) {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
      hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
    }
    return Math.abs(hash);
  },
  weekdayName(date: string) {
    const value = parseDay(date);
    return value ? ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][value.getUTCDay()] : "";
  },
  daysBetween(from: string, to: string) {
    const left = parseDay(from);
    const right = parseDay(to);
    return left && right ? Math.round((right.getTime() - left.getTime()) / 86_400_000) : 0;
  }
};
const { fill, stableHash, weekdayName, daysBetween } = engineText;

function parseDay(date: string) {
  const value = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(value.getTime()) ? null : value;
}

const DAY_MS = 86_400_000;
// A signal shown as the headline steps aside for a few days...
export const REST_MS = 3 * DAY_MS;
// ...unless its numbers move by 10% or $50.
export const MOVE_RATIO = 0.1;
export const MOVE_MINOR = 5_000;
// A visit within this window with nothing new is a quiet visit.
export const QUIET_MS = 3 * DAY_MS;
const FORGET_MS = 90 * DAY_MS;
const MAX_ALSO = 3;

export interface SignalMemory {
  // Last visit the signal was present at.
  at: number;
  // Last time it led the check-in (headline or long view line).
  shownAt?: number;
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
  fun: { key: string; type: string; text: string } | null;
  // The quote topic for the expanded view, or null when no quote may show
  // (never beside a bigger question).
  quoteTopic: QuoteTopic | null;
  // Which of the signal's wordings (rotation.ts) the headline and the long
  // view use this period.
  headlineWording: number | null;
  longViewWording: number | null;
  // Internal choices recordVisit needs.
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
  return { v: 1, signals: {}, quickFixes: {} };
}

// Stored memory is untrusted: anything malformed starts fresh. Fields of
// older versions (trivia and quote times, phrasings) are dropped.
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
    quickFixes
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

function kindRank(signal: MoneySignal, hasBiggerQuestion: boolean) {
  const rank = HEADLINE_KIND_ORDER.indexOf(signal.kind);
  // A quick fix that yields (Month's statement gap) goes right after the
  // month's own bigger question.
  if (signal.yieldsToBiggerQuestion && hasBiggerQuestion) {
    return 1.2;
  }
  // A moment (payday, a bonus, bills coming up) comes right after the
  // quick fixes and the bigger question.
  return signal.moment && rank > 1 ? 1.5 : rank;
}

// Whether a signal may lead this period: anything notable, and a steady
// signal only in its turn (types.ts, notability).
export function leadsThisPeriod(signal: MoneySignal, period: string | undefined) {
  return !signal.steady || isQuarterTurn(period, signal.turn);
}

function isHeadlineKind(signal: MoneySignal) {
  return HEADLINE_KIND_ORDER.includes(signal.kind) && signal.phrasings.length > 0;
}

// Headline candidates in order: kind (quick fix, bigger question, worth a
// look, going well; a quick fix that yields goes right after the bigger
// question), then the money involved, then signals not seen
// recently. A signal resting after being shown goes after the rest. Only
// one bigger question is kept. A steady signal is no candidate outside its
// turn.
export function rankSignals(signals: MoneySignal[], memory: VisitMemory, nowMs: number, period?: string): MoneySignal[] {
  const hasBiggerQuestion = signals.some((signal) => signal.kind === "bigger_question" && signal.phrasings.length > 0);
  const ranked = signals
    .filter((signal) => isHeadlineKind(signal) && leadsThisPeriod(signal, period))
    .map((signal) => ({ signal, rested: isRested(signal, memory, nowMs), shownAt: memory.signals[signal.key]?.shownAt ?? -Infinity }))
    .sort((left, right) => Number(left.rested) - Number(right.rested)
      || kindRank(left.signal, hasBiggerQuestion) - kindRank(right.signal, hasBiggerQuestion)
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
  // The period being viewed ("2026-08"): what rotates follows it.
  period: string;
  // The page's Just for fun schedule; no trivia without one.
  triviaRotation?: TriviaRotation;
  // The page's calm lines (one per month in turn), or a single line.
  calmLines?: string[];
  calmLine?: string;
  // False while part of the page's data is still loading: nothing may be
  // called sorted or quiet from a partial picture.
  ready?: boolean;
}): CheckInView {
  const { signals, memory, nowMs, today, contextKey, period } = input;
  const seed = stableHash(input.seed);
  const ranked = rankSignals(signals, memory, nowMs, period);
  // Steady signals out of their turn: never the headline, at most under
  // Also, after everything notable, largest first.
  const steady = signals
    .filter((signal) => isHeadlineKind(signal) && !leadsThisPeriod(signal, period))
    .sort((left, right) => HEADLINE_KIND_ORDER.indexOf(left.kind) - HEADLINE_KIND_ORDER.indexOf(right.kind)
      || right.weight - left.weight
      || left.key.localeCompare(right.key));
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
  let headlineWording: number | null = null;
  let quietIndex: number | null = null;
  let also: MoneySignal[];
  if (sortedKey) {
    mode = "sorted";
    headline = { key: `sorted:${sortedKey}`, kind: "going_well", ...memory.quickFixes[sortedKey] };
    also = [...ranked, ...steady];
  } else if (isQuiet) {
    mode = "quiet";
    quietIndex = memory.quiet === undefined ? seed % QUIET_LINES.length : (memory.quiet + 1) % QUIET_LINES.length;
    headline = { key: "quiet", kind: null, fact: fill(QUIET_LINES[quietIndex], { when: describeLastVisit(memory.lastVisitDay, today) }), think: "" };
    also = [...ranked, ...steady];
  } else if (ranked.length) {
    mode = "signal";
    const top = ranked[0];
    const selected = selectWording(top, period)!;
    headlineWording = selected.index;
    headline = { key: top.key, kind: top.kind, fact: `${changedLead(top, memory)}${selected.wording.fact}`, think: selected.wording.think, action: top.action };
    also = [...ranked.slice(1), ...steady];
  } else {
    // Nothing notable: the calm line, and nothing under Also (a steady
    // "Worth a look" there would contradict it).
    mode = "calm";
    headline = { key: "calm", kind: null, fact: pickByPeriod(input.calmLines ?? [], period) ?? input.calmLine ?? "", think: "" };
    also = [];
  }

  const alsoLines = also.slice(0, MAX_ALSO).map((signal) => ({ key: signal.key, kind: signal.kind, fact: signal.phrasings[0].fact }));

  const longViewSignal = pickLongView(signals.filter((signal) => signal.kind === "long_view" && signal.phrasings.length > 0), period);
  const longViewSelected = longViewSignal ? selectWording(longViewSignal, period) : null;
  const longView = longViewSignal && longViewSelected
    ? { key: longViewSignal.key, kind: "long_view" as const, fact: longViewSelected.wording.fact, think: longViewSelected.wording.think }
    : null;

  // Just for fun: never beside a bigger question.
  const trivia = headline.kind === "bigger_question" ? null : pickTrivia(signals, input.triviaRotation, period);
  const fun = trivia ? { key: trivia.key, type: trivia.triviaType ?? trivia.key, text: trivia.phrasings[0].fact } : null;

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
    headlineWording,
    longViewWording: longViewSelected?.index ?? null,
    sortedKey,
    quietIndex
  };
}

// The memory after this visit: what was present and shown, quick fixes
// still to announce. Merged into the latest stored memory so several
// writes in one visit add up.
export function recordVisit(memory: VisitMemory, view: CheckInView, signals: MoneySignal[], input: { nowMs: number; today: string; contextKey: string }): VisitMemory {
  const { nowMs } = input;
  const next: VisitMemory = {
    ...memory,
    signals: { ...memory.signals },
    quickFixes: input.contextKey === memory.lastContextKey ? { ...memory.quickFixes } : {}
  };
  for (const signal of signals) {
    if (signal.kind === "just_for_fun") {
      continue;
    }
    const previous = next.signals[signal.key];
    const isShown = (view.mode === "signal" && view.headline.key === signal.key) || view.longView?.key === signal.key;
    next.signals[signal.key] = {
      at: nowMs,
      shownAt: isShown ? nowMs : previous?.shownAt,
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

// The quote for the page and period: from the period's column of the
// library (rotation.ts), one that fits the topic, else a calm one; null
// when the column has neither. The library (quotes.ts) is passed in
// because it loads on demand.
export function pickQuote(quotes: CheckInQuote[], topic: QuoteTopic, { page, period }: { page: CheckInPage; period: string }): CheckInQuote | null {
  const column = quoteColumn(page, period);
  const inColumn = quotes.filter((_quote, index) => index % YEAR_MONTHS === column);
  return inColumn.find((quote) => quote.topics.includes(topic))
    ?? inColumn.find((quote) => quote.topics.includes("calm"))
    ?? null;
}

function forgetOld(memory: VisitMemory, nowMs: number): VisitMemory {
  const keepSince = nowMs - FORGET_MS;
  return {
    ...memory,
    signals: Object.fromEntries(Object.entries(memory.signals).filter(([, entry]) => entry.at >= keepSince))
  };
}
