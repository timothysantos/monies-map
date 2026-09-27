// Small shared helpers for the check-in signals: copy templates, money and
// date wording, and calendar arithmetic on plain YYYY-MM-DD strings (never
// Date.now: callers pass `today`, so every result is deterministic).
import type { SignalPhrasing } from "./types";

export type FormatMoney = (amountMinor: number) => string;

// One or more think lines. A signal that can recur month after month has
// several, so its wording rotates through a year without repeating.
export type ThinkLines = string | string[];

// One signal's approved copy. Templates use {token} placeholders; a
// phrasing given as { fact, think } carries its own (shorter) think lines.
// `one` variants replace the plural ones when a count is 1.
export interface CopyEntry {
  phrasings: Array<string | { fact: string; think: ThinkLines }>;
  phrasingsOne?: Array<string | { fact: string; think: ThinkLines }>;
  think: ThinkLines;
  thinkOne?: ThinkLines;
  sorted?: { fact: string; think: string };
  action?: string;
}

export type CopyCatalogue = Record<string, CopyEntry>;

export function thinkList(lines: ThinkLines | undefined): string[] {
  return Array.isArray(lines) ? lines : lines ? [lines] : [];
}

export function fill(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_match, token: string) => String(values[token] ?? ""));
}

// The phrasings with their numbers filled in. Each carries every think
// line it may pair with (`thinks`); `think` is the first, the plain one.
export function phrase(entry: CopyEntry, values: Record<string, string | number>, { one = false, think }: { one?: boolean; think?: ThinkLines } = {}): SignalPhrasing[] {
  const templates = one && entry.phrasingsOne ? entry.phrasingsOne : entry.phrasings;
  const baseThinks = thinkList(think ?? (one && entry.thinkOne ? entry.thinkOne : entry.think)).map((line) => fill(line, values));
  return templates.map((template) => {
    const fact = capitalize(fill(typeof template === "string" ? template : template.fact, values));
    const thinks = typeof template === "string" ? baseThinks : thinkList(template.think).map((line) => fill(line, values));
    return { fact, think: thinks[0] ?? "", thinks };
  });
}

// A quick fix's one-time "Sorted" line with its numbers filled in.
export function sortedLine(sorted: { fact: string; think: string }, values: Record<string, string | number>) {
  return { fact: capitalize(fill(sorted.fact, values)), think: fill(sorted.think, values) };
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

// "once", "twice", "3 times".
export function timesWord(count: number) {
  return count === 1 ? "once" : count === 2 ? "twice" : `${count} times`;
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

// A payment to a person or an account, not a place: never named in copy.
const PAYMENT_RAIL = /\b(?:pay\s?now|fast\s+(?:payment|transfer)|giro|ibg|funds?\s+transfer|interbank|i-?bank|bill\s+payment|cash\s+withdrawal|atm)\b/i;
// What a bank appends after a place's name: the city and the country.
const LOCATION_WORD = /^(?:singapore|sgp?|sin|mys?|usa?|gbr?|uk|hk|jpn?|aus?|th|id|ph|nz|kr|tw|cn)$/i;
const COMPANY_SUFFIX = /[\s,]+(?:PTE\.?\s*LTD\.?|LTD\.?|SDN\.?\s*BHD\.?|INC\.?|LLP)$/i;
const CURRENCY_AMOUNT = /\b(?:usd|eur|gbp|aud|jpy|myr|thb|php|idr|hkd|twd|krw|cny|vnd)\s*\d+(?:[.,]\d+)*\b/gi;
// Words that say how something was paid, not where: a name made only of
// these is not a place.
const GENERIC_WORD = /^(?:ref|trf|transfer|payment|purchase|pos|debit|credit|card|online|othr|misc|to|from|and|txn|no|nets)$/i;
// Brands and services written in capitals. Other all-capital words of up
// to four letters with no vowel ("FP", "KFC") keep their capitals too.
const ACRONYMS = new Set(["MRT", "LRT", "NTUC", "OCBC", "UOB", "POSB", "HSBC", "IKEA", "CPF", "HDB", "IRAS", "SMRT", "BBQ", "SBS", "LTA", "DBS", "KFC"]);

// A reference code, terminal or card number: 4 or more digits in one word,
// a masked card ("XX1234", "****"), or a bare number of 3 or more digits.
function isCodeWord(word: string) {
  const bare = word.replace(/[^\p{L}\p{N}*]/gu, "");
  return !bare
    || (bare.match(/\d/g)?.length ?? 0) >= 4
    || /^\d{3,}$/.test(bare)
    || /^(?:x{2,}|\*+)\d*$/i.test(bare);
}

function titleWord(word: string, wasUpper: boolean) {
  return word.split(/([/&()-])/).map((part) => {
    const upper = part.toUpperCase();
    if (ACRONYMS.has(upper) || (wasUpper && /^[A-Z]{2,4}$/.test(part) && !/[AEIOU]/.test(part))) {
      return upper;
    }
    if (!wasUpper) {
      return part;
    }
    return part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part;
  }).join("");
}

// A bank description as the name a person would say: "BUS/MRT 912263684
// SINGAPORE SG" reads "Bus/MRT", "NTUC FP-TAMPINES #01-23 SINGAPORE SG"
// reads "NTUC FP-Tampines", "COURTS MEGASTORE TAMPINES PTE LTD" reads
// "Courts Megastore Tampines". Reference numbers, card and terminal codes,
// unit numbers, the city and country go. Empty when nothing readable is
// left, or when it is a payment to a person (PayNow, GIRO, a transfer), so
// a caller skips that entry instead of printing a code.
export function tidyName(description: string | undefined) {
  const raw = String(description ?? "").replace(/\s+/g, " ").trim();
  if (!raw || PAYMENT_RAIL.test(raw)) {
    return "";
  }
  const wasUpper = !/[a-z]/.test(raw);
  const words = raw
    .replace(CURRENCY_AMOUNT, " ")
    .replace(/#\s?\d+(?:-\d+)?/g, " ")
    .replace(/\*+/g, " ")
    .replace(COMPANY_SUFFIX, "")
    .split(" ")
    .filter((word) => word && !isCodeWord(word));
  while (words.length > 1 && LOCATION_WORD.test(words.at(-1)!.replace(/[.,]/g, ""))) {
    words.pop();
  }
  const cleaned = words.join(" ").replace(COMPANY_SUFFIX, "").replace(/^[\s,.:;/*-]+|[\s,.:;/*-]+$/g, "").slice(0, 60);
  const letters = cleaned.replace(/[^\p{L}]/gu, "");
  if (letters.length < 2 || cleaned.split(" ").every((word) => GENERIC_WORD.test(word.replace(/[^\p{L}]/gu, "")))) {
    return "";
  }
  return cleaned.split(" ").map((word) => titleWord(word, wasUpper)).join(" ");
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
