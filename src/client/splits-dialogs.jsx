import * as Dialog from "@radix-ui/react-dialog";
import { ChevronDown, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { messages } from "./copy/en-SG";
import { focusFieldUnlessEditing } from "./deferred-focus";
import { selectAllOnFocus } from "./focus-utils";
import { moniesClient } from "./monies-client-service";
import { TotalsVisibilityToggle } from "./money-privacy";
import { ResponsiveSelect } from "./responsive-select";
import { buildComparableSplitDraft, updateSplitExpenseDraft } from "./split-editing";
import { CategoryGlyph } from "./ui-components";
import { InlineError } from "./ui-states";
import { SettlementLockNotice } from "./settlement-lock-notice";
import { SheetDiscardConfirm, SheetDragHandle, useSheetSwipeDismiss } from "./sheet-swipe";
import { OddCentChooser, SplitExpenseCard, splitSharePreview } from "./split-expense-card";
import { BottomActions } from "./ui/lead-support-detail";
import { useDraftChanged } from "./use-draft-changed";
import { useKeyboardInset } from "./use-keyboard-inset";
import { useIsMobileLayout } from "./use-viewport";

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

// The fields the group dialog edits: a change to any of them makes a swipe
// down ask "Discard changes?" before closing.
function pickGroupFields(dialog) {
  return [dialog.name ?? "", dialog.currency ?? "SGD", dialog.expenseSource ?? "mixed"];
}

// SplitsPanel owns the draft state; these dialogs keep the long JSX out of the panel body.
export function SplitGroupDialog({ dialog, formError, isSubmitting, readOnly = false, onChange, onClose, onSave }) {
  const isMobileLayout = useIsMobileLayout();
  const [content, setContent] = useState(null);
  // On a phone the dialog is a bottom sheet and swipes down to close,
  // asking first once a field changed.
  const isDirty = useDraftChanged(readOnly ? null : dialog, pickGroupFields);
  const swipe = useSheetSwipeDismiss({ sheet: content, enabled: isMobileLayout, isDirty, isSubmitting, onClose });

  return (
    <Dialog.Root open={Boolean(dialog)} onOpenChange={(open) => { if (!open && !isSubmitting) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="note-dialog-overlay" />
        <Dialog.Content
          ref={setContent}
          className="note-dialog-content split-dialog-content split-group-dialog"
          {...swipe.contentProps}
        >
          {isMobileLayout ? <SheetDragHandle /> : null}
          <form
            inert={swipe.isConfirmOpen}
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
            <label className="split-dialog-field">
              <span>Purchase source</span>
              <select className="table-edit-input" value={dialog?.expenseSource ?? "mixed"} onChange={(event) => onChange((current) => current ? { ...current, expenseSource: event.target.value } : current)}>
                <option value="cash">Cash only</option>
                <option value="ledger">Bank/card</option>
                <option value="mixed">Cash and bank/card</option>
              </select>
              <small className="split-dialog-help">Use Cash only and Bank/card as separate groups for a holiday when you want settlements to stay easy to reconcile.</small>
            </label>
            <InlineError message={formError} />
            <div className="dialog-actions">
              <button type="button" className="subtle-cancel" disabled={isSubmitting} onClick={onClose}>{readOnly ? "Close" : "Cancel"}</button>
              <button type="submit" className="dialog-primary" disabled={isSubmitting}>
                {isSubmitting ? messages.common.saving : messages.splits.saveGroup}
              </button>
            </div>
          </form>
          <SheetDiscardConfirm open={swipe.isConfirmOpen} onKeepEditing={swipe.keepEditing} onDiscard={swipe.discard} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SplitSharePreview({ dialog, people }) {
  const preview = splitSharePreview(dialog, people);
  // Shares are in the expense's own currency (the group currency in a group).
  const currency = dialog?.currency ?? "SGD";

  if (preview.totalAmountMinor <= 0 || people.length < 2) {
    return null;
  }

  return (
    <div className="split-share-preview" aria-label="Split share amounts">
      <span>
        <span>{preview.primaryName} share</span>
        <strong>{formatService.moneyWithCurrency(preview.primaryAmountMinor, currency)}</strong>
      </span>
      <span>
        <span>{preview.secondaryName} share</span>
        <strong>{formatService.moneyWithCurrency(preview.secondaryAmountMinor, currency)}</strong>
      </span>
    </div>
  );
}

export function SplitExpenseFields({ dialog, groupOptions, people, categoryOptions, categories = [], onChange, autoFocusAmount = false }) {
  const amountInputRef = useRef(null);
  const selectedGroup = groupOptions.find((group) => group.id === dialog?.groupId);
  const allowedPaymentMethods = selectedGroup?.expenseSource === "cash"
    ? ["cash"]
    : selectedGroup?.expenseSource === "ledger"
      ? ["card", "bank"]
      : ["cash", "card", "bank", "other"];

  useEffect(() => {
    if (!autoFocusAmount || !dialog) {
      return;
    }

    const timeout = window.setTimeout(() => {
      focusFieldUnlessEditing(amountInputRef.current, { select: true });
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
              onValueChange={(nextValue) => onChange((current) => {
                if (!current) return current;
                const nextGroup = groupOptions.find((option) => option.id === nextValue);
                const nextPaymentMethod = nextGroup?.expenseSource === "cash"
                  ? "cash"
                  : nextGroup?.expenseSource === "ledger" && !["card", "bank"].includes(current.paymentMethod)
                    ? "card"
                    : current.paymentMethod;
                return { ...current, groupId: nextValue, currency: nextGroup?.currency ?? current.currency, paymentMethod: nextPaymentMethod };
              })}
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
            <div className="money-input-with-visibility">
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
              <TotalsVisibilityToggle className="totals-visibility-toggle--form" />
            </div>
          </label>
          <label className="split-dialog-field">
            <span>{dialog?.linkedTransactionId ? "Paid using (ledger)" : "Paid using"}</span>
            <select className="table-edit-input" value={dialog?.paymentMethod ?? "cash"} disabled={Boolean(dialog?.linkedTransactionId)} onChange={(event) => onChange((current) => current ? { ...current, paymentMethod: event.target.value } : current)}>
              {allowedPaymentMethods.map((method) => <option key={method} value={method}>{method === "cash" ? "Cash" : method === "card" ? "Card" : method === "bank" ? "Bank" : "Other"}</option>)}
            </select>
            {selectedGroup?.expenseSource === "cash" ? <small className="split-dialog-help">Cash-only group: no bank or card match is expected.</small> : null}
            {selectedGroup?.expenseSource === "ledger" ? <small className="split-dialog-help">Bank/card group: cash purchases belong in a separate cash group.</small> : null}
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
            <div className="money-input-with-visibility">
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
              <TotalsVisibilityToggle className="totals-visibility-toggle--form" />
            </div>
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

export function SplitExpenseDialog({ dialog, groupOptions, people, categoryOptions, categories = [], formError, settlementLock = null, isUndoingSettlementLock = false, onUndoSettlementLock, isSubmitting, isSaveDisabled = false, readOnly = false, onChange, onClose, onSave, onViewLinkedEntry, onRequestDelete }) {
  const isMobileLayout = useIsMobileLayout();
  const [content, setContent] = useState(null);
  // New, edit and view all use the split expense card (design.md, "Lead ·
  // Support · Detail"); the inline desktop editor keeps the form.
  const isEditing = Boolean(dialog?.id) && !readOnly;
  const title = readOnly ? messages.splits.viewSplit : (dialog?.id ? messages.splits.editSplit : messages.splits.createExpense);
  const closeLabel = readOnly
    ? messages.splits.expenseCard.closeView
    : (dialog?.id ? messages.splits.expenseCard.closeEdit : messages.splits.expenseCard.close);
  useKeyboardInset(isMobileLayout ? content : null);
  // On a phone the dialog is a bottom sheet and swipes down to close, asking
  // first when the draft changed since it opened (for a saved split: since
  // it was loaded, the saved split).
  const isDirty = useDraftChanged(readOnly ? null : dialog, buildComparableSplitDraft);
  const swipe = useSheetSwipeDismiss({ sheet: content, enabled: isMobileLayout, isDirty, isSubmitting, onClose });
  const groupName = groupOptions.find((group) => group.id === dialog?.groupId)?.name ?? "";

  return (
    <Dialog.Root open={Boolean(dialog)} onOpenChange={(open) => { if (!open && !isSubmitting) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="note-dialog-overlay" />
        <Dialog.Content
          ref={setContent}
          className={`note-dialog-content split-dialog-content split-expense-card-dialog${dialog?.id ? "" : " split-expense-create"}`}
          onOpenAutoFocus={(event) => event.preventDefault()}
          {...swipe.contentProps}
        >
          {isMobileLayout ? <SheetDragHandle /> : null}
          <form
            inert={swipe.isConfirmOpen}
            onSubmit={(event) => {
              event.preventDefault();
              if (readOnly || isSubmitting || isSaveDisabled) {
                return;
              }
              void onSave();
            }}
          >
            <div className="note-dialog-head split-dialog-head split-expense-card-head">
              <div>
                <Dialog.Title>{title}</Dialog.Title>
                <Dialog.Description>{messages.splits.expenseCard.sheetContext(groupName, people.map((person) => person.name))}</Dialog.Description>
              </div>
              <div className="split-expense-card-head-actions">
                <TotalsVisibilityToggle className="totals-visibility-toggle--form" />
                <button
                  type="button"
                  className="icon-action subtle-cancel split-expense-card-close"
                  aria-label={closeLabel}
                  disabled={isSubmitting}
                  onClick={onClose}
                >
                  <X size={16} />
                </button>
              </div>
            </div>
            <div className="split-dialog-scroll" data-sheet-body>
              <SplitExpenseCard
                dialog={dialog}
                groupOptions={groupOptions}
                people={people}
                categoryOptions={categoryOptions}
                categories={categories}
                onChange={onChange}
                layout={isMobileLayout ? "sheet" : "dialog"}
                autoFocusAmount={!readOnly}
                readOnly={readOnly}
                onViewLinkedEntry={onViewLinkedEntry ? () => onViewLinkedEntry(dialog) : undefined}
              />
              {settlementLock
                ? <SettlementLockNotice lock={settlementLock} isUndoing={isUndoingSettlementLock} onUndo={onUndoSettlementLock} />
                : <InlineError message={formError} />}
            </div>
            <div className="dialog-actions split-expense-card-actions">
              <BottomActions
                destructive={isEditing ? (
                  // Asks in the app first (SplitDeleteDialog), as before.
                  <button type="button" className="lsd-quiet is-danger" disabled={isSubmitting} onClick={() => onRequestDelete?.(dialog)}>
                    {messages.splits.expenseCard.deleteSplit}
                  </button>
                ) : null}
                secondary={(
                  <button type="button" className="lsd-quiet" disabled={isSubmitting} onClick={onClose}>
                    {readOnly ? messages.common.close : messages.splits.expenseCard.cancel}
                  </button>
                )}
                primary={readOnly ? null : (
                  <button type="submit" className="lsd-primary" disabled={isSubmitting || isSaveDisabled}>
                    {isSubmitting ? messages.common.saving : messages.splits.saveExpense}
                  </button>
                )}
              />
            </div>
          </form>
          <SheetDiscardConfirm open={swipe.isConfirmOpen} onKeepEditing={swipe.keepEditing} onDiscard={swipe.discard} />
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
      focusFieldUnlessEditing(amountInputRef.current, { select: true });
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
            <div className="money-input-with-visibility">
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
              <TotalsVisibilityToggle className="totals-visibility-toggle--form" />
            </div>
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

export function SplitSettlementDialog({ dialog, groupOptions, people, formError, settlementLock = null, isUndoingSettlementLock = false, onUndoSettlementLock, isSubmitting, isSaveDisabled = false, readOnly = false, onChange, onClose, onSave, onViewLinkedEntry, onRequestDelete }) {
  const isMobileLayout = useIsMobileLayout();
  const [content, setContent] = useState(null);
  // On a phone the dialog is a bottom sheet (Settle group, Record
  // settlement) and swipes down to close, asking first when the draft
  // changed since it opened.
  const isDirty = useDraftChanged(readOnly ? null : dialog, buildComparableSplitDraft);
  const swipe = useSheetSwipeDismiss({ sheet: content, enabled: isMobileLayout, isDirty, isSubmitting, onClose });

  return (
    <Dialog.Root open={Boolean(dialog)} onOpenChange={(open) => { if (!open && !isSubmitting) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="note-dialog-overlay" />
        <Dialog.Content
          ref={setContent}
          className="note-dialog-content split-dialog-content split-settlement-dialog"
          onOpenAutoFocus={(event) => event.preventDefault()}
          {...swipe.contentProps}
        >
          {isMobileLayout ? <SheetDragHandle /> : null}
          <form
            inert={swipe.isConfirmOpen}
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
            <div className="split-dialog-scroll" data-sheet-body>
              <div className="split-dialog-scroll-cue"><ChevronDown size={15} /> More fields below</div>
              <fieldset disabled={readOnly} className="split-dialog-fieldset">
                <SplitSettlementFields dialog={dialog} groupOptions={groupOptions} people={people} onChange={onChange} autoFocusAmount={!readOnly} />
              </fieldset>
              {settlementLock
                ? <SettlementLockNotice lock={settlementLock} isUndoing={isUndoingSettlementLock} onUndo={onUndoSettlementLock} />
                : <InlineError message={formError} />}
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
          <SheetDiscardConfirm open={swipe.isConfirmOpen} onKeepEditing={swipe.keepEditing} onDiscard={swipe.discard} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function SplitDeleteDialog({ target, formError, settlementLock = null, isUndoingSettlementLock = false, onUndoSettlementLock, isSubmitting, onClose, onConfirm }) {
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
            {settlementLock
              ? <SettlementLockNotice lock={settlementLock} isUndoing={isUndoingSettlementLock} onUndo={onUndoSettlementLock} />
              : <InlineError message={formError} />}
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
