// The year rule for everything that rotates in Money insights: the Just for
// fun line, a recurring signal's wording, which long view leads, the quote
// and the calm line. Each is chosen from the period being viewed (never
// from the visit's time or the browser's memory), so for one page and view
// nothing shown for a period is shown again in the eleven periods before or
// after it. The period is a month: Month and Entries use their month,
// Summary the range's last month, Splits the current month for the group.
// Browser memory may still add (a rested headline, a quiet visit, "sorted")
// but is never needed for the rule to hold.
import type { MoneySignal, QuarterTurn } from "./types";

export const YEAR_MONTHS = 12;
export const QUARTER_MONTHS = 3;

export type CheckInPage = "summary" | "month" | "entries" | "splits";

function mod(value: number, size: number) {
  return size > 0 ? ((value % size) + size) % size : 0;
}

// "2026-08" as a running month number (year * 12 + month - 1), so twelve
// consecutive months give twelve consecutive numbers.
export function periodIndex(period: string | undefined) {
  const match = /^(\d{4})-(\d{2})/.exec(period ?? "");
  return match ? Number(match[1]) * YEAR_MONTHS + Number(match[2]) - 1 : 0;
}

// A steady signal's turn (types.ts): one month of each quarter. Without a
// period there is no turn.
export function isQuarterTurn(period: string | undefined, turn: QuarterTurn | undefined) {
  return turn !== undefined && Boolean(period) && mod(periodIndex(period), QUARTER_MONTHS) === turn;
}

export function pickByPeriod<T>(items: T[], period: string | undefined, offset = 0): T | undefined {
  return items.length ? items[mod(periodIndex(period) + offset, items.length)] : undefined;
}

// A page's Just for fun schedule. Each trivia type sits in exactly one of
// the twelve columns (at least twelve types in all); a period uses the
// column of its month number, trying its types in turn (the first one this
// cycle, then the reserves). Two periods less than twelve apart always use
// different columns, so no type can come back within a year. A moment type
// (a year recap, an anniversary) sits in no column; it goes first, and its
// builder fires in at most one period of any twelve.
export interface TriviaRotation {
  columns: string[][];
  moments?: string[];
}

export function scheduledTriviaTypes(rotation: TriviaRotation, period: string | undefined) {
  const index = periodIndex(period);
  const column = rotation.columns[mod(index, rotation.columns.length)] ?? [];
  const start = mod(Math.floor(index / Math.max(1, rotation.columns.length)), column.length);
  return [...column.slice(start), ...column.slice(0, start)];
}

// The period's Just for fun line: a moment, else the first scheduled type
// that fires. Null (no trivia) rather than a type from another column.
export function pickTrivia(signals: MoneySignal[], rotation: TriviaRotation | undefined, period: string | undefined): MoneySignal | null {
  if (!rotation) {
    return null;
  }
  const byType = new Map<string, MoneySignal>();
  for (const signal of signals) {
    if (signal.kind === "just_for_fun" && signal.triviaType && signal.phrasings.length && !byType.has(signal.triviaType)) {
      byType.set(signal.triviaType, signal);
    }
  }
  for (const type of [...(rotation.moments ?? []), ...scheduledTriviaTypes(rotation, period)]) {
    const signal = byType.get(type);
    if (signal) {
      return signal;
    }
  }
  return null;
}

export interface SignalWording {
  fact: string;
  think: string;
  phrasing: number;
  thinkIndex: number;
}

// A signal's wordings in turn: every phrasing with its first think line,
// then every phrasing with its second, and so on. Consecutive months change
// the fact every month and the think line every round.
export function wordingsOf(signal: MoneySignal): SignalWording[] {
  const thinks = signal.phrasings.map((phrasing) => (phrasing.thinks?.length ? phrasing.thinks : [phrasing.think]));
  const rounds = Math.max(0, ...thinks.map((lines) => lines.length));
  const wordings: SignalWording[] = [];
  for (let thinkIndex = 0; thinkIndex < rounds; thinkIndex += 1) {
    signal.phrasings.forEach((phrasing, index) => {
      if (thinkIndex < thinks[index].length) {
        wordings.push({ fact: phrasing.fact, think: thinks[index][thinkIndex], phrasing: index, thinkIndex });
      }
    });
  }
  return wordings;
}

// The wording for the period: with 12 or more wordings, the same sentence
// never comes back within a year.
export function selectWording(signal: MoneySignal, period: string | undefined): { index: number; wording: SignalWording } | null {
  const wordings = wordingsOf(signal);
  if (!wordings.length) {
    return null;
  }
  const index = mod(periodIndex(period), wordings.length);
  return { index, wording: wordings[index] };
}

// Which long view leads: a seasonal moment first, otherwise the next one in
// turn by month.
export function pickLongView(longViews: MoneySignal[], period: string | undefined): MoneySignal | null {
  return longViews.find((signal) => signal.moment) ?? pickByPeriod(longViews, period) ?? null;
}

// Quotes sit in twelve columns (a quote's place in the library, mod 12).
// Each page reads a different column in the same month, three apart, and
// a page's column moves on every month.
export const QUOTE_PAGE_OFFSETS: Record<CheckInPage, number> = { summary: 0, month: 3, entries: 6, splits: 9 };

export function quoteColumn(page: CheckInPage, period: string | undefined) {
  return mod(periodIndex(period) + QUOTE_PAGE_OFFSETS[page], YEAR_MONTHS);
}
