import {
  countSharedTokens,
  diffDays
} from "./app-repository-helpers";

export interface SplitExpenseMatchInput {
  id: string;
  date: string;
  description: string;
  totalAmountMinor: number;
  // What the exact-amount tier needs (all optional: a caller that has none
  // of them gets the word-based matching only). `currency` is the split's
  // own; `homeAmountMinor` is its home-currency (SGD) amount for a foreign
  // expense; `payerPersonId` is whose card or account the payment left.
  currency?: string;
  homeAmountMinor?: number | null;
  payerPersonId?: string;
  paymentMethod?: "cash" | "card" | "bank" | "other";
  paymentStatus?: "recorded" | "awaiting_statement" | "certified";
}

export interface SplitSettlementMatchInput {
  id: string;
  date: string;
  amountMinor: number;
  paymentMethod?: "cash" | "card" | "bank" | "other";
  paymentStatus?: "recorded" | "awaiting_statement" | "certified";
}

export interface LedgerSplitMatchRow {
  id: string;
  transaction_date: string;
  description: string;
  amount_minor: number;
  entry_type: "expense" | "income" | "transfer";
  // The account owner of the row; none means a shared or joint account.
  owner_person_id?: string | null;
  currency?: string;
}

export interface RankedSplitMatchCandidate<T extends LedgerSplitMatchRow = LedgerSplitMatchRow> {
  row: T;
  dateDelta: number;
  amountDelta: number;
  overlap: number;
}

export function findBestSplitExpenseLedgerCandidate<T extends LedgerSplitMatchRow>(
  expense: SplitExpenseMatchInput,
  rows: T[]
): RankedSplitMatchCandidate<T> | undefined {
  return rows
    .filter((row) => row.entry_type === "expense")
    .map((row) => ({
      row,
      dateDelta: diffDays(expense.date, row.transaction_date),
      amountDelta: Math.abs(expense.totalAmountMinor - row.amount_minor),
      overlap: countSharedTokens(expense.description, row.description)
    }))
    .filter((item) => item.dateDelta <= 5 && item.amountDelta <= 150 && item.overlap > 0)
    .sort(compareSplitMatchCandidates)[0];
}

// A bank row one day from the split's date is the same payment: the card
// posts a day after the purchase, or the purchase is entered the next day.
// (loadSplitMatchCandidates also calls this "High" confidence.)
const EXACT_MATCH_MAX_DAY_DELTA = 1;
const HOME_CURRENCY = "SGD";

export type SplitMatchReason = "words" | "exact-amount-and-date";

export interface SplitExpenseMatch<T extends LedgerSplitMatchRow = LedgerSplitMatchRow> extends RankedSplitMatchCandidate<T> {
  // Why it is suggested: shared description words (as always), or the
  // exact amount on the exact date with nothing else in common.
  reason: SplitMatchReason;
}

/**
 * The one suggestion for an unlinked split expense, best first:
 * 1. a same-currency row with the exact amount and date that also shares a
 *    description word (as before);
 * 2. a row with the exact amount and date and no shared word, only when it
 *    is the one such row (two equal rows are a tie and suggest nothing). A
 *    foreign-currency expense compares its home amount with a home-currency
 *    row and, like the linker, needs a card or bank expense awaiting its
 *    statement. The row must be on the payer's account or a shared one;
 * 3. a word match a few cents or days off (as before, cross-currency too).
 * Rows already held by another split are filtered out by the caller's query
 * (the linker refuses them). Nothing is ever linked here.
 */
export function findBestSplitExpenseMatch<T extends LedgerSplitMatchRow>(
  expense: SplitExpenseMatchInput,
  rows: T[]
): SplitExpenseMatch<T> | undefined {
  const sameCurrencyRows = rows.filter((row) => isSameCurrency(expense, row));
  const crossCurrencyRows = rows.filter((row) => !isSameCurrency(expense, row));
  const wordMatch = findBestSplitExpenseLedgerCandidate(expense, sameCurrencyRows)
    ?? findBestCrossCurrencySplitExpenseLedgerCandidate(expense, crossCurrencyRows);

  if (wordMatch && wordMatch.amountDelta === 0 && wordMatch.dateDelta <= EXACT_MATCH_MAX_DAY_DELTA && isSameCurrency(expense, wordMatch.row)) {
    return { ...wordMatch, reason: "words" };
  }
  const exactOnly = findExactAmountAndDateCandidates(expense, rows);
  if (exactOnly.length === 1) {
    return { ...exactOnly[0], reason: "exact-amount-and-date" };
  }
  return wordMatch ? { ...wordMatch, reason: "words" } : undefined;
}

function isSameCurrency(expense: SplitExpenseMatchInput, row: LedgerSplitMatchRow) {
  return normaliseCurrency(row.currency) === normaliseCurrency(expense.currency);
}

function normaliseCurrency(currency: string | undefined) {
  return (currency ?? HOME_CURRENCY).trim().toUpperCase() || HOME_CURRENCY;
}

// Expense rows with exactly the split's amount (its own currency, or its home
// amount against a home-currency row) within a day of its date, on the
// payer's own or a shared account. Rows sharing a word are included: when one
// of those is exact, step 1 above already chose it.
function findExactAmountAndDateCandidates<T extends LedgerSplitMatchRow>(expense: SplitExpenseMatchInput, rows: T[]) {
  return rows
    .filter((row) => row.entry_type === "expense" && isOnPayersAccount(expense, row))
    .filter((row) => diffDays(expense.date, row.transaction_date) <= EXACT_MATCH_MAX_DAY_DELTA)
    .filter((row) => exactAmountFor(expense, row))
    .map((row) => ({
      row,
      dateDelta: diffDays(expense.date, row.transaction_date),
      amountDelta: 0,
      overlap: countSharedTokens(expense.description, row.description)
    }))
    .sort(compareSplitMatchCandidates);
}

function exactAmountFor(expense: SplitExpenseMatchInput, row: LedgerSplitMatchRow) {
  if (isSameCurrency(expense, row)) {
    return expense.totalAmountMinor === row.amount_minor;
  }
  // The linker's rule for unlike currencies: a card or bank expense still
  // awaiting its statement. The home amount is the only figure comparable
  // with the row.
  return ["card", "bank"].includes(expense.paymentMethod ?? "")
    && expense.paymentStatus === "awaiting_statement"
    && normaliseCurrency(row.currency) === HOME_CURRENCY
    && typeof expense.homeAmountMinor === "number"
    && expense.homeAmountMinor > 0
    && expense.homeAmountMinor === row.amount_minor;
}

function isOnPayersAccount(expense: SplitExpenseMatchInput, row: LedgerSplitMatchRow) {
  return !row.owner_person_id || !expense.payerPersonId || row.owner_person_id === expense.payerPersonId;
}

export function findBestSplitSettlementLedgerCandidate<T extends LedgerSplitMatchRow>(
  settlement: SplitSettlementMatchInput,
  rows: T[]
): RankedSplitMatchCandidate<T> | undefined {
  return rows
    .filter((row) => row.entry_type === "transfer")
    .map((row) => ({
      row,
      dateDelta: diffDays(settlement.date, row.transaction_date),
      amountDelta: Math.abs(settlement.amountMinor - row.amount_minor),
      overlap: 0
    }))
    .filter((item) => item.dateDelta <= 7 && item.amountDelta <= 150)
    .sort(compareSplitMatchCandidates)[0];
}

export function findBestCrossCurrencySplitExpenseLedgerCandidate<T extends LedgerSplitMatchRow>(
  expense: SplitExpenseMatchInput,
  rows: T[]
): RankedSplitMatchCandidate<T> | undefined {
  if (!["card", "bank"].includes(expense.paymentMethod ?? "") || expense.paymentStatus !== "awaiting_statement") {
    return undefined;
  }

  return rows
    .filter((row) => row.entry_type === "expense")
    .map((row) => ({
      row,
      dateDelta: diffDays(expense.date, row.transaction_date),
      amountDelta: 0,
      overlap: countSharedTokens(expense.description, row.description)
    }))
    .filter((item) => item.dateDelta <= 5 && item.overlap > 0)
    .sort((left, right) => left.dateDelta - right.dateDelta || right.overlap - left.overlap)[0];
}

export function findBestCrossCurrencySplitSettlementLedgerCandidate<T extends LedgerSplitMatchRow>(
  settlement: SplitSettlementMatchInput,
  rows: T[]
): RankedSplitMatchCandidate<T> | undefined {
  if (settlement.paymentMethod !== "bank" || settlement.paymentStatus !== "awaiting_statement") {
    return undefined;
  }

  return rows
    .filter((row) => row.entry_type === "transfer")
    .map((row) => ({
      row,
      dateDelta: diffDays(settlement.date, row.transaction_date),
      amountDelta: 0,
      overlap: 0
    }))
    .filter((item) => item.dateDelta <= 7)
    .sort((left, right) => left.dateDelta - right.dateDelta)[0];
}

function compareSplitMatchCandidates<T extends LedgerSplitMatchRow>(
  left: RankedSplitMatchCandidate<T>,
  right: RankedSplitMatchCandidate<T>
) {
  return left.amountDelta - right.amountDelta
    || left.dateDelta - right.dateDelta
    || right.overlap - left.overlap;
}
