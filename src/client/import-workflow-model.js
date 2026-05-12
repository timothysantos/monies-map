// Keep the import workflow state in one derived object so the panel can reason
// about draft identity, active edits, and auto-refresh safety without spreading
// the rules across hooks.
export function buildImportWorkflowModel({
  preview,
  previewRows = [],
  statementCheckpoints = [],
  mappedRows = [],
  mappedFields = {},
  missingRequiredFields = [],
  duplicateMappings = [],
  missingRequiredFieldsCount,
  duplicateMappingsCount,
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
  const readyForMapping = Boolean(mappedRows?.length);
  const readyForPreview = Boolean(
    readyForMapping
    && missingRequiredFieldsCount === 0
    && duplicateMappingsCount === 0
  );
  const currentStage = preview ? 3 : readyForMapping ? 2 : 1;
  const hasMissingRequiredFields = missingRequiredFields.length > 0;
  const hasDuplicateMappings = duplicateMappings.length > 0;

  return {
    currentStage,
    duplicateMappings,
    hasDraft,
    hasReviewablePreview,
    isPreviewDirty,
    isPreviewRefreshSafe,
    isWorkflowLocked,
    hasDuplicateMappings,
    hasMissingRequiredFields,
    mappedFields,
    missingRequiredFields,
    readyForMapping,
    readyForPreview
  };
}
