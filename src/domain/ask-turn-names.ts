// "The model states intent, the server completes" (docs/flows/ask-flow.md,
// "Three principles"): the readers the Ask turn uses to turn what a person
// (or the model repeating them) said into the household's own records.
//
// The model is only asked to report what the message says: a name as written
// ("joyce's", "J", "citi"), a month as a word ("september", "last month"), a
// day as a word ("yesterday", "last friday"), an amount as written ("1.6",
// "$1,200", "fifty bucks", "1.2k"). Everything the app can work out is worked
// out here, so a phrasing the model passes through differently never turns
// into a question.
//
// Pure: no database, no network. The only clock is the `today` it is given.

// ---------------------------------------------------------------------------
// Names

export type NameMatch =
  | { kind: "match"; index: number }
  | { kind: "ambiguous"; indexes: number[] }
  | { kind: "none" };

// Lower case, accents folded, a possessive and punctuation taken out, so
// "Joyce's", "JOYCE" and "joyce." read the same.
export function normaliseName(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/'s\b/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP_TOKENS = new Set(["the", "my", "our", "a", "an", "and", "card", "account", "wallet", "group"]);

function tokensOf(normalised: string) {
  return normalised.split(" ").filter(Boolean);
}

function significantTokens(normalised: string) {
  const tokens = tokensOf(normalised);
  const kept = tokens.filter((token) => !STOP_TOKENS.has(token));
  return kept.length ? kept : tokens;
}

// Edit distance, early out above `limit`.
export function editDistance(left: string, right: string, limit = 3) {
  if (Math.abs(left.length - right.length) > limit) return limit + 1;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    let best = row;
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      const value = Math.min(previous[column] + 1, current[column - 1] + 1, previous[column - 1] + cost);
      current.push(value);
      best = Math.min(best, value);
    }
    if (best > limit) return limit + 1;
    previous = current;
  }
  return previous[right.length];
}

// How many typos a word of this length may carry and still be that word.
function typoBudget(length: number) {
  if (length >= 7) return 2;
  if (length >= 4) return 1;
  return 0;
}

// Which candidate a name means, in order of how sure the match is: the same
// name; a single letter that starts exactly one name ("J"); every word of the
// query starting a word of the candidate ("citi" for "Citi Rewards 4417");
// one containing the other ("transportation" for "Transport"); and last a
// typo or two ("Joyse"). Two candidates at the same level is ambiguous: the
// caller asks, as two readings would write different things.
export function matchName(query: unknown, candidates: readonly string[]): NameMatch {
  const wanted = normaliseName(query);
  if (!wanted) return { kind: "none" };
  const names = candidates.map(normaliseName);
  const pick = (indexes: number[]): NameMatch | null =>
    indexes.length === 1 ? { kind: "match", index: indexes[0] } : indexes.length > 1 ? { kind: "ambiguous", indexes } : null;
  const where = (test: (name: string, index: number) => boolean) => names.flatMap((name, index) => (name && test(name, index) ? [index] : []));

  const exact = pick(where((name) => name === wanted));
  if (exact) return exact;

  if (wanted.length === 1) {
    return pick(where((name) => significantTokens(name).some((token) => token.startsWith(wanted)))) ?? { kind: "none" };
  }

  const wantedTokens = significantTokens(wanted);
  const prefix = pick(where((name) => {
    const tokens = tokensOf(name);
    return wantedTokens.every((token) => tokens.some((candidate) => candidate === token || (token.length >= 2 && candidate.startsWith(token))));
  }));
  if (prefix) {
    // "Home" beats "Home trip" when it is a whole word of exactly one name.
    if (prefix.kind === "ambiguous") {
      const whole = where((name) => wantedTokens.every((token) => tokensOf(name).includes(token)) && tokensOf(name).length === wantedTokens.length);
      return pick(whole) ?? prefix;
    }
    return prefix;
  }

  if (wanted.length >= 3) {
    const contains = pick(where((name) => (name.length >= 3 && (name.includes(wanted) || wanted.includes(name))) || significantTokens(name).some((token) => token.length >= 4 && wanted.includes(token))));
    if (contains) return contains;
  }

  // Typos: every query word is within a typo or two of a word of the name;
  // the nearest name wins only when it is alone at that distance.
  const scored: Array<{ index: number; distance: number }> = [];
  names.forEach((name, index) => {
    if (!name) return;
    const tokens = tokensOf(name);
    let total = 0;
    for (const token of wantedTokens) {
      const budget = typoBudget(token.length);
      const best = Math.min(...tokens.map((candidate) => editDistance(token, candidate, budget)));
      if (best > budget) return;
      total += best;
    }
    scored.push({ index, distance: total });
  });
  if (!scored.length) return { kind: "none" };
  const nearest = Math.min(...scored.map((item) => item.distance));
  return pick(scored.filter((item) => item.distance === nearest).map((item) => item.index)) ?? { kind: "none" };
}

// The names nearest to what was said, for chips on a question back.
export function closestNames(query: unknown, candidates: readonly string[], count = 3): string[] {
  const wanted = normaliseName(query);
  if (!wanted) return candidates.slice(0, count);
  const scored = candidates.map((candidate) => {
    const name = normaliseName(candidate);
    const shared = tokensOf(wanted).filter((token) => tokensOf(name).some((other) => other.startsWith(token.slice(0, 3)) || token.startsWith(other.slice(0, 3)))).length;
    return { candidate, score: shared * 10 - editDistance(wanted, name, 12) };
  });
  return scored.sort((left, right) => right.score - left.score).slice(0, count).map((item) => item.candidate);
}

// ---------------------------------------------------------------------------
// Amounts

const AMOUNT_MAX_MINOR = 1_000_000_000;

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

// "fifty", "twenty five", "a hundred", "two hundred and fifty", "one thousand"
// as a number, or null. Whole numbers only.
export function numberFromWords(text: string): number | null {
  const words = text.toLowerCase().replace(/-/g, " ").split(/\s+/).filter((word) => word && word !== "and");
  if (!words.length) return null;
  let total = 0;
  let current = 0;
  let seen = false;
  for (const word of words) {
    if (word === "a" && !seen) continue;
    if (word in UNITS) current += UNITS[word];
    else if (word in TENS) current += TENS[word];
    else if (word === "hundred") current = (current || 1) * 100;
    else if (word === "thousand") {
      total += (current || 1) * 1000;
      current = 0;
    } else return null;
    seen = true;
  }
  return seen ? total + current : null;
}

// "12", "$12.50", "S$12", "12 dollars", "1,200", "1.2k", "fifty bucks", "1,6"
// (a comma before one or two digits is a decimal point) as minor units, or
// null. Never a percent: that is a share, read by the share reader.
export function readAmountMinor(value: unknown): number | null {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value : "";
  const text = raw
    .trim()
    .toLowerCase()
    .replace(/\b(?:sgd|s\$|dollars?|bucks?|sing(?:apore)? dollars?)\b/g, " ")
    .replace(/^s\$|^\$|\$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || text.includes("%")) return null;
  const numeric = /^(\d[\d,]*(?:\.\d{1,2})?|\d+,\d{1,2}|\.\d{1,2})\s?(k?)$/.exec(text);
  if (numeric) {
    let digits = numeric[1];
    // "1,6" and "12,50" are decimals; "1,200" and "1,200,000" are thousands.
    if (/^\d+,\d{1,2}$/.test(digits)) digits = digits.replace(",", ".");
    else digits = digits.replace(/,/g, "");
    const number = Number(digits) * (numeric[2] ? 1000 : 1);
    if (!Number.isFinite(number)) return null;
    const minor = Math.round(number * 100);
    return minor > 0 && minor <= AMOUNT_MAX_MINOR ? minor : null;
  }
  const whole = numberFromWords(text);
  if (whole !== null) {
    const minor = whole * 100;
    return minor > 0 && minor <= AMOUNT_MAX_MINOR ? minor : null;
  }
  return null;
}

// Every amount a message says, as minor units: digits ("12.50", "$1,200",
// "1.2k") and simple number words ("fifty"). A percent is not an amount.
export function amountsIn(text: string): Set<number> {
  const found = new Set<number>();
  const lower = text.toLowerCase();
  for (const match of lower.matchAll(/(?<![\w.])\$?\d[\d,]*(?:\.\d{1,2})?k?(?!\d|[.,]\d)(?!\s?%)/g)) {
    const minor = readAmountMinor(match[0]);
    if (minor !== null) found.add(minor);
    // "1,6" read as a thousands group above is also 1.6 when it has two digits.
    const comma = /^\$?(\d+),(\d{1,2})$/.exec(match[0]);
    if (comma) {
      const alt = readAmountMinor(`${comma[1]}.${comma[2]}`);
      if (alt !== null) found.add(alt);
    }
  }
  for (const match of lower.matchAll(/\b(?:(?:a|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|zero|and)[\s-]+)*(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)\b/g)) {
    const minor = readAmountMinor(match[0]);
    if (minor !== null) found.add(minor);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Days and months

const MONTH_WORDS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function monthIndexOf(word: string): number | null {
  const lower = word.toLowerCase().replace(/\.$/, "");
  if (lower.length < 3) return null;
  const index = MONTH_WORDS.findIndex((name) => name === lower || (lower.length >= 3 && name.startsWith(lower) && (lower.length >= 4 || name.slice(0, 3) === lower)));
  return index >= 0 ? index : lower === "sept" ? 8 : null;
}

function isoDay(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day ? date.toISOString().slice(0, 10) : null;
}

function addDays(iso: string, days: number) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

// A day as the model may pass it on: an ISO date, or the person's own words
// ("today", "yesterday", "2 days ago", "friday", "last friday", "12 oct",
// "oct 12", "12/10", "12/10/2026"). The most recent such day that is not in
// the future ("12 dec" in October is last December). Null when it is not a day.
export function readDayWord(value: unknown, today: string): string | null {
  const text = String(value ?? "").trim().toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (text === "today" || text === "tonight" || text === "this morning" || text === "just now") return today;
  if (text === "yesterday" || text === "last night") return addDays(today, -1);
  if (text === "day before yesterday") return addDays(today, -2);
  const ago = /^(\d{1,3}|a|one|two|three|four|five|six|seven) days? ago$/.exec(text);
  if (ago) {
    const count = /^\d+$/.test(ago[1]) ? Number(ago[1]) : numberFromWords(ago[1]);
    return count ? addDays(today, -count) : null;
  }
  if (/^(a|one) week ago$/.test(text)) return addDays(today, -7);
  const weekday = /^(?:on |last |this |on last |on this )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)$/.exec(text);
  if (weekday) {
    const target = WEEKDAYS.findIndex((name) => name.startsWith(weekday[1].slice(0, 3)));
    const current = new Date(`${today}T00:00:00Z`).getUTCDay();
    // "friday" on a Friday is today; "last friday" on a Friday is a week back.
    let back = (current - target + 7) % 7;
    if (back === 0 && text.startsWith("last ")) back = 7;
    return addDays(today, -back);
  }
  const [todayYear, todayMonth] = [Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1];
  const withYear = (month: number, day: number, year: number | null) => {
    if (year !== null) return isoDay(year, month, day);
    const candidate = isoDay(todayYear, month, day);
    if (!candidate) return null;
    return candidate <= today ? candidate : isoDay(todayYear - 1, month, day);
  };
  const dayMonth = /^(\d{1,2})(?:st|nd|rd|th)?(?: of)? ([a-z]{3,9})\.?(?: (\d{4}))?$/.exec(text);
  if (dayMonth) {
    const month = monthIndexOf(dayMonth[2]);
    return month === null ? null : withYear(month, Number(dayMonth[1]), dayMonth[3] ? Number(dayMonth[3]) : null);
  }
  const monthDay = /^([a-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/.exec(text);
  if (monthDay) {
    const month = monthIndexOf(monthDay[1]);
    return month === null ? null : withYear(month, Number(monthDay[2]), monthDay[3] ? Number(monthDay[3]) : null);
  }
  // Day first: this app is Singapore's.
  const slash = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(text);
  if (slash) {
    const year = slash[3] ? (slash[3].length === 2 ? 2000 + Number(slash[3]) : Number(slash[3])) : null;
    return withYear(Number(slash[2]) - 1, Number(slash[1]), year);
  }
  void todayMonth;
  return null;
}

// A month as the model may pass it on: YYYY-MM, or "september", "sep",
// "sep 2025", "last month", "this month", "previous month", "09/2026". The
// most recent such month that is not in the future. Null when it is not one.
export function readMonthWord(value: unknown, today: string): string | null {
  const text = String(value ?? "").trim().toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
  if (!text) return null;
  if (/^\d{4}-\d{2}$/.test(text)) return text;
  const thisMonth = today.slice(0, 7);
  const shift = (months: number) => {
    const [year, month] = thisMonth.split("-").map(Number);
    const index = year * 12 + (month - 1) + months;
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
  };
  if (text === "this month" || text === "current month" || text === "now") return thisMonth;
  if (text === "last month" || text === "previous month" || text === "prior month") return shift(-1);
  if (text === "next month") return shift(1);
  const monthsAgo = /^(\d{1,2}|two|three|four|five|six) months? ago$/.exec(text);
  if (monthsAgo) {
    const count = /^\d+$/.test(monthsAgo[1]) ? Number(monthsAgo[1]) : numberFromWords(monthsAgo[1]);
    return count ? shift(-count) : null;
  }
  const slash = /^(\d{1,2})[/-](\d{4})$/.exec(text) ?? null;
  if (slash) {
    const month = Number(slash[1]);
    return month >= 1 && month <= 12 ? `${slash[2]}-${String(month).padStart(2, "0")}` : null;
  }
  const yearFirst = /^(\d{4})[/.](\d{1,2})$/.exec(text);
  if (yearFirst) {
    const month = Number(yearFirst[2]);
    return month >= 1 && month <= 12 ? `${yearFirst[1]}-${String(month).padStart(2, "0")}` : null;
  }
  const named = /^(?:in |for |during )?([a-z]{3,9})\.?(?: (\d{4}))?$/.exec(text);
  if (named) {
    const month = monthIndexOf(named[1]);
    if (month === null) return null;
    const label = String(month + 1).padStart(2, "0");
    if (named[2]) return `${named[2]}-${label}`;
    const year = Number(today.slice(0, 4));
    return `${year}-${label}` <= thisMonth ? `${year}-${label}` : `${year - 1}-${label}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// What the message itself says about a day or a month

const WEEKDAY_FULL = "sunday|monday|tuesday|wednesday|thursday|friday|saturday";
const MONTH_FULL = "january|february|march|april|may|june|july|august|september|october|november|december";
const MONTH_ABBR = "jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";

function paddedLower(text: string) {
  return ` ${String(text ?? "").toLowerCase().replace(/[,.!?]/g, " ").replace(/\s+/g, " ")} `;
}

// The one day the message names ("yesterday", "2 days ago", "last friday",
// "12 oct"), read from today, or null when it names none or several. The
// model reports a day as it likes (even as a date it worked out wrongly);
// a day the person wrote is what the card gets.
export function findDayIn(text: string, today: string): string | null {
  const lower = paddedLower(text);
  const days = new Set<string>();
  const add = (phrase: string) => {
    const day = readDayWord(phrase.trim(), today);
    if (day) days.add(day);
  };
  for (const match of lower.matchAll(/ (day before yesterday|yesterday|today|tonight|last night) /g)) add(match[1]);
  for (const match of lower.matchAll(/ ((?:\d{1,3}|a|one|two|three|four|five|six|seven) days? ago) /g)) add(match[1]);
  for (const match of lower.matchAll(new RegExp(` ((?:on |last |this |on last )(?:${WEEKDAY_FULL})) `, "g"))) add(match[1]);
  const monthWord = `${MONTH_FULL}|${MONTH_ABBR}`;
  for (const match of lower.matchAll(new RegExp(` (\\d{1,2}(?:st|nd|rd|th)?(?: of)? (?:${monthWord})(?: \\d{4})?) `, "g"))) add(match[1]);
  for (const match of lower.matchAll(new RegExp(` ((?:${monthWord}) \\d{1,2}(?:st|nd|rd|th)?(?: \\d{4})?) `, "g"))) add(match[1]);
  return days.size === 1 ? [...days][0] : null;
}

// The one month the message names ("last month", "this month", "3 months
// ago", "in september", "sep 2025"), or null when none or several.
export function findMonthIn(text: string, today: string): string | null {
  const lower = paddedLower(text);
  const months = new Set<string>();
  const add = (phrase: string) => {
    const month = readMonthWord(phrase.trim(), today);
    if (month) months.add(month);
  };
  for (const match of lower.matchAll(/ (this month|last month|previous month|current month|(?:\d{1,2}|two|three|four|five|six) months? ago) /g)) add(match[1]);
  const monthWord = `${MONTH_FULL}|${MONTH_ABBR}`;
  // A month name counts after a month-ish word or beside a year, so "may" the
  // verb and "mar" the name are told apart.
  for (const match of lower.matchAll(new RegExp(` (?:in|for|during|of|from|to|since|until|through|by|compare|vs|versus|with|and) ((?:${monthWord})(?: \\d{4})?) `, "g"))) add(match[1]);
  for (const match of lower.matchAll(new RegExp(` ((?:${monthWord}) \\d{4}) `, "g"))) add(match[1]);
  // A whole month name needs no helper word ("how did September go?"),
  // except May, which is also a verb.
  for (const match of lower.matchAll(new RegExp(` (${MONTH_FULL.replace("|may", "")}) `, "g"))) add(match[1]);
  return months.size === 1 ? [...months][0] : null;
}

// ---------------------------------------------------------------------------
// Shares

export type ShareValue =
  | { kind: "all" }
  | { kind: "percent"; percent: number }
  | { kind: "amount"; minor: number }
  | { kind: "bare"; number: number };

// One share as the person said it. "100%", "70 percent", "half", "all",
// "everything", "$1.60", "1.6 dollars" are what they are; a bare "1.6" is
// told apart by the caller (an amount that fits the entry, else a percent).
export function readShareValue(value: unknown): ShareValue | null {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!text) return null;
  if (/^(all|whole|everything|the lot|full|entire|100)(?: of (?:it|the amount))?$/.test(text)) return text === "100" ? { kind: "bare", number: 100 } : { kind: "all" };
  if (text === "half" || text === "50/50" || text === "a half") return { kind: "percent", percent: 50 };
  if (text === "a third") return { kind: "percent", percent: 100 / 3 };
  if (text === "a quarter") return { kind: "percent", percent: 25 };
  const percent = /^(\d+(?:\.\d+)?)\s?(?:%|percent|pct|per cent)$/.exec(text);
  if (percent) return { kind: "percent", percent: Number(percent[1]) };
  if (/[$]|dollars?|bucks?|sgd/.test(text)) {
    const minor = readAmountMinor(text);
    return minor === null ? null : { kind: "amount", minor };
  }
  const bare = /^\d+(?:[.,]\d+)?$/.exec(text.replace(/,(?=\d{1,2}$)/, "."));
  return bare ? { kind: "bare", number: Number(text.replace(/,(?=\d{1,2}$)/, ".")) } : null;
}
