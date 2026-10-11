import { classifyBankCharge } from "../domain/bank-charges";

// The bank's own charges on one statement card, and the reversals of them,
// totalled by kind in the order a reader cares about. Currency conversion
// fees are the price of foreign purchases, not something to act on, so they
// are left out. Notices come from the statement (past due, penalty rate).
const KIND_ORDER = ["late_fee", "interest", "annual_fee", "other_fee"];

/**
 * @param {Array<{ description?: string, amountMinor?: number, entryType?: string }>} rows
 * @param {Array<{ code: string, annualRatePercent?: number }>} [notices]
 */
export function summarizeStatementCharges(rows, notices = []) {
  const charges = new Map();
  const reversals = new Map();
  for (const row of rows ?? []) {
    const charge = classifyBankCharge(row.description ?? "");
    if (!charge || charge.kind === "fx_fee" || row.entryType === "transfer") {
      continue;
    }
    const isReversal = charge.isReversal || row.entryType === "income";
    const totals = isReversal ? reversals : charges;
    totals.set(charge.kind, (totals.get(charge.kind) ?? 0) + Math.abs(Number(row.amountMinor ?? 0)));
  }
  const byKind = (totals) => KIND_ORDER
    .filter((kind) => totals.get(kind))
    .map((kind) => ({ kind, amountMinor: totals.get(kind) }));
  const knownNotices = (notices ?? []).filter((notice) => notice.code === "past_due" || notice.code === "penalty_interest");
  const result = { charges: byKind(charges), reversals: byKind(reversals), notices: knownNotices };
  return { ...result, hasAnything: result.charges.length > 0 || result.reversals.length > 0 || result.notices.length > 0 };
}

// "Pay $33.15 by 23 Oct 2026 · minimum $33.15" for a card statement that
// asks for money; nothing for a statement with nothing owed.
export function describePaymentDue(reconciliation) {
  if (reconciliation?.accountKind !== "credit_card" || !reconciliation.paymentDueDate) {
    return null;
  }
  const owedMinor = -Number(reconciliation.statementBalanceMinor ?? 0);
  if (!(owedMinor > 0)) {
    return null;
  }
  return {
    owedMinor,
    dueDate: reconciliation.paymentDueDate,
    isDueNow: reconciliation.paymentDueDate === reconciliation.statementEndDate,
    ...(reconciliation.minimumPaymentMinor ? { minimumMinor: reconciliation.minimumPaymentMinor } : {})
  };
}
