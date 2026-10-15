import { importMessages } from "./copy/en-SG-imports";
import { formatAccountSelectLabel } from "./account-display";
import { formatDateOnly, formatMonthLabel } from "./formatters";

// What a commit did, read from the preview it committed: one entry per
// statement card (balance, rows added, entries confirmed or moved, entries
// left for the next statement), or a row count for an activity file, and a
// sentence naming the file, its accounts (with their owner, "UOB One Card -
// Tim") and its period. `fileName` is the file as the user picked it;
// pasted rows fall back to the source label.
// `removedEntryCount` is the entries an activity file removed because the
// bank no longer lists them; a statement card counts its own.
export function buildImportDoneSummary({ importId, title, sourceLabel, fileName = "", accounts = [], preview, previewRows, statementReconciliations, isStatement, removedEntryCount = 0 }) {
  const committedRows = previewRows.filter((row) => row.commitStatus !== "skipped" && row.commitStatus !== "needs_review");
  const count = (rows) => ({
    added: rows.filter((row) => !row.reconciliationTargetTransactionId).length,
    confirmed: rows.filter((row) => row.reconciliationTargetTransactionId).length
  });
  const shownFileName = fileName || sourceLabel;
  const accountLabel = (accountId, accountName) => {
    const account = accounts.find((item) => (accountId && item.id === accountId))
      ?? accounts.find((item) => (item.name ?? item.accountName) === accountName);
    return account ? formatAccountSelectLabel(account) : accountName;
  };
  if (!isStatement) {
    const rowDates = committedRows.map((row) => row.date).filter(Boolean).sort();
    // An investment statement saves the account's value on its last day and
    // may add no rows at all. Its rows' dates name the period when it has
    // any, as Recent imports does; otherwise the value's date does.
    const investmentSaves = (preview?.investmentValues ?? []).map((value) => ({
      accountName: value.accountName,
      accountLabel: accountLabel(value.accountId, value.accountName),
      valueMinor: value.totalAssetsMinor,
      asOfDate: value.asOfDate
    }));
    const dates = rowDates.length ? rowDates : investmentSaves.map((save) => save.asOfDate).filter(Boolean).sort();
    return {
      importId,
      sourceLabel,
      title: importMessages.doneTitle(title),
      confirmation: importMessages.doneConfirmation({
        fileName: shownFileName,
        accountNames: uniqueNames([
          ...committedRows.map((row) => accountLabel(row.accountId, row.accountName)),
          ...investmentSaves.map((save) => save.accountLabel)
        ]),
        period: dates.length ? formatPeriod(dates[0], dates[dates.length - 1]) : "",
        isStatement: false,
        unbalancedCount: 0
      }),
      cards: [],
      ...(investmentSaves.length ? { investmentSaves } : {}),
      counts: {
        ...count(committedRows),
        removed: removedEntryCount,
        ...(investmentSaves.length ? { paired: committedRows.filter((row) => row.transferMatch).length } : {})
      }
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
      counts: { ...count(rows), moved, later, removed: countRemovedByStatement(reconciliation) }
    };
  });
  const unbalanced = cards.filter((card) => !card.balanced).length;
  return {
    importId,
    sourceLabel,
    title: importMessages.doneTitle(title),
    confirmation: importMessages.doneConfirmation({
      fileName: shownFileName,
      accountNames: uniqueNames(cards.map((card) => accountLabel(card.reconciliation.accountId, card.name))),
      period: statementPeriod(statementReconciliations[0]),
      isStatement: true,
      unbalancedCount: unbalanced
    }),
    statusLabel: unbalanced ? importMessages.doneSavedWithDifference(unbalanced) : importMessages.doneAllBalanced,
    statusTone: unbalanced ? "warning" : "success",
    cards
  };
}

// The commit removes a card's superseded rows only when the card balances.
export function countRemovedByStatement(reconciliation) {
  return reconciliation.status === "matched" ? reconciliation.supersededLedgerRows?.length ?? 0 : 0;
}

function uniqueNames(names) {
  return [...new Set(names.filter(Boolean))];
}

function formatPeriod(startDate, endDate) {
  return startDate === endDate
    ? formatDateOnly(startDate)
    : importMessages.donePeriod(formatDateOnly(startDate), formatDateOnly(endDate));
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
