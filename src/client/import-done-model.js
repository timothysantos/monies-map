import { messages } from "./copy/en-SG";
import { formatDateOnly, formatMonthLabel } from "./formatters";

// What a commit did, read from the preview it committed: one entry per
// statement card (balance, rows added, entries confirmed or moved, entries
// left for the next statement), or a row count for an activity file, and a
// sentence naming the file, its accounts and its period. `fileName` is the
// file as the user picked it; pasted rows fall back to the source label.
export function buildImportDoneSummary({ importId, title, sourceLabel, fileName = "", preview, previewRows, statementReconciliations, isStatement }) {
  const committedRows = previewRows.filter((row) => row.commitStatus !== "skipped" && row.commitStatus !== "needs_review");
  const count = (rows) => ({
    added: rows.filter((row) => !row.reconciliationTargetTransactionId).length,
    confirmed: rows.filter((row) => row.reconciliationTargetTransactionId).length
  });
  const shownFileName = fileName || sourceLabel;
  if (!isStatement) {
    const dates = committedRows.map((row) => row.date).filter(Boolean).sort();
    return {
      importId,
      sourceLabel,
      title: messages.imports.doneTitle(title),
      confirmation: messages.imports.doneConfirmation({
        fileName: shownFileName,
        accountNames: uniqueNames(committedRows.map((row) => row.accountName)),
        period: dates.length ? formatPeriod(dates[0], dates[dates.length - 1]) : "",
        isStatement: false,
        unbalancedCount: 0
      }),
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
    confirmation: messages.imports.doneConfirmation({
      fileName: shownFileName,
      accountNames: uniqueNames(cards.map((card) => card.name)),
      period: statementPeriod(statementReconciliations[0]),
      isStatement: true,
      unbalancedCount: unbalanced
    }),
    statusLabel: unbalanced ? messages.imports.doneSavedWithDifference(unbalanced) : messages.imports.doneAllBalanced,
    statusTone: unbalanced ? "warning" : "success",
    cards
  };
}

function uniqueNames(names) {
  return [...new Set(names.filter(Boolean))];
}

function formatPeriod(startDate, endDate) {
  return startDate === endDate
    ? formatDateOnly(startDate)
    : messages.imports.donePeriod(formatDateOnly(startDate), formatDateOnly(endDate));
}

// The cards of one statement share its period; the first card's dates are
// the statement's. Without dates, its month names it.
function statementPeriod(reconciliation) {
  if (!reconciliation) {
    return "";
  }
  if (reconciliation.statementStartDate && reconciliation.statementEndDate) {
    return formatPeriod(reconciliation.statementStartDate, reconciliation.statementEndDate);
  }
  return reconciliation.checkpointMonth ? formatMonthLabel(reconciliation.checkpointMonth) : "";
}
