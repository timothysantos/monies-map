// Investments over time (DOMAIN.md "Investments Over Time"; design.md
// "Investments over time"): Summary's card built only from what the
// statements said each investment account was worth
// (`investment_statement_values`) and the money the ledger shows moving into
// and out of those accounts this calendar year. Nothing is guessed: a month
// with no statement has no worth point, and there is no forecast.
//
// The figures, per account and added up:
// - worth: the account's latest statement value (`total_assets_minor`);
// - put in: this year's transfers into the account less transfers out of
//   it, as the Invested money job finds them (findInvestmentMoves). A
//   transfer in whose linked other side is an expense filed under
//   Investments is counted as that expense, the way the Invested figure
//   counts it, so View entries ("invested", narrowed to the ids) totals the
//   put in to the cent (money-figures.ts, investmentPutInFigureMinor);
// - grew by: worth less the account's starting worth less what was put in
//   after the start and up to the latest statement's date. The start is
//   the last statement before 1 January (put in counted from 1 January),
//   or, for an account whose first statement is this year ("from Jun"),
//   that first statement (put in counted after its date): money that was
//   in the account before its first statement is never taken for growth.
//   Market moves included, so it can be below zero;
// - paid out: the statements' dividends and interest (`income_minor`) dated
//   this year.
//
// Pure: the loader (pages/investments-over-time.ts) reads the rows.

import { spendingMinor } from "./category-offset";
import { isInvestmentsCategoryName } from "./money-jobs";
import type { EntryDto } from "../types/dto";

type MoveEntry = Pick<EntryDto, "id" | "date" | "accountId" | "entryType" | "transferDirection" | "amountMinor" | "categoryName" | "linkedTransfer">;

export interface InvestmentAccountFact {
  id: string;
  name: string;
  provider: string;
  personId: string;
  // The owner's name, or "Shared" for a joint account.
  personName: string;
}

export interface InvestmentValueFact {
  accountId: string;
  month: string;
  asOfDate: string;
  worthMinor: number;
  paidOutMinor: number;
}

export interface InvestmentPutIn {
  amountMinor: number;
  ids: string[];
}

export interface InvestmentAccountRow {
  accountId: string;
  name: string;
  provider: string;
  personId: string;
  personName: string;
  asOfDate: string;
  // The first statement month this year, when the account had none before.
  fromMonth?: string;
  worthMinor: number;
  startWorthMinor: number;
  putIn: InvestmentPutIn;
  grewMinor: number;
  paidOutMinor: number;
}

export interface InvestmentChartMonth {
  month: string;
  // Only a month every account with a statement by then has one for.
  worthMinor: number | null;
  // What the accounts were worth on 1 January plus what was put in by the
  // month's end: the stepped line.
  putInMinor: number;
}

export interface InvestmentsOverTime {
  year: string;
  asOfDate: string;
  worthMinor: number;
  startWorthMinor: number;
  putIn: InvestmentPutIn;
  grewMinor: number;
  paidOutMinor: number;
  months: InvestmentChartMonth[];
  accounts: InvestmentAccountRow[];
}

interface Move {
  id: string;
  accountId: string;
  date: string;
  // Signed: into the account adds, out of it takes away.
  amountMinor: number;
}

/**
 * The moves into and out of each investment account among `entries` (the
 * household's own, this year). A pair between two investment accounts moves
 * nothing; a transfer in paid by an expense filed under Investments is that
 * expense (the Invested rule, investment-moves.ts).
 */
export function findInvestmentAccountMoves(entries: MoveEntry[], investmentAccountIds: ReadonlySet<string>): Move[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const isInvestment = (accountId?: string) => Boolean(accountId) && investmentAccountIds.has(accountId as string);
  const moves: Move[] = [];
  for (const entry of entries) {
    if (entry.entryType !== "transfer" || !entry.accountId || !isInvestment(entry.accountId) || !(entry.amountMinor > 0)) {
      continue;
    }
    const otherSide = entry.linkedTransfer ? byId.get(entry.linkedTransfer.transactionId) : undefined;
    if (otherSide && isInvestment(otherSide.accountId)) {
      continue;
    }
    if (entry.transferDirection === "in") {
      if (otherSide?.entryType === "expense" && isInvestmentsCategoryName(otherSide.categoryName)) {
        moves.push({ id: otherSide.id, accountId: entry.accountId, date: entry.date, amountMinor: spendingMinor(otherSide) });
      } else {
        moves.push({ id: entry.id, accountId: entry.accountId, date: entry.date, amountMinor: entry.amountMinor });
      }
    } else if (entry.transferDirection === "out") {
      moves.push({ id: entry.id, accountId: entry.accountId, date: entry.date, amountMinor: -entry.amountMinor });
    }
  }
  return moves;
}

function putInOf(moves: Move[]): InvestmentPutIn {
  return {
    amountMinor: moves.reduce((sum, move) => sum + move.amountMinor, 0),
    ids: [...new Set(moves.map((move) => move.id))].sort()
  };
}

function monthsOfYear(year: string, lastMonth: string) {
  const months: string[] = [];
  for (let index = 1; index <= 12; index += 1) {
    const month = `${year}-${String(index).padStart(2, "0")}`;
    if (month > lastMonth) break;
    months.push(month);
  }
  return months;
}

/**
 * The card's figures for the accounts in view. `accounts` are the
 * investment accounts to show (with at least one statement value), `values`
 * every statement value of theirs, `entries` the household's entries from 1
 * January to the end of today's month.
 */
export function buildInvestmentsOverTime({
  today,
  accounts,
  values,
  entries,
  investmentAccountIds
}: {
  today: string;
  accounts: InvestmentAccountFact[];
  values: InvestmentValueFact[];
  entries: MoveEntry[];
  investmentAccountIds: ReadonlySet<string>;
}): InvestmentsOverTime | null {
  const year = today.slice(0, 4);
  const yearStart = `${year}-01-01`;
  const valuesByAccount = new Map<string, InvestmentValueFact[]>();
  for (const value of values) {
    const list = valuesByAccount.get(value.accountId) ?? [];
    list.push(value);
    valuesByAccount.set(value.accountId, list);
  }
  const shown = accounts.filter((account) => valuesByAccount.get(account.id)?.length);
  if (!shown.length) {
    return null;
  }
  const allMoves = findInvestmentAccountMoves(entries, investmentAccountIds);

  // Each account's start: the last statement before 1 January (moves
  // counted from 1 January), else its first statement this year (moves
  // counted after that statement's date).
  const starts = new Map<string, { worthMinor: number; month: string; after: string; inYear: boolean }>();
  const rows: InvestmentAccountRow[] = shown.map((account) => {
    const list = [...(valuesByAccount.get(account.id) ?? [])].sort((left, right) => left.asOfDate.localeCompare(right.asOfDate));
    const latest = list[list.length - 1];
    const before = list.filter((value) => value.asOfDate < yearStart);
    const thisYear = list.filter((value) => value.asOfDate.startsWith(year));
    const startValue = before.length ? before[before.length - 1] : thisYear[0] ?? latest;
    const start = before.length || !thisYear.length
      ? { worthMinor: startValue.worthMinor, month: `${year}-01`, after: "", inYear: false }
      : { worthMinor: startValue.worthMinor, month: startValue.month, after: startValue.asOfDate, inYear: true };
    starts.set(account.id, start);
    const moves = allMoves.filter((move) => move.accountId === account.id && move.date.startsWith(year));
    const grownMoves = moves.filter((move) => move.date > start.after && move.date <= latest.asOfDate);
    return {
      accountId: account.id,
      name: account.name,
      provider: account.provider,
      personId: account.personId,
      personName: account.personName,
      asOfDate: latest.asOfDate,
      ...(start.inYear ? { fromMonth: start.month } : {}),
      worthMinor: latest.worthMinor,
      startWorthMinor: start.worthMinor,
      putIn: putInOf(moves),
      grewMinor: latest.worthMinor - start.worthMinor - grownMoves.reduce((sum, move) => sum + move.amountMinor, 0),
      paidOutMinor: thisYear.reduce((sum, value) => sum + value.paidOutMinor, 0)
    };
  });

  // The chart starts at the first account's start: January, or the month of
  // the first statement when every account started this year.
  const firstMonth = [...starts.values()].reduce((earliest, start) => (start.month < earliest ? start.month : earliest), `${year}-12`);
  const months = monthsOfYear(year, today.slice(0, 7)).filter((month) => month >= firstMonth).map((month) => {
    let worthMinor: number | null = 0;
    let started = 0;
    let putInMinor = 0;
    const monthEnd = `${month}-31`;
    for (const row of rows) {
      const list = valuesByAccount.get(row.accountId) ?? [];
      if (list.some((value) => value.month <= month)) {
        started += 1;
        const atMonth = list.find((value) => value.month === month);
        worthMinor = atMonth && worthMinor !== null ? worthMinor + atMonth.worthMinor : null;
      }
      // The stepped line: from the account's start on, its starting worth
      // plus what was put in after the start, by the month's end.
      const start = starts.get(row.accountId);
      if (start && start.month <= month) {
        putInMinor += start.worthMinor + allMoves
          .filter((move) => move.accountId === row.accountId && move.date >= yearStart && move.date > start.after && move.date <= monthEnd)
          .reduce((sum, move) => sum + move.amountMinor, 0);
      }
    }
    return { month, worthMinor: started ? worthMinor : null, putInMinor };
  });

  const sum = (pick: (row: InvestmentAccountRow) => number) => rows.reduce((total, row) => total + pick(row), 0);
  return {
    year,
    asOfDate: rows.reduce((latest, row) => (row.asOfDate > latest ? row.asOfDate : latest), ""),
    worthMinor: sum((row) => row.worthMinor),
    startWorthMinor: sum((row) => row.startWorthMinor),
    putIn: {
      amountMinor: sum((row) => row.putIn.amountMinor),
      ids: [...new Set(rows.flatMap((row) => row.putIn.ids))].sort()
    },
    grewMinor: sum((row) => row.grewMinor),
    paidOutMinor: sum((row) => row.paidOutMinor),
    months,
    accounts: rows
  };
}
