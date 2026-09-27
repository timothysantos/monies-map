// Small shared helpers for the check-in signals: copy templates, money and
// date wording, and calendar arithmetic on plain YYYY-MM-DD strings (never
// Date.now: callers pass `today`, so every result is deterministic).
import type { SignalPhrasing } from "./types";

export type FormatMoney = (amountMinor: number) => string;

// One signal's approved copy. Templates use {token} placeholders; a
// phrasing given as { fact, think } carries its own (shorter) think line.
// `one` variants replace the plural ones when a count is 1.
export interface CopyEntry {
  phrasings: Array<string | { fact: string; think: string }>;
  phrasingsOne?: Array<string | { fact: string; think: string }>;
  think: string;
  thinkOne?: string;
  sorted?: { fact: string; think: string };
  action?: string;
}

export type CopyCatalogue = Record<string, CopyEntry>;

export function fill(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_match, token: string) => String(values[token] ?? ""));
}

export function phrase(entry: CopyEntry, values: Record<string, string | number>, { one = false, think }: { one?: boolean; think?: string } = {}): SignalPhrasing[] {
  const templates = one && entry.phrasingsOne ? entry.phrasingsOne : entry.phrasings;
  const baseThink = fill(think ?? (one && entry.thinkOne ? entry.thinkOne : entry.think), values);
  return templates.map((template) => typeof template === "string"
    ? { fact: capitalize(fill(template, values)), think: baseThink }
    : { fact: capitalize(fill(template.fact, values)), think: fill(template.think, values) });
}

export function capitalize(text: string) {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

// "$650.00" reads as "$650"; other amounts keep their cents.
export function compactMoney(formatMoney: FormatMoney, amountMinor: number) {
  return formatMoney(amountMinor).replace(/\.00(?=\D*$)/, "");
}

// "about $913": whole units, no cents.
export function approxMoney(formatMoney: FormatMoney, amountMinor: number) {
  return compactMoney(formatMoney, Math.round(amountMinor / 100) * 100);
}

export function joinWithAnd(values: string[]) {
  if (values.length < 2) {
    return values[0] ?? "";
  }
  return values.length === 2
    ? `${values[0]} and ${values[1]}`
    : `${values.slice(0, -1).join(", ")} and ${values.at(-1)}`;
}

export function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

export function numberWord(value: number) {
  return NUMBER_WORDS[value] ?? String(value);
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function monthName(month: string) {
  return MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month;
}

export function monthYear(month: string) {
  return `${monthName(month)} ${month.slice(0, 4)}`;
}

function parseDate(date: string) {
  const value = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(value.getTime()) ? null : value;
}

export function weekdayIndex(date: string) {
  return parseDate(date)?.getUTCDay() ?? -1;
}

export function weekdayName(date: string) {
  return WEEKDAY_NAMES[weekdayIndex(date)] ?? "";
}

export function weekdayNameOf(index: number) {
  return WEEKDAY_NAMES[index] ?? "";
}

// "Sat 11 Jul"
export function shortDay(date: string) {
  const value = parseDate(date);
  return value ? `${WEEKDAY_SHORT[value.getUTCDay()]} ${value.getUTCDate()} ${MONTH_SHORT[value.getUTCMonth()]}` : date;
}

// "3 and 5 Aug", or "30 Jul and 2 Aug" across months.
export function dayPair(first: string, second: string) {
  const [a, b] = [first, second].sort();
  const left = parseDate(a);
  const right = parseDate(b);
  if (!left || !right) {
    return `${a} and ${b}`;
  }
  return left.getUTCMonth() === right.getUTCMonth()
    ? `${left.getUTCDate()} and ${right.getUTCDate()} ${MONTH_SHORT[right.getUTCMonth()]}`
    : `${left.getUTCDate()} ${MONTH_SHORT[left.getUTCMonth()]} and ${right.getUTCDate()} ${MONTH_SHORT[right.getUTCMonth()]}`;
}

export function addDays(date: string, days: number) {
  const value = parseDate(date);
  if (!value) {
    return date;
  }
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string) {
  const left = parseDate(from);
  const right = parseDate(to);
  return left && right ? Math.round((right.getTime() - left.getTime()) / 86_400_000) : 0;
}

export function addMonths(month: string, count: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const index = year * 12 + (monthNumber - 1) + count;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

export function monthsBetween(from: string, to: string) {
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const [toYear, toMonth] = to.split("-").map(Number);
  return (toYear * 12 + toMonth) - (fromYear * 12 + fromMonth);
}

export function daysInMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

// Where `today` sits in a month: early looks ahead, mid looks at pace, late
// wraps up; a past month is wrapped up and a future one is ahead.
export type MonthPhase = "ahead" | "early" | "mid" | "late" | "past";

export function monthPhase(month: string, today: string): MonthPhase {
  const currentMonth = today.slice(0, 7);
  if (month < currentMonth) {
    return "past";
  }
  if (month > currentMonth) {
    return "ahead";
  }
  const day = Number(today.slice(8, 10));
  return day <= 10 ? "early" : day <= 20 ? "mid" : "late";
}

// A bank description as a readable name: "COURTS MEGASTORE TAMPINES PTE
// LTD" reads "Courts Megastore Tampines".
export function tidyName(description: string | undefined) {
  const cleaned = String(description ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s,]+(PTE\.?\s*LTD\.?|LTD\.?|SDN\.?\s*BHD\.?|INC\.?)$/i, "")
    .slice(0, 60);
  if (!cleaned || /[a-z]/.test(cleaned)) {
    return cleaned;
  }
  return cleaned.toLowerCase().replace(/(^|[\s/&(-])([a-z])/g, (_match, lead: string, letter: string) => `${lead}${letter.toUpperCase()}`);
}

// A plain category name reads in lower case mid-sentence ("went to
// groceries"); a name with its own capitals ("SP Group") keeps them.
export function lowerLabel(label: string) {
  return /^[A-Z][a-z]+(?: (?:&|and) [A-Za-z][a-z]+)*$/.test(label) ? label.toLowerCase() : label;
}

export function stableHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

export function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}
