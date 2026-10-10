import { messages } from "./copy/en-SG";

// Read alongside docs/import-summary-code-glossary.md.
// This model translates raw preview payloads into UI concepts:
// - what still needs user action
// - the facts the commit rules read (import-blockers-model.js decides
//   whether the commit is disabled or asks first)
// - which helper sections the preview page should render
const COMMIT_LABELS = {
  certify_rows: messages.imports.certifyMatchedEntries,
  covered_checkpoint: () => messages.imports.saveStatementBalance,
  saved_again: () => messages.imports.saveStatementAgain,
  empty_checkpoint: () => messages.imports.saveEmptyStatementCheckpoint,
  rows: () => messages.imports.commit
};

// A row paired with an entry the ledger already has: confirmed by the
// statement, already covered, or resolved by an earlier statement match.
export function isLedgerMatchedPreviewRow(row) {
  return Boolean(row.reconciliationTargetTransactionId)
    || Boolean(row.isStatementMatchResolved)
    || (row.commitStatus === "skipped" && !row.commitStatusExplicit && !row.isCertifiedConflict);
}

export function buildImportPreviewModel({
  accounts,
  preview,
  previewRows,
  statementCheckpoints,
  statementImportMeta,
  dismissedOverlapIds,
  unknownCategoryMode,
  keepsNoLongerListedEntries = false
}) {
  const certifiedConflictRows = previewRows.filter((row) => row.isCertifiedConflict && row.commitStatus === "skipped");
  const knownAccountNames = new Set(accounts.map((account) => account.name));
  const accountNameCounts = buildAccountNameCounts(accounts);
  const visiblePreviewRows = previewRows.filter((row) => (
    !row.isStatementMatchResolved && !(row.isCertifiedConflict && row.commitStatus === "skipped")
  ));
  const detectedPreviewAccountNames = getDetectedPreviewAccountNames({
    previewRows,
    statementCheckpoints,
    statementImportMeta
  });
  const checkpointByDetectedName = buildCheckpointMap(statementCheckpoints);
  const unknownPreviewAccountNames = detectedPreviewAccountNames.filter((accountName) => {
    const checkpoint = checkpointByDetectedName.get(accountName);
    if (checkpoint?.accountId) {
      return false;
    }
    return !knownAccountNames.has(checkpoint?.accountName ?? accountName);
  });
  const ambiguousPreviewAccountNames = detectedPreviewAccountNames.filter((accountName) => {
    const checkpoint = checkpointByDetectedName.get(accountName);
    if (checkpoint?.accountId) {
      return false;
    }
    return (accountNameCounts.get(checkpoint?.accountName ?? accountName) ?? 0) > 1;
  });
  const unmappedPreviewAccountNames = Array.from(new Set(
    visiblePreviewRows
      .filter((row) => !row.accountId && Boolean(row.accountName))
      .map((row) => row.statementAccountName ?? row.accountName)
      .filter(Boolean)
  )).sort();
  const accountMappingAccountNames = Array.from(new Set([
    ...detectedPreviewAccountNames,
    ...unmappedPreviewAccountNames
  ])).sort();
  const duplicateCheckpointAccounts = getDuplicateCheckpointAccounts(statementCheckpoints);
  const visibleOverlapImports = (preview?.overlapImports ?? []).filter((item) => !dismissedOverlapIds.includes(item.id));
  const previewReconciliationRowCount = visiblePreviewRows.filter((row) => row.reconciliationMatches?.length).length;
  const reconciledExistingRowCount = previewRows.filter((row) => row.reconciliationTargetTransactionId).length;
  const skippedPreviewRowCount = visiblePreviewRows.filter((row) => row.commitStatus === "skipped").length;
  const needsReviewPreviewRowCount = visiblePreviewRows.filter((row) => row.commitStatus === "needs_review").length;
  const commitPayloadPreviewRows = previewRows.filter((row) => row.commitStatus !== "skipped" && row.commitStatus !== "needs_review");
  const statementReconciliations = preview?.statementReconciliations ?? [];
  const hasDuplicateCheckpointAccounts = duplicateCheckpointAccounts.length > 0;
  const hasCheckpointOnlyCommit = statementCheckpoints.length > 0 && commitPayloadPreviewRows.length === 0;
  // A statement is empty only when it has no rows at all. Rows the ledger
  // already has are hidden from the review once the card balances, so a
  // statement uploaded again is covered, never empty.
  const hasEmptyStatementCheckpointOnly = hasCheckpointOnlyCommit && previewRows.length === 0;
  const hasAlreadyCoveredCheckpointRefresh = hasCheckpointOnlyCommit && !hasEmptyStatementCheckpointOnly;
  const isStatementBalanced = statementReconciliations.length > 0
    && statementReconciliations.every((item) => item.status === "matched");
  const hasMatchedCheckpointOnlyCommit = hasCheckpointOnlyCommit && isStatementBalanced;
  const matchedPreviewRowCount = previewRows.filter(isLedgerMatchedPreviewRow).length;
  // Mid-cycle entries the statement certifies on commit.
  const toCertifyRowCount = commitPayloadPreviewRows.filter((row) => row.reconciliationTargetTransactionId).length;
  // Every statement row is already in the ledger and the cards balance:
  // nothing new is added; the commit certifies what is not certified yet.
  const ledgerMatchedStatement = statementCheckpoints.length > 0
    && isStatementBalanced
    && previewRows.length > 0
    && needsReviewPreviewRowCount === 0
    && matchedPreviewRowCount === previewRows.length
    && toCertifyRowCount === commitPayloadPreviewRows.length
    ? { matchedCount: matchedPreviewRowCount, toCertifyCount: toCertifyRowCount }
    : null;
  // Every card names the import that already saved this statement: saving
  // it again adds nothing to the ledger.
  const previousStatementImport = statementReconciliations.length > 0
    && statementReconciliations.every((item) => item.previousStatementImport)
    ? statementReconciliations[0].previousStatementImport
    : null;
  // What the commit saves, which names its button (describeCommitLabel
  // adds "and open next" while another file waits).
  const commitKind = hasAlreadyCoveredCheckpointRefresh
    ? previousStatementImport ? "saved_again" : "covered_checkpoint"
    : hasEmptyStatementCheckpointOnly
      ? "empty_checkpoint"
      : ledgerMatchedStatement?.toCertifyCount
        ? "certify_rows"
        : "rows";
  const unmappedCommitRows = commitPayloadPreviewRows.filter((row) => !row.accountId && (!row.accountName || (accountNameCounts.get(row.accountName) ?? 0) !== 1));
  const hasUnmappedAccounts = unmappedCommitRows.length > 0;
  // The account labels still to map, one per label (a row without one counts
  // as one more).
  const unmappedCommitAccountNames = Array.from(new Set(unmappedCommitRows.map((row) => row.statementAccountName ?? row.accountName ?? "")));
  const hasBlockingCategoryPolicy = unknownCategoryMode === "block" && Boolean(preview?.unknownCategories?.length);
  // Entries an earlier export created that this one no longer lists: the
  // commit removes them unless the user keeps them, so removing them alone
  // is something to commit.
  const noLongerListedEntriesToRemove = keepsNoLongerListedEntries ? [] : (preview?.noLongerListedEntries ?? []);
  // Estimates whose bank row is gone and that the user did not link to a
  // row of this file go back to their own saved amount on commit.
  const reopenedEstimates = (preview?.unlistedEstimates ?? []).filter((estimate) => (
    !previewRows.some((row) => row.reconciliationTargetTransactionId === estimate.transactionId)
  ));
  const hasCommitPayload = commitPayloadPreviewRows.length > 0 || statementCheckpoints.length > 0
    || noLongerListedEntriesToRemove.length > 0 || reopenedEstimates.length > 0;
  const hasStatementReconciliationMismatch = statementReconciliations.some((item) => item.status !== "matched");

  return {
    accountMappingAccountNames,
    detectedPreviewAccountNames,
    duplicateCheckpointAccounts,
    hasBlockingCategoryPolicy,
    hasDuplicateCheckpointAccounts,
    hasStatementReconciliationMismatch,
    hasUnmappedAccounts,
    unmappedCommitAccountNames,
    hasCommitPayload,
    noLongerListedEntriesToRemove,
    reopenedEstimates,
    hasCheckpointOnlyCommit,
    hasMatchedCheckpointOnlyCommit,
    ledgerMatchedStatement,
    matchedPreviewRowCount,
    certifiedConflictRows,
    knownAccountNames,
    needsReviewPreviewRowCount,
    hasAlreadyCoveredCheckpointRefresh,
    hasEmptyStatementCheckpointOnly,
    previousStatementImport,
    previewReconciliationRowCount,
    reconciledExistingRowCount,
    skippedPreviewRowCount,
    commitKind,
    commitLabel: COMMIT_LABELS[commitKind](toCertifyRowCount),
    // A statement whose cards all map to one account each only shows the
    // mapping on request; an unknown, ambiguous or unmapped card needs it.
    needsStatementAccountMapping: unknownPreviewAccountNames.length > 0 || ambiguousPreviewAccountNames.length > 0 || hasUnmappedAccounts,
    showStatementAccountMapping: preview && accountMappingAccountNames.length > 0 && (
      statementImportMeta.sourceType === "pdf" || unknownPreviewAccountNames.length > 0 || ambiguousPreviewAccountNames.length > 0
    ),
    statementReconciliations,
    statementDiagnosis: preview?.statementDiagnosis,
    unknownPreviewAccountNames,
    visibleOverlapImports
  };
}

// The months with no saved statement between the account's last saved
// statement and this one, when they explain why the balance before this
// statement is off (the diagnosis's missing_statements fact). Empty when
// nothing is missing.
export function getMissingStatementMonths(diagnosis, accountId) {
  const gap = (diagnosis?.findings ?? []).find((finding) => (
    finding.kind === "opening_balance_gap" && finding.accountId === accountId
  ));
  return gap?.facts?.find((fact) => fact.code === "missing_statements")?.months ?? [];
}

function buildAccountNameCounts(accounts) {
  return accounts.reduce((counts, account) => {
    counts.set(account.name, (counts.get(account.name) ?? 0) + 1);
    return counts;
  }, new Map());
}

function getDetectedPreviewAccountNames({ previewRows, statementCheckpoints, statementImportMeta }) {
  const accountNames = statementImportMeta.sourceType === "pdf" && statementCheckpoints.length
    ? statementCheckpoints.map((checkpoint) => checkpoint.detectedAccountName ?? checkpoint.accountName)
    : previewRows.map((row) => row.statementAccountName ?? row.accountName);

  return Array.from(new Set(accountNames.filter(Boolean))).sort();
}

function buildCheckpointMap(statementCheckpoints) {
  return new Map(
    statementCheckpoints.map((checkpoint) => [checkpoint.detectedAccountName ?? checkpoint.accountName, checkpoint])
  );
}

function getDuplicateCheckpointAccounts(statementCheckpoints) {
  const counts = new Map();
  for (const checkpoint of statementCheckpoints) {
    const key = checkpoint.accountId ?? checkpoint.accountName;
    if (!key) {
      continue;
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries()).filter(([, count]) => count > 1).map(([accountKey]) => accountKey);
}
