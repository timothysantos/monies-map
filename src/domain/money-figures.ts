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
//   `from_savings` (spending past what came in) and `took_out` (more taken
//   out of investments than put in);
// - the Entries page's own figures, as entry-totals.js counts them:
//   `spent` (every expense less paybacks, the Spent lead and the Month
//   "Actual spend"), `transfers` (transfers out), `outflow` (spent plus
//   transfers out) and `difference` (income less spent; Summary's realized
//   savings).
//
// A row belongs to a figure when it adds to it (or takes from it), so
// leaving the other rows out never changes the figure. The total is worked
// out from the rows by the same calculation the card used: the money jobs'
// figures through splitMoneyUse itself.

import { incomeMinor, spendingMinor } from "./category-offset";
import { findInvestmentMoves } from "./investment-moves";
import { isInvestmentsCategoryName, isSavingsCategoryName, splitMoneyUse, type MoneyUseInput } from "./money-jobs";
import type { EntryDto } from "../types/dto";

export const MONEY_JOB_FIGURES = ["spending", "invested", "kept", "earned", "from_savings", "took_out"] as const;
export const ENTRIES_FIGURES = ["spent", "transfers", "outflow", "difference"] as const;
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
  const split = splitMoneyUse(moneyUseInputFromEntries(entries, allEntries, investmentAccountIds));
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
