import { messages } from "./copy/en-SG";
import { getAmountToneClass } from "./entry-helpers";
import { formatMinorInput, parseMoneyInput } from "./formatters";

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

// Preview rows are edited here, while ImportsPanel owns the canonical payload and commit callback.
export function ImportPreviewRowsTable({
  previewRows,
  accounts,
  categories,
  people,
  knownAccountNames,
  isCommitDisabled,
  onCommit,
  onUpdatePreviewRow,
  onRemovePreviewRow,
  getPreviewAccountOwnerPatch
}) {
  return (
    <>
      <ImportCommitButton disabled={isCommitDisabled} onCommit={onCommit} />
      <div className="table-wrap import-table-wrap">
        <table className="summary-table import-preview-table">
          <thead>
            <tr>
              <th>{messages.imports.table.row}</th>
              <th>{messages.imports.table.date}</th>
              <th>{messages.imports.table.description}</th>
              <th>{messages.imports.table.amount}</th>
              <th>{messages.imports.table.type}</th>
              <th>{messages.imports.table.account}</th>
              <th>{messages.imports.table.category}</th>
              <th>{messages.imports.table.owner}</th>
              <th>{messages.imports.table.split}</th>
              <th>{messages.imports.table.note}</th>
              <th>{messages.imports.table.actions}</th>
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row) => {
              const duplicateMatch = row.duplicateMatches?.[0];
              return (
              <tr key={row.rowId} className={duplicateMatch ? "import-preview-row-duplicate" : ""}>
                <td>
                  <span>{row.rowIndex}</span>
                  {duplicateMatch ? (
                    <span className={`pill duplicate-row-pill ${duplicateMatch.matchKind === "exact" ? "warning" : ""}`}>
                      {duplicateMatch.matchKind === "exact" ? messages.imports.duplicateMatchKindExact : messages.imports.duplicateMatchKindNear}
                    </span>
                  ) : null}
                </td>
                <td>
                  <input className="table-edit-input" type="date" value={row.date} onChange={(event) => onUpdatePreviewRow(row.rowId, { date: event.target.value })} />
                </td>
                <td>
                  <input className="table-edit-input" value={row.description} onChange={(event) => onUpdatePreviewRow(row.rowId, { description: event.target.value })} />
                  {duplicateMatch ? (
                    <small className="duplicate-row-detail">
                      {messages.imports.duplicateRowDetail(formatDuplicateMatch(duplicateMatch))}
                    </small>
                  ) : null}
                </td>
                <td className={getAmountToneClass(row.entryType === "expense" || row.transferDirection === "out" ? -row.amountMinor : row.amountMinor)}>
                  <input
                    className="table-edit-input import-amount-input"
                    value={formatMinorInput(row.amountMinor)}
                    onChange={(event) => onUpdatePreviewRow(row.rowId, { amountMinor: parseMoneyInput(event.target.value, row.amountMinor) })}
                  />
                </td>
                <td>
                  <select className="table-edit-input" value={row.entryType} onChange={(event) => onUpdatePreviewRow(row.rowId, { entryType: event.target.value })}>
                    <option value="expense">Expense</option>
                    <option value="income">Income</option>
                    <option value="transfer">Transfer</option>
                  </select>
                </td>
                <td>
                  <select
                    className="table-edit-input"
                    value={row.accountName ?? ""}
                    onChange={(event) => {
                      const nextAccountName = event.target.value || undefined;
                      onUpdatePreviewRow(row.rowId, {
                        accountName: nextAccountName,
                        ...getPreviewAccountOwnerPatch(nextAccountName, row)
                      });
                    }}
                  >
                    <option value="">{messages.entries.allWallets}</option>
                    {row.accountName && !knownAccountNames.has(row.accountName) ? (
                      <option value={row.accountName}>{row.accountName}</option>
                    ) : null}
                    {accounts.map((account) => (
                      <option key={account.id} value={account.name}>{account.name}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <select className="table-edit-input" value={row.categoryName ?? ""} onChange={(event) => onUpdatePreviewRow(row.rowId, { categoryName: event.target.value || undefined })}>
                    <option value="">{messages.entries.allCategories}</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.name}>{category.name}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    className="table-edit-input"
                    value={row.ownershipType === "shared" ? "Shared" : (row.ownerName ?? "")}
                    onChange={(event) => {
                      const nextOwner = event.target.value;
                      if (nextOwner === "Shared") {
                        onUpdatePreviewRow(row.rowId, { ownershipType: "shared", ownerName: undefined, splitBasisPoints: 5000 });
                        return;
                      }
                      onUpdatePreviewRow(row.rowId, { ownershipType: "direct", ownerName: nextOwner, splitBasisPoints: 10000 });
                    }}
                  >
                    {people.map((person) => (
                      <option key={person.id} value={person.name}>{person.name}</option>
                    ))}
                    <option value="Shared">{messages.entries.shared}</option>
                  </select>
                </td>
                <td>
                  {row.ownershipType === "shared" ? (
                    <input
                      className="table-edit-input import-split-input"
                      type="number"
                      min="0"
                      max="100"
                      value={Math.round((row.splitBasisPoints ?? 5000) / 100)}
                      onChange={(event) => onUpdatePreviewRow(row.rowId, { splitBasisPoints: Math.round(Number(event.target.value || "50") * 100) })}
                    />
                  ) : (
                    messages.common.emptyValue
                  )}
                </td>
                <td>
                  <input className="table-edit-input" value={row.note ?? ""} onChange={(event) => onUpdatePreviewRow(row.rowId, { note: event.target.value })} />
                </td>
                <td>
                  <button type="button" className="subtle-action" onClick={() => onRemovePreviewRow(row.rowId)}>
                    {messages.imports.removePreviewRow}
                  </button>
                </td>
              </tr>
            );
            })}
          </tbody>
        </table>
      </div>
      <ImportCommitButton disabled={isCommitDisabled} onCommit={onCommit} isBottom />
    </>
  );
}

function formatDuplicateMatch(match) {
  return messages.common.triplet(match.date, match.accountName ?? messages.common.emptyValue, formatMinorInput(match.amountMinor));
}

function ImportCommitButton({ disabled, onCommit, isBottom = false }) {
  return (
    <div className={`import-actions import-actions-end ${isBottom ? "import-actions-bottom" : ""}`}>
      <button
        type="button"
        className="import-commit-button"
        disabled={disabled}
        onClick={onCommit}
      >
        {messages.imports.commit}
      </button>
    </div>
  );
}

// Stage 1 collects source defaults and hands file/paste events back to ImportsPanel.
export function ImportSelectFileStage({
  currentStage,
  sourceLabel,
  onSourceLabelChange,
  defaultAccountName,
  onDefaultAccountChange,
  accounts,
  ownershipType,
  onOwnershipTypeChange,
  ownerName,
  onOwnerNameChange,
  people,
  splitPercent,
  onSplitPercentChange,
  importNote,
  onImportNoteChange,
  csvText,
  onCsvTextChange,
  fileInputRef,
  onUploadImportFile,
  isDragActive,
  isParsingStatement,
  onDragOverImportFile,
  onDragLeaveImportFile,
  onDropImportFile,
  uploadStatus,
  rollbackPolicy
}) {
  const stageClassName = currentStage === 1 ? "is-current" : currentStage > 1 ? "is-complete" : "";

  return (
    <div className={`import-stage-card ${stageClassName}`}>
      <div className="import-stage-head">
        <div className="section-head">
          <h3>{messages.imports.selectFileTitle}</h3>
          <span className="panel-context">{messages.imports.selectFileDetail}</span>
        </div>
        <span className={`import-stage-label ${stageClassName}`}>
          {messages.imports.steps[0]}
        </span>
      </div>

      <div className="import-form-grid">
        <label className="entries-filter">
          <span className="entries-filter-label">{messages.imports.sourceLabel}</span>
          <input
            className="table-edit-input"
            value={sourceLabel}
            onChange={(event) => onSourceLabelChange(event.target.value)}
            placeholder={messages.imports.sourceLabelPlaceholder}
          />
        </label>
        <label className="entries-filter">
          <span className="entries-filter-label">{messages.imports.defaultAccount}</span>
          <select className="table-edit-input" value={defaultAccountName} onChange={(event) => onDefaultAccountChange(event.target.value)}>
            <option value="">{messages.entries.allWallets}</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.name}>{account.name}</option>
            ))}
          </select>
        </label>
        <label className="entries-filter">
          <span className="entries-filter-label">{messages.imports.ownership}</span>
          <select className="table-edit-input" value={ownershipType} onChange={(event) => onOwnershipTypeChange(event.target.value)}>
            <option value="direct">Direct</option>
            <option value="shared">{messages.entries.shared}</option>
          </select>
        </label>
        <label className="entries-filter">
          <span className="entries-filter-label">{messages.imports.owner}</span>
          <select className="table-edit-input" value={ownerName} disabled={ownershipType !== "direct"} onChange={(event) => onOwnerNameChange(event.target.value)}>
            {people.map((person) => (
              <option key={person.id} value={person.name}>{person.name}</option>
            ))}
          </select>
        </label>
        <label className="entries-filter">
          <span className="entries-filter-label">{messages.imports.split}</span>
          <input
            className="table-edit-input"
            type="number"
            min="0"
            max="100"
            value={splitPercent}
            disabled={ownershipType !== "shared"}
            onChange={(event) => onSplitPercentChange(event.target.value)}
          />
        </label>
        <label className="entries-filter import-note-field">
          <span className="entries-filter-label">{messages.imports.importNote}</span>
          <input
            className="table-edit-input"
            value={importNote}
            onChange={(event) => onImportNoteChange(event.target.value)}
            placeholder={messages.imports.importNotePlaceholder}
          />
        </label>
      </div>

      <div className="import-csv-grid">
        <label className="entries-filter import-csv-field">
          <span className="entries-filter-label">{messages.imports.csvInput}</span>
          <textarea
            className="table-edit-textarea import-textarea"
            value={csvText}
            onChange={(event) => onCsvTextChange(event.target.value)}
            placeholder={messages.imports.csvPlaceholder}
          />
        </label>
        <div className="import-sidecar">
          <input ref={fileInputRef} type="file" accept=".csv,text/csv,.pdf,application/pdf,.xls,application/vnd.ms-excel" hidden onChange={onUploadImportFile} />
          <div
            className={`import-dropzone ${isDragActive ? "is-active" : ""} ${isParsingStatement ? "is-busy" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            onDragEnter={onDragOverImportFile}
            onDragOver={onDragOverImportFile}
            onDragLeave={onDragLeaveImportFile}
            onDrop={onDropImportFile}
          >
            <strong>{messages.imports.dropzoneTitle}</strong>
            <span>{messages.imports.dropzoneDetail}</span>
          </div>
          {uploadStatus ? (
            <div className={`import-upload-status is-${uploadStatus.tone}`} role={uploadStatus.tone === "error" ? "alert" : "status"}>
              <strong>{uploadStatus.tone === "error" ? messages.imports.uploadStatusError : uploadStatus.tone === "success" ? messages.imports.uploadStatusReady : messages.imports.uploadStatusWorking}</strong>
              <span>{uploadStatus.message}</span>
            </div>
          ) : null}
          <div className="import-step-hint">
            <strong>{messages.imports.selectFileNextUpload}</strong>
            <p>{messages.imports.selectFileNextPaste}</p>
          </div>
          <p className="lede compact">{messages.imports.defaultsHint}</p>
          <p className="lede compact">{messages.imports.trustHint}</p>
          <p className="lede compact">{rollbackPolicy}</p>
        </div>
      </div>
    </div>
  );
}
