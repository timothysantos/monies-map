import * as Dialog from "@radix-ui/react-dialog";

import { messages } from "./copy/en-SG";
import { moniesClient } from "./monies-client-service";

const { format: formatService } = moniesClient;

export function SplitLinkedEntryDialog({ dialog, people, categoryOptions, formError, isSubmitting, onChange, onClose, onSave }) {
  return (
    <Dialog.Root open={Boolean(dialog)} onOpenChange={(open) => { if (!open && !isSubmitting) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="note-dialog-overlay" />
        <Dialog.Content className="note-dialog-content split-dialog-content split-linked-entry-dialog">
          <div className="note-dialog-head split-dialog-head">
            <Dialog.Title>{messages.splits.editLinkedEntry}</Dialog.Title>
            <Dialog.Description>Edit the ledger entry that also appears on Entries.</Dialog.Description>
          </div>
          <div className="linked-entry-notice">
            <strong>Linked to Entries</strong>
            <p>Saving here updates the matching row in Entries too.</p>
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
                <input
                  className="table-edit-input table-edit-input-money"
                  type="number"
                  min="0"
                  step="0.01"
                  value={formatService.minorToDecimalString(dialog?.amountMinor ?? 0)}
                  onChange={(event) => onChange((current) => current ? {
                    ...current,
                    amountMinor: formatService.decimalStringToMinor(event.target.value)
                  } : current)}
                />
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
            <button type="button" className="subtle-cancel" disabled={isSubmitting} onClick={onClose}>Cancel</button>
            <button type="button" className="dialog-primary" disabled={isSubmitting} onClick={() => void onSave()}>
              {isSubmitting ? messages.common.saving : "Save linked entry"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
