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
  const detectedPreviewAccountNames = Array.from(new Set(previewRows.map((row) => row.accountName).filter(Boolean))).sort();
  const unknownPreviewAccountNames = detectedPreviewAccountNames.filter((accountName) => !knownAccountNames.has(accountName));
  const duplicateCheckpointAccounts = getDuplicateCheckpointAccounts(statementCheckpoints);
  const visibleOverlapImports = (preview?.overlapImports ?? []).filter((item) => !dismissedOverlapIds.includes(item.id));
  const previewDuplicateRowCount = previewRows.filter((row) => row.duplicateMatches?.length).length;
  const statementReconciliations = preview?.statementReconciliations ?? [];
  const hasDuplicateCheckpointAccounts = duplicateCheckpointAccounts.length > 0;
  const hasUnmappedAccounts = previewRows.some((row) => !row.accountName || !knownAccountNames.has(row.accountName));
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
      statementImportMeta.sourceType === "pdf" || unknownPreviewAccountNames.length > 0
    ),
    statementReconciliations,
    unknownPreviewAccountNames,
    visibleOverlapImports
  };
}

function getDuplicateCheckpointAccounts(statementCheckpoints) {
  const counts = new Map();
  for (const checkpoint of statementCheckpoints) {
    if (!checkpoint.accountName) {
      continue;
    }
    counts.set(checkpoint.accountName, (counts.get(checkpoint.accountName) ?? 0) + 1);
  }
  return Array.from(counts.entries()).filter(([, count]) => count > 1).map(([accountName]) => accountName);
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
