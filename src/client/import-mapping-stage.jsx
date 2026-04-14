import { messages } from "./copy/en-SG";

const IMPORT_FIELD_OPTIONS = [
  { value: "ignore", label: "Don't import" },
  { value: "date", label: "Date" },
  { value: "description", label: "Description" },
  { value: "amount", label: "Amount" },
  { value: "expense", label: "Expense amount" },
  { value: "income", label: "Income amount" },
  { value: "account", label: "Account" },
  { value: "category", label: "Category" },
  { value: "note", label: "Note" },
  { value: "type", label: "Type" }
];

// Stage 2 maps arbitrary CSV headers into the fixed import DTO the preview API expects.
export function ImportMappingStage({
  mappingSectionRef,
  currentStage,
  csvInspection,
  unknownCategoryMode,
  onUnknownCategoryModeChange,
  missingRequiredFields,
  duplicateMappings,
  columnMappings,
  onColumnMappingChange,
  isSubmitting,
  isParsingStatement,
  readyForPreview,
  onPreview,
  previewError
}) {
  const stageClassName = currentStage === 2 ? "is-current" : currentStage > 2 ? "is-complete" : "";

  return (
    <div ref={mappingSectionRef} className={`import-stage-card ${stageClassName}`}>
      <div className="import-stage-head">
        <div className="section-head">
          <h3>{messages.imports.mappingTitle}</h3>
          <span className="panel-context">{messages.imports.mappingDetail(csvInspection.rows.length)}</span>
        </div>
        <span className={`import-stage-label ${stageClassName}`}>
          {messages.imports.steps[1]}
        </span>
      </div>

      <div className="import-mapping-topline">
        <label className="entries-filter">
          <span className="entries-filter-label">{messages.imports.nonExistingCategories}</span>
          <select className="table-edit-input" value={unknownCategoryMode} onChange={(event) => onUnknownCategoryModeChange(event.target.value)}>
            <option value="other">{messages.imports.categoryFallbackOther}</option>
            <option value="block">{messages.imports.categoryFallbackBlock}</option>
          </select>
        </label>
        <div className="import-mapping-state">
          {missingRequiredFields.length ? (
            <span className="pill warning">{messages.imports.missingRequired(missingRequiredFields.join(", "))}</span>
          ) : null}
          {duplicateMappings.length ? (
            <span className="pill warning">{messages.imports.duplicateMappings(duplicateMappings.join(", "))}</span>
          ) : null}
          {!missingRequiredFields.length && !duplicateMappings.length ? (
            <span className="pill is-active">{messages.imports.mappingReady}</span>
          ) : null}
        </div>
      </div>

      <div className="import-mapping-grid">
        {csvInspection.headers.map((header) => (
          <article key={header} className="import-column-card">
            <div className="import-column-head">
              <strong>{header}</strong>
              <span>{messages.imports.sampleRows}</span>
            </div>
            <select
              className="table-edit-input"
              value={columnMappings[header] ?? "ignore"}
              onChange={(event) => onColumnMappingChange(header, event.target.value)}
            >
              {IMPORT_FIELD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <div className="import-column-samples">
              {csvInspection.rows.slice(0, 3).map((row, index) => (
                <code key={`${header}-${index}`}>{row[header] || messages.common.emptyValue}</code>
              ))}
            </div>
          </article>
        ))}
      </div>

      <div className="import-actions">
        <button type="button" className="subtle-action is-primary" disabled={isSubmitting || isParsingStatement || !readyForPreview} onClick={onPreview}>
          {messages.imports.preview}
        </button>
      </div>
      {readyForPreview ? <p className="import-stage-note">{messages.imports.mappingNext}</p> : null}
      {previewError ? <div className="import-warning"><strong>{previewError}</strong></div> : null}
    </div>
  );
}
