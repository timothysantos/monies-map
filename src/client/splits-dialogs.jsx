import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useRef } from "react";

import { getCategory } from "./category-utils";
import { messages } from "./copy/en-SG";
import { decimalStringToMinor, minorToDecimalString } from "./formatters";
import { ResponsiveSelect } from "./responsive-select";
import { CategoryGlyph } from "./ui-components";

// SplitsPanel owns the draft state; these dialogs keep the long JSX out of the panel body.
export function SplitGroupDialog({ dialog, formError, isSubmitting, onChange, onClose, onSave }) {
  return (
    <Dialog.Root open={Boolean(dialog)} onOpenChange={(open) => { if (!open && !isSubmitting) onClose(); }}>
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
            <button type="button" className="subtle-cancel" disabled={isSubmitting} onClick={onClose}>Cancel</button>
            <button type="button" className="dialog-primary" disabled={isSubmitting} onClick={() => void onSave()}>
              {isSubmitting ? messages.common.saving : messages.splits.saveGroup}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function SplitExpenseFields({ dialog, groupOptions, people, categoryOptions, categories = [], onChange, autoFocusAmount = false }) {
  const amountInputRef = useRef(null);

  useEffect(() => {
    if (!autoFocusAmount || !dialog) {
      return;
    }

    const timeout = window.setTimeout(() => {
      amountInputRef.current?.focus({ preventScroll: true });
      amountInputRef.current?.select?.();
    }, 80);

    return () => window.clearTimeout(timeout);
  }, [autoFocusAmount, dialog?.id]);

  return (
    <>
      <div className="split-dialog-section">
        <div className="entry-core-grid split-dialog-grid">
          <label className="split-dialog-field">
            <span>Group</span>
            <ResponsiveSelect
              className="table-edit-input"
              title="Group"
              value={dialog?.groupId ?? "split-group-none"}
              options={groupOptions.map((option) => ({ value: option.id, label: option.name }))}
              onValueChange={(nextValue) => onChange((current) => current ? { ...current, groupId: nextValue } : current)}
            />
          </label>
          <label className="split-dialog-field">
            <span>{messages.splits.expenseDate}</span>
            <input className="table-edit-input" type="date" value={dialog?.date ?? ""} onChange={(event) => onChange((current) => current ? { ...current, date: event.target.value } : current)} />
          </label>
          <label className="split-dialog-field">
            <span>{messages.splits.expensePaidBy}</span>
            <ResponsiveSelect
              className="table-edit-input"
              title={messages.splits.expensePaidBy}
              value={dialog?.payerPersonName ?? ""}
              options={people.map((person) => ({ value: person.name, label: person.name }))}
              onValueChange={(nextValue) => onChange((current) => current ? { ...current, payerPersonName: nextValue } : current)}
            />
          </label>
          <label className="split-dialog-field">
            <span>{messages.splits.expenseCategory}</span>
            <ResponsiveSelect
              className="table-edit-input"
              title={messages.splits.expenseCategory}
              value={dialog?.categoryName ?? ""}
              options={categoryOptions.map((option) => {
                const optionCategory = getCategory(categories, { categoryName: option });
                return {
                  value: option,
                  label: option,
                  iconKey: optionCategory?.iconKey,
                  colorHex: optionCategory?.colorHex,
                  icon: optionCategory ? <CategoryGlyph iconKey={optionCategory.iconKey} /> : null
                };
              })}
              onValueChange={(nextValue) => onChange((current) => current ? { ...current, categoryName: nextValue } : current)}
            />
          </label>
        </div>
      </div>
      <div className="split-dialog-section split-dialog-section-compact">
        <div className="split-dialog-inline">
          <label className="split-dialog-field">
            <span>{messages.splits.expenseAmount}</span>
            <input
              ref={amountInputRef}
              className="table-edit-input table-edit-input-money"
              type="number"
              min="0"
              step="0.01"
              value={dialog?.amountInput ?? minorToDecimalString(dialog?.amountMinor ?? 0)}
              onChange={(event) => onChange((current) => current ? {
                ...current,
                amountInput: event.target.value,
                amountMinor: decimalStringToMinor(event.target.value)
              } : current)}
              onBlur={() => onChange((current) => current ? {
                ...current,
                amountInput: minorToDecimalString(current.amountMinor ?? 0)
              } : current)}
            />
          </label>
          <label className="split-dialog-field">
            <span>{messages.splits.expenseSplit}</span>
            <input
              className="table-edit-input table-edit-input-money"
              type="number"
              min="0"
              max="100"
              value={dialog?.splitPercentInput ?? String(Number(dialog?.splitBasisPoints ?? 5000) / 100)}
              onChange={(event) => onChange((current) => current ? {
                ...current,
                splitPercentInput: event.target.value,
                splitBasisPoints: Math.round(Number(event.target.value || 0) * 100)
              } : current)}
              onBlur={() => onChange((current) => current ? {
                ...current,
                splitPercentInput: String(Number(current.splitBasisPoints ?? 5000) / 100)
              } : current)}
            />
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
    </>
  );
}

export function SplitExpenseDialog({ dialog, groupOptions, people, categoryOptions, categories = [], formError, isSubmitting, isSaveDisabled = false, onChange, onClose, onSave, onViewLinkedEntry }) {
  return (
    <Dialog.Root open={Boolean(dialog)} onOpenChange={(open) => { if (!open && !isSubmitting) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="note-dialog-overlay" />
        <Dialog.Content className="note-dialog-content split-dialog-content" onOpenAutoFocus={(event) => event.preventDefault()}>
          <div className="note-dialog-head split-dialog-head">
            <Dialog.Title>{dialog?.id ? messages.splits.editSplit : messages.splits.createExpense}</Dialog.Title>
            <Dialog.Description>Create or edit a split expense without touching the bank import workflow.</Dialog.Description>
          </div>
          <SplitExpenseFields dialog={dialog} groupOptions={groupOptions} people={people} categoryOptions={categoryOptions} categories={categories} onChange={onChange} autoFocusAmount />
          {formError ? <p className="form-error">{formError}</p> : null}
          <div className="dialog-actions">
            {dialog?.linkedTransactionId ? (
              <>
                <button
                  type="button"
                  className="subtle-action"
                  disabled={isSubmitting}
                  onClick={() => onViewLinkedEntry?.(dialog)}
                >
                  {messages.splits.viewLinkedEntry}
                </button>
                <span className="split-dialog-actions-divider" aria-hidden="true">|</span>
              </>
            ) : null}
            <button type="button" className="subtle-cancel" disabled={isSubmitting} onClick={onClose}>Cancel</button>
            <button type="button" className="dialog-primary" disabled={isSubmitting || isSaveDisabled} onClick={() => void onSave()}>
              {isSubmitting ? messages.common.saving : messages.splits.saveExpense}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function SplitSettlementFields({ dialog, groupOptions, people, onChange, autoFocusAmount = false }) {
  const amountInputRef = useRef(null);

  useEffect(() => {
    if (!autoFocusAmount || !dialog) {
      return;
    }

    const timeout = window.setTimeout(() => {
      amountInputRef.current?.focus({ preventScroll: true });
      amountInputRef.current?.select?.();
    }, 80);

    return () => window.clearTimeout(timeout);
  }, [autoFocusAmount, dialog?.id]);

  return (
    <>
      <div className="split-dialog-section">
        <div className="entry-core-grid split-dialog-grid">
          <label className="split-dialog-field">
            <span>Group</span>
            <ResponsiveSelect
              className="table-edit-input"
              title="Group"
              value={dialog?.groupId ?? "split-group-none"}
              options={groupOptions.map((option) => ({ value: option.id, label: option.name }))}
              onValueChange={(nextValue) => onChange((current) => current ? { ...current, groupId: nextValue } : current)}
            />
          </label>
          <label className="split-dialog-field">
            <span>{messages.splits.settlementDate}</span>
            <input className="table-edit-input" type="date" value={dialog?.date ?? ""} onChange={(event) => onChange((current) => current ? { ...current, date: event.target.value } : current)} />
          </label>
          <label className="split-dialog-field">
            <span>{messages.splits.settlementFrom}</span>
            <ResponsiveSelect
              className="table-edit-input"
              title={messages.splits.settlementFrom}
              value={dialog?.fromPersonName ?? ""}
              options={people.map((person) => ({ value: person.name, label: person.name }))}
              onValueChange={(nextValue) => onChange((current) => current ? { ...current, fromPersonName: nextValue } : current)}
            />
          </label>
          <label className="split-dialog-field">
            <span>{messages.splits.settlementTo}</span>
            <ResponsiveSelect
              className="table-edit-input"
              title={messages.splits.settlementTo}
              value={dialog?.toPersonName ?? ""}
              options={people.map((person) => ({ value: person.name, label: person.name }))}
              onValueChange={(nextValue) => onChange((current) => current ? { ...current, toPersonName: nextValue } : current)}
            />
          </label>
        </div>
      </div>
      <div className="split-dialog-section split-dialog-section-compact">
        <div className="split-dialog-inline">
          <label className="split-dialog-field">
            <span>{messages.splits.settlementAmount}</span>
            <input
              ref={amountInputRef}
              className="table-edit-input table-edit-input-money"
              type="number"
              min="0"
              step="0.01"
              value={dialog?.amountInput ?? minorToDecimalString(dialog?.amountMinor ?? 0)}
              onChange={(event) => onChange((current) => current ? {
                ...current,
                amountInput: event.target.value,
                amountMinor: decimalStringToMinor(event.target.value)
              } : current)}
              onBlur={() => onChange((current) => current ? {
                ...current,
                amountInput: minorToDecimalString(current.amountMinor ?? 0)
              } : current)}
            />
          </label>
        </div>
      </div>
      <div className="split-dialog-section">
        <label className="split-dialog-field">
          <span>{messages.splits.expenseNote}</span>
          <textarea className="table-edit-input table-edit-textarea" rows={4} value={dialog?.note ?? ""} onChange={(event) => onChange((current) => current ? { ...current, note: event.target.value } : current)} />
        </label>
      </div>
    </>
  );
}

export function SplitSettlementDialog({ dialog, groupOptions, people, formError, isSubmitting, isSaveDisabled = false, onChange, onClose, onSave, onViewLinkedEntry }) {
  return (
    <Dialog.Root open={Boolean(dialog)} onOpenChange={(open) => { if (!open && !isSubmitting) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="note-dialog-overlay" />
        <Dialog.Content className="note-dialog-content split-dialog-content" onOpenAutoFocus={(event) => event.preventDefault()}>
          <div className="note-dialog-head split-dialog-head">
            <Dialog.Title>{dialog?.id ? messages.splits.editSplit : messages.splits.createSettlement}</Dialog.Title>
            <Dialog.Description>Record or edit a settle-up and match the bank transfer later from the Matches view.</Dialog.Description>
          </div>
          <SplitSettlementFields dialog={dialog} groupOptions={groupOptions} people={people} onChange={onChange} autoFocusAmount />
          {formError ? <p className="form-error">{formError}</p> : null}
          <div className="dialog-actions">
            {dialog?.linkedTransactionId ? (
              <>
                <button
                  type="button"
                  className="subtle-action"
                  disabled={isSubmitting}
                  onClick={() => onViewLinkedEntry?.(dialog)}
                >
                  {messages.splits.viewLinkedEntry}
                </button>
                <span className="split-dialog-actions-divider" aria-hidden="true">|</span>
              </>
            ) : null}
            <button type="button" className="subtle-cancel" disabled={isSubmitting} onClick={onClose}>Cancel</button>
            <button type="button" className="dialog-primary" disabled={isSubmitting || isSaveDisabled} onClick={() => void onSave()}>
              {isSubmitting ? messages.common.saving : messages.splits.saveSettlement}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function SplitDeleteDialog({ target, formError, isSubmitting, onClose, onConfirm }) {
  const label = target?.description ?? target?.note ?? "this split row";

  return (
    <Dialog.Root open={Boolean(target)} onOpenChange={(open) => { if (!open && !isSubmitting) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="note-dialog-overlay" />
        <Dialog.Content className="note-dialog-content split-delete-dialog">
          <div className="note-dialog-head split-dialog-head">
            <Dialog.Title>Delete split row</Dialog.Title>
            <Dialog.Description>
              Delete {label}? This removes the split record only. Any linked bank ledger row stays in entries.
            </Dialog.Description>
          </div>
          {formError ? <p className="form-error">{formError}</p> : null}
          <div className="dialog-actions">
            <button type="button" className="subtle-cancel" disabled={isSubmitting} onClick={onClose}>Cancel</button>
            <button type="button" className="dialog-danger" disabled={isSubmitting} onClick={() => void onConfirm()}>
              {isSubmitting ? messages.common.working : "Delete split row"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
