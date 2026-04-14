import * as Dialog from "@radix-ui/react-dialog";
import { ArrowRightLeft } from "lucide-react";

import { messages } from "./copy/en-SG";
import { formatDateOnly } from "./formatters";
import { SplitActivityGroups } from "./splits-activity";
import { formatArchiveDate, getArchivedBatchSummary } from "./split-helpers";

// SplitsPanel owns the draft state; these dialogs keep the long JSX out of the panel body.
export function SplitArchiveDialog({
  archiveDialog,
  archivedBatches,
  selectedArchivedBatch,
  categories,
  viewId,
  onClose,
  onBackToList,
  onOpenBatch,
  onEditExpense,
  onEditSettlement,
  onEditLinkedEntry
}) {
  return (
    <Dialog.Root open={Boolean(archiveDialog)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="note-dialog-overlay" />
        <Dialog.Content className="note-dialog-content split-dialog-content split-archive-dialog">
          <div className="note-dialog-head split-dialog-head">
            <Dialog.Title>{selectedArchivedBatch ? selectedArchivedBatch.label : "Archived batches"}</Dialog.Title>
            <Dialog.Description>
              {selectedArchivedBatch
                ? (selectedArchivedBatch.closedAt ? `Settled ${formatDateOnly(selectedArchivedBatch.closedAt)}` : "Settled batch")
                : "Closed settle-up batches stay here as muted history."}
            </Dialog.Description>
          </div>
          {selectedArchivedBatch ? (
            <div className="split-archive-dialog-body">
              <button type="button" className="subtle-action split-archive-back" onClick={onBackToList}>
                Back to archived batches
              </button>
              <div className="split-archive-batch-detail">
                <SplitActivityGroups
                  groups={selectedArchivedBatch.groups}
                  categories={categories}
                  archived
                  onEditExpense={onEditExpense}
                  onEditSettlement={onEditSettlement}
                  onEditLinkedEntry={onEditLinkedEntry}
                />
              </div>
            </div>
          ) : (
            <div className="split-archive-dialog-body split-archive-list-dialog">
              {archivedBatches.map((batch) => {
                const summary = getArchivedBatchSummary(batch, viewId);
                return (
                  <button key={batch.batchId} type="button" className="split-archive-row" onClick={() => onOpenBatch(batch.batchId)}>
                    <span className="split-archive-row-date">{formatArchiveDate(batch.closedAt)}</span>
                    <span className="split-archive-row-icon category-icon category-icon-static" style={{ "--category-color": "#c58b62" }}>
                      <ArrowRightLeft size={16} />
                    </span>
                    <span className="split-archive-row-copy">
                      <strong>{summary.title}</strong>
                      <small>{summary.subtitle}</small>
                    </span>
                    <span className="split-archive-row-meta">{batch.items.length} {batch.items.length === 1 ? "entry" : "entries"}</span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="dialog-actions">
            <button type="button" className="subtle-cancel" onClick={onClose}>Close</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function SplitGroupDialog({ dialog, formError, onChange, onClose, onSave }) {
  return (
    <Dialog.Root open={Boolean(dialog)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="note-dialog-overlay" />
        <Dialog.Content className="note-dialog-content split-dialog-content">
          <div className="note-dialog-head split-dialog-head">
            <Dialog.Title>{messages.splits.createGroup}</Dialog.Title>
            <Dialog.Description>Add a named split group for shared expenses.</Dialog.Description>
          </div>
          <label className="split-dialog-field">
            <span>{messages.splits.groupName}</span>
            <input className="table-edit-input" value={dialog?.name ?? ""} onChange={(event) => onChange((current) => current ? { ...current, name: event.target.value } : current)} />
          </label>
          {formError ? <p className="form-error">{formError}</p> : null}
          <div className="dialog-actions">
            <button type="button" className="subtle-cancel" onClick={onClose}>Cancel</button>
            <button type="button" className="dialog-primary" onClick={() => void onSave()}>{messages.splits.saveGroup}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
