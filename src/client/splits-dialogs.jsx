import * as Dialog from "@radix-ui/react-dialog";
import { Trash2, X } from "lucide-react";
import { useState } from "react";

import { messages } from "./copy/en-SG";
import { splitsMessages } from "./copy/en-SG-splits";
import { TotalsVisibilityToggle } from "./money-privacy";
import { buildComparableSplitDraft } from "./split-editing";
import { InlineError } from "./ui-states";
import { SettlementLockNotice } from "./settlement-lock-notice";
import { SheetDiscardConfirm, SheetDragHandle, useSheetSwipeDismiss } from "./sheet-swipe";
import { ConfirmLead, SheetDialog } from "./sheet-dialog";
import { SplitExpenseCard } from "./split-expense-card";
import { SplitGroupCard } from "./split-group-card";
import { SplitSettlementCard } from "./split-settlement-card";
import { BottomActions } from "./ui/lead-support-detail";
import { useDraftChanged } from "./use-draft-changed";
import { useKeyboardInset } from "./use-keyboard-inset";
import { useIsMobileLayout } from "./use-viewport";

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
  useKeyboardInset(isMobileLayout ? content : null);
  const isDirty = useDraftChanged(readOnly ? null : dialog, pickGroupFields);
  const swipe = useSheetSwipeDismiss({ sheet: content, enabled: isMobileLayout, isDirty, isSubmitting, onClose });

  return (
    <Dialog.Root open={Boolean(dialog)} onOpenChange={(open) => { if (!open && !isSubmitting) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="note-dialog-overlay" />
        <Dialog.Content
          ref={setContent}
          className="note-dialog-content split-dialog-content split-group-dialog split-expense-card-dialog"
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
              <Dialog.Title>{splitsMessages.createGroup}</Dialog.Title>
              <Dialog.Description>Add a named split group for shared expenses.</Dialog.Description>
            </div>
            <div className="split-dialog-scroll" data-sheet-body>
              <SplitGroupCard dialog={dialog} isSheet={isMobileLayout} onChange={onChange} />
              <InlineError message={formError} />
            </div>
            <div className="dialog-actions split-expense-card-actions">
              <BottomActions
                secondary={(
                  <button type="button" className="lsd-quiet" disabled={isSubmitting} onClick={onClose}>{readOnly ? "Close" : "Cancel"}</button>
                )}
                primary={(
                  <button type="submit" className="lsd-primary" disabled={isSubmitting}>
                    {isSubmitting ? messages.common.saving : splitsMessages.saveGroup}
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

export function SplitExpenseDialog({ dialog, groupOptions, people, categoryOptions, categories = [], formError, settlementLock = null, isUndoingSettlementLock = false, onUndoSettlementLock, isSubmitting, isSaveDisabled = false, readOnly = false, lockedBySettlement = false, onChange, onClose, onCloseAutoFocus = undefined, onSave, onViewLinkedEntry, onRequestDelete }) {
  const isMobileLayout = useIsMobileLayout();
  const [content, setContent] = useState(null);
  // New, edit and view all use the split expense card (design.md, "Lead ·
  // Support · Detail"), on a phone and on a wide screen.
  const isEditing = Boolean(dialog?.id) && !readOnly;
  const title = readOnly ? splitsMessages.viewSplit : (dialog?.id ? splitsMessages.editSplit : splitsMessages.createExpense);
  const closeLabel = readOnly
    ? splitsMessages.expenseCard.closeView
    : (dialog?.id ? splitsMessages.expenseCard.closeEdit : splitsMessages.expenseCard.close);
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
          onCloseAutoFocus={onCloseAutoFocus}
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
                <Dialog.Description>{splitsMessages.expenseCard.sheetContext(groupName, people.map((person) => person.name))}</Dialog.Description>
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
              {lockedBySettlement && settlementLock
                ? <SettlementLockNotice lock={settlementLock} isUndoing={isUndoingSettlementLock} onUndo={onUndoSettlementLock} />
                : null}
              {/* Keyed by mode: after Undo the same card opens editable with a fresh share editor. */}
              <SplitExpenseCard
                key={readOnly ? "view" : "edit"}
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
              {lockedBySettlement
                ? null
                : settlementLock
                  ? <SettlementLockNotice lock={settlementLock} isUndoing={isUndoingSettlementLock} onUndo={onUndoSettlementLock} />
                  : <InlineError message={formError} />}
            </div>
            <div className="dialog-actions split-expense-card-actions">
              <BottomActions
                destructive={isEditing ? (
                  // Asks in the app first (SplitDeleteDialog), as before.
                  <button type="button" className="lsd-quiet is-danger" disabled={isSubmitting} onClick={() => onRequestDelete?.(dialog)}>
                    {splitsMessages.expenseCard.deleteSplit}
                  </button>
                ) : null}
                secondary={(
                  <button type="button" className="lsd-quiet" disabled={isSubmitting} onClick={onClose}>
                    {readOnly ? messages.common.close : splitsMessages.expenseCard.cancel}
                  </button>
                )}
                primary={readOnly ? null : (
                  <button type="submit" className="lsd-primary" disabled={isSubmitting || isSaveDisabled}>
                    {isSubmitting ? messages.common.saving : splitsMessages.saveExpense}
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

export function SplitSettlementDialog({ dialog, groupOptions, people, formError, settlementLock = null, isUndoingSettlementLock = false, onUndoSettlementLock, isSubmitting, isSaveDisabled = false, readOnly = false, onChange, onClose, onSave, onViewLinkedEntry, onRequestDelete }) {
  const isMobileLayout = useIsMobileLayout();
  const [content, setContent] = useState(null);
  // On a phone the dialog is a bottom sheet (Settle group, Record
  // settlement) and swipes down to close, asking first when the draft
  // changed since it opened.
  useKeyboardInset(isMobileLayout ? content : null);
  const isDirty = useDraftChanged(readOnly ? null : dialog, buildComparableSplitDraft);
  const swipe = useSheetSwipeDismiss({ sheet: content, enabled: isMobileLayout, isDirty, isSubmitting, onClose });

  return (
    <Dialog.Root open={Boolean(dialog)} onOpenChange={(open) => { if (!open && !isSubmitting) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="note-dialog-overlay" />
        <Dialog.Content
          ref={setContent}
          className="note-dialog-content split-dialog-content split-settlement-dialog split-expense-card-dialog"
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
            <div className="note-dialog-head split-dialog-head split-expense-card-head">
              <div>
                <Dialog.Title>{readOnly ? "View split" : (dialog?.id ? splitsMessages.editSplit : splitsMessages.createSettlement)}</Dialog.Title>
                <Dialog.Description>{readOnly
                  ? "Review the split and its linked ledger evidence."
                  : splitsMessages.groupSettlementDetail(groupOptions.find((group) => group.value === dialog?.groupId)?.label)}</Dialog.Description>
              </div>
            </div>
            <div className="split-dialog-scroll" data-sheet-body>
              <SplitSettlementCard
                dialog={dialog}
                groupOptions={groupOptions}
                people={people}
                onChange={onChange}
                layout={isMobileLayout ? "sheet" : "dialog"}
                autoFocusAmount={!readOnly}
                readOnly={readOnly}
                amountAction={<TotalsVisibilityToggle className="totals-visibility-toggle--form" />}
                onViewLinkedEntry={onViewLinkedEntry ? () => onViewLinkedEntry(dialog) : undefined}
              />
              {settlementLock
                ? <SettlementLockNotice lock={settlementLock} isUndoing={isUndoingSettlementLock} onUndo={onUndoSettlementLock} />
                : <InlineError message={formError} />}
            </div>
            <div className="dialog-actions split-expense-card-actions">
              <BottomActions
                destructive={!readOnly && dialog?.id ? (
                  // Asks in the app first (SplitDeleteDialog), as before.
                  <button type="button" className="lsd-quiet is-danger" disabled={isSubmitting} onClick={() => onRequestDelete?.(dialog)}>
                    Delete
                  </button>
                ) : null}
                secondary={(
                  <button type="button" className="lsd-quiet" disabled={isSubmitting} onClick={onClose}>
                    {readOnly ? messages.common.close : "Cancel"}
                  </button>
                )}
                primary={readOnly ? null : (
                  <button type="submit" className="lsd-primary" disabled={isSubmitting || isSaveDisabled}>
                    {isSubmitting ? messages.common.saving : splitsMessages.saveSettlement}
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

export function SplitDeleteDialog({ target, formError, settlementLock = null, isUndoingSettlementLock = false, onUndoSettlementLock, isSubmitting, onClose, onConfirm }) {
  if (!target) {
    return null;
  }
  const label = target.description ?? target.note ?? "this split row";
  const consequence = "This removes the split record only. Any linked bank ledger row stays in entries.";

  return (
    <SheetDialog
      tone="danger"
      className="split-delete-dialog"
      title="Delete split row"
      description={`Delete ${label}? ${consequence}`}
      descriptionHidden
      lead={(
        <ConfirmLead icon={Trash2} title={label}>
          <p className="lsd-note">{consequence}</p>
        </ConfirmLead>
      )}
      errorContent={settlementLock
        ? <SettlementLockNotice lock={settlementLock} isUndoing={isUndoingSettlementLock} onUndo={onUndoSettlementLock} />
        : undefined}
      errorMessage={formError}
      primaryLabel={isSubmitting ? messages.common.working : "Delete split row"}
      primaryDisabled={isSubmitting}
      isSubmitting={isSubmitting}
      onSubmit={onConfirm}
      onClose={onClose}
    />
  );
}
