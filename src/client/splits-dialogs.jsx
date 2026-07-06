import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useRef } from "react";

import { messages } from "./copy/en-SG";
import { selectAllOnFocus } from "./focus-utils";
import { moniesClient } from "./monies-client-service";
import { ResponsiveSelect } from "./responsive-select";
import { updateSplitExpenseDraft } from "./split-editing";
import { CategoryGlyph } from "./ui-components";

const { categories: categoryService, format: formatService } = moniesClient;

// SplitsPanel owns the draft state; these dialogs keep the long JSX out of the panel body.
export function SplitGroupDialog({ dialog, formError, isSubmitting, onChange, onClose, onSave }) {
  return (
    <Dialog.Root open={Boolean(dialog)} onOpenChange={(open) => { if (!open && !isSubmitting) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="note-dialog-overlay" />
        <Dialog.Content className="note-dialog-content split-dialog-content">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (isSubmitting) {
                return;
              }
              void onSave();
            }}
          >
            <div className="note-dialog-head split-dialog-head">
              <Dialog.Title>{messages.splits.createGroup}</Dialog.Title>
              <Dialog.Description>Add a named split group for shared expenses.</Dialog.Description>
            </div>
            <label className="split-dialog-field">
              <span>{messages.splits.groupName}</span>
            <input className="table-edit-input" value={dialog?.name ?? ""} enterKeyHint="done" onChange={(event) => onChange((current) => current ? { ...current, name: event.target.value } : current)} />
            </label>
            {formError ? <p className="form-error">{formError}</p> : null}
            <div className="dialog-actions">
              <button type="button" className="subtle-cancel" disabled={isSubmitting} onClick={onClose}>Cancel</button>
              <button type="submit" className="dialog-primary" disabled={isSubmitting}>
                {isSubmitting ? messages.common.saving : messages.splits.saveGroup}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function getSplitCounterparty(people, primaryName) {
  return people.find((person) => person.name !== primaryName) ?? null;
}

function splitSharePreview(dialog, people) {
  const totalAmountMinor = Math.max(0, Number(dialog?.amountMinor ?? 0));
  const primaryName = dialog?.sharePersonName ?? people[0]?.name ?? "First person";
  const counterparty = getSplitCounterparty(people, primaryName);
  const primaryAmountMinor = Math.max(0, Math.min(totalAmountMinor, Number(dialog?.splitAmountMinor ?? 0)));
  const secondaryAmountMinor = Math.max(0, totalAmountMinor - primaryAmountMinor);

  return {
    totalAmountMinor,
    primaryName,
    secondaryName: counterparty?.name ?? "Second person",
    primaryAmountMinor,
    secondaryAmountMinor
  };
}

function applyPrimarySplitAmount(current, primaryAmountMinor) {
  const amountMinor = Math.max(0, Math.min(Number(current?.amountMinor ?? 0), Number(primaryAmountMinor ?? 0)));
  return updateSplitExpenseDraft(current, {
    splitAmountMinor: amountMinor,
    splitAmountInput: formatService.minorToDecimalString(amountMinor)
  }, "amount", { commit: true });
}

function OddCentChooser({ dialog, people, onChange }) {
  const preview = splitSharePreview(dialog, people);
  const hasOddCent = preview.totalAmountMinor % 2 === 1;
  const hasTwoSidedShare = preview.primaryAmountMinor > 0 && preview.secondaryAmountMinor > 0;
  const canShow = hasOddCent && hasTwoSidedShare && people.length >= 2 && preview.totalAmountMinor > 0;

  if (!canShow) {
    return null;
  }

  const lowerHalf = Math.floor(preview.totalAmountMinor / 2);
  const higherHalf = preview.totalAmountMinor - lowerHalf;
  const extraCentName = preview.primaryAmountMinor > preview.secondaryAmountMinor
    ? preview.primaryName
    : preview.secondaryName;

  return (
    <div className="split-odd-cent-control">
      <div>
        <strong>Odd cent</strong>
        <p>
          This amount cannot split into two equal cents. Pick who carries the extra cent so this record can match
          another split app exactly.
        </p>
      </div>
      <div className="split-odd-cent-actions" role="group" aria-label="Choose odd cent recipient">
        <button
          type="button"
          className={extraCentName === preview.primaryName ? "is-selected" : ""}
          onClick={() => onChange((current) => current ? applyPrimarySplitAmount(current, higherHalf) : current)}
        >
          {preview.primaryName} gets +$0.01
        </button>
        <button
          type="button"
          className={extraCentName === preview.secondaryName ? "is-selected" : ""}
          onClick={() => onChange((current) => current ? applyPrimarySplitAmount(current, lowerHalf) : current)}
        >
          {preview.secondaryName} gets +$0.01
        </button>
      </div>
    </div>
  );
}

function SplitSharePreview({ dialog, people }) {
  const preview = splitSharePreview(dialog, people);

  if (preview.totalAmountMinor <= 0 || people.length < 2) {
    return null;
  }

  return (
    <div className="split-share-preview" aria-label="Split share amounts">
      <span>
        <span>{preview.primaryName} share</span>
        <strong>{formatService.money(preview.primaryAmountMinor)}</strong>
      </span>
      <span>
        <span>{preview.secondaryName} share</span>
        <strong>{formatService.money(preview.secondaryAmountMinor)}</strong>
      </span>
    </div>
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
            <input className="table-edit-input" type="date" value={dialog?.date ?? ""} enterKeyHint="next" onChange={(event) => onChange((current) => current ? { ...current, date: event.target.value } : current)} />
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
                const optionCategory = categoryService.get(categories, { categoryName: option });
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
                type="text"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={dialog?.amountInput ?? formatService.minorToDecimalString(dialog?.amountMinor ?? 0)}
                enterKeyHint="next"
                onMouseDown={selectAllOnFocus}
                onFocus={selectAllOnFocus}
                onChange={(event) => onChange((current) => current ? updateSplitExpenseDraft(current, {
                amountInput: event.target.value,
                amountMinor: formatService.decimalStringToMinor(event.target.value)
              }) : current)}
              onBlur={() => onChange((current) => current ? {
                ...current,
                amountInput: formatService.minorToDecimalString(current.amountMinor ?? 0)
              } : current)}
            />
          </label>
          <label className="split-dialog-field split-dialog-field-percent">
            <span>{messages.splits.expenseSplit(dialog?.sharePersonName ?? "First person")}</span>
              <input
                className="table-edit-input table-edit-input-money"
                type="text"
                inputMode="decimal"
                min="0"
                max="100"
                value={dialog?.splitPercentInput ?? String(Number(dialog?.splitBasisPoints ?? 5000) / 100)}
                enterKeyHint="next"
                onMouseDown={selectAllOnFocus}
                onFocus={selectAllOnFocus}
                onChange={(event) => onChange((current) => current ? updateSplitExpenseDraft(current, {
                splitPercentInput: event.target.value,
                splitBasisPoints: Math.round(Number(event.target.value || 0) * 100)
              }, "percent") : current)}
              onBlur={() => onChange((current) => current ? updateSplitExpenseDraft(current, {
                splitPercentInput: String(Number(current.splitBasisPoints ?? 5000) / 100)
              }, "percent", { commit: true }) : current)}
            />
          </label>
          <label className="split-dialog-field split-dialog-field-exact-amount">
            <span>{messages.splits.expenseExactAmount(dialog?.sharePersonName ?? "First person")}</span>
              <input
                className="table-edit-input table-edit-input-money"
                type="text"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={dialog?.splitAmountInput ?? formatService.minorToDecimalString(dialog?.splitAmountMinor ?? 0)}
                enterKeyHint="done"
                onMouseDown={selectAllOnFocus}
                onFocus={selectAllOnFocus}
                onChange={(event) => onChange((current) => current ? updateSplitExpenseDraft(current, {
                splitAmountInput: event.target.value,
                splitAmountMinor: formatService.decimalStringToMinor(event.target.value)
              }, "amount") : current)}
              onBlur={() => onChange((current) => current ? updateSplitExpenseDraft(current, {
                splitAmountInput: formatService.minorToDecimalString(current.splitAmountMinor ?? 0)
              }, "amount", { commit: true }) : current)}
            />
          </label>
        </div>
        <SplitSharePreview dialog={dialog} people={people} />
        <OddCentChooser dialog={dialog} people={people} onChange={onChange} />
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
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (isSubmitting || isSaveDisabled) {
                return;
              }
              void onSave();
            }}
          >
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
              <button type="submit" className="dialog-primary" disabled={isSubmitting || isSaveDisabled}>
                {isSubmitting ? messages.common.saving : messages.splits.saveExpense}
              </button>
            </div>
          </form>
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
            <input className="table-edit-input" type="date" value={dialog?.date ?? ""} enterKeyHint="next" onChange={(event) => onChange((current) => current ? { ...current, date: event.target.value } : current)} />
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
                type="text"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={dialog?.amountInput ?? formatService.minorToDecimalString(dialog?.amountMinor ?? 0)}
                enterKeyHint="done"
                onMouseDown={selectAllOnFocus}
                onFocus={selectAllOnFocus}
                onChange={(event) => onChange((current) => current ? {
                ...current,
                amountInput: event.target.value,
                amountMinor: formatService.decimalStringToMinor(event.target.value)
              } : current)}
              onBlur={() => onChange((current) => current ? {
                ...current,
                amountInput: formatService.minorToDecimalString(current.amountMinor ?? 0)
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
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (isSubmitting || isSaveDisabled) {
                return;
              }
              void onSave();
            }}
          >
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
              <button type="submit" className="dialog-primary" disabled={isSubmitting || isSaveDisabled}>
                {isSubmitting ? messages.common.saving : messages.splits.saveSettlement}
              </button>
            </div>
          </form>
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
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (isSubmitting) {
                return;
              }
              void onConfirm();
            }}
          >
            <div className="note-dialog-head split-dialog-head">
              <Dialog.Title>Delete split row</Dialog.Title>
              <Dialog.Description>
                Delete {label}? This removes the split record only. Any linked bank ledger row stays in entries.
              </Dialog.Description>
            </div>
            {formError ? <p className="form-error">{formError}</p> : null}
            <div className="dialog-actions">
              <button type="button" className="subtle-cancel" disabled={isSubmitting} onClick={onClose}>Cancel</button>
              <button type="submit" className="dialog-danger" disabled={isSubmitting}>
                {isSubmitting ? messages.common.working : "Delete split row"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
