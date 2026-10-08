import { useId } from "react";
import { ChevronRight } from "lucide-react";

import { messages } from "./copy/en-SG";
import { moniesClient } from "./monies-client-service";
import { useMoneyPrivacy } from "./money-privacy";

const { accounts: accountService } = moniesClient;

// Stage 1 hands file/paste events back to ImportsPanel. The drop zone, the
// upload status and the AI consent stay in view; the pasted rows and the
// defaults (source label, account, owner, batch note) sit behind one link
// that ImportsPanel opens when the workflow needs them.
export function ImportSelectFileStage({
  currentStage,
  sourceLabel,
  onSourceLabelChange,
  defaultAccountName,
  onDefaultAccountChange,
  accounts,
  ownerName,
  onOwnerNameChange,
  people,
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
  allowAiStatementFallback,
  onAllowAiStatementFallbackChange,
  rollbackPolicy,
  isPasteDefaultsOpen,
  onTogglePasteDefaults
}) {
  const { areTotalsVisible } = useMoneyPrivacy();
  const stageClassName = currentStage === 1 ? "is-current" : currentStage > 1 ? "is-complete" : "";
  const accountOptions = accountService.getSelectOptions(accounts);
  const pasteDefaultsId = useId();

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

      <div className="import-drop-grid">
        <input ref={fileInputRef} type="file" accept=".csv,text/csv,.pdf,application/pdf,.xls,application/vnd.ms-excel,.hsbc-ocr.tsv,.tsv,text/tab-separated-values" hidden multiple onChange={onUploadImportFile} />
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
        <div className="import-sidecar">
          {uploadStatus ? (
            <div className={`import-upload-status is-${uploadStatus.tone}`} role={uploadStatus.tone === "error" ? "alert" : "status"}>
              <strong>{uploadStatus.tone === "error" ? messages.imports.uploadStatusError : uploadStatus.tone === "success" ? messages.imports.uploadStatusReady : messages.imports.uploadStatusWorking}</strong>
              <span>{uploadStatus.message}</span>
            </div>
          ) : null}
          <div className="import-step-hint">
            <strong>{messages.imports.selectFileNextUpload}</strong>
          </div>
          <label className="checkbox-field import-ai-consent">
            <input
              type="checkbox"
              checked={allowAiStatementFallback}
              onChange={(event) => onAllowAiStatementFallbackChange(event.target.checked)}
            />
            <span>Allow optional AI fallback for an unsupported PDF using extracted text only. Original files are not uploaded or stored.</span>
          </label>
          <p className="lede compact">{messages.imports.trustHint}</p>
          <p className="lede compact">{rollbackPolicy}</p>
        </div>
      </div>

      <button
        type="button"
        className="subtle-action import-paste-defaults-toggle"
        aria-expanded={isPasteDefaultsOpen}
        aria-controls={pasteDefaultsId}
        onClick={onTogglePasteDefaults}
      >
        <ChevronRight size={16} aria-hidden="true" className={isPasteDefaultsOpen ? "is-open" : ""} />
        {messages.imports.pasteRowsOrDefaults}
      </button>

      {isPasteDefaultsOpen ? (
        <div id={pasteDefaultsId} className="import-paste-defaults">
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
                  <option key={account.id} value={account.name}>{account.label}</option>
                ))}
              </select>
            </label>
            <label className="entries-filter">
              <span className="entries-filter-label">{messages.imports.owner}</span>
              <select className="table-edit-input" value={ownerName} onChange={(event) => onOwnerNameChange(event.target.value)}>
                {people.map((person) => (
                  <option key={person.id} value={person.name}>{person.name}</option>
                ))}
              </select>
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
          <p className="lede compact">{messages.imports.defaultsHint}</p>

          <label className="entries-filter import-csv-field">
            <span className="entries-filter-label">{messages.imports.csvInput}</span>
            {!areTotalsVisible ? (
              <span className="import-privacy-notice">
                {messages.imports.csvScreenedWhileHidden}
              </span>
            ) : null}
            <textarea
              className={`table-edit-textarea import-textarea${areTotalsVisible ? "" : " is-screened"}`}
              value={csvText}
              onInput={(event) => onCsvTextChange(event.currentTarget.value)}
              onChange={(event) => onCsvTextChange(event.target.value)}
              placeholder={messages.imports.csvPlaceholder}
            />
          </label>
          <p className="lede compact">{messages.imports.selectFileNextPaste}</p>
        </div>
      ) : null}
    </div>
  );
}
