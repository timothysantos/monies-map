const AUTO_REFRESH_COOLDOWN_MS = 15_000;
const PREVIEW_SETTLE_GRACE_MS = 2_000;

export function getStatementPreviewAutoRefreshKey({
  sourceType,
  statementCheckpoints,
  previewRows
}) {
  if (sourceType !== "pdf" || !statementCheckpoints.length || !previewRows.length) {
    return "";
  }

  return JSON.stringify({
    checkpoints: statementCheckpoints.map((checkpoint) => ([
      checkpoint.accountId ?? "",
      checkpoint.accountName ?? "",
      checkpoint.checkpointMonth ?? "",
      checkpoint.statementStartDate ?? "",
      checkpoint.statementEndDate ?? "",
      Number(checkpoint.statementBalanceMinor ?? 0)
    ])),
    rows: previewRows.map((row) => ([
      row.rowId,
      row.date,
      row.description,
      Number(row.amountMinor ?? 0),
      row.entryType,
      row.transferDirection ?? "",
      row.accountId ?? row.accountName ?? "",
      row.commitStatus ?? "",
      row.reconciliationTargetTransactionId ?? ""
    ]))
  });
}

export function shouldAutoRefreshStatementPreview({
  hasPreview,
  autoRefreshKey,
  isWorkflowLocked = false,
  isSubmitting,
  isParsingStatement,
  isDocumentVisible,
  now,
  lastPreviewHydratedAt,
  lastAutoRefreshAt,
  lastAutoRefreshKey
}) {
  if (
    !hasPreview
    || !autoRefreshKey
    || isWorkflowLocked
    || isSubmitting
    || isParsingStatement
    || !isDocumentVisible
  ) {
    return false;
  }

  if (now - lastPreviewHydratedAt < PREVIEW_SETTLE_GRACE_MS) {
    return false;
  }

  return !(
    lastAutoRefreshKey === autoRefreshKey
    && now - lastAutoRefreshAt < AUTO_REFRESH_COOLDOWN_MS
  );
}
