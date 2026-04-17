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
  const knownAccountNames = new Set(accounts.map((account) => account.name));
  const accountNameCounts = accounts.reduce((counts, account) => {
    counts.set(account.name, (counts.get(account.name) ?? 0) + 1);
    return counts;
  }, new Map());
  const detectedPreviewAccountNames = Array.from(new Set(
    statementImportMeta.sourceType === "pdf" && statementCheckpoints.length
      ? statementCheckpoints.map((checkpoint) => checkpoint.detectedAccountName ?? checkpoint.accountName).filter(Boolean)
      : previewRows.map((row) => row.statementAccountName ?? row.accountName).filter(Boolean)
  )).sort();
  const checkpointByDetectedName = new Map(statementCheckpoints.map((checkpoint) => [checkpoint.detectedAccountName ?? checkpoint.accountName, checkpoint]));
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
  const previewDuplicateRowCount = previewRows.filter((row) => row.duplicateMatches?.length).length;
  const statementReconciliations = preview?.statementReconciliations ?? [];
  const hasDuplicateCheckpointAccounts = duplicateCheckpointAccounts.length > 0;
  const hasUnmappedAccounts = previewRows.some((row) => !row.accountId && (!row.accountName || (accountNameCounts.get(row.accountName) ?? 0) !== 1));
  const hasBlockingCategoryPolicy = unknownCategoryMode === "block" && Boolean(preview?.unknownCategories?.length);

  return {
    detectedPreviewAccountNames,
    duplicateCheckpointAccounts,
    hasBlockingCategoryPolicy,
    hasDuplicateCheckpointAccounts,
    hasStatementReconciliationMismatch: statementReconciliations.some((item) => item.status !== "matched"),
    hasUnmappedAccounts,
    isCommitDisabled: isSubmitting
      || isParsingStatement
      || !previewRows.length
      || hasUnmappedAccounts
      || hasBlockingCategoryPolicy
      || hasDuplicateCheckpointAccounts,
    knownAccountNames,
    previewDuplicateRowCount,
    showStatementAccountMapping: preview && detectedPreviewAccountNames.length > 0 && (
      statementImportMeta.sourceType === "pdf" || unknownPreviewAccountNames.length > 0 || ambiguousPreviewAccountNames.length > 0
    ),
    statementReconciliations,
    unknownPreviewAccountNames,
    visibleOverlapImports
  };
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
