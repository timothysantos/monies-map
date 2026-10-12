import { useId } from "react";
import { ChevronRight } from "lucide-react";

import { messages } from "./copy/en-SG";
import { importMessages } from "./copy/en-SG-imports";
import { moniesClient } from "./monies-client-service";
import { describeUploadStatus } from "./import-upload-status";
import { useMoneyPrivacy } from "./money-privacy";
import { DetailRow, DetailRows, MoreDetails } from "./ui-components";
import "./import-select-file-stage.css";

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
  isSlim = false,
  hasWaitingFiles = false,
  onShowQueue,
  intro = ""
}) {
  const { areTotalsVisible } = useMoneyPrivacy();
  const stageClassName = currentStage === 1 ? "is-current" : currentStage > 1 ? "is-complete" : "";
  const accountOptions = accountService.getSelectOptions(accounts);
  const pasteDefaultsId = useId();
  const status = describeUploadStatus(uploadStatus, { hasWaitingFiles });
  const statusContent = status ? (
    <>
      <strong>{status.title}</strong>
      <span>{status.message}</span>
    </>
  ) : null;
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
      <strong>{importMessages.selectFileNextUpload}</strong>
    </div>
  );
  const trustNotes = (
    <>
      <p className="lede compact">{importMessages.trustHint}</p>
      <p className="lede compact">{rollbackPolicy}</p>
    </>
  );
  // The explanations are one folded row, "How importing works", so the drop
  // zone and its Select file are the first thing on the screen.
  const howImporting = (
    <DetailRows className="import-how">
      <MoreDetails label={importMessages.howImportingTitle} openLabel={importMessages.howImportingTitle}>
        <div className="import-how-notes">
          {intro ? <p className="lede compact">{intro}</p> : null}
          <p className="lede compact">{importMessages.selectFileDetail}</p>
          {stepHint}
          {trustNotes}
        </div>
      </MoreDetails>
    </DetailRows>
  );

  return (
    <div className={`import-stage-card ${stageClassName}${isSlim ? " is-slim" : ""}`}>
      {/* Slim, the line below is the whole drop zone and its Select file. */}
      {isSlim ? null : (
        <div className="import-stage-head">
          <div className="section-head">
            <h3>{importMessages.selectFileTitle}</h3>
          </div>
          <span className={`import-stage-label ${stageClassName}`}>
            {importMessages.steps[0]}
          </span>
        </div>
      )}

      <div className={`import-drop-grid${isSlim ? " is-slim" : ""}`}>
        <input ref={fileInputRef} type="file" accept=".csv,text/csv,.pdf,application/pdf,.xls,application/vnd.ms-excel,.hsbc-ocr.tsv,.tsv,text/tab-separated-values" hidden multiple onChange={onUploadImportFile} />
        {isSlim ? (
          <div className={`${dropzoneClassName} is-slim`} {...dropHandlers}>
            <span>{importMessages.dropMoreFiles}</span>{" "}
            <button type="button" className="subtle-action" onClick={openFilePicker}>
              {importMessages.selectFileTitle}
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
            <strong>{importMessages.dropzoneTitle}</strong>
            <span>{importMessages.dropzoneDetail}</span>
          </div>
        )}
        <div className="import-sidecar">
          {/* Queued files wait for review: the box opens the queue. */}
          {status?.opensQueue ? (
            <div className="import-upload-status-live" role="status">
              <button type="button" className="import-upload-status is-waiting" onClick={onShowQueue}>
                {statusContent}
              </button>
            </div>
          ) : status ? (
            <div className={`import-upload-status is-${status.tone}`} role={status.role}>
              {statusContent}
            </div>
          ) : null}
          <label className="checkbox-field import-ai-consent">
            <input
              type="checkbox"
              checked={allowAiStatementFallback}
              onChange={(event) => onAllowAiStatementFallbackChange(event.target.checked)}
            />
            <span>Allow optional AI fallback for an unsupported PDF using extracted text only. Original files are not uploaded or stored.</span>
          </label>
          {isSlim ? null : howImporting}
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
        {importMessages.pasteRowsOrDefaults}
      </button>

      {isPasteDefaultsOpen ? (
        <div id={pasteDefaultsId} className="import-paste-defaults">
          {isSlim ? <div className="import-paste-defaults-notes">{intro ? <p className="lede compact">{intro}</p> : null}{stepHint}{trustNotes}</div> : null}
          <DetailRows className="import-defaults-rows" label={importMessages.pasteRowsOrDefaults}>
            <DetailRow label={importMessages.sourceLabel}>
              <input
                value={sourceLabel}
                onChange={(event) => onSourceLabelChange(event.target.value)}
                placeholder={importMessages.sourceLabelPlaceholder}
              />
            </DetailRow>
            <DetailRow label={importMessages.defaultAccount} value={defaultAccountName || messages.entries.allWallets}>
              <select className="lsd-row-native" aria-label={importMessages.defaultAccount} value={defaultAccountName} onChange={(event) => onDefaultAccountChange(event.target.value)}>
                <option value="">{messages.entries.allWallets}</option>
                {accountOptions.map((account) => (
                  <option key={account.id} value={account.name}>{account.label}</option>
                ))}
              </select>
            </DetailRow>
            <DetailRow label={importMessages.owner} value={ownerName}>
              <select className="lsd-row-native" aria-label={importMessages.owner} value={ownerName} onChange={(event) => onOwnerNameChange(event.target.value)}>
                {people.map((person) => (
                  <option key={person.id} value={person.name}>{person.name}</option>
                ))}
              </select>
            </DetailRow>
            <DetailRow label={importMessages.importNote}>
              <input
                value={importNote}
                onChange={(event) => onImportNoteChange(event.target.value)}
                placeholder={importMessages.importNotePlaceholder}
              />
            </DetailRow>
          </DetailRows>
          <p className="lede compact">{importMessages.defaultsHint}</p>

          <label className="entries-filter import-csv-field">
            <span className="entries-filter-label">{importMessages.csvInput}</span>
            {!areTotalsVisible ? (
              <span className="import-privacy-notice">
                {importMessages.csvScreenedWhileHidden}
              </span>
            ) : null}
            <textarea
              className={`table-edit-textarea import-textarea${areTotalsVisible ? "" : " is-screened"}`}
              value={csvText}
              onInput={(event) => onCsvTextChange(event.currentTarget.value)}
              onChange={(event) => onCsvTextChange(event.target.value)}
              placeholder={importMessages.csvPlaceholder}
            />
          </label>
          <p className="lede compact">{importMessages.selectFileNextPaste}</p>
        </div>
      ) : null}
    </div>
  );
}
