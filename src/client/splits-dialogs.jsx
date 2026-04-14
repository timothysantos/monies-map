import * as Dialog from "@radix-ui/react-dialog";

import { messages } from "./copy/en-SG";
import { decimalStringToMinor, minorToDecimalString } from "./formatters";

// SplitsPanel owns the draft state; these dialogs keep the long JSX out of the panel body.
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
