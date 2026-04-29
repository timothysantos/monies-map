import { messages } from "./copy/en-SG";
import { moniesClient } from "./monies-client-service";

const { accounts: accountService } = moniesClient;

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
  const accountOptions = accountService.getSelectOptions(accounts);

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
            {accountOptions.map((account) => (
              <option key={account.id} value={account.value}>{account.label}</option>
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
