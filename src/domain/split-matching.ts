import {
  countSharedTokens,
  diffDays
} from "./app-repository-helpers";

export interface SplitExpenseMatchInput {
  id: string;
  date: string;
  description: string;
  totalAmountMinor: number;
}

export interface SplitSettlementMatchInput {
  id: string;
  date: string;
  amountMinor: number;
}

export interface LedgerSplitMatchRow {
  id: string;
  transaction_date: string;
  description: string;
  amount_minor: number;
  entry_type: "expense" | "income" | "transfer";
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

function compareSplitMatchCandidates<T extends LedgerSplitMatchRow>(
  left: RankedSplitMatchCandidate<T>,
  right: RankedSplitMatchCandidate<T>
) {
  return left.amountDelta - right.amountDelta
    || left.dateDelta - right.dateDelta
    || right.overlap - left.overlap;
}
