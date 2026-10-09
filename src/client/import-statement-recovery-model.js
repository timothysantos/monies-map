// The live check for a statement whose readable rows did not add up to its
// printed totals (ParsedStatementImport.reconciliation). It is recomputed
// from the current preview rows on every change, so the import unblocks only
// when the rows really add up: after a missing row is added, an unread
// amount is typed, or a misread amount is corrected in Edit rows. Nothing is
// cleared by a click.

/**
 * @param {object} input
 * @param {{ expectedDebitMinor?: number, expectedCreditMinor?: number, candidates: Array<{ id: string, evidence: "leftover-amount" | "unread-amount", row: Record<string, string>, amountMinor?: number, isCredit: boolean }> } | undefined | null} input.reconciliation
 * @param {Array<{ date: string, description: string, amountMinor: number, entryType: string, transferDirection?: string }>} input.previewRows
 */
export function buildStatementRecovery({ reconciliation, previewRows }) {
  if (!reconciliation) {
    return null;
  }

  // Every parsed row counts, including excluded ones: the statement's total
  // includes them whether or not the ledger imports them.
  const found = { debit: 0, credit: 0 };
  for (const row of previewRows) {
    found[isMoneyIn(row) ? "credit" : "debit"] += Number(row.amountMinor) || 0;
  }

  const totals = [
    reconciliation.expectedDebitMinor == null ? null : total(false, reconciliation.expectedDebitMinor, found.debit),
    reconciliation.expectedCreditMinor == null ? null : total(true, reconciliation.expectedCreditMinor, found.credit)
  ].filter(Boolean);

  const remaining = reconciliation.candidates.filter((candidate) => !isInPreview(candidate, previewRows));
  const unreadRows = remaining.filter((candidate) => candidate.evidence === "unread-amount");
  // A leftover is offered only while it is the single leftover of its kind
  // that exactly equals that kind's current difference.
  const offeredLeftovers = totals.flatMap((item) => {
    const matches = remaining.filter((candidate) => (
      candidate.evidence === "leftover-amount"
      && candidate.isCredit === item.isCredit
      && candidate.amountMinor === item.differenceMinor
    ));
    return item.differenceMinor > 0 && matches.length === 1 ? matches : [];
  });

  return {
    totals,
    isBalanced: totals.every((item) => item.differenceMinor === 0),
    offeredLeftovers,
    unreadRows
  };
}

// The import row for a confirmed candidate, with its amount on the side the
// statement printed it.
export function buildRecoveryImportRow(candidate, amountMinor) {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new Error("A missing statement row needs a positive amount.");
  }
  const amount = (amountMinor / 100).toFixed(2);
  return {
    ...candidate.row,
    expense: candidate.isCredit ? "" : amount,
    income: candidate.isCredit ? amount : ""
  };
}

function total(isCredit, expectedMinor, foundMinor) {
  return { isCredit, expectedMinor, foundMinor, differenceMinor: expectedMinor - foundMinor };
}

function isMoneyIn(row) {
  return row.entryType === "income" || (row.entryType === "transfer" && row.transferDirection === "in");
}

// A candidate is done once a preview row has its date and description (and,
// for a leftover, its amount), whether the user just added it or edited a row
// into it.
function isInPreview(candidate, previewRows) {
  return previewRows.some((row) => (
    row.date === candidate.row.date
    && row.description === candidate.row.description
    && (candidate.amountMinor == null || row.amountMinor === candidate.amountMinor)
  ));
}
