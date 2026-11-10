// Money figures (DOMAIN.md "Money figure"): the rule behind each figure a
// card shows, as a filter Entries can apply (entry_figure) and the total it
// then shows, so "View entries" from a figure lists exactly the money behind
// it and its total is the figure, to the cent (design.md "Openable
// figures").
//
// Two families share one list:
// - the money jobs' figures (splitMoneyUse, money-jobs.ts), which the
//   Summary and Month leads, the savings bar, Simple and "Earned vs spent by
//   month" show: `spending` (spent, without money filed under Investments
//   or Savings), `invested` (the Investments category plus transfers into
//   investment accounts, less transfers out), `kept`, `earned`,
//   `from_savings` (spending past what came in), `took_out` (more taken out
//   of investments than put in) and `spent` (every expense less paybacks, at
//   the view's amounts: the Month "Actual spend", Intent vs Outcome, a
//   category's spending, a plan row's actual);
// - the Entries page's own figures, as entry-totals.js counts them (whole
//   amounts, with a person's share beside them): `expenses` (the Spent
//   lead), `transfers` (transfers out), `outflow` (spent plus transfers out)
//   and `difference` (income less spent at the view's amounts; Summary's
//   realized savings).
// A third kind is named by the server: Subscriptions and bills' figures
// (`repeating`, repeatingFigureMinor) are the exact charges behind them,
// opened as `spent` narrowed to their entry ids. Investments over time's
// "put in" (investmentPutInFigureMinor) opens as `invested` (or `took_out`
// when more came out) narrowed to the moves it counted, and Tax reliefs'
// figures (taxReliefFigureMinor) as `outflow` narrowed to their entries.
//
// A row belongs to a figure when it adds to it (or takes from it), so
// leaving the other rows out never changes the figure. The total is worked
// out from the rows by the same calculation the card used: the money jobs'
// figures through splitMoneyUse itself.

import { incomeMinor, spendingMinor } from "./category-offset";
import { findInvestmentMoves } from "./investment-moves";
import { isInvestmentsCategoryName, isSavingsCategoryName, splitMoneyUse, type MoneyUseInput } from "./money-jobs";
import type { EntryDto } from "../types/dto";

export const MONEY_JOB_FIGURES = ["spending", "invested", "kept", "earned", "from_savings", "took_out", "spent"] as const;
export const ENTRIES_FIGURES = ["expenses", "transfers", "outflow", "difference"] as const;
export const MONEY_FIGURES = [...MONEY_JOB_FIGURES, ...ENTRIES_FIGURES] as const;
export type MoneyFigure = (typeof MONEY_FIGURES)[number];

type FigureEntry = Pick<EntryDto, "id" | "accountId" | "entryType" | "transferDirection" | "amountMinor" | "categoryName" | "linkedTransfer">;

export function isMoneyFigure(value: unknown): value is MoneyFigure {
  return (MONEY_FIGURES as readonly string[]).includes(String(value));
}

export function isMoneyJobFigure(value: unknown): boolean {
  return (MONEY_JOB_FIGURES as readonly string[]).includes(String(value));
}

const isMovedCategory = (entry: FigureEntry) => isInvestmentsCategoryName(entry.categoryName) || isSavingsCategoryName(entry.categoryName);
const isTransferOut = (entry: FigureEntry) => entry.entryType === "transfer" && entry.transferDirection === "out";

/**
 * splitMoneyUse's input from entries, the way the Summary and Month pages
 * build it: income and spending (paybacks lower spending), the spending
 * filed under Investments and under Savings (as the category share counts
 * it: a category below zero adds nothing), and the transfers into and out of
 * investment accounts. `entries` are the view's own, at the view's amounts;
 * `allEntries` is every loaded entry, where a linked transfer's other side
 * is looked up.
 */
export function moneyUseInputFromEntries(
  entries: FigureEntry[],
  allEntries: FigureEntry[],
  investmentAccountIds: ReadonlySet<string>
): MoneyUseInput {
  let income = 0;
  let spent = 0;
  let filedUnderInvestments = 0;
  let movedToSavings = 0;
  for (const entry of entries) {
    income += incomeMinor(entry);
    const spending = spendingMinor(entry);
    spent += spending;
    if (isInvestmentsCategoryName(entry.categoryName)) filedUnderInvestments += spending;
    else if (isSavingsCategoryName(entry.categoryName)) movedToSavings += spending;
  }
  const moves = findInvestmentMoves(entries, allEntries, investmentAccountIds);
  const total = (list: FigureEntry[]) => list.reduce((sum, entry) => sum + entry.amountMinor, 0);
  return {
    incomeMinor: income,
    spentMinor: spent,
    investedMinor: Math.max(0, filedUnderInvestments),
    savedMovedMinor: Math.max(0, movedToSavings),
    movedIntoInvestmentsMinor: total(moves.into),
    takenFromInvestmentsMinor: total(moves.outOf)
  };
}

/**
 * The ids of the entries behind a figure. `entries` are the rows the page
 * shows before the figure filter (the view and scope applied); moves into
 * and out of investment accounts are found among them.
 */
export function figureEntryIds(
  figure: MoneyFigure,
  entries: FigureEntry[],
  allEntries: FigureEntry[],
  investmentAccountIds: ReadonlySet<string>
): Set<string> {
  const moves = figure === "invested" || figure === "took_out" || figure === "kept"
    ? findInvestmentMoves(entries, allEntries, investmentAccountIds)
    : { into: [], outOf: [] };
  const moved = new Set([...moves.into, ...moves.outOf].map((entry) => entry.id));
  const ids = new Set<string>();
  for (const entry of entries) {
    const spends = spendingMinor(entry) !== 0;
    const earns = incomeMinor(entry) !== 0;
    let counts = false;
    switch (figure) {
      case "spending":
        counts = spends && !isMovedCategory(entry);
        break;
      case "invested":
      case "took_out":
        counts = (spends && isInvestmentsCategoryName(entry.categoryName)) || moved.has(entry.id);
        break;
      case "kept":
        counts = spends || earns || moved.has(entry.id);
        break;
      case "earned":
        counts = earns;
        break;
      case "from_savings":
        counts = earns || (spends && !isMovedCategory(entry));
        break;
      case "spent":
      case "expenses":
        counts = spends;
        break;
      case "transfers":
        counts = isTransferOut(entry);
        break;
      case "outflow":
        counts = spends || isTransferOut(entry);
        break;
      case "difference":
        counts = spends || earns;
        break;
    }
    if (counts) {
      ids.add(entry.id);
    }
  }
  return ids;
}

/**
 * A money job's figure worked out from rows: splitMoneyUse over them, the
 * same calculation the lead, the savings bar and Simple use. Null for the
 * Entries page's own figures (its totals already show them).
 */
export function moneyJobFigureMinor(
  figure: MoneyFigure,
  entries: FigureEntry[],
  allEntries: FigureEntry[],
  investmentAccountIds: ReadonlySet<string>
): number | null {
  if (!isMoneyJobFigure(figure)) {
    return null;
  }
  const input = moneyUseInputFromEntries(entries, allEntries, investmentAccountIds);
  if (figure === "spent") {
    return input.spentMinor;
  }
  const split = splitMoneyUse(input);
  switch (figure) {
    case "spending":
      return split.spending;
    case "invested":
      return split.invested;
    case "kept":
      return split.kept;
    case "earned":
      return split.income;
    case "from_savings":
      return Math.max(0, split.spending - split.income);
    case "took_out":
      return split.takenFromInvestments;
    default:
      return null;
  }
}

/**
 * Subscriptions and bills (DOMAIN.md "Repeating Charge"; the `repeating`
 * figure): every amount on the card is the charges the server named, at the
 * view's amounts. It opens as `spent` with exactly those entry ids, so the
 * Entries Spent total is this sum to the cent. Paybacks are never named.
 */
export function repeatingFigureMinor(ids: readonly string[], entries: FigureEntry[]): number {
  const named = new Set(ids);
  return entries.filter((entry) => named.has(entry.id)).reduce((sum, entry) => sum + spendingMinor(entry), 0);
}

/**
 * Bank fees this year (the `bank_fees` figure, DOMAIN.md "Bank Charge"):
 * every row either classifier names a fee in the year, charges adding and
 * refunds (money in under Fees) taking away, at the view's amounts. It opens
 * as `spent` narrowed to those ids over January to the focus month, so a
 * refunded charge and its refund net to zero and the total is the figure.
 */
export const bankFeesFigureMinor = repeatingFigureMinor;

/**
 * Investments over time's "You put in" (DOMAIN.md "Investments Over Time"):
 * the named moves into investment accounts less the moves out, an expense
 * filed under Investments (the bank side of a contribution) counting as
 * money put in. It is the Invested money job's net over exactly those rows
 * (moneyUseInputFromEntries), so View entries opens it as `invested`
 * narrowed to the ids when it is zero or more and as `took_out` when it is
 * below zero, and the Entries lead is its size to the cent. Signed.
 */
export function investmentPutInFigureMinor(
  ids: readonly string[],
  entries: FigureEntry[],
  allEntries: FigureEntry[],
  investmentAccountIds: ReadonlySet<string>
): number {
  const named = new Set(ids);
  const input = moneyUseInputFromEntries(entries.filter((entry) => named.has(entry.id)), allEntries, investmentAccountIds);
  return (input.investedMinor ?? 0) + (input.movedIntoInvestmentsMinor ?? 0) - (input.takenFromInvestmentsMinor ?? 0);
}

/** The figure a "put in" amount opens as: `invested`, or `took_out` below zero. */
export function investmentPutInFigure(amountMinor: number): "invested" | "took_out" {
  return amountMinor < 0 ? "took_out" : "invested";
}

/**
 * Tax reliefs this year (DOMAIN.md "Tax Relief"): each amount is the named
 * entries' money out at their whole amounts, an expense and a transfer out
 * alike (a top-up or gift sent as a transfer with a purpose). It opens as
 * `outflow` narrowed to the ids in the household view, whose Entries total
 * (spent plus transfers out) is this sum to the cent.
 */
export function taxReliefFigureMinor(ids: readonly string[], entries: FigureEntry[]): number {
  const named = new Set(ids);
  return entries
    .filter((entry) => named.has(entry.id))
    .reduce((sum, entry) => sum + (entry.entryType === "expense" || isTransferOut(entry) ? entry.amountMinor : 0), 0);
}

// ---- Spent on a trip or event (DOMAIN.md "Trip or Event") ------------------
//
// The trip view's figures: the same Spend as the Entries Spent lead
// (expenses less paybacks, no transfers), over the rows the trip view
// lists, at the view's amounts. Every pill and bar is a slice of that one
// set, so Before you went + While away = Spent, the category bars add up to
// Spent, and the days add up to Spent. A row's `amountMinor` is its amount
// in the view (the Entries aggregate rows' `visibleAmountMinor`).

type TripFigureEntry = Pick<EntryDto, "id" | "date" | "entryType" | "amountMinor" | "categoryName" | "transferPurpose">;

export interface TripEventFigures {
  spentMinor: number;
  // Only with dates: what was spent before the first day, and from then on.
  beforeMinor: number | null;
  whileAwayMinor: number | null;
  // While away over the trip's days, rounded to the cent; null without dates.
  perDayMinor: number | null;
  days: number | null;
  // Largest first; a category whose refunds outweigh it is kept (below
  // zero), so the bars add up to Spent.
  byCategory: Array<{ categoryName: string; amountMinor: number; entryIds: string[] }>;
  // "before" first, then each day (dates in order).
  byDay: Array<{ key: string; amountMinor: number; entryIds: string[] }>;
}

function daysBetween(start: string, end: string) {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

export function tripEventFigures(entries: TripFigureEntry[], trip: { startDate?: string; endDate?: string } | null): TripEventFigures {
  const start = trip?.startDate ?? null;
  const end = trip?.endDate ?? start;
  let spent = 0;
  let before = 0;
  const categories = new Map<string, { amountMinor: number; entryIds: string[] }>();
  const dayMap = new Map<string, { amountMinor: number; entryIds: string[] }>();
  for (const entry of entries) {
    const amount = spendingMinor(entry);
    if (amount === 0 && entry.entryType !== "expense") continue;
    spent += amount;
    const category = categories.get(entry.categoryName) ?? { amountMinor: 0, entryIds: [] };
    category.amountMinor += amount;
    category.entryIds.push(entry.id);
    categories.set(entry.categoryName, category);
    const dayKey = start && entry.date < start ? "before" : entry.date;
    if (dayKey === "before") before += amount;
    const day = dayMap.get(dayKey) ?? { amountMinor: 0, entryIds: [] };
    day.amountMinor += amount;
    day.entryIds.push(entry.id);
    dayMap.set(dayKey, day);
  }
  const days = start && end ? daysBetween(start, end) : null;
  const whileAway = start ? spent - before : null;
  return {
    spentMinor: spent,
    beforeMinor: start ? before : null,
    whileAwayMinor: whileAway,
    perDayMinor: days && whileAway !== null ? Math.round(whileAway / days) : null,
    days,
    byCategory: [...categories].map(([categoryName, value]) => ({ categoryName, ...value }))
      .sort((left, right) => right.amountMinor - left.amountMinor || left.categoryName.localeCompare(right.categoryName)),
    byDay: [...dayMap].map(([key, value]) => ({ key, ...value }))
      .sort((left, right) => (left.key === "before" ? -1 : right.key === "before" ? 1 : left.key.localeCompare(right.key)))
  };
}

/**
 * "What changed?" figures (the `changed` figure): Ask's rows (ask-changed.ts)
 * and Summary's "What changed this month" card (summary-changed.ts), where
 * a row's so-far amount, last month's amount at the same point and each
 * shop's so-far amount are each the entries of that month, named by id,
 * opened as Spent narrowed to them, so Entries' total is the figure.
 */
export const changedFigureMinor = repeatingFigureMinor;
