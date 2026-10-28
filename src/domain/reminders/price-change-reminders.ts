// Subscription price change: the same payee charged one amount for several
// periods in a row, then a new amount that differs by at least $1 and 5%.
// Shown for 45 days from the first new charge; a later change is a new
// reminder. The payee is the statement line without codes and reference
// numbers (payeeKey, as Account routine uses), so every charge of one
// subscription reads as one series even when its reference changes.
import { daysBetween, monthsBetween } from "../money-signals/format";
import { payeeKey, payeeName } from "../account-routines";
import type { PriceChangeReminderDto } from "../../types/dto";
import type { ReminderChargeRow, ReminderInputs } from "./facts";
import { REMINDER_THRESHOLDS } from "./thresholds";

type PriceInput = Pick<ReminderInputs, "today" | "viewId" | "accounts" | "charges">;
type Period = ReminderChargeRow["period"];

interface Charge {
  date: string;
  month: string;
  amountMinor: number;
  description: string;
}

// Whether two charges are one period apart: next month, or about a year on
// (a yearly charge can land a few days either side of the anniversary).
function isNextPeriod(period: Period, previous: Charge, next: Charge) {
  const gap = monthsBetween(previous.month, next.month);
  return period === "monthly" ? gap === 1 : gap >= 11 && gap <= 13;
}

// The length of the run of one amount that ends just before `endIndex`
// (exclusive), going back one period at a time. 0 when `endIndex` is 0.
function runLengthBefore(period: Period, series: Charge[], endIndex: number) {
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

function detectChange(period: Period, series: Charge[], today: string) {
  const { stableMonthlyCharges, stableYearlyCharges, minChangeMinor, minChangeRatio, showDays } = REMINDER_THRESHOLDS.priceChange;
  const last = series[series.length - 1];
  // The newest run of one amount: the first new charge and any after it.
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
  return { oldAmount, newAmount: last.amountMinor, firstNewCharge: series[firstNew], priorCount };
}

export function priceChangeReminders(input: PriceInput): PriceChangeReminderDto[] {
  const accountIds = new Set(input.accounts
    .filter((account) => account.isActive && (input.viewId === "household" || account.isJoint || account.ownerPersonId === input.viewId))
    .map((account) => account.id));
  const seriesByPayee = new Map<string, { period: Period; charges: Charge[] }>();
  for (const row of input.charges) {
    const key = payeeKey(row.description);
    if (row.isForeign || !key || !accountIds.has(row.accountId)) {
      continue;
    }
    const entry = seriesByPayee.get(`${row.period}|${key}`) ?? { period: row.period, charges: [] };
    entry.charges.push({ date: row.date, month: row.date.slice(0, 7), amountMinor: Math.abs(row.amountMinor), description: row.description });
    seriesByPayee.set(`${row.period}|${key}`, entry);
  }

  const reminders: PriceChangeReminderDto[] = [];
  for (const [seriesKey, { period, charges }] of seriesByPayee) {
    charges.sort((left, right) => left.date.localeCompare(right.date));
    // One charge a period: a payee billed twice in one month (several items
    // on one bill) is not one series.
    if (charges.some((charge, index) => index > 0 && charge.month === charges[index - 1].month)) {
      continue;
    }
    const change = detectChange(period, charges, input.today);
    if (!change) {
      continue;
    }
    reminders.push({
      key: `price:${seriesKey}:${change.firstNewCharge.date}`,
      kind: "price_change",
      payeeName: payeeName(change.firstNewCharge.description) || "A subscription",
      period,
      fromMinor: change.oldAmount,
      toMinor: change.newAmount,
      firstNewChargeDate: change.firstNewCharge.date,
      priorChargeCount: change.priorCount,
      currency: "SGD"
    });
  }
  return reminders;
}
