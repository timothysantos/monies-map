import * as Dialog from "@radix-ui/react-dialog";
import { ArrowRightLeft } from "lucide-react";

import { messages } from "./copy/en-SG";
import { decimalStringToMinor, formatDateOnly, minorToDecimalString } from "./formatters";
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

export function SplitExpenseDialog({ dialog, groupOptions, people, categoryOptions, formError, onChange, onClose, onSave }) {
  return (
    <Dialog.Root open={Boolean(dialog)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="note-dialog-overlay" />
        <Dialog.Content className="note-dialog-content split-dialog-content">
          <div className="note-dialog-head split-dialog-head">
            <Dialog.Title>{dialog?.id ? messages.splits.editSplit : messages.splits.createExpense}</Dialog.Title>
            <Dialog.Description>Create or edit a split expense without touching the bank import workflow.</Dialog.Description>
          </div>
          <div className="split-dialog-section">
            <div className="entry-core-grid split-dialog-grid">
              <label className="split-dialog-field">
                <span>Group</span>
                <select className="table-edit-input" value={dialog?.groupId ?? "split-group-none"} onChange={(event) => onChange((current) => current ? { ...current, groupId: event.target.value } : current)}>
                  {groupOptions.map((option) => (
                    <option key={option.id} value={option.id}>{option.name}</option>
                  ))}
                </select>
              </label>
              <label className="split-dialog-field">
                <span>{messages.splits.expenseDate}</span>
                <input className="table-edit-input" type="date" value={dialog?.date ?? ""} onChange={(event) => onChange((current) => current ? { ...current, date: event.target.value } : current)} />
              </label>
              <label className="split-dialog-field">
                <span>{messages.splits.expensePaidBy}</span>
                <select className="table-edit-input" value={dialog?.payerPersonName ?? ""} onChange={(event) => onChange((current) => current ? { ...current, payerPersonName: event.target.value } : current)}>
                  {people.map((person) => (
                    <option key={person.id} value={person.name}>{person.name}</option>
                  ))}
                </select>
              </label>
              <label className="split-dialog-field">
                <span>{messages.splits.expenseCategory}</span>
                <select className="table-edit-input" value={dialog?.categoryName ?? ""} onChange={(event) => onChange((current) => current ? { ...current, categoryName: event.target.value } : current)}>
                  {categoryOptions.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <div className="split-dialog-section split-dialog-section-compact">
            <div className="split-dialog-inline">
              <label className="split-dialog-field">
                <span>{messages.splits.expenseAmount}</span>
                <input className="table-edit-input table-edit-input-money" type="number" min="0" step="0.01" value={minorToDecimalString(dialog?.amountMinor ?? 0)} onChange={(event) => onChange((current) => current ? { ...current, amountMinor: decimalStringToMinor(event.target.value) } : current)} />
              </label>
              <label className="split-dialog-field">
                <span>{messages.splits.expenseSplit}</span>
                <input className="table-edit-input table-edit-input-money" type="number" min="0" max="100" value={Number(dialog?.splitBasisPoints ?? 5000) / 100} onChange={(event) => onChange((current) => current ? { ...current, splitBasisPoints: Math.round(Number(event.target.value || 0) * 100) } : current)} />
              </label>
            </div>
          </div>
          <div className="split-dialog-section">
            <div className="entry-writing-grid split-dialog-writing-grid">
              <label className="split-dialog-field">
                <span>{messages.splits.expenseDescription}</span>
                <textarea className="table-edit-input table-edit-textarea" rows={3} value={dialog?.description ?? ""} onChange={(event) => onChange((current) => current ? { ...current, description: event.target.value } : current)} />
              </label>
              <label className="split-dialog-field">
                <span>{messages.splits.expenseNote}</span>
                <textarea className="table-edit-input table-edit-textarea" rows={3} value={dialog?.note ?? ""} onChange={(event) => onChange((current) => current ? { ...current, note: event.target.value } : current)} />
              </label>
            </div>
          </div>
          {formError ? <p className="form-error">{formError}</p> : null}
          <div className="dialog-actions">
            <button type="button" className="subtle-cancel" onClick={onClose}>Cancel</button>
            <button type="button" className="dialog-primary" onClick={() => void onSave()}>{messages.splits.saveExpense}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function SplitSettlementDialog({ dialog, groupOptions, people, formError, onChange, onClose, onSave }) {
  return (
    <Dialog.Root open={Boolean(dialog)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="note-dialog-overlay" />
        <Dialog.Content className="note-dialog-content split-dialog-content">
          <div className="note-dialog-head split-dialog-head">
            <Dialog.Title>{dialog?.id ? messages.splits.editSplit : messages.splits.createSettlement}</Dialog.Title>
            <Dialog.Description>Record or edit a settle-up and match the bank transfer later from the Matches view.</Dialog.Description>
          </div>
          <div className="split-dialog-section">
            <div className="entry-core-grid split-dialog-grid">
              <label className="split-dialog-field">
                <span>Group</span>
                <select className="table-edit-input" value={dialog?.groupId ?? "split-group-none"} onChange={(event) => onChange((current) => current ? { ...current, groupId: event.target.value } : current)}>
                  {groupOptions.map((option) => (
                    <option key={option.id} value={option.id}>{option.name}</option>
                  ))}
                </select>
              </label>
              <label className="split-dialog-field">
                <span>{messages.splits.settlementDate}</span>
                <input className="table-edit-input" type="date" value={dialog?.date ?? ""} onChange={(event) => onChange((current) => current ? { ...current, date: event.target.value } : current)} />
              </label>
              <label className="split-dialog-field">
                <span>{messages.splits.settlementFrom}</span>
                <select className="table-edit-input" value={dialog?.fromPersonName ?? ""} onChange={(event) => onChange((current) => current ? { ...current, fromPersonName: event.target.value } : current)}>
                  {people.map((person) => (
                    <option key={person.id} value={person.name}>{person.name}</option>
                  ))}
                </select>
              </label>
              <label className="split-dialog-field">
                <span>{messages.splits.settlementTo}</span>
                <select className="table-edit-input" value={dialog?.toPersonName ?? ""} onChange={(event) => onChange((current) => current ? { ...current, toPersonName: event.target.value } : current)}>
                  {people.map((person) => (
                    <option key={person.id} value={person.name}>{person.name}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <div className="split-dialog-section split-dialog-section-compact">
            <div className="split-dialog-inline">
              <label className="split-dialog-field">
                <span>{messages.splits.settlementAmount}</span>
                <input className="table-edit-input table-edit-input-money" type="number" min="0" step="0.01" value={minorToDecimalString(dialog?.amountMinor ?? 0)} onChange={(event) => onChange((current) => current ? { ...current, amountMinor: decimalStringToMinor(event.target.value) } : current)} />
              </label>
            </div>
          </div>
          <div className="split-dialog-section">
            <label className="split-dialog-field">
              <span>{messages.splits.expenseNote}</span>
              <textarea className="table-edit-input table-edit-textarea" rows={4} value={dialog?.note ?? ""} onChange={(event) => onChange((current) => current ? { ...current, note: event.target.value } : current)} />
            </label>
          </div>
          {formError ? <p className="form-error">{formError}</p> : null}
          <div className="dialog-actions">
            <button type="button" className="subtle-cancel" onClick={onClose}>Cancel</button>
            <button type="button" className="dialog-primary" onClick={() => void onSave()}>{messages.splits.saveSettlement}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function SplitLinkedEntryDialog({ dialog, people, categoryOptions, formError, onChange, onClose, onSave }) {
  return (
    <Dialog.Root open={Boolean(dialog)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="note-dialog-overlay" />
        <Dialog.Content className="note-dialog-content split-dialog-content">
          <div className="note-dialog-head split-dialog-head">
            <Dialog.Title>{messages.splits.editLinkedEntry}</Dialog.Title>
            <Dialog.Description>Edit the same ledger entry that also appears on the Entries page. Changes here update that row there too.</Dialog.Description>
          </div>
          <div className="linked-entry-notice">
            <strong>Linked to Entries</strong>
            <p>This form edits the underlying ledger row. When you save here, the matching entry in `Entries` updates too.</p>
          </div>
          <div className="split-dialog-section">
            <div className="entry-core-grid split-dialog-grid">
              <label className="split-dialog-field">
                <span>{messages.entries.editDate}</span>
                <input className="table-edit-input" type="date" value={dialog?.date ?? ""} onChange={(event) => onChange((current) => current ? { ...current, date: event.target.value } : current)} />
              </label>
              <label className="split-dialog-field">
                <span>{messages.entries.editWallet}</span>
                <input className="table-edit-input" value={dialog?.accountName ?? ""} onChange={(event) => onChange((current) => current ? { ...current, accountName: event.target.value } : current)} />
              </label>
              <label className="split-dialog-field">
                <span>{messages.entries.editCategory}</span>
                <select className="table-edit-input" value={dialog?.categoryName ?? ""} onChange={(event) => onChange((current) => current ? { ...current, categoryName: event.target.value } : current)}>
                  {categoryOptions.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <div className="split-dialog-section split-dialog-section-compact">
            <div className="split-dialog-inline">
              <label className="split-dialog-field">
                <span>{messages.entries.editAmount}</span>
                <input className="table-edit-input table-edit-input-money" type="number" min="0" step="0.01" value={minorToDecimalString(dialog?.amountMinor ?? 0)} onChange={(event) => onChange((current) => current ? { ...current, amountMinor: decimalStringToMinor(event.target.value) } : current)} />
              </label>
              <label className="split-dialog-field">
                <span>{messages.entries.editOwner}</span>
                <select className="table-edit-input" value={dialog?.ownershipType === "shared" ? "Shared" : (dialog?.ownerName ?? "")} onChange={(event) => {
                  const nextValue = event.target.value;
                  onChange((current) => current ? {
                    ...current,
                    ownershipType: nextValue === "Shared" ? "shared" : "direct",
                    ownerName: nextValue === "Shared" ? undefined : nextValue
                  } : current);
                }}>
                  {[...people.map((person) => person.name), "Shared"].map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </label>
              {dialog?.ownershipType === "shared" ? (
                <label className="split-dialog-field">
                  <span>{messages.entries.editSplit}</span>
                  <input className="table-edit-input table-edit-input-money" type="number" min="0" max="100" value={Number(dialog?.splitBasisPoints ?? 5000) / 100} onChange={(event) => onChange((current) => current ? { ...current, splitBasisPoints: Math.round(Number(event.target.value || 0) * 100) } : current)} />
                </label>
              ) : null}
            </div>
          </div>
          <div className="split-dialog-section">
            <div className="entry-writing-grid split-dialog-writing-grid">
              <label className="split-dialog-field">
                <span>{messages.entries.editDescription}</span>
                <textarea className="table-edit-input table-edit-textarea" rows={3} value={dialog?.description ?? ""} onChange={(event) => onChange((current) => current ? { ...current, description: event.target.value } : current)} />
              </label>
              <label className="split-dialog-field">
                <span>{messages.entries.editNote}</span>
                <textarea className="table-edit-input table-edit-textarea" rows={3} value={dialog?.note ?? ""} onChange={(event) => onChange((current) => current ? { ...current, note: event.target.value } : current)} />
              </label>
            </div>
          </div>
          {formError ? <p className="form-error">{formError}</p> : null}
          <div className="dialog-actions">
            <button type="button" className="subtle-cancel" onClick={onClose}>Cancel</button>
            <button type="button" className="dialog-primary" onClick={() => void onSave()}>Save linked entry</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
