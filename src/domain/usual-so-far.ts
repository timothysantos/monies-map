// More than usual so far (DOMAIN.md "Usual Level", "so far"): a month in
// progress compared like for like. Spending up to today's day of the month
// is compared with the same day-of-month point of earlier months (the 10th
// with earlier 10ths, never with whole months), averaged over the last 6
// months that have data. It reports what has happened; it never predicts.
//
// One engine for Summary's "What changed this month" card (its "more than
// usual" mark; it replaced the Money insights lines) and Ask's "is that more than usual?" and "what
// changed?" when they are about the month in progress.
import { spendingMinor } from "./category-offset";
import { addMonths, daysInMonth } from "./money-signals/format";

export const SO_FAR_MONTHS = 6;
export const SO_FAR_MIN_MONTHS = 2;
// A category is "more than usual" only with both: more than 20% and more than $50 above.
export const SO_FAR_MIN_RATIO = 0.2;
export const SO_FAR_MIN_MINOR = 5_000;

export interface SoFarEntry {
  id: string;
  date: string;
  categoryName: string;
  entryType: string;
  // The view's amount.
  amountMinor: number;
}

export interface SoFarGroup {
  key: string;
  nowMinor: number;
  // The average of the same day-of-month point over the months with data.
  usualMinor: number;
  diffMinor: number;
  // This month's entries so far (the "so far" figure opens exactly these).
  ids: string[];
}

export interface SoFarResult {
  month: string;
  day: number;
  // The earlier months that have data, newest first (at most 6).
  months: string[];
  groups: SoFarGroup[];
}

const spend = (entry: SoFarEntry) => spendingMinor({ entryType: entry.entryType, categoryName: entry.categoryName, amountMinor: entry.amountMinor });

// The day of a month that matches `day` (the 31st in a 30-day month is its
// 30th).
const dayPoint = (month: string, day: number) => `${month}-${String(Math.min(day, daysInMonth(month))).padStart(2, "0")}`;

/** Each group's spending so far this month against its usual by this day. */
export function sameDayUsual(entries: SoFarEntry[], today: string, keyOf: (entry: SoFarEntry) => string, monthsBack = SO_FAR_MONTHS): SoFarResult {
  const month = today.slice(0, 7);
  const day = Number(today.slice(8, 10));
  const counted = entries.filter((entry) => spend(entry) !== 0);
  const earlier = Array.from({ length: 24 }, (_, index) => addMonths(month, -(index + 1)))
    .filter((item) => counted.some((entry) => entry.date.slice(0, 7) === item))
    .slice(0, monthsBack);
  const byKey = new Map<string, { now: number; ids: string[]; past: Map<string, number> }>();
  for (const entry of counted) {
    const at = entry.date.slice(0, 7);
    const isNow = at === month && entry.date <= today;
    const isPast = earlier.includes(at) && entry.date <= dayPoint(at, day);
    if (!isNow && !isPast) continue;
    const key = keyOf(entry);
    const group = byKey.get(key) ?? { now: 0, ids: [] as string[], past: new Map<string, number>() };
    if (isNow) {
      group.now += spend(entry);
      group.ids.push(entry.id);
    } else {
      group.past.set(at, (group.past.get(at) ?? 0) + spend(entry));
    }
    byKey.set(key, group);
  }
  const groups = [...byKey.entries()].map(([key, group]) => {
    const usual = earlier.length ? Math.round(earlier.reduce((sum, item) => sum + (group.past.get(item) ?? 0), 0) / earlier.length) : 0;
    return { key, nowMinor: group.now, usualMinor: usual, diffMinor: group.now - usual, ids: group.ids.sort() };
  });
  return { month, day, months: earlier, groups };
}

/**
 * The categories well above their usual so far (more than 20% and more than
 * $50, with at least 2 months of history), largest difference first. The
 * Summary card marks its rows with these; it is not capped.
 */
export function categoriesAboveUsual(entries: SoFarEntry[], today: string): { day: number; months: number; categories: SoFarGroup[] } {
  const result = sameDayUsual(entries, today, (entry) => entry.categoryName);
  if (result.months.length < SO_FAR_MIN_MONTHS) return { day: result.day, months: result.months.length, categories: [] };
  const categories = result.groups
    .filter((group) => group.diffMinor > SO_FAR_MIN_MINOR && group.nowMinor > group.usualMinor * (1 + SO_FAR_MIN_RATIO))
    .sort((left, right) => right.diffMinor - left.diffMinor || left.key.localeCompare(right.key));
  return { day: result.day, months: result.months.length, categories };
}
