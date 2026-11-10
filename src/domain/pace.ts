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
//   month, or statement imports behind that matter this month
//   (paceAccountsBehind below). The reason is always shown in words
//   (pace-quiet.ts), never left as silence.
import { addMonths, daysInMonth } from "./money-signals/format";

export const PACE_QUIET_DAYS = 5;
export const PACE_MIN_MONTHS = 3;
export const PACE_ONE_OFF_MINOR = 30_000;
export const PACE_ONE_OFF_TIMES_MEDIAN = 3;
export const PACE_NARROW_RATIO = 0.1;
export const PACE_IMPORTS_BEHIND_DAYS = 10;
// An account behind only matters if it matters this month: it carries at
// least a quarter of the last 3 months' spending, is the one spending the
// most, or has charges this month already.
export const PACE_BEHIND_MAIN_SHARE = 0.25;
// Behind accounts count together when they carry that share between them;
// each one under this share is then still left out.
export const PACE_BEHIND_MINOR_SHARE = 0.05;
// Each account's own cadence: nothing for more than twice its usual gap
// between charge days is behind, but never sooner than 10 days and never
// later than 21 (a main account is never excused for weeks).
export const PACE_BEHIND_CADENCE_TIMES = 2;
export const PACE_BEHIND_MAX_DAYS = 21;

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

// What one account did in the last 3 months and this month (the view's
// charges), and its latest entry of any kind.
export interface PaceAccountActivity {
  accountId: string;
  name: string;
  // Latest entry of any kind on the account; "" when it has none.
  lastEntryDate: string;
  // The view's spending on it since the start of the month 3 months back.
  spendMinor: number;
  // Distinct days with a charge in that window.
  chargeDays: string[];
  chargesThisMonth: number;
}

export interface PaceBehindAccount {
  accountId: string;
  name: string;
  lastDate: string;
}

const dayNumber = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86_400_000;

/**
 * The accounts whose missing statements would make the pace wrong.
 * 1. Behind by their own cadence (see the constants above).
 * 2. And mattering this month: a quarter of the last 3 months' spending,
 *    the account spending the most, or charges this month. A minor account
 *    that stopped months ago, with nothing this month, is ignored.
 * 3. Several smaller accounts count together: when the accounts behind carry
 *    a quarter of the spending between them, each one of at least 5% is
 *    named (a household of many cards, none of them a quarter).
 * A pace built on missing statements is worse than none, so this leans
 * towards staying quiet. Biggest spender first.
 */
export function paceAccountsBehind(accounts: PaceAccountActivity[], today: string): PaceBehindAccount[] {
  const active = accounts.filter((account) => account.spendMinor > 0 || account.chargesThisMonth > 0);
  const total = active.reduce((sum, account) => sum + account.spendMinor, 0);
  const share = (account: PaceAccountActivity) => (total > 0 ? account.spendMinor / total : 0);
  const top = [...active].sort((left, right) => right.spendMinor - left.spendMinor)[0];
  const candidates = active.filter((account) => {
    const days = [...new Set(account.chargeDays)].sort().map(dayNumber);
    const usualGap = median(days.slice(1).map((day, index) => day - days[index]));
    const allowed = Math.min(PACE_BEHIND_MAX_DAYS, Math.max(PACE_IMPORTS_BEHIND_DAYS, Math.ceil(usualGap * PACE_BEHIND_CADENCE_TIMES)));
    return dayNumber(today) - (account.lastEntryDate ? dayNumber(account.lastEntryDate) : -Infinity) > allowed;
  });
  const matters = (account: PaceAccountActivity) => share(account) >= PACE_BEHIND_MAIN_SHARE || account === top || account.chargesThisMonth > 0;
  const together = candidates.reduce((sum, account) => sum + share(account), 0) >= PACE_BEHIND_MAIN_SHARE;
  return candidates
    .filter((account) => matters(account) || (together && share(account) >= PACE_BEHIND_MINOR_SHARE))
    .sort((left, right) => right.spendMinor - left.spendMinor)
    .map((account) => ({ accountId: account.accountId, name: account.name, lastDate: account.lastEntryDate }));
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

// Quiet (null) before April, and unless every month from January and each
// of the last 6 complete months is known: a gap would count as $0 kept.
export function yearEndKept(months: KeptMonth[], thisMonth: string, leftLowMinor: number, leftHighMinor: number) {
  const number = Number(thisMonth.slice(5, 7));
  if (number < YEAR_PACE_FIRST_MONTH) return null;
  const year = thisMonth.slice(0, 4);
  const kept = new Map(months.map((month) => [month.month, month.keptMinor]));
  const lastSixMonths = [6, 5, 4, 3, 2, 1].map((back) => addMonths(thisMonth, -back));
  const yearMonths = Array.from({ length: number - 1 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`);
  if (![...lastSixMonths, ...yearMonths].every((month) => kept.has(month))) return null;
  const sorted = lastSixMonths.map((month) => kept.get(month)!).sort((left, right) => left - right);
  const secondLowest = sorted[1];
  const secondHighest = sorted[sorted.length - 2];
  const keptSoFar = yearMonths.reduce((sum, month) => sum + kept.get(month)!, 0);
  const monthsLeft = 12 - number;
  const low = keptSoFar + leftLowMinor + monthsLeft * secondLowest;
  const high = keptSoFar + leftHighMinor + monthsLeft * secondHighest;
  return { year, lowMinor: low, highMinor: high, shown: roundOutward(low, high), keptSoFarMinor: keptSoFar, monthsLeft, secondLowestMinor: secondLowest, secondHighestMinor: secondHighest };
}
