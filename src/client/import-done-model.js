import { messages } from "./copy/en-SG";

// What a commit did, read from the preview it committed: one entry per
// statement card (balance, rows added, entries confirmed or moved, entries
// left for the next statement), or a row count for an activity file.
export function buildImportDoneSummary({ importId, title, sourceLabel, preview, previewRows, statementReconciliations, isStatement }) {
  const committedRows = previewRows.filter((row) => row.commitStatus !== "skipped" && row.commitStatus !== "needs_review");
  const count = (rows) => ({
    added: rows.filter((row) => !row.reconciliationTargetTransactionId).length,
    confirmed: rows.filter((row) => row.reconciliationTargetTransactionId).length
  });
  if (!isStatement) {
    return {
      importId,
      sourceLabel,
      title: messages.imports.doneTitle(title),
      cards: [],
      counts: count(committedRows)
    };
  }

  const diagnosis = preview?.statementDiagnosis;
  const cards = statementReconciliations.map((reconciliation) => {
    const rows = committedRows.filter((row) => row.accountId === reconciliation.accountId);
    const moved = (diagnosis?.appliedFixes ?? []).filter((fix) => fix.kind === "move_to_statement_account" && fix.toAccountId === reconciliation.accountId).length;
    const later = diagnosis?.cards?.find((card) => card.accountId === reconciliation.accountId)?.laterStatementEntryCount ?? 0;
    // Amounts are formatted when shown, so revealing hidden money updates them.
    return {
      name: reconciliation.accountName,
      balanced: reconciliation.status === "matched",
      reconciliation,
      counts: { ...count(rows), moved, later }
    };
  });
  const unbalanced = cards.filter((card) => !card.balanced).length;
  return {
    importId,
    sourceLabel,
    title: messages.imports.doneTitle(title),
    statusLabel: unbalanced ? messages.imports.doneSavedWithDifference(unbalanced) : messages.imports.doneAllBalanced,
    statusTone: unbalanced ? "warning" : "success",
    cards
  };
}
