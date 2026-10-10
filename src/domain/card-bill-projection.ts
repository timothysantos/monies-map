// What each card owes from its latest statement, what has been paid to it
// since, and the bank charges no reversal cancelled: the facts the Summary
// and Month check-in reads from the account pills (DOMAIN.md "Card bill").
// Pure: the caller loads the accounts and the card entries and passes today.
import { addDays } from "./money-signals/format";
import { findUnreversedBankCharges } from "./bank-charges";
import type { AccountCheckpointDto, CardBillDto, CardNoticesDto, UnreversedChargeDto } from "../types/dto";

// A bill is followed until this many days after it was due; a charge for
// this many days after it was made; a statement's notices until this many
// days after it closed (about two statement cycles).
const BILL_FOLLOW_DAYS = 45;
const NOTICE_FOLLOW_DAYS = 62;
export const CHARGE_LOOKBACK_DAYS = 120;

export interface CardBillAccount {
  id: string;
  kind: string;
  checkpointHistory?: AccountCheckpointDto[];
}

export interface CardBillTransactionRow {
  id: string;
  account_id: string;
  transaction_date: string;
  post_date: string | null;
  description: string;
  amount_minor: number;
  entry_type: string;
  transfer_direction: string | null;
}

export interface CardBillFacts {
  cardBill?: CardBillDto;
  unreversedCharges?: UnreversedChargeDto[];
  cardNotices?: CardNoticesDto;
}

// How far back the card entries must go: the oldest followed statement or
// the charge window, whichever is earlier.
export function cardBillWindowStart(today: string) {
  return addDays(today, -Math.max(CHARGE_LOOKBACK_DAYS, BILL_FOLLOW_DAYS + 62));
}

export function buildCardBillFacts(input: {
  accounts: CardBillAccount[];
  transactions: CardBillTransactionRow[];
  today: string;
}): Map<string, CardBillFacts> {
  const facts = new Map<string, CardBillFacts>();
  const cards = input.accounts.filter((account) => account.kind === "credit_card");
  const cardIds = new Set(cards.map((account) => account.id));
  const entriesByAccount = new Map<string, CardBillTransactionRow[]>();
  for (const row of input.transactions) {
    if (cardIds.has(row.account_id)) {
      entriesByAccount.set(row.account_id, [...(entriesByAccount.get(row.account_id) ?? []), row]);
    }
  }

  const chargeCutoff = addDays(input.today, -CHARGE_LOOKBACK_DAYS);
  for (const account of cards) {
    const entries = entriesByAccount.get(account.id) ?? [];
    const cardBill = buildCardBill(account, entries, input.today);
    const cardNotices = buildCardNotices(account, input.today);
    const unreversedCharges = findUnreversedBankCharges(entries.map((row) => ({
      id: row.id,
      accountId: row.account_id,
      date: row.post_date ?? row.transaction_date,
      description: row.description,
      amountMinor: Math.abs(row.amount_minor),
      direction: row.entry_type === "expense" || row.transfer_direction === "out" ? "out" as const : "in" as const
    })))
      .filter((charge) => charge.date >= chargeCutoff && charge.kind !== "fx_fee")
      .map((charge) => ({ date: charge.date, kind: charge.kind as UnreversedChargeDto["kind"], amountMinor: charge.amountMinor }));
    if (cardBill || unreversedCharges.length || cardNotices) {
      facts.set(account.id, {
        ...(cardBill ? { cardBill } : {}),
        ...(unreversedCharges.length ? { unreversedCharges } : {}),
        ...(cardNotices ? { cardNotices } : {})
      });
    }
  }
  return facts;
}

function latestCheckpoint(account: CardBillAccount) {
  return [...(account.checkpointHistory ?? [])].sort((left, right) => right.month.localeCompare(left.month))[0];
}

// The latest statement's notices only: a later statement without the
// notice means the bank no longer prints it.
function buildCardNotices(account: CardBillAccount, today: string): CardNoticesDto | undefined {
  const latest = latestCheckpoint(account);
  if (!latest?.notices?.length || !latest.statementEndDate || addDays(latest.statementEndDate, NOTICE_FOLLOW_DAYS) < today) {
    return undefined;
  }
  return { statementMonth: latest.month, owedMinor: Math.max(0, -latest.statementBalanceMinor), notices: latest.notices };
}

function buildCardBill(account: CardBillAccount, entries: CardBillTransactionRow[], today: string): CardBillDto | undefined {
  const latest = latestCheckpoint(account);
  if (!latest?.paymentDueDate || !latest.statementEndDate) {
    return undefined;
  }
  // Card balances are owed when negative (the ledger's sign).
  const owedMinor = -latest.statementBalanceMinor;
  if (owedMinor <= 0 || addDays(latest.paymentDueDate, BILL_FOLLOW_DAYS) < today) {
    return undefined;
  }
  const statementEndDate = latest.statementEndDate;
  // Payments to the card after the statement closed count towards it.
  const paidSinceMinor = entries
    .filter((row) => row.entry_type === "transfer" && row.transfer_direction === "in")
    .filter((row) => (row.post_date ?? row.transaction_date) > statementEndDate)
    .reduce((total, row) => total + Math.abs(row.amount_minor), 0);
  return {
    statementMonth: latest.month,
    statementEndDate,
    paymentDueDate: latest.paymentDueDate,
    owedMinor,
    ...(latest.minimumPaymentMinor ? { minimumMinor: latest.minimumPaymentMinor } : {}),
    paidSinceMinor
  };
}
