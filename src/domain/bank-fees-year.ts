// Bank fees this year (DOMAIN.md "Bank Charge", "fees this year"): what the
// banks charged the view's cards and accounts from 1 January to the end of
// the focus month, by kind, with each refunded fee paired with its refund
// and left out of the total. It reuses the two existing ways of spotting a
// fee, so nothing new decides what a fee is: classifyBankCharge (card rows:
// late fee, interest, annual fee, foreign currency fee, other) and
// classifyAccountCharge (bank account rows: a charge for a payment that
// didn't go through, the monthly or fall-below fee). Both read the
// description's leading words, never a word inside a shop's name.
//
// Pairing is findUnreversedBankCharges' rule: each refund cancels one charge
// of the same kind and amount on the same account, dated on or before it.
// Foreign currency fees are counted (owner decision D4) and named apart.
import { classifyAccountCharge } from "./account-routines";
import { classifyBankCharge, type BankChargeKind } from "./bank-charges";

export type BankFeeKind = BankChargeKind | "failed_payment" | "account_fee";

export interface BankFeeRow {
  id: string;
  accountId: string;
  accountKind: string;
  date: string;
  description: string;
  // Positive: the entry's amount.
  amountMinor: number;
  // Money out (a charge) or in (a refund).
  direction: "out" | "in";
  // Money in that lowers spending (a refund filed under Fees or another
  // spending category). A refund filed as income is not one here: Entries
  // would count it as income, so View entries could not show the total.
  offsetsSpending?: boolean;
}

export interface BankFeesYear {
  year: string;
  // Charged less refunded: what the year's fees came to.
  netMinor: number;
  // The charges that were refunded (each paired with its refund).
  refundedMinor: number;
  // The fees that stand, by kind, largest first.
  parts: Array<{ kind: BankFeeKind; minor: number; count: number }>;
  refundedParts: Array<{ kind: BankFeeKind; minor: number; count: number }>;
  // Every fee row and refund row of the year: View entries opens them, and
  // their Spent total is netMinor (a paired charge and its refund net to 0).
  ids: string[];
  // The months a late fee, interest or an annual fee was charged (the line
  // may lead in such a month).
  penaltyMonths: string[];
}

// The kinds a bank might refund when asked; a foreign currency fee is the
// price of paying in another currency.
export const REFUNDABLE_KINDS: readonly BankFeeKind[] = ["late_fee", "interest", "annual_fee", "other_fee", "failed_payment", "account_fee"];

function classify(row: BankFeeRow): { kind: BankFeeKind; isRefund: boolean } | null {
  if (row.direction === "in" && !row.offsetsSpending) {
    return null;
  }
  const card = classifyBankCharge(row.description);
  if (card) {
    return { kind: card.kind, isRefund: card.isReversal || row.direction === "in" };
  }
  if (row.accountKind === "bank") {
    const account = classifyAccountCharge(row.description);
    if (account) {
      return { kind: account, isRefund: row.direction === "in" };
    }
  }
  return null;
}

function byKind(list: Array<{ kind: BankFeeKind; amountMinor: number }>) {
  const totals = new Map<BankFeeKind, { minor: number; count: number }>();
  for (const item of list) {
    const current = totals.get(item.kind) ?? { minor: 0, count: 0 };
    totals.set(item.kind, { minor: current.minor + item.amountMinor, count: current.count + 1 });
  }
  return [...totals.entries()]
    .map(([kind, value]) => ({ kind, ...value }))
    .sort((left, right) => right.minor - left.minor || left.kind.localeCompare(right.kind));
}

/** The year's fees from its rows (already in the view and the window). */
export function buildBankFeesYear(year: string, rows: BankFeeRow[]): BankFeesYear {
  const classified = rows
    .map((row) => ({ row, fee: classify(row) }))
    .filter((item): item is { row: BankFeeRow; fee: { kind: BankFeeKind; isRefund: boolean } } => Boolean(item.fee))
    .sort((left, right) => left.row.date.localeCompare(right.row.date) || left.row.id.localeCompare(right.row.id));
  const open: Array<{ id: string; accountId: string; kind: BankFeeKind; amountMinor: number; date: string }> = [];
  const refunded: Array<{ kind: BankFeeKind; amountMinor: number }> = [];
  const ids: string[] = [];
  let unpairedRefundsMinor = 0;
  for (const { row, fee } of classified) {
    ids.push(row.id);
    if (!fee.isRefund) {
      open.push({ id: row.id, accountId: row.accountId, kind: fee.kind, amountMinor: row.amountMinor, date: row.date });
      continue;
    }
    const index = open.findIndex((charge) => (
      charge.accountId === row.accountId && charge.kind === fee.kind && charge.amountMinor === row.amountMinor && charge.date <= row.date
    ));
    if (index >= 0) {
      refunded.push(open[index]);
      open.splice(index, 1);
    } else {
      // A refund of a charge from before the year: it lowers this year's
      // total, as it lowers the Fees spending Entries shows.
      unpairedRefundsMinor += row.amountMinor;
    }
  }
  const parts = byKind(open);
  const standing = parts.reduce((sum, part) => sum + part.minor, 0);
  return {
    year,
    netMinor: standing - unpairedRefundsMinor,
    refundedMinor: refunded.reduce((sum, charge) => sum + charge.amountMinor, 0),
    parts,
    refundedParts: byKind(refunded),
    ids,
    penaltyMonths: [...new Set(classified
      .filter(({ fee }) => !fee.isRefund && ["late_fee", "interest", "annual_fee"].includes(fee.kind))
      .map(({ row }) => row.date.slice(0, 7)))].sort()
  };
}
