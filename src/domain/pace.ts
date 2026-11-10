// If this keeps up (DOMAIN.md "Pace"; owner decision, 2026-11-10): where
// this month's spending, and what is left of what comes in, end up if the
// month keeps going as it has. Always a range, low to high, rounded
// outward; built only from recorded entries; never from AI. Pure: the facts
// come from the repeating charges read (pages/repeating-charges.ts).
//
// - Spent so far: the month's recorded spending (the figure the page shows).
// - The lumpy parts are counted once, as recorded, never scaled up: charges
//   in a repeating series, and one-offs (a single entry of at least $300, or
//   at least 3 times the month's middle entry, not in a series).
// - Everyday pace: what is left, per day gone (this month's rate), and the
//   middle of the last 3 complete months' everyday daily rates (the usual
//   rate). Low and high are the days left at the lower and the higher rate;
//   two rates within 10% of each other widen to 10% either side of their
//   middle.
// - Bills still to come: each monthly series whose usual day is after today
//   and still this month, at its last amount (one that changes: the lowest
//   and highest of its last 3); a yearly one only when its date falls in
//   the month.
// - Money in: what came in so far, plus regular income still due this month
//   on its usual day. Nothing else is assumed.
// - Quiet: days 1 to 5, fewer than 3 complete months with entries, a past
//   month, or statement imports behind.
import { daysInMonth } from "./money-signals/format";

export const PACE_QUIET_DAYS = 5;
export const PACE_MIN_MONTHS = 3;
export const PACE_ONE_OFF_MINOR = 30_000;
export const PACE_ONE_OFF_TIMES_MEDIAN = 3;
export const PACE_NARROW_RATIO = 0.1;
export const PACE_IMPORTS_BEHIND_DAYS = 10;

export interface PaceEntry {
  id: string;
  date: string;
  amountMinor: number;
  // In a repeating series (Subscriptions and bills).
  inSeries: boolean;
  // Several charges of one shop in one day's group (added together): never a
  // one-off.
  several?: boolean;
  label?: string;
}

export interface PaceBill {
  key: string;
  name: string;
  date: string;
  lowMinor: number;
  highMinor: number;
}

export interface PaceFacts {
  month: string;
  today: string;
  // This month's spending entries so far (the view's amounts).
  entries: PaceEntry[];
  // The last 3 complete months' everyday spending (spending less series
  // charges and one-offs) and their days.
  usualMonths: Array<{ month: string; everydayMinor: number; days: number }>;
  bills: PaceBill[];
  incomeSoFarMinor: number;
  incomeToCome: Array<{ name: string; date: string; amountMinor: number }>;
  // Complete months with entries in the view, and whether imports are behind.
  monthsWithEntries: number;
  importsBehind: boolean;
}

export type PaceQuiet = "early" | "history" | "past" | "imports";

export interface PaceRange {
  // Added to what is spent so far: the everyday pace and the bills to come.
  addLowMinor: number;
  addHighMinor: number;
  daysGone: number;
  daysLeft: number;
  thisRateMinor: number;
  usualRateMinor: number;
  everydaySoFarMinor: number;
  everydayLowMinor: number;
  everydayHighMinor: number;
  billsLowMinor: number;
  billsHighMinor: number;
  oneOffs: PaceEntry[];
  seriesSoFarMinor: number;
  incomeMinor: number;
}

const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** The one-offs among a month's entries: big single costs not in a series. */
export function paceOneOffs(entries: PaceEntry[]) {
  const middle = median(entries.map((entry) => entry.amountMinor));
  return entries.filter((entry) => !entry.inSeries && !entry.several
    && (entry.amountMinor >= PACE_ONE_OFF_MINOR || (middle > 0 && entry.amountMinor >= middle * PACE_ONE_OFF_TIMES_MEDIAN)));
}

/** A month's everyday spending: its spending less series charges and one-offs. */
export function everydayMinor(entries: PaceEntry[]) {
  const oneOffs = new Set(paceOneOffs(entries).map((entry) => entry.id));
  return entries.filter((entry) => !entry.inSeries && !oneOffs.has(entry.id)).reduce((sum, entry) => sum + entry.amountMinor, 0);
}

export function paceQuiet(facts: PaceFacts): PaceQuiet | null {
  if (facts.month !== facts.today.slice(0, 7)) return "past";
  if (Number(facts.today.slice(8, 10)) <= PACE_QUIET_DAYS) return "early";
  if (facts.monthsWithEntries < PACE_MIN_MONTHS || facts.usualMonths.length < PACE_MIN_MONTHS) return "history";
  if (facts.importsBehind) return "imports";
  return null;
}

/** The range added to what is spent so far, or the reason it is quiet. */
export function buildPaceRange(facts: PaceFacts): PaceRange | { quiet: PaceQuiet } {
  const quiet = paceQuiet(facts);
  if (quiet) return { quiet };
  const days = daysInMonth(facts.month);
  const daysGone = Number(facts.today.slice(8, 10));
  const daysLeft = days - daysGone;
  const oneOffs = paceOneOffs(facts.entries);
  const everydaySoFar = everydayMinor(facts.entries);
  const thisRate = everydaySoFar / daysGone;
  const usualRate = median(facts.usualMonths.map((month) => month.everydayMinor / month.days));
  let lowRate = Math.min(thisRate, usualRate);
  let highRate = Math.max(thisRate, usualRate);
  const middle = (thisRate + usualRate) / 2;
  if (highRate - lowRate <= middle * PACE_NARROW_RATIO) {
    lowRate = middle * (1 - PACE_NARROW_RATIO);
    highRate = middle * (1 + PACE_NARROW_RATIO);
  }
  const everydayLow = Math.round(daysLeft * lowRate);
  const everydayHigh = Math.round(daysLeft * highRate);
  const billsLow = facts.bills.reduce((sum, bill) => sum + bill.lowMinor, 0);
  const billsHigh = facts.bills.reduce((sum, bill) => sum + bill.highMinor, 0);
  return {
    addLowMinor: everydayLow + billsLow,
    addHighMinor: everydayHigh + billsHigh,
    daysGone,
    daysLeft,
    thisRateMinor: Math.round(thisRate),
    usualRateMinor: Math.round(usualRate),
    everydaySoFarMinor: everydaySoFar,
    everydayLowMinor: everydayLow,
    everydayHighMinor: everydayHigh,
    billsLowMinor: billsLow,
    billsHighMinor: billsHigh,
    oneOffs,
    seriesSoFarMinor: facts.entries.filter((entry) => entry.inSeries).reduce((sum, entry) => sum + entry.amountMinor, 0),
    incomeMinor: facts.incomeSoFarMinor + facts.incomeToCome.reduce((sum, item) => sum + item.amountMinor, 0)
  };
}

/** Outward to $10 under $1,000, $50 under $10,000, then $100. */
export function roundOutward(lowMinor: number, highMinor: number) {
  const step = (value: number) => (Math.abs(value) < 100_000 ? 1_000 : Math.abs(value) < 1_000_000 ? 5_000 : 10_000);
  return {
    lowMinor: Math.floor(lowMinor / step(lowMinor)) * step(lowMinor),
    highMinor: Math.ceil(highMinor / step(highMinor)) * step(highMinor)
  };
}

/**
 * A total that may be one amount (every part fixed) or a range: one amount
 * is rounded to its nearest step ("about $20" for $19.98), never widened
 * into "$10 to $20"; a range is rounded outward (Coming up's total).
 */
export function roundRange(lowMinor: number, highMinor: number) {
  if (lowMinor !== highMinor) return roundOutward(lowMinor, highMinor);
  const step = Math.abs(lowMinor) < 100_000 ? 1_000 : Math.abs(lowMinor) < 1_000_000 ? 5_000 : 10_000;
  const about = Math.max(step, Math.round(lowMinor / step) * step);
  return { lowMinor: about, highMinor: about };
}

/** Spending at month end and what is left of what comes in, both ranges. */
export function paceTotals(spentSoFarMinor: number, range: PaceRange) {
  const low = spentSoFarMinor + range.addLowMinor;
  const high = spentSoFarMinor + range.addHighMinor;
  const leftLow = range.incomeMinor - high;
  const leftHigh = range.incomeMinor - low;
  return {
    lowMinor: low,
    highMinor: high,
    shown: roundOutward(low, high),
    leftLowMinor: leftLow,
    leftHighMinor: leftHigh,
    leftShown: roundOutward(leftLow, leftHigh)
  };
}

// The year-end savings pace (owner decision D7; Summary only, from April):
// what was kept so far this year (income less spending, complete months),
// plus this month's "left" range, plus each month still to come at the
// second-lowest to second-highest kept amount of the last 6 complete months
// (so one odd month, a bonus that did not come again, never sets it).
export const YEAR_PACE_FIRST_MONTH = 4;

export interface KeptMonth {
  month: string;
  keptMinor: number;
}

export function yearEndKept(months: KeptMonth[], thisMonth: string, leftLowMinor: number, leftHighMinor: number) {
  const number = Number(thisMonth.slice(5, 7));
  if (number < YEAR_PACE_FIRST_MONTH) return null;
  const year = thisMonth.slice(0, 4);
  const complete = months.filter((month) => month.month < thisMonth).sort((left, right) => left.month.localeCompare(right.month));
  const lastSix = complete.slice(-6);
  if (lastSix.length < 6) return null;
  const sorted = lastSix.map((month) => month.keptMinor).sort((left, right) => left - right);
  const secondLowest = sorted[1];
  const secondHighest = sorted[sorted.length - 2];
  const keptSoFar = complete.filter((month) => month.month.startsWith(`${year}-`)).reduce((sum, month) => sum + month.keptMinor, 0);
  const monthsLeft = 12 - number;
  const low = keptSoFar + leftLowMinor + monthsLeft * secondLowest;
  const high = keptSoFar + leftHighMinor + monthsLeft * secondHighest;
  return { year, lowMinor: low, highMinor: high, shown: roundOutward(low, high), keptSoFarMinor: keptSoFar, monthsLeft, secondLowestMinor: secondLowest, secondHighestMinor: secondHighest };
}
