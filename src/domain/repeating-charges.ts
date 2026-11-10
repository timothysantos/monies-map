// Repeating charges (DOMAIN.md "Repeating charge"): the charges that come
// back every month or every year (streaming, phone, broadband, S&CC,
// insurance, utilities), found in recorded entries by fixed rules. One engine
// for the Summary card "Subscriptions and bills", its Coming up list and the
// subscription price change reminder, so they never disagree about what a
// series is or when its price went up.
//
// Pure: the caller loads the charges (expenses only, never a transfer and
// never Investments or Savings), each account's latest entry date and the
// household's choices, and passes today. Nothing here calls AI or guesses:
// a series is the same payee (payeeKey, the rule Account routines use),
// charged about a month (or a year) apart, at similar amounts.
import { addDays, addMonths, daysBetween, daysInMonth, monthsBetween } from "./money-signals/format";
import { payeeKey, payeeName } from "./account-routines";
import { isInvestmentsCategoryName, isSavingsCategoryName } from "./money-jobs";
import { REMINDER_THRESHOLDS } from "./reminders/thresholds";

export type RepeatingPeriod = "monthly" | "yearly";

// The rules' numbers, as the approved design states them.
export const REPEATING_RULES = Object.freeze({
  // How far back charges are read: a monthly series needs about a year, a
  // yearly one two charges a year apart plus the one before a change.
  monthlyLookbackMonths: 13,
  yearlyLookbackMonths: 26,
  // Monthly: charges 25 to 35 days apart, 3 or more in a row.
  monthlyGapMinDays: 25,
  monthlyGapMaxDays: 35,
  monthlyMinRun: 3,
  // Two in a row that pass every other test "might repeat".
  mightRepeatRun: 2,
  // A kept series may miss a month without leaving the list.
  keptGapMaxDays: 70,
  // Yearly: 11 to 13 months apart, 2 or more.
  yearlyGapMinMonths: 11,
  yearlyGapMaxMonths: 13,
  yearlyMinRun: 2,
  // A fixed charge stays within $1 or 5% (10% when charged in another
  // currency) of its amount.
  fixedToleranceMinor: 100,
  fixedToleranceRatio: 0.05,
  foreignToleranceRatio: 0.1,
  // A bill that changes each month stays within half to double its middle
  // amount, and only in these categories (or once kept).
  varyingCategories: Object.freeze(["Bills", "Insurance"]),
  // "Not seen since": the usual day plus this many days has passed.
  lateGraceDays: 10,
  // "Went up" shows on the row for this many days from the first new charge
  // (the reminder keeps its own 45).
  wentUpShowDays: 90
});

// The price change rule the reminder and the row share: charges at one
// amount for several periods in a row, then a new amount at least $1 and 5%
// different. Its numbers are the reminder's (thresholds.ts priceChange).
const PRICE_CHANGE_RULES = REMINDER_THRESHOLDS.priceChange;

export interface PriceCharge {
  date: string;
  month: string;
  amountMinor: number;
}

// Whether two charges are one period apart: next month, or about a year on
// (a yearly charge can land a few days either side of the anniversary).
function isNextPeriod(period: RepeatingPeriod, previous: PriceCharge, next: PriceCharge) {
  const gap = monthsBetween(previous.month, next.month);
  return period === "monthly" ? gap === 1 : gap >= 11 && gap <= 13;
}

// The length of the run of one amount that ends just before `endIndex`
// (exclusive), going back one period at a time. 0 when `endIndex` is 0.
function runLengthBefore(period: RepeatingPeriod, series: PriceCharge[], endIndex: number) {
  if (endIndex <= 0) {
    return 0;
  }
  const amount = series[endIndex - 1].amountMinor;
  let length = 1;
  for (let index = endIndex - 2; index >= 0; index -= 1) {
    if (series[index].amountMinor !== amount || !isNextPeriod(period, series[index], series[index + 1])) {
      break;
    }
    length += 1;
  }
  return length;
}

/**
 * The price change in a series sorted by date, or null: the newest run of
 * one amount, the run before it at a different amount (3 charges, 2 for a
 * yearly one), a step of at least $1 and 5%, and a first new charge no more
 * than `showDays` before today.
 */
export function detectPriceChange<T extends PriceCharge>(period: RepeatingPeriod, series: T[], today: string, showDays: number) {
  const { stableMonthlyCharges, stableYearlyCharges, minChangeMinor, minChangeRatio } = PRICE_CHANGE_RULES;
  if (!series.length) {
    return null;
  }
  const last = series[series.length - 1];
  let firstNew = series.length - 1;
  while (firstNew > 0 && series[firstNew - 1].amountMinor === last.amountMinor && isNextPeriod(period, series[firstNew - 1], series[firstNew])) {
    firstNew -= 1;
  }
  if (firstNew === 0 || !isNextPeriod(period, series[firstNew - 1], series[firstNew])) {
    return null;
  }
  const priorCount = runLengthBefore(period, series, firstNew);
  const oldAmount = series[firstNew - 1].amountMinor;
  const change = Math.abs(last.amountMinor - oldAmount);
  const sinceFirstNew = daysBetween(series[firstNew].date, today);
  const enoughHistory = priorCount >= (period === "monthly" ? stableMonthlyCharges : stableYearlyCharges);
  if (!enoughHistory || change < minChangeMinor || change < oldAmount * minChangeRatio || sinceFirstNew < 0 || sinceFirstNew > showDays) {
    return null;
  }
  return { oldAmount, newAmount: last.amountMinor, lastOldCharge: series[firstNew - 1], firstNewCharge: series[firstNew], priorCount };
}

// One charge as the engine reads it. A loader may pass one row for several
// charges of one description in one month (`ids` longer than one): such a
// month is never part of a series unless the household kept it.
export interface RepeatingChargeRow {
  ids: string[];
  date: string;
  description: string;
  // Positive: the view's amount of the charge (or of all of `ids`).
  amountMinor: number;
  accountId: string;
  categoryName: string;
  entryType: string;
  // Charged in another currency: amounts are compared within 10%.
  isForeign: boolean;
}

export type RepeatingChoiceKind = "kept" | "not_repeating";

export interface RepeatingChoice {
  choice: RepeatingChoiceKind | null;
  displayName: string | null;
}

export type RepeatingStatus = "active" | "late" | "stopped" | "might_repeat" | "taken_off";

export interface RepeatingCharge {
  date: string;
  amountMinor: number;
  ids: string[];
}

export interface RepeatingSeries {
  // payeeKey + "|monthly" or "|yearly": what a choice is kept against.
  seriesKey: string;
  payeeKey: string;
  // The household's own name for it (Rename), else the payee as said.
  name: string;
  payeeName: string;
  period: RepeatingPeriod;
  // "fixed" (one amount, maybe a price change) or "varies" (a bill that
  // changes each month).
  amountKind: "fixed" | "varies";
  status: RepeatingStatus;
  kept: boolean;
  renamed: boolean;
  // The latest charge's category and account.
  categoryName: string;
  accountId: string;
  // The middle day of the month of the last 3 charges.
  usualDay: number;
  // When the next one usually comes (yearly: the last date a year on).
  nextDate: string;
  // How many charges in a row were found.
  runLength: number;
  charges: RepeatingCharge[];
  latest: RepeatingCharge;
  // The lowest and highest of the last 3 charges.
  lastThree: { lowMinor: number; highMinor: number };
  // The focus month (the last complete month) and the 12 months ending it.
  focus: { amountMinor: number; ids: string[] };
  year: { amountMinor: number; ids: string[] };
  // The last charge at the old price and the first at the new one.
  wentUp?: { fromMinor: number; toMinor: number; lastOldDate: string; firstNewDate: string; fromIds: string[]; toIds: string[] };
  // The month of the last charge, for a series that is late or stopped.
  lastSeenMonth?: string;
}

export interface RepeatingChargesInput {
  today: string;
  rows: RepeatingChargeRow[];
  // Each account's latest entry date: a statement not in yet is not a
  // stopped subscription.
  accountLatestDate: Record<string, string>;
  choices?: Record<string, RepeatingChoice>;
}

export interface RepeatingChargesResult {
  focusMonth: string;
  yearStartMonth: string;
  // Listed and counted: active and late series, then stopped ones (paid,
  // so counted, shown in the fold).
  series: RepeatingSeries[];
  // Two in a row: listed apart, never counted until kept.
  mightRepeat: RepeatingSeries[];
  // "Not a subscription or bill": listed apart, never counted.
  takenOff: RepeatingSeries[];
}

const median = (values: number[]) => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
};

function withinFixed(amount: number, base: number, foreign: boolean) {
  const ratio = foreign ? REPEATING_RULES.foreignToleranceRatio : REPEATING_RULES.fixedToleranceRatio;
  return Math.abs(amount - base) <= Math.max(REPEATING_RULES.fixedToleranceMinor, base * ratio);
}

// One amount, or one step to a new amount (a price change): the charges
// split into stretches that each stay near their first amount, at most 3,
// and any stretch between the first and the last has 2 or more.
function isFixedAmount(charges: Array<RepeatingCharge & { isForeign: boolean }>) {
  const stretches: number[] = [];
  let base = charges[0].amountMinor;
  let length = 0;
  for (const charge of charges) {
    if (withinFixed(charge.amountMinor, base, charge.isForeign)) {
      length += 1;
    } else {
      stretches.push(length);
      base = charge.amountMinor;
      length = 1;
    }
  }
  stretches.push(length);
  return stretches.length <= 3 && stretches.slice(1, -1).every((count) => count >= 2);
}

function isVaryingAmount(charges: RepeatingCharge[]) {
  const middle = median(charges.map((charge) => charge.amountMinor));
  return charges.every((charge) => charge.amountMinor * 2 >= middle && charge.amountMinor <= middle * 2);
}

// The day a charge falls on in a month: its usual day, kept inside the month.
function dayIn(month: string, day: number) {
  return `${month}-${String(Math.min(day, daysInMonth(month))).padStart(2, "0")}`;
}

interface Charge extends RepeatingCharge {
  month: string;
  description: string;
  accountId: string;
  categoryName: string;
  isForeign: boolean;
  multiple: boolean;
}

// The latest run: back from the newest charge while each is one period
// after the one before.
function latestRun(charges: Charge[], linked: (previous: Charge, next: Charge) => boolean) {
  let start = charges.length - 1;
  while (start > 0 && linked(charges[start - 1], charges[start])) {
    start -= 1;
  }
  return charges.slice(start);
}

function mergeMonths(charges: Charge[]): Charge[] {
  const byMonth = new Map<string, Charge>();
  for (const charge of charges) {
    const current = byMonth.get(charge.month);
    byMonth.set(charge.month, current
      ? { ...current, amountMinor: current.amountMinor + charge.amountMinor, ids: [...current.ids, ...charge.ids], multiple: true }
      : charge);
  }
  return [...byMonth.values()];
}

function buildSeries(
  key: string,
  period: RepeatingPeriod,
  run: Charge[],
  input: RepeatingChargesInput,
  windows: { focusMonth: string; yearStartMonth: string },
  choice: RepeatingChoice | undefined
): RepeatingSeries | null {
  const kept = choice?.choice === "kept";
  const fixed = isFixedAmount(run);
  const varies = !fixed && isVaryingAmount(run) && (kept || REPEATING_RULES.varyingCategories.includes(run.at(-1)!.categoryName));
  if (!fixed && !varies) {
    return null;
  }
  const latest = run[run.length - 1];
  const lastThree = run.slice(-3);
  const usualDay = median(lastThree.map((charge) => Number(charge.date.slice(8, 10))));
  const nextDate = period === "monthly"
    ? dayIn(addMonths(latest.month, 1), usualDay)
    : dayIn(addMonths(latest.month, 12), Number(latest.date.slice(8, 10)));
  const seriesKey = `${key}|${period}`;

  // Late: the usual day plus 10 days has passed with no charge, and the
  // account it came from has later entries (so the statement is in). Two
  // missed (monthly) moves it to stopped; a kept one never stops.
  const grace = REPEATING_RULES.lateGraceDays;
  const accountReach = input.accountLatestDate[latest.accountId] ?? "";
  const missedOnce = addDays(nextDate, grace);
  const nextAfter = period === "monthly" ? dayIn(addMonths(nextDate.slice(0, 7), 1), usualDay) : "";
  const missedTwice = nextAfter ? addDays(nextAfter, grace) : "";
  let status: RepeatingStatus = "active";
  if (input.today > missedOnce && accountReach > missedOnce) {
    status = !kept && missedTwice && input.today > missedTwice && accountReach > missedTwice ? "stopped" : "late";
  }

  const inYear = run.filter((charge) => charge.month >= windows.yearStartMonth && charge.month <= windows.focusMonth);
  const inFocus = run.filter((charge) => charge.month === windows.focusMonth);
  const total = (list: Charge[]) => ({ amountMinor: list.reduce((sum, charge) => sum + charge.amountMinor, 0), ids: list.flatMap((charge) => charge.ids) });

  // "Went up": the reminder's own rule, over charges in this currency.
  const priced = run.filter((charge) => !charge.isForeign && !charge.multiple);
  const change = fixed && priced.length === run.length
    ? detectPriceChange(period, priced, input.today, REPEATING_RULES.wentUpShowDays)
    : null;

  const ownName = choice?.displayName?.trim() || "";
  // The payee as a person says it, without a web address's ending
  // ("NETFLIX.COM" is "Netflix").
  const said = payeeName(latest.description.replace(/\.(?:COM|NET|ORG|SG|CO|IO)\b/gi, "")) || key;
  return {
    seriesKey,
    payeeKey: key,
    name: ownName || said,
    payeeName: said,
    period,
    amountKind: fixed ? "fixed" : "varies",
    status,
    kept,
    renamed: Boolean(ownName),
    categoryName: latest.categoryName,
    accountId: latest.accountId,
    usualDay,
    nextDate,
    runLength: run.length,
    charges: run.map(({ date, amountMinor, ids }) => ({ date, amountMinor, ids })),
    latest: { date: latest.date, amountMinor: latest.amountMinor, ids: latest.ids },
    lastThree: {
      lowMinor: Math.min(...lastThree.map((charge) => charge.amountMinor)),
      highMinor: Math.max(...lastThree.map((charge) => charge.amountMinor))
    },
    focus: total(inFocus),
    year: total(inYear),
    ...(change ? {
      wentUp: {
        fromMinor: change.oldAmount,
        toMinor: change.newAmount,
        firstNewDate: change.firstNewCharge.date,
        lastOldDate: change.lastOldCharge.date,
        fromIds: change.lastOldCharge.ids,
        toIds: change.firstNewCharge.ids
      }
    } : {}),
    ...(status === "late" || status === "stopped" ? { lastSeenMonth: latest.month } : {})
  };
}

// Whether an entry can be part of a repeating series at all: an expense, not
// money moved into Investments or Savings.
export function isRepeatingCandidate(row: Pick<RepeatingChargeRow, "entryType" | "categoryName" | "amountMinor">) {
  return row.entryType === "expense"
    && row.amountMinor > 0
    && !isInvestmentsCategoryName(row.categoryName)
    && !isSavingsCategoryName(row.categoryName);
}

// The first and last month a page reads, for today: the yearly window.
export function repeatingWindowStart(today: string) {
  return `${addMonths(today.slice(0, 7), -REPEATING_RULES.yearlyLookbackMonths)}-01`;
}

export function findRepeatingCharges(input: RepeatingChargesInput): RepeatingChargesResult {
  const thisMonth = input.today.slice(0, 7);
  const focusMonth = addMonths(thisMonth, -1);
  const yearStartMonth = addMonths(focusMonth, -11);
  const monthlyStart = addMonths(thisMonth, -REPEATING_RULES.monthlyLookbackMonths);
  const yearlyStart = addMonths(thisMonth, -REPEATING_RULES.yearlyLookbackMonths);
  const windows = { focusMonth, yearStartMonth };
  const choices = input.choices ?? {};

  const byPayee = new Map<string, Charge[]>();
  for (const row of input.rows) {
    const key = payeeKey(row.description);
    const month = row.date.slice(0, 7);
    if (!key || !isRepeatingCandidate(row) || row.date > input.today || month < yearlyStart) {
      continue;
    }
    const list = byPayee.get(key) ?? [];
    list.push({
      date: row.date,
      month,
      amountMinor: row.amountMinor,
      ids: row.ids,
      description: row.description,
      accountId: row.accountId,
      categoryName: row.categoryName,
      isForeign: row.isForeign,
      multiple: row.ids.length > 1
    });
    byPayee.set(key, list);
  }

  const series: RepeatingSeries[] = [];
  const mightRepeat: RepeatingSeries[] = [];
  const takenOff: RepeatingSeries[] = [];
  const { monthlyGapMinDays, monthlyGapMaxDays, keptGapMaxDays, yearlyGapMinMonths, yearlyGapMaxMonths } = REPEATING_RULES;
  for (const [key, all] of byPayee) {
    all.sort((left, right) => left.date.localeCompare(right.date) || left.ids[0].localeCompare(right.ids[0]));
    const monthlyChoice = choices[`${key}|monthly`];
    const yearlyChoice = choices[`${key}|yearly`];

    // Monthly first: the last 13 months, one charge a month, 25 to 35 days
    // apart. A kept one may have two in a month (added together) or miss one.
    const recent = all.filter((charge) => charge.month >= monthlyStart);
    const keptMonthly = monthlyChoice?.choice === "kept";
    const monthlyCharges = keptMonthly ? mergeMonths(recent) : recent;
    let found: { period: RepeatingPeriod; run: Charge[]; choice?: RepeatingChoice } | null = null;
    if (monthlyCharges.length) {
      const run = latestRun(monthlyCharges, (previous, next) => {
        const gap = daysBetween(previous.date, next.date);
        if (previous.multiple || next.multiple) {
          return keptMonthly && monthsBetween(previous.month, next.month) === 1;
        }
        return gap >= monthlyGapMinDays && gap <= (keptMonthly ? keptGapMaxDays : monthlyGapMaxDays);
      });
      const clean = run.every((charge) => !charge.multiple) || keptMonthly;
      if (clean && (run.length >= REPEATING_RULES.mightRepeatRun || (keptMonthly && run.length >= 1))) {
        found = { period: "monthly", run, choice: monthlyChoice };
      }
    }
    // Yearly: 2 or more charges 11 to 13 months apart.
    if (!found || found.run.length < REPEATING_RULES.monthlyMinRun) {
      const keptYearly = yearlyChoice?.choice === "kept";
      const run = latestRun(all, (previous, next) => {
        const gap = monthsBetween(previous.month, next.month);
        return gap >= yearlyGapMinMonths && gap <= yearlyGapMaxMonths;
      });
      if ((run.length >= REPEATING_RULES.yearlyMinRun || (keptYearly && run.length >= 1)) && run.every((charge) => !charge.multiple || keptYearly)) {
        found = { period: "yearly", run, choice: yearlyChoice };
      }
    }
    if (!found) {
      continue;
    }

    const built = buildSeries(key, found.period, found.run, input, windows, found.choice);
    if (!built) {
      continue;
    }
    // Too old to matter: nothing in the last 12 months.
    if (built.latest.date.slice(0, 7) < yearStartMonth) {
      continue;
    }
    if (found.choice?.choice === "not_repeating") {
      takenOff.push({ ...built, status: "taken_off" });
    } else if (found.period === "monthly" && built.runLength < REPEATING_RULES.monthlyMinRun && !built.kept) {
      // Two in a row: only while still current (not late or stopped).
      if (built.status === "active") {
        mightRepeat.push({ ...built, status: "might_repeat" });
      }
    } else {
      series.push(built);
    }
  }

  const byCost = (left: RepeatingSeries, right: RepeatingSeries) => (
    right.year.amountMinor - left.year.amountMinor || left.name.localeCompare(right.name)
  );
  const rank = (status: RepeatingStatus) => (status === "stopped" ? 1 : 0);
  series.sort((left, right) => rank(left.status) - rank(right.status) || byCost(left, right));
  mightRepeat.sort(byCost);
  takenOff.sort(byCost);
  return { focusMonth, yearStartMonth, series, mightRepeat, takenOff };
}

// What a series needs to say when it comes next (the server's DTO or the
// engine's own series).
export interface UpcomingSource {
  key: string;
  period: RepeatingPeriod;
  status: RepeatingStatus;
  usualDay: number;
  nextDate: string;
  kind: "fixed" | "varies";
  latest: { date: string; amountMinor: number };
  lowMinor: number;
  highMinor: number;
}

export interface UpcomingCharge {
  key: string;
  date: string;
  // A fixed charge: its last amount (low = high). One that changes each
  // month: the lowest and highest of its last 3.
  lowMinor: number;
  highMinor: number;
}

export const COMING_UP_DAYS = 30;

/**
 * Coming up (DOMAIN.md "Repeating Charge"): each listed series' next charges
 * from today to `days` ahead, on its usual day (a monthly one once a month
 * after the month of its last charge, a yearly one on its next date), in
 * date order. Only series that are coming as usual: never one not seen
 * lately, stopped, taken off or only found twice. Dates and recorded
 * amounts only; nothing here adds them up.
 */
export function upcomingCharges(series: UpcomingSource[], today: string, days = COMING_UP_DAYS): UpcomingCharge[] {
  const end = addDays(today, days);
  const upcoming: UpcomingCharge[] = [];
  for (const item of series) {
    if (item.status !== "active") {
      continue;
    }
    const amounts = item.kind === "varies"
      ? { lowMinor: item.lowMinor, highMinor: item.highMinor }
      : { lowMinor: item.latest.amountMinor, highMinor: item.latest.amountMinor };
    const lastMonth = item.latest.date.slice(0, 7);
    const dates = item.period === "yearly"
      ? [item.nextDate]
      : [0, 1, 2].map((ahead) => dayIn(addMonths(today.slice(0, 7), ahead), item.usualDay))
        .filter((date) => date.slice(0, 7) > lastMonth);
    for (const date of dates) {
      if (date >= today && date <= end) {
        upcoming.push({ key: item.key, date, ...amounts });
      }
    }
  }
  return upcoming.sort((left, right) => left.date.localeCompare(right.date) || left.key.localeCompare(right.key));
}
