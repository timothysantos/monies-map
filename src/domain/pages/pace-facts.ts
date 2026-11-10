import { payeeKey, payeeName } from "../account-routines";
import { isSpendingCategoryName } from "../category-offset";
import { addDays, addMonths, daysInMonth } from "../money-signals/format";
import { buildPaceRange, everydayMinor, PACE_IMPORTS_BEHIND_DAYS, type PaceBill, type PaceEntry, type PaceFacts, type PaceQuiet, type PaceRange } from "../pace";
import type { RepeatingChargeRow, RepeatingChargesResult } from "../repeating-charges";

// The facts "If this keeps up" needs (pace.ts), from what the Subscriptions
// and bills read already holds (the view's expenses of 26 months grouped by
// description and month, the series, each account's latest entry) and the
// view's income of the last 4 months. No read of its own beyond the income.

export interface IncomeRow {
  description: string;
  date: string;
  amountMinor: number;
  categoryName: string | null;
}

export interface PaceDto {
  month: string;
  quiet?: PaceQuiet;
  range?: PaceRange;
  bills?: PaceBill[];
  incomeSoFarMinor?: number;
  incomeToCome?: Array<{ name: string; date: string; amountMinor: number }>;
  // What the engine counts as spent so far (expenses), for a page that has
  // no spent figure of its own.
  spentSoFarMinor?: number;
}

// Regular income: at least $500 from the same payer in each of the last 2
// complete months (Account routines' rule); still due when it has not come
// this month and its usual day is after today.
const REGULAR_MIN_MINOR = 50_000;

function incomeFacts(income: IncomeRow[], today: string) {
  const month = today.slice(0, 7);
  const counted = income.filter((row) => !isSpendingCategoryName(row.categoryName));
  const soFar = counted.filter((row) => row.date.slice(0, 7) === month && row.date <= today).reduce((sum, row) => sum + row.amountMinor, 0);
  const byPayer = new Map<string, IncomeRow[]>();
  for (const row of counted) {
    const key = payeeKey(row.description);
    if (!key) continue;
    byPayer.set(key, [...(byPayer.get(key) ?? []), row]);
  }
  const toCome: Array<{ name: string; date: string; amountMinor: number }> = [];
  for (const rows of byPayer.values()) {
    const months = [addMonths(month, -2), addMonths(month, -1)].map((item) => rows.filter((row) => row.date.slice(0, 7) === item && row.amountMinor >= REGULAR_MIN_MINOR));
    if (months.some((list) => !list.length) || rows.some((row) => row.date.slice(0, 7) === month)) continue;
    const last = months[1].at(-1)!;
    const day = Number(last.date.slice(8, 10));
    const due = `${month}-${String(Math.min(day, daysInMonth(month))).padStart(2, "0")}`;
    if (due > today) {
      toCome.push({ name: payeeName(last.description) || "Regular income", date: due, amountMinor: last.amountMinor });
    }
  }
  return { soFar, toCome };
}

export function buildPaceDto(input: {
  today: string;
  rows: RepeatingChargeRow[];
  result: RepeatingChargesResult;
  accountLatestDate: Record<string, string>;
  income: IncomeRow[];
}): PaceDto {
  const { today } = input;
  const month = today.slice(0, 7);
  const seriesIds = new Set(input.result.series.flatMap((series) => series.charges.flatMap((charge) => charge.ids)));
  // Each row is one description in one month: one entry, or several added
  // together (their sum is what counts).
  const entriesOf = (target: string): PaceEntry[] => input.rows
    .filter((row) => row.date.slice(0, 7) === target && row.date <= today)
    .map((row) => ({ id: row.ids.join(","), date: row.date, amountMinor: row.amountMinor, inSeries: row.ids.some((id) => seriesIds.has(id)), several: row.ids.length > 1, label: row.description }));
  // The last 3 complete months, each only when it has entries: a gap (no
  // entries recorded) is too little history, never a usual rate of $0.
  const usualMonths = [-3, -2, -1].map((offset) => addMonths(month, offset))
    .filter((item) => entriesOf(item).length > 0)
    .map((item) => ({
      month: item,
      everydayMinor: everydayMinor(entriesOf(item)),
      days: daysInMonth(item)
    }));
  const monthsWithEntries = new Set(input.rows.map((row) => row.date.slice(0, 7)).filter((item) => item < month)).size;
  // Imports behind: the account with the most charges in the last 3 months
  // has nothing recorded for more than 10 days.
  const recent = input.rows.filter((row) => row.date >= `${addMonths(month, -3)}-01`);
  const byAccount = new Map<string, number>();
  for (const row of recent) byAccount.set(row.accountId, (byAccount.get(row.accountId) ?? 0) + row.ids.length);
  const main = [...byAccount.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
  const importsBehind = Boolean(main) && (input.accountLatestDate[main!] ?? "") < addDays(today, -PACE_IMPORTS_BEHIND_DAYS);

  const day = Number(today.slice(8, 10));
  const bills: PaceBill[] = [];
  for (const series of input.result.series) {
    if (series.status !== "active") continue;
    const charged = series.latest.date.slice(0, 7) >= month;
    const date = series.period === "yearly"
      ? series.nextDate
      : `${month}-${String(Math.min(series.usualDay, daysInMonth(month))).padStart(2, "0")}`;
    if (charged || date.slice(0, 7) !== month || Number(date.slice(8, 10)) <= day) continue;
    const varies = series.amountKind === "varies";
    bills.push({
      key: series.seriesKey,
      name: series.name,
      date,
      lowMinor: varies ? series.lastThree.lowMinor : series.latest.amountMinor,
      highMinor: varies ? series.lastThree.highMinor : series.latest.amountMinor
    });
  }
  bills.sort((left, right) => left.date.localeCompare(right.date) || left.key.localeCompare(right.key));
  const { soFar, toCome } = incomeFacts(input.income, today);
  const entries = entriesOf(month);
  const facts: PaceFacts = { month, today, entries, usualMonths, bills, incomeSoFarMinor: soFar, incomeToCome: toCome, monthsWithEntries, importsBehind };
  const range = buildPaceRange(facts);
  if ("quiet" in range) {
    return { month, quiet: range.quiet };
  }
  return {
    month,
    range,
    bills,
    incomeSoFarMinor: soFar,
    incomeToCome: toCome,
    spentSoFarMinor: entries.reduce((sum, item) => sum + item.amountMinor, 0)
  };
}
