import { useId } from "react";
import { ChevronRight } from "lucide-react";

import { messages } from "./copy/en-SG";
import { moniesClient } from "./monies-client-service";
import { useMoneyPrivacy } from "./money-privacy";

const { accounts: accountService } = moniesClient;

// Stage 1 hands file/paste events back to ImportsPanel. The drop zone, the
// upload status and the AI consent stay in view; the pasted rows and the
// defaults (source label, account, owner, batch note) sit behind one link
// that ImportsPanel opens when the workflow needs them. Once files are
// queued (`isSlim`) the drop zone is one line and its notes move behind
// that link too.
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
  onTogglePasteDefaults,
  isSlim = false
}) {
  const { areTotalsVisible } = useMoneyPrivacy();
  const stageClassName = currentStage === 1 ? "is-current" : currentStage > 1 ? "is-complete" : "";
  const accountOptions = accountService.getSelectOptions(accounts);
  const pasteDefaultsId = useId();
  const openFilePicker = () => fileInputRef.current?.click();
  const dropHandlers = {
    onDragEnter: onDragOverImportFile,
    onDragOver: onDragOverImportFile,
    onDragLeave: onDragLeaveImportFile,
    onDrop: onDropImportFile
  };
  const dropzoneClassName = `import-dropzone ${isDragActive ? "is-active" : ""} ${isParsingStatement ? "is-busy" : ""}`;
  const stepHint = (
    <div className="import-step-hint">
      <strong>{messages.imports.selectFileNextUpload}</strong>
    </div>
  );
  const trustNotes = (
    <>
      <p className="lede compact">{messages.imports.trustHint}</p>
      <p className="lede compact">{rollbackPolicy}</p>
    </>
  );

  return (
    <div className={`import-stage-card ${stageClassName}${isSlim ? " is-slim" : ""}`}>
      {/* Slim, the line below is the whole drop zone and its Select file. */}
      {isSlim ? null : (
        <div className="import-stage-head">
          <div className="section-head">
            <h3>{messages.imports.selectFileTitle}</h3>
            <span className="panel-context">{messages.imports.selectFileDetail}</span>
          </div>
          <span className={`import-stage-label ${stageClassName}`}>
            {messages.imports.steps[0]}
          </span>
        </div>
      )}

      <div className={`import-drop-grid${isSlim ? " is-slim" : ""}`}>
        <input ref={fileInputRef} type="file" accept=".csv,text/csv,.pdf,application/pdf,.xls,application/vnd.ms-excel,.hsbc-ocr.tsv,.tsv,text/tab-separated-values" hidden multiple onChange={onUploadImportFile} />
        {isSlim ? (
          <div className={`${dropzoneClassName} is-slim`} {...dropHandlers}>
            <span>{messages.imports.dropMoreFiles}</span>{" "}
            <button type="button" className="subtle-action" onClick={openFilePicker}>
              {messages.imports.selectFileTitle}
            </button>
          </div>
        ) : (
          <div
            className={dropzoneClassName}
            role="button"
            tabIndex={0}
            onClick={openFilePicker}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openFilePicker();
              }
            }}
            {...dropHandlers}
          >
            <strong>{messages.imports.dropzoneTitle}</strong>
            <span>{messages.imports.dropzoneDetail}</span>
          </div>
        )}
        <div className="import-sidecar">
          {uploadStatus ? (
            <div className={`import-upload-status is-${uploadStatus.tone}`} role={uploadStatus.tone === "error" ? "alert" : "status"}>
              <strong>{uploadStatus.tone === "error" ? messages.imports.uploadStatusError : uploadStatus.tone === "success" ? messages.imports.uploadStatusReady : messages.imports.uploadStatusWorking}</strong>
              <span>{uploadStatus.message}</span>
            </div>
          ) : null}
          {isSlim ? null : stepHint}
          <label className="checkbox-field import-ai-consent">
            <input
              type="checkbox"
              checked={allowAiStatementFallback}
              onChange={(event) => onAllowAiStatementFallbackChange(event.target.checked)}
            />
            <span>Allow optional AI fallback for an unsupported PDF using extracted text only. Original files are not uploaded or stored.</span>
          </label>
          {isSlim ? null : trustNotes}
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
          {isSlim ? <div className="import-paste-defaults-notes">{stepHint}{trustNotes}</div> : null}
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
