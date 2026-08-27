import * as Dialog from "@radix-ui/react-dialog";
import { ChevronDown } from "lucide-react";
import { useEffect, useRef } from "react";

import { messages } from "./copy/en-SG";
import { selectAllOnFocus } from "./focus-utils";
import { moniesClient } from "./monies-client-service";
import { ResponsiveSelect } from "./responsive-select";
import { updateSplitExpenseDraft } from "./split-editing";
import { CategoryGlyph } from "./ui-components";

const { categories: categoryService, format: formatService } = moniesClient;

const SPLIT_CURRENCY_OPTIONS = [
  ["SGD", "Singapore dollar"],
  ["JPY", "Japanese yen"],
  ["KRW", "South Korean won"],
  ["PHP", "Philippine peso"],
  ["USD", "US dollar"],
  ["EUR", "Euro"],
  ["GBP", "British pound"],
  ["AUD", "Australian dollar"],
  ["CAD", "Canadian dollar"],
  ["CNY", "Chinese yuan"],
  ["HKD", "Hong Kong dollar"],
  ["TWD", "New Taiwan dollar"],
  ["THB", "Thai baht"],
  ["MYR", "Malaysian ringgit"],
  ["IDR", "Indonesian rupiah"],
  ["VND", "Vietnamese dong"],
  ["INR", "Indian rupee"]
];

// SplitsPanel owns the draft state; these dialogs keep the long JSX out of the panel body.
export function SplitGroupDialog({ dialog, formError, isSubmitting, readOnly = false, onChange, onClose, onSave }) {
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
            <label className="split-dialog-field">
              <span>Group currency</span>
              <select className="table-edit-input" value={dialog?.currency ?? "SGD"} onChange={(event) => onChange((current) => current ? { ...current, currency: event.target.value } : current)}>
                {SPLIT_CURRENCY_OPTIONS.map(([code, name]) => <option key={code} value={code}>{code} - {name}</option>)}
              </select>
            </label>
            {formError ? <p className="form-error">{formError}</p> : null}
            <div className="dialog-actions">
              <button type="button" className="subtle-cancel" disabled={isSubmitting} onClick={onClose}>{readOnly ? "Close" : "Cancel"}</button>
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
            <span>Currency</span>
            <input className="table-edit-input" inputMode="text" maxLength={3} value={dialog?.currency ?? "SGD"} onChange={(event) => onChange((current) => current ? { ...current, currency: event.target.value.toUpperCase() } : current)} />
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
          <label className="split-dialog-field">
            <span>{dialog?.linkedTransactionId ? "Paid using (ledger)" : "Paid using"}</span>
            <select className="table-edit-input" value={dialog?.paymentMethod ?? "cash"} disabled={Boolean(dialog?.linkedTransactionId)} onChange={(event) => onChange((current) => current ? { ...current, paymentMethod: event.target.value } : current)}>
              <option value="cash">Cash</option><option value="card">Card</option><option value="bank">Bank</option><option value="other">Other</option>
            </select>
          </label>
          <label className="split-dialog-field">
            <span>Evidence</span>
            <select className="table-edit-input" value={dialog?.paymentStatus ?? "recorded"} onChange={(event) => onChange((current) => current ? { ...current, paymentStatus: event.target.value } : current)}>
              <option value="recorded">Recorded</option><option value="awaiting_statement">Awaiting statement</option><option value="certified">Statement certified</option>
            </select>
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

export function SplitExpenseDialog({ dialog, groupOptions, people, categoryOptions, categories = [], formError, isSubmitting, isSaveDisabled = false, readOnly = false, onChange, onClose, onSave, onViewLinkedEntry, onRequestDelete }) {
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
              <Dialog.Title>{readOnly ? "View split" : (dialog?.id ? messages.splits.editSplit : messages.splits.createExpense)}</Dialog.Title>
              <Dialog.Description>{readOnly ? "Review the split and its linked ledger evidence." : "Create or edit a split expense without touching the bank import workflow."}</Dialog.Description>
            </div>
            <div className="split-dialog-scroll">
              <div className="split-dialog-scroll-cue"><ChevronDown size={15} /> More fields below</div>
              <fieldset disabled={readOnly} className="split-dialog-fieldset">
                <SplitExpenseFields dialog={dialog} groupOptions={groupOptions} people={people} categoryOptions={categoryOptions} categories={categories} onChange={onChange} autoFocusAmount={!readOnly} />
              </fieldset>
              {formError ? <p className="form-error">{formError}</p> : null}
            </div>
            <div className="dialog-actions">
              {!readOnly && dialog?.id ? (
                <button
                  type="button"
                  className="dialog-danger split-dialog-delete-action"
                  disabled={isSubmitting}
                  onClick={() => onRequestDelete?.(dialog)}
                >
                  Delete
                </button>
              ) : null}
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
              <button type="button" className="subtle-cancel" disabled={isSubmitting} onClick={onClose}>{readOnly ? "Close" : "Cancel"}</button>
              {!readOnly ? <button type="submit" className="dialog-primary" disabled={isSubmitting || isSaveDisabled}>
                {isSubmitting ? messages.common.saving : messages.splits.saveExpense}
              </button> : null}
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
            <span>Currency</span>
            <input className="table-edit-input" inputMode="text" maxLength={3} value={dialog?.currency ?? "SGD"} onChange={(event) => onChange((current) => current ? { ...current, currency: event.target.value.toUpperCase() } : current)} />
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
          <label className="split-dialog-field">
            <span>{dialog?.linkedTransactionId ? "Paid using (ledger)" : "Paid using"}</span>
            <select className="table-edit-input" value={dialog?.paymentMethod ?? "cash"} disabled={Boolean(dialog?.linkedTransactionId)} onChange={(event) => onChange((current) => current ? { ...current, paymentMethod: event.target.value } : current)}>
              <option value="cash">Cash</option><option value="card">Card</option><option value="bank">Bank</option><option value="other">Other</option>
            </select>
          </label>
          <label className="split-dialog-field">
            <span>Evidence</span>
            <select className="table-edit-input" value={dialog?.paymentStatus ?? "recorded"} onChange={(event) => onChange((current) => current ? { ...current, paymentStatus: event.target.value } : current)}>
              <option value="recorded">Recorded</option><option value="awaiting_statement">Awaiting statement</option><option value="certified">Statement certified</option>
            </select>
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

export function SplitSettlementDialog({ dialog, groupOptions, people, formError, isSubmitting, isSaveDisabled = false, readOnly = false, onChange, onClose, onSave, onViewLinkedEntry, onRequestDelete }) {
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
              <Dialog.Title>{readOnly ? "View split" : (dialog?.id ? messages.splits.editSplit : messages.splits.createSettlement)}</Dialog.Title>
              <Dialog.Description>{readOnly
                ? "Review the split and its linked ledger evidence."
                : messages.splits.groupSettlementDetail(groupOptions.find((group) => group.value === dialog?.groupId)?.label)}</Dialog.Description>
            </div>
            <div className="split-dialog-scroll">
              <div className="split-dialog-scroll-cue"><ChevronDown size={15} /> More fields below</div>
              <fieldset disabled={readOnly} className="split-dialog-fieldset">
                <SplitSettlementFields dialog={dialog} groupOptions={groupOptions} people={people} onChange={onChange} autoFocusAmount={!readOnly} />
              </fieldset>
              {formError ? <p className="form-error">{formError}</p> : null}
            </div>
            <div className="dialog-actions">
              {!readOnly && dialog?.id ? (
                <button
                  type="button"
                  className="dialog-danger split-dialog-delete-action"
                  disabled={isSubmitting}
                  onClick={() => onRequestDelete?.(dialog)}
                >
                  Delete
                </button>
              ) : null}
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
              {!readOnly ? <button type="submit" className="dialog-primary" disabled={isSubmitting || isSaveDisabled}>
                {isSubmitting ? messages.common.saving : messages.splits.saveSettlement}
              </button> : null}
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
