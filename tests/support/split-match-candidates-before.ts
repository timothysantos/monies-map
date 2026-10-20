// FROZEN COPY for tests: the bank-match suggestion scan of
// src/domain/app-repository-splits.ts as it was before it skipped settled
// records (every unlinked split record, settled or not, against every
// imported row in their date windows). tests/split-match-open-records.test.mjs
// compares the new scan with this one. Do not update it.
import { DEFAULT_HOUSEHOLD_ID } from "../../src/domain/app-repository-constants";
import { loadSplitExpenses, loadSplitSettlements } from "../../src/domain/app-repository-splits";
import {
  findBestCrossCurrencySplitSettlementLedgerCandidate,
  findBestSplitExpenseMatch,
  findBestSplitSettlementLedgerCandidate
} from "../../src/domain/split-matching";
import { calculateFxRateBasisPoints, normalizeSplitCurrency } from "../../src/domain/split-currency";
import { truncateReviewDescription } from "../../src/domain/review-description";
import { getCurrentMonthKey } from "../../src/lib/month";
import type { SplitExpenseDto, SplitMatchCandidateDto, SplitSettlementDto } from "../../src/types/dto";

const SPLIT_MATCH_DESCRIPTION_MAX_LENGTH = 240;

// The widest date gap split-matching.ts accepts (settle-ups: 7 days), plus a
// day of margin so a window edge never drops a real candidate.
const SPLIT_MATCH_WINDOW_DAYS = 8;
const SPLIT_MATCH_MAX_WINDOWS = 40;

// Merges the unlinked records' dates into the fewest date ranges that cover
// every possible candidate. Past a cap, one range spans them all.
function buildSplitMatchDateWindows(dates: string[]): { from: string; to: string }[] {
  const shift = (date: string, days: number) => {
    const moved = new Date(`${date}T00:00:00Z`);
    moved.setUTCDate(moved.getUTCDate() + days);
    return moved.toISOString().slice(0, 10);
  };
  const sorted = Array.from(new Set(dates.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))).sort();
  const windows: { from: string; to: string }[] = [];
  for (const date of sorted) {
    const from = shift(date, -SPLIT_MATCH_WINDOW_DAYS);
    const to = shift(date, SPLIT_MATCH_WINDOW_DAYS);
    const last = windows[windows.length - 1];
    if (last && from <= last.to) {
      last.to = to;
    } else {
      windows.push({ from, to });
    }
  }
  if (windows.length > SPLIT_MATCH_MAX_WINDOWS) {
    return [{ from: windows[0].from, to: windows[windows.length - 1].to }];
  }
  return windows;
}


// The bank-match suggestions and the unlinked records they were found for
// (only an unlinked record can be suggested a row, so only those are read).
// The Splits page checks a suggestion's record against the person view with
// these records, because a settled one is not in the page's own rows.
export async function loadSplitMatchCandidatesBefore(db: D1Database, month = getCurrentMonthKey()): Promise<{
  matches: SplitMatchCandidateDto[];
  expenses: SplitExpenseDto[];
  settlements: SplitSettlementDto[];
}> {
  const [expenses, settlements] = await Promise.all([
    loadSplitExpenses(db, month).then((rows) => rows.filter((row) => !row.linkedTransactionId)),
    loadSplitSettlements(db, month).then((rows) => rows.filter((row) => !row.linkedTransactionId))
  ]);
  return { matches: await buildSplitMatchCandidates(db, expenses, settlements), expenses, settlements };
}

async function buildSplitMatchCandidates(db: D1Database, expenses: SplitExpenseDto[], settlements: SplitSettlementDto[]): Promise<SplitMatchCandidateDto[]> {
  const unlinkedDates = [
    ...expenses.filter((item) => !item.linkedTransactionId).map((item) => item.date),
    ...settlements.filter((item) => !item.linkedTransactionId).map((item) => item.date)
  ];
  // Nothing waits for a match, so no imported row can be a candidate: skip
  // reading the whole imported ledger (every page that counts matches paid
  // for it).
  if (!unlinkedDates.length) {
    return [];
  }
  // A candidate lies within a week of an unlinked record's date
  // (split-matching.ts), so only those date windows are read.
  const windows = buildSplitMatchDateWindows(unlinkedDates);
  if (!windows.length) {
    return [];
  }
  const windowPredicate = windows.map(() => "transactions.transaction_date BETWEEN ? AND ?").join(" OR ");
  const transactionRows = await db
    .prepare(`
      SELECT
        transactions.id,
        transactions.transaction_date,
        SUBSTR(transactions.description, 1, ${SPLIT_MATCH_DESCRIPTION_MAX_LENGTH + 1}) AS description,
        transactions.amount_minor,
        transactions.currency,
        transactions.entry_type,
        transactions.owner_person_id,
        transactions.import_id
      FROM transactions
      INNER JOIN imports ON imports.id = transactions.import_id
      WHERE transactions.household_id = ?
        AND transactions.import_id IS NOT NULL
        AND imports.status = 'completed'
        AND (${windowPredicate})
        -- A row another split record already holds is refused at link time
        -- (linkSplitExpenseMatch), so it is never suggested.
        AND NOT EXISTS (SELECT 1 FROM split_expenses WHERE split_expenses.linked_transaction_id = transactions.id AND split_expenses.deleted_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM split_settlements WHERE split_settlements.linked_transaction_id = transactions.id AND split_settlements.deleted_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM split_settlement_checkpoint_matches WHERE split_settlement_checkpoint_matches.transaction_id = transactions.id)
      ORDER BY transactions.transaction_date DESC, transactions.created_at DESC
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, ...windows.flatMap((window) => [window.from, window.to]))
    .all<{
      id: string;
      transaction_date: string;
      description: string;
      amount_minor: number;
      currency: string;
      entry_type: "expense" | "income" | "transfer";
      owner_person_id: string | null;
      import_id: string;
    }>();

  const matches: SplitMatchCandidateDto[] = [];

  for (const expense of expenses.filter((item) => !item.linkedTransactionId)) {
    const candidate = findBestSplitExpenseMatch(expense, transactionRows.results);

    if (!candidate) {
      continue;
    }

    matches.push({
      id: `expense-match-${expense.id}-${candidate.row.id}`,
      kind: "expense",
      groupId: expense.groupId ?? "split-group-none",
      groupName: expense.groupName,
      splitRecordId: expense.id,
      splitDate: expense.date,
      splitDescription: expense.description,
      splitAmountMinor: expense.totalAmountMinor,
      splitCurrency: normalizeSplitCurrency(expense.currency),
      transactionId: candidate.row.id,
      transactionDate: candidate.row.transaction_date,
      transactionDescription: truncateReviewDescription(candidate.row.description, SPLIT_MATCH_DESCRIPTION_MAX_LENGTH),
      amountMinor: candidate.row.amount_minor,
      transactionCurrency: normalizeSplitCurrency(candidate.row.currency),
      amountDeltaMinor: candidate.amountDelta,
      dateDeltaDays: candidate.dateDelta,
      confidenceLabel: normalizeSplitCurrency(candidate.row.currency) === normalizeSplitCurrency(expense.currency) && candidate.amountDelta === 0 && candidate.dateDelta <= 1 ? "High" : "Medium",
      reviewLabel: candidate.reason === "exact-amount-and-date"
        ? "Same amount and date as this split expense"
        : "Imported transaction could match this split expense",
      requiresFxReview: normalizeSplitCurrency(candidate.row.currency) !== normalizeSplitCurrency(expense.currency),
      fxRateBasisPoints: normalizeSplitCurrency(candidate.row.currency) !== normalizeSplitCurrency(expense.currency)
        ? calculateFxRateBasisPoints(Math.abs(expense.totalAmountMinor), Math.abs(candidate.row.amount_minor))
        : undefined
    });
  }

  for (const settlement of settlements.filter((item) => !item.linkedTransactionId)) {
    const sameCurrencyRows = transactionRows.results.filter((row) => normalizeSplitCurrency(row.currency) === normalizeSplitCurrency(settlement.currency));
    const crossCurrencyRows = transactionRows.results.filter((row) => normalizeSplitCurrency(row.currency) !== normalizeSplitCurrency(settlement.currency));
    const candidate = findBestSplitSettlementLedgerCandidate(
      settlement,
      sameCurrencyRows
    ) ?? findBestCrossCurrencySplitSettlementLedgerCandidate(settlement, crossCurrencyRows);

    if (!candidate) {
      continue;
    }

    matches.push({
      id: `settlement-match-${settlement.id}-${candidate.row.id}`,
      kind: "settlement",
      groupId: settlement.groupId ?? "split-group-none",
      groupName: settlement.groupName,
      splitRecordId: settlement.id,
      splitDate: settlement.date,
      splitDescription: `${settlement.fromPersonName} to ${settlement.toPersonName}`,
      splitAmountMinor: settlement.amountMinor,
      splitCurrency: normalizeSplitCurrency(settlement.currency),
      transactionId: candidate.row.id,
      transactionDate: candidate.row.transaction_date,
      transactionDescription: truncateReviewDescription(candidate.row.description, SPLIT_MATCH_DESCRIPTION_MAX_LENGTH),
      amountMinor: candidate.row.amount_minor,
      transactionCurrency: normalizeSplitCurrency(candidate.row.currency),
      amountDeltaMinor: candidate.amountDelta,
      dateDeltaDays: candidate.dateDelta,
      confidenceLabel: normalizeSplitCurrency(candidate.row.currency) === normalizeSplitCurrency(settlement.currency) && candidate.amountDelta === 0 && candidate.dateDelta <= 1 ? "High" : "Medium",
      reviewLabel: "Imported transfer could match this settle-up",
      requiresFxReview: normalizeSplitCurrency(candidate.row.currency) !== normalizeSplitCurrency(settlement.currency),
      fxRateBasisPoints: normalizeSplitCurrency(candidate.row.currency) !== normalizeSplitCurrency(settlement.currency)
        ? calculateFxRateBasisPoints(Math.abs(settlement.amountMinor), Math.abs(candidate.row.amount_minor))
        : undefined
    });
  }

  return matches;
}
