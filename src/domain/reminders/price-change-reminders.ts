// Subscription price change: the same payee charged one amount for several
// periods in a row, then a new amount that differs by at least $1 and 5%
// (detectPriceChange, the rule the Subscriptions and bills row's "Went up"
// shares: src/domain/repeating-charges.ts).
// Shown for 45 days from the first new charge; a later change is a new
// reminder. The payee is the statement line without codes and reference
// numbers (payeeKey, as Account routine uses), so every charge of one
// subscription reads as one series even when its reference changes.
import { payeeKey, payeeName } from "../account-routines";
import { detectPriceChange } from "../repeating-charges";
import type { PriceChangeReminderDto } from "../../types/dto";
import type { ReminderChargeRow, ReminderInputs } from "./facts";
import { REMINDER_THRESHOLDS } from "./thresholds";

type PriceInput = Pick<ReminderInputs, "today" | "viewId" | "accounts" | "charges" | "notRepeatingPayeeKeys">;
type Period = ReminderChargeRow["period"];

interface Charge {
  date: string;
  month: string;
  amountMinor: number;
  description: string;
}

function detectChange(period: Period, series: Charge[], today: string) {
  return detectPriceChange(period, series, today, REMINDER_THRESHOLDS.priceChange.showDays);
}

export function priceChangeReminders(input: PriceInput): PriceChangeReminderDto[] {
  const accountIds = new Set(input.accounts
    .filter((account) => account.isActive && (input.viewId === "household" || account.isJoint || account.ownerPersonId === input.viewId))
    .map((account) => account.id));
  const silenced = new Set(input.notRepeatingPayeeKeys ?? []);
  const seriesByPayee = new Map<string, { period: Period; charges: Charge[] }>();
  for (const row of input.charges) {
    const key = payeeKey(row.description);
    if (row.isForeign || !key || !accountIds.has(row.accountId) || silenced.has(key)) {
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
