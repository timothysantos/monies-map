// A run of days as a person says it ("last week", "yesterday", "this
// weekend", "between 3 and 10 nov", "since monday", "past 7 days"), read
// into the first and last day (DOMAIN.md "Day Range"; docs/flows/ask-flow.md
// "Days"). The model reports the words as said; this works out the dates,
// with AI on (ask-turn.ts, search) and off (ask-filter-reader.js), so both
// read a phrase the same way.
//
// Rules (owner-approved batch, 2026-11-18):
// - Weeks start on Monday. "This week" is this Monday to today; "last week"
//   (or "previous week") is the Monday to Sunday before it.
// - "This weekend" is this week's Saturday and Sunday once it has started
//   (Saturday: today only), else the weekend just gone, the same as "last
//   weekend": the Saturday and Sunday before this week's Monday.
// - "Since <day>" runs from that day to today; "past/last N days" is the N
//   days ending today; a single day ("yesterday", "last friday", "12 nov")
//   is that day alone.
// - "Between 3 and 10 nov", "3 to 10 nov", "3-10 nov", "from 3 nov to 10
//   nov", "28 oct to 3 nov": both ends as said; a day with no year is the
//   latest one not after today, and the first end takes the second's month
//   and year when it has none of its own.
// - Never in the future past today for the words that end "now" (this
//   week, since); a range whose first day is after its last, or that runs
//   longer than MAX_RANGE_DAYS, is not read (the turn asks back).
//
// Pure: the only clock is the `today` it is given (YYYY-MM-DD).

import { readDayWord } from "./ask-turn-names";

export interface DayRange {
  from: string;
  to: string;
}

// Two years, the longest period Entries lists at once (MAX_ENTRY_RANGE_MONTHS).
export const MAX_RANGE_DAYS = 731;

const DAY = 86_400_000;
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5,
  jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11
};
const NUMBER_WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fourteen: 14, thirty: 30 };

function toTime(day: string) {
  return Date.parse(`${day}T00:00:00Z`);
}

export function addDaysTo(day: string, count: number) {
  return new Date(toTime(day) + count * DAY).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string) {
  return Math.round((toTime(to) - toTime(from)) / DAY);
}

// Monday of the week `day` is in (weeks start Monday).
function mondayOf(day: string) {
  const weekday = new Date(toTime(day)).getUTCDay();
  return addDaysTo(day, -((weekday + 6) % 7));
}

function clean(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/[,!?]/g, " ").replace(/\.(?=\s|$)/g, " ").replace(/\s+/g, " ").trim();
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function checked(range: DayRange | null): DayRange | null {
  if (!range || !ISO_DAY.test(range.from) || !ISO_DAY.test(range.to)) return null;
  if (range.from > range.to) return null;
  if (daysBetween(range.from, range.to) + 1 > MAX_RANGE_DAYS) return null;
  return range;
}

// "10 nov", "nov 10", "10 nov 2026", "10" (with the month given), a day word.
function readEnd(text: string, today: string, fallback: { month: number; year: number | null } | null): { day: string; month: number; year: number | null } | null {
  const bare = /^(\d{1,2})(?:st|nd|rd|th)?$/.exec(text);
  if (bare && fallback) {
    return pickYear(Number(bare[1]), fallback.month, fallback.year, today);
  }
  const dayMonth = /^(\d{1,2})(?:st|nd|rd|th)?(?: of)? ([a-z]{3,9})(?: (\d{4}))?$/.exec(text);
  const monthDay = /^([a-z]{3,9}) (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/.exec(text);
  const parts = dayMonth
    ? { date: Number(dayMonth[1]), month: MONTH_NAMES[dayMonth[2]], year: dayMonth[3] ? Number(dayMonth[3]) : null }
    : monthDay
      ? { date: Number(monthDay[2]), month: MONTH_NAMES[monthDay[1]], year: monthDay[3] ? Number(monthDay[3]) : null }
      : null;
  if (parts && parts.month !== undefined) {
    return pickYear(parts.date, parts.month, parts.year, today);
  }
  const word = readDayWord(text, today);
  return word ? { day: word, month: Number(word.slice(5, 7)) - 1, year: Number(word.slice(0, 4)) } : null;
}

function pickYear(date: number, month: number, year: number | null, today: string) {
  const make = (y: number) => {
    const day = `${y}-${String(month + 1).padStart(2, "0")}-${String(date).padStart(2, "0")}`;
    const parsed = new Date(toTime(day));
    return Number.isNaN(parsed.getTime()) || parsed.getUTCDate() !== date ? null : day;
  };
  if (date < 1 || date > 31) return null;
  if (year !== null) {
    const day = make(year);
    return day ? { day, month, year } : null;
  }
  const thisYear = Number(today.slice(0, 4));
  const candidate = make(thisYear);
  if (candidate && candidate <= today) return { day: candidate, month, year: thisYear };
  const before = make(thisYear - 1);
  return before ? { day: before, month, year: thisYear - 1 } : null;
}

// Two ends as said: the second is read first, so "3 to 10 nov" gives the 3
// November's month and year.
function readSpan(first: string, second: string, today: string): DayRange | null {
  const end = readEnd(second, today, null);
  if (!end) return null;
  const start = readEnd(first, today, { month: end.month, year: end.year });
  if (!start) return null;
  let from = start.day;
  // "28 dec to 3 jan" read in January: the first end is the year before.
  if (from > end.day && !/\d{4}/.test(first) && start.month > end.month) {
    const earlier = pickYear(Number(from.slice(8, 10)), Number(from.slice(5, 7)) - 1, Number(end.day.slice(0, 4)) - 1, today);
    if (earlier) from = earlier.day;
  }
  return { from, to: end.day };
}

/**
 * The days a phrase names, or null when it names no run of days this reads.
 * @param value the words as said ("last week", "between 3 and 10 nov")
 * @param today YYYY-MM-DD in the app's time zone
 */
export function readDayRange(value: unknown, today: string): DayRange | null {
  const text = clean(value).replace(/^(?:in |on |for |during |over )/, "").replace(/^the /, "");
  if (!text || !ISO_DAY.test(today)) return null;
  const monday = mondayOf(today);
  if (/^(?:this|current) week$/.test(text)) return checked({ from: monday, to: today });
  if (/^(?:last|previous|past|prior) week$/.test(text)) return checked({ from: addDaysTo(monday, -7), to: addDaysTo(monday, -1) });
  if (/^(?:this|last|past|previous) weekend$/.test(text) || text === "weekend") {
    const saturday = addDaysTo(monday, 5);
    if (text !== "last weekend" && text !== "previous weekend" && text !== "past weekend" && today >= saturday) {
      return checked({ from: saturday, to: today });
    }
    return checked({ from: addDaysTo(monday, -2), to: addDaysTo(monday, -1) });
  }
  const pastDays = /^(?:the )?(?:last|past|previous) (\d{1,3}|two|three|four|five|six|seven|eight|nine|ten|fourteen|thirty) days$/.exec(text);
  if (pastDays) {
    const count = /^\d+$/.test(pastDays[1]) ? Number(pastDays[1]) : NUMBER_WORDS[pastDays[1]];
    return count ? checked({ from: addDaysTo(today, -(count - 1)), to: today }) : null;
  }
  const since = /^since (.+)$/.exec(text);
  if (since) {
    const start = readEnd(since[1], today, null);
    return start ? checked({ from: start.day, to: today }) : null;
  }
  const between = /^(?:between|from) (.+?) (?:and|to|until|till|-) (.+)$/.exec(text)
    ?? /^(.+?) (?:to|until|till|-) (.+)$/.exec(text);
  if (between) return checked(readSpan(between[1], between[2], today));
  // "3-10 nov": a dash with no spaces.
  const dashed = /^(\d{1,2})(?:st|nd|rd|th)?-(\d{1,2}(?:st|nd|rd|th)? [a-z]{3,9}(?: \d{4})?)$/.exec(text);
  if (dashed) return checked(readSpan(dashed[1], dashed[2], today));
  const single = readDayWord(text, today);
  return single ? checked({ from: single, to: single }) : null;
}

// The phrases a message may use for a run of days, longest first, for the
// rules reader to find in a whole message (ask-filter-reader.js).
const RANGE_IN_TEXT = new RegExp([
  String.raw`(?:between|from) \d{1,2}(?:st|nd|rd|th)?(?: [a-z]{3,9})?(?: \d{4})? (?:and|to|until|till) \d{1,2}(?:st|nd|rd|th)? [a-z]{3,9}(?: \d{4})?`,
  String.raw`\d{1,2}(?:st|nd|rd|th)?(?: [a-z]{3,9})? (?:to|until|till) \d{1,2}(?:st|nd|rd|th)? [a-z]{3,9}(?: \d{4})?`,
  String.raw`\d{1,2}-\d{1,2} [a-z]{3,9}(?: \d{4})?`,
  String.raw`since (?:last |this )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|yesterday|\d{1,2}(?:st|nd|rd|th)? [a-z]{3,9}(?: \d{4})?)`,
  String.raw`(?:last|past|previous) (?:\d{1,3}|two|three|four|five|six|seven|eight|nine|ten|fourteen|thirty) days`,
  String.raw`(?:this|current|last|previous|past|prior) week(?:end)?`,
  String.raw`weekend`
].join("|"), "g");

/**
 * The one run of days a whole message names, with the words that named it,
 * or null when it names none this reads (a single day is left to the day
 * readers). `phrase` is as written, for the assumption line.
 */
export function findDayRangeIn(text: string, today: string): (DayRange & { phrase: string }) | null {
  const lower = ` ${clean(text)} `;
  for (const match of lower.matchAll(RANGE_IN_TEXT)) {
    const before = lower[match.index - 1];
    const after = lower[match.index + match[0].length];
    if (before !== " " || after !== " ") continue;
    const range = readDayRange(match[0], today);
    if (range) return { ...range, phrase: match[0] };
  }
  return null;
}

/**
 * "9 to 15 Nov", "27 Oct to 2 Nov", "15 Nov", "28 Dec 2025 to 3 Jan 2026":
 * the year only when the range is not all in today's year.
 */
export function formatDayRange(range: DayRange, today: string) {
  const year = today.slice(0, 4);
  const withYear = range.from.slice(0, 4) !== year || range.to.slice(0, 4) !== year;
  const part = (day: string, month: boolean, showYear: boolean) => [
    String(Number(day.slice(8, 10))),
    month ? SHORT_MONTHS[Number(day.slice(5, 7)) - 1] : "",
    showYear ? day.slice(0, 4) : ""
  ].filter(Boolean).join(" ");
  if (range.from === range.to) return part(range.from, true, withYear);
  const sameMonth = range.from.slice(0, 7) === range.to.slice(0, 7);
  return `${part(range.from, !sameMonth, withYear && range.from.slice(0, 4) !== range.to.slice(0, 4))} to ${part(range.to, true, withYear)}`;
}
