import * as Dialog from "@radix-ui/react-dialog";
import { SquarePen, X } from "lucide-react";

import { messages } from "./copy/en-SG";

// Checkpoint editing has its own dialog because it also owns history review
// actions like export, compare, and delete.
export function SettingsReconciliationDialog({
  dialog,
  isSubmitting,
  checkpointHistoryYears,
  checkpointHistoryYear,
  visibleCheckpointHistory,
  onChange,
  onHistoryYearChange,
  onClose,
  onSave,
  onEditCheckpoint,
  onDownloadCheckpoint,
  onCompareCheckpoint,
  renderCheckpointDeleteAction,
  formatCheckpointMonth,
  formatCheckpointCoverage,
  formatCheckpointBalanceLine,
  formatCheckpointDelta
}) {
  return (
    <Dialog.Root open={Boolean(dialog)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="note-dialog-overlay" />
        <Dialog.Content className="note-dialog-content settings-account-dialog settings-reconciliation-dialog">
          <div className="note-dialog-head">
            <div>
              <Dialog.Title>{messages.settings.reconcileAccountTitle}</Dialog.Title>
              <Dialog.Description>{messages.settings.reconcileAccountDetail}</Dialog.Description>
            </div>
            <button
              type="button"
              className="icon-action subtle-cancel"
              aria-label="Close reconciliation dialog"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </div>
          <div className="settings-account-form settings-reconciliation-form">
            <label className="table-edit-field settings-reconciliation-field-half">
              <span>{messages.settings.accountName}</span>
              <input className="table-edit-input" value={dialog?.accountName ?? ""} readOnly />
            </label>
            <label className="table-edit-field settings-reconciliation-field-half">
              <span>{messages.settings.checkpointMonth}</span>
              <input
                type="month"
                className="table-edit-input"
                value={dialog?.checkpointMonth ?? ""}
                onChange={(event) => onChange((current) => current ? { ...current, checkpointMonth: event.target.value } : current)}
              />
            </label>
            <label className="table-edit-field settings-reconciliation-field-half">
              <span>{messages.settings.checkpointStartDate}</span>
              <input
                type="date"
                className="table-edit-input"
                value={dialog?.statementStartDate ?? ""}
                onChange={(event) => onChange((current) => current ? { ...current, statementStartDate: event.target.value } : current)}
              />
            </label>
            <label className="table-edit-field settings-reconciliation-field-half">
              <span>{messages.settings.checkpointEndDate}</span>
              <input
                type="date"
                className="table-edit-input"
                value={dialog?.statementEndDate ?? ""}
                onChange={(event) => onChange((current) => current ? { ...current, statementEndDate: event.target.value } : current)}
              />
              <small className="field-help">{messages.settings.checkpointHelp}</small>
            </label>
            <label className="table-edit-field settings-reconciliation-balance-field">
              <span>{messages.settings.checkpointBalance}</span>
              <input
                className="table-edit-input table-edit-input-money"
                value={dialog?.statementBalance ?? "0.00"}
                onChange={(event) => onChange((current) => current ? { ...current, statementBalance: event.target.value } : current)}
              />
            </label>
            <label className="table-edit-field settings-reconciliation-note-field">
              <span>{messages.settings.checkpointNote}</span>
              <textarea
                className="table-edit-input"
                rows={4}
                value={dialog?.note ?? ""}
                onChange={(event) => onChange((current) => current ? { ...current, note: event.target.value } : current)}
              />
            </label>
          </div>
          <div className="settings-reconciliation-scroll">
            {dialog?.history?.length ? (
              <SettingsCheckpointHistory
                isSubmitting={isSubmitting}
                checkpointHistoryYears={checkpointHistoryYears}
                checkpointHistoryYear={checkpointHistoryYear}
                visibleCheckpointHistory={visibleCheckpointHistory}
                onHistoryYearChange={onHistoryYearChange}
                onEditCheckpoint={onEditCheckpoint}
                onDownloadCheckpoint={onDownloadCheckpoint}
                onCompareCheckpoint={onCompareCheckpoint}
                renderCheckpointDeleteAction={renderCheckpointDeleteAction}
                formatCheckpointMonth={formatCheckpointMonth}
                formatCheckpointCoverage={formatCheckpointCoverage}
                formatCheckpointBalanceLine={formatCheckpointBalanceLine}
                formatCheckpointDelta={formatCheckpointDelta}
              />
            ) : null}
          </div>
          <div className="note-dialog-actions">
            <button type="button" className="subtle-cancel" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="dialog-primary"
              disabled={!dialog?.checkpointMonth?.trim() || isSubmitting}
              onClick={() => void onSave()}
            >
              {messages.settings.checkpointSave}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SettingsCheckpointHistory({
  isSubmitting,
  checkpointHistoryYears,
  checkpointHistoryYear,
  visibleCheckpointHistory,
  onHistoryYearChange,
  onEditCheckpoint,
  onDownloadCheckpoint,
  onCompareCheckpoint,
  renderCheckpointDeleteAction,
  formatCheckpointMonth,
  formatCheckpointCoverage,
  formatCheckpointBalanceLine,
  formatCheckpointDelta
}) {
  return (
    <section className="settings-account-history">
      <div className="panel-subhead">
        <h3>{messages.settings.checkpointHistoryTitle}</h3>
        <p>{messages.settings.checkpointHistoryDetail}</p>
      </div>
      {checkpointHistoryYears.length > 1 ? (
        <div className="settings-checkpoint-year-filter">
          {checkpointHistoryYears.map((year) => (
            <button
              key={year}
              type="button"
              className={`summary-focus-button ${checkpointHistoryYear === year ? "is-active" : ""}`}
              onClick={() => onHistoryYearChange(year)}
            >
              {year}
            </button>
          ))}
        </div>
      ) : null}
      <div className="settings-account-list">
        {visibleCheckpointHistory.map((item) => (
          <div key={item.month} className="settings-account-row settings-checkpoint-row">
            <div className="settings-account-main">
              <strong>{formatCheckpointMonth(item)}</strong>
              <p>{formatCheckpointCoverage(item)}</p>
              <p>{formatCheckpointBalanceLine(item)}</p>
              <div className="settings-checkpoint-delta-line">
                <p className={`settings-account-health ${item.deltaMinor === 0 ? "is-matched" : "is-mismatch"}`}>
                  {formatCheckpointDelta(item)}
                </p>
                {item.deltaMinor !== 0 ? (
                  <>
                    <button
                      type="button"
                      className="settings-checkpoint-export"
                      disabled={isSubmitting}
                      onClick={() => void onDownloadCheckpoint(item)}
                    >
                      {messages.settings.checkpointExport}
                    </button>
                    <button
                      type="button"
                      className="settings-checkpoint-export"
                      disabled={isSubmitting}
                      onClick={() => onCompareCheckpoint(item)}
                    >
                      {messages.settings.statementCompareOpen}
                    </button>
                  </>
                ) : null}
              </div>
              {item.note ? <p className="settings-account-meta">{item.note}</p> : null}
            </div>
            <div className="settings-account-actions">
              <button type="button" className="icon-action" aria-label={messages.settings.checkpointEdit} onClick={() => onEditCheckpoint(item)}>
                <SquarePen size={16} />
              </button>
              {renderCheckpointDeleteAction(item)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
