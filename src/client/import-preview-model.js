import { messages } from "./copy/en-SG";

// Read alongside docs/import-summary-code-glossary.md.
// This model translates raw preview payloads into UI concepts:
// - what still needs user action
// - whether commit is safe
// - which helper sections the preview page should render
export function buildImportPreviewModel({
  accounts,
  preview,
  previewRows,
  statementCheckpoints,
  statementImportMeta,
  dismissedOverlapIds,
  unknownCategoryMode,
  isSubmitting,
  isParsingStatement
}) {
  const certifiedConflictRows = previewRows.filter((row) => row.isCertifiedConflict);
  const knownAccountNames = new Set(accounts.map((account) => account.name));
  const accountNameCounts = buildAccountNameCounts(accounts);
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
  const duplicateCheckpointAccounts = getDuplicateCheckpointAccounts(statementCheckpoints);
  const visibleOverlapImports = (preview?.overlapImports ?? []).filter((item) => !dismissedOverlapIds.includes(item.id));
  const visiblePreviewRows = previewRows.filter((row) => !row.isStatementMatchResolved && !row.isCertifiedConflict);
  const previewDuplicateRowCount = visiblePreviewRows.filter((row) => row.duplicateMatches?.length).length;
  const statementCertificationRowCount = previewRows.filter((row) => row.statementCertificationTargetTransactionId).length;
  const skippedPreviewRowCount = visiblePreviewRows.filter((row) => row.commitStatus === "skipped").length;
  const needsReviewPreviewRowCount = visiblePreviewRows.filter((row) => row.commitStatus === "needs_review").length;
  const includedPreviewRows = visiblePreviewRows.filter((row) => row.commitStatus !== "skipped" && row.commitStatus !== "needs_review");
  const statementReconciliations = preview?.statementReconciliations ?? [];
  const hasDuplicateCheckpointAccounts = duplicateCheckpointAccounts.length > 0;
  const hasCheckpointOnlyCommit = statementCheckpoints.length > 0 && includedPreviewRows.length === 0;
  const hasAlreadyCoveredCheckpointRefresh = hasCheckpointOnlyCommit && skippedPreviewRowCount > 0;
  const hasEmptyStatementCheckpointOnly = hasCheckpointOnlyCommit && skippedPreviewRowCount === 0;
  const hasMatchedCheckpointOnlyCommit = hasCheckpointOnlyCommit
    && statementReconciliations.length > 0
    && statementReconciliations.every((item) => item.status === "matched");
  const hasUnmappedAccounts = includedPreviewRows.some((row) => !row.accountId && (!row.accountName || (accountNameCounts.get(row.accountName) ?? 0) !== 1));
  const hasBlockingCategoryPolicy = unknownCategoryMode === "block" && Boolean(preview?.unknownCategories?.length);
  const hasCommitPayload = includedPreviewRows.length > 0 || statementCheckpoints.length > 0;
  const hasStatementReconciliationMismatch = statementReconciliations.some((item) => item.status !== "matched");
  const isCommitDisabled = isSubmitting
    || isParsingStatement
    || !hasCommitPayload
    || hasUnmappedAccounts
    || (hasCheckpointOnlyCommit && !hasMatchedCheckpointOnlyCommit)
    || hasBlockingCategoryPolicy
    || hasDuplicateCheckpointAccounts
    || needsReviewPreviewRowCount > 0;

  return {
    detectedPreviewAccountNames,
    duplicateCheckpointAccounts,
    hasBlockingCategoryPolicy,
    hasDuplicateCheckpointAccounts,
    hasStatementReconciliationMismatch,
    hasUnmappedAccounts,
    isCommitDisabled,
    certifiedConflictRows,
    knownAccountNames,
    needsReviewPreviewRowCount,
    hasAlreadyCoveredCheckpointRefresh,
    hasEmptyStatementCheckpointOnly,
    previewDuplicateRowCount,
    statementCertificationRowCount,
    skippedPreviewRowCount,
    commitLabel: hasAlreadyCoveredCheckpointRefresh
      ? messages.imports.refreshCoveredStatementCheckpoint
      : hasEmptyStatementCheckpointOnly
        ? messages.imports.saveEmptyStatementCheckpoint
        : hasCheckpointOnlyCommit
          ? messages.imports.saveStatementCheckpoints
          : messages.imports.commit,
    showStatementAccountMapping: preview && detectedPreviewAccountNames.length > 0 && (
      statementImportMeta.sourceType === "pdf" || unknownPreviewAccountNames.length > 0 || ambiguousPreviewAccountNames.length > 0
    ),
    statementReconciliations,
    unknownPreviewAccountNames,
    visibleOverlapImports
  };
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

export function hasImportDraft({
  preview,
  previewRows,
  csvText,
  importNote,
  statementCheckpoints,
  uploadStatus,
  previewError,
  sourceLabel
}) {
  return Boolean(
    preview
    || previewRows.length
    || csvText
    || importNote
    || statementCheckpoints.length
    || uploadStatus
    || previewError
    || sourceLabel !== "Imported CSV"
  );
}
