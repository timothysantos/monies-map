// Keep the import workflow state in one derived object so the panel can reason
// about draft identity, active edits, and auto-refresh safety without spreading
// the rules across hooks.
export function buildImportWorkflowModel({
  preview,
  previewRows = [],
  statementCheckpoints = [],
  mappedRows = [],
  columnMappings = {},
  sourceLabel,
  csvText,
  importNote,
  statementImportMeta,
  uploadStatus,
  previewError,
  sourceLabelDefault = "Imported CSV",
  isSubmitting,
  isParsingStatement,
  currentPreviewSignature,
  hydratedPreviewSignature
}) {
  const isPreviewDirty = Boolean(preview) && currentPreviewSignature !== hydratedPreviewSignature;
  const isWorkflowLocked = Boolean(preview) && isPreviewDirty;
  const isPreviewRefreshSafe = Boolean(preview)
    && !isWorkflowLocked
    && !isSubmitting
    && !isParsingStatement;
  const mappedFields = buildMappedFields(columnMappings);
  const duplicateMappings = Object.entries(mappedFields).filter(([, count]) => count > 1).map(([field]) => field);
  const missingRequiredFields = buildMissingRequiredFields(mappedFields);
  const hasDraft = Boolean(
    preview
    || previewRows.length
    || csvText
    || importNote
    || statementCheckpoints.length
    || uploadStatus
    || previewError
    || sourceLabel !== sourceLabelDefault
  );
  const hasReviewablePreview = Boolean(preview && previewRows.length);
  const readyForMapping = Boolean(mappedRows.length);
  const readyForPreview = Boolean(
    readyForMapping
    && missingRequiredFields.length === 0
    && duplicateMappings.length === 0
  );
  const currentStage = preview ? 3 : readyForMapping ? 2 : 1;

  return {
    currentStage,
    duplicateMappings,
    hasDraft,
    hasReviewablePreview,
    isPreviewDirty,
    isPreviewRefreshSafe,
    isWorkflowLocked,
    mappedFields,
    mappedRows,
    missingRequiredFields,
    readyForMapping,
    readyForPreview
  };
}

function buildMappedFields(columnMappings) {
  const counts = {};
  for (const value of Object.values(columnMappings)) {
    if (!value || value === "ignore") {
      continue;
    }
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function buildMissingRequiredFields(mappedFields) {
  return [
    !mappedFields.date ? "date" : null,
    !mappedFields.description ? "description" : null,
    !mappedFields.amount && !mappedFields.expense && !mappedFields.income ? "amount/expense/income" : null
  ].filter(Boolean);
}
