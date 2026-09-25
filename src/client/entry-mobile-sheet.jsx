import { useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { ResponsiveSelect } from "./responsive-select";

// The mobile bottom sheet shared by Entries and Month. It is a modal Radix
// dialog like the desktop dialogs: focus moves into the sheet on open and
// stays inside it, Escape or a tap on the backdrop closes it (discarding the
// draft, as the desktop dialogs do), and focus returns to the control that
// opened it. While `isSubmitting` a save or delete is in flight, so Escape
// and backdrop taps are ignored rather than dropping the pending result.
export function EntryMobileSheet({
  title,
  description,
  errorMessage = "",
  saveLabel,
  cancelLabel = "Cancel",
  isSaveDisabled = false,
  isSubmitting = false,
  secondaryAction = null,
  footerContent = null,
  onClose,
  onSave,
  children
}) {
  // Captured during the first render, before Radix moves focus, so closing
  // can hand focus back to the row or button that opened the sheet.
  const openerRef = useRef(undefined);
  if (openerRef.current === undefined) {
    openerRef.current = typeof document === "undefined" ? null : document.activeElement;
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !isSubmitting) {
          onClose();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="entry-composer-overlay" />
        <Dialog.Content
          className="entry-composer entry-mobile-sheet"
          aria-label={title}
          onOpenAutoFocus={(event) => {
            // Focus the sheet itself, not its first field, so opening a sheet
            // does not pop the phone keyboard. Editors that focus a field on
            // purpose still do so afterwards.
            event.preventDefault();
            const sheet = event.currentTarget;
            if (sheet instanceof HTMLElement && !sheet.contains(document.activeElement)) {
              sheet.focus({ preventScroll: true });
            }
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const opener = openerRef.current;
            if (opener instanceof HTMLElement && opener.isConnected && opener !== document.body) {
              opener.focus({ preventScroll: true });
            }
          }}
        >
          <form
            className="entry-mobile-sheet-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!isSaveDisabled) {
                onSave();
              }
            }}
          >
          <div className="entry-mobile-sheet-scroll">
            <div className="note-dialog-head split-dialog-head entry-composer-head">
              <div className="entry-composer-copy">
                <Dialog.Title asChild><strong>{title}</strong></Dialog.Title>
                <Dialog.Description asChild><p>{description}</p></Dialog.Description>
              </div>
              <button
                type="button"
                className="icon-action subtle-cancel entry-composer-close"
                aria-label={`Close ${title.toLowerCase()}`}
                onClick={onClose}
              >
                <X size={16} />
              </button>
            </div>
            {errorMessage ? <p className="entry-submit-error">{errorMessage}</p> : null}
            {children}
          </div>
          {footerContent ?? (
            <div className="entry-inline-actions entry-mobile-sheet-actions">
              {secondaryAction}
              <button type="button" className="subtle-cancel" onClick={onClose}>{cancelLabel}</button>
              <button type="submit" className="dialog-primary" disabled={isSaveDisabled}>{saveLabel}</button>
            </div>
          )}
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function EntryMobileEditExpenseFooter({
  mode,
  addToSplitsLabel,
  deleteEntryLabel,
  deleteLabel,
  saveLabel = "Save",
  cancelLabel = "Cancel",
  isWorking = false,
  isSaveDisabled = false,
  splitGroupId = "",
  splitGroupOptions = [],
  isSplitSelectorOpen = false,
  onViewSplit,
  onDeleteSplit,
  onDeleteEntry,
  onCancel,
  onSave,
  onOpenAddToSplits,
  onSplitSelectorOpenChange,
  onSelectSplitGroup,
  onCancelSplitPicker
}) {
  if (mode === "linked") {
    return (
      <div className="entry-inline-actions entry-mobile-sheet-actions entry-mobile-sheet-linked-actions">
        <div className="entry-mobile-sheet-secondary-row">
          <button
            type="button"
            className="subtle-action entry-mobile-sheet-secondary"
            disabled={isWorking}
            onClick={onDeleteEntry}
          >
            {deleteEntryLabel}
          </button>
          <button
            type="button"
            className="subtle-action entry-mobile-sheet-secondary"
            disabled={isWorking}
            onClick={onViewSplit}
          >
            View split
          </button>
          <button
            type="button"
            className="subtle-action entry-mobile-sheet-secondary"
            disabled={isWorking}
            onClick={onDeleteSplit}
          >
            {deleteLabel}
          </button>
        </div>
        <div className="entry-mobile-sheet-primary-row">
          <button type="button" className="subtle-cancel" onClick={onCancel}>{cancelLabel}</button>
          <button type="submit" className="dialog-primary" disabled={isSaveDisabled}>{saveLabel}</button>
        </div>
      </div>
    );
  }

  if (mode === "picker") {
    return (
        <div className="entry-mobile-sheet-confirm-actions">
        <span className="entry-mobile-sheet-confirm-copy">Choose split group</span>
        <ResponsiveSelect
          title="Split group"
          value={splitGroupId}
          options={splitGroupOptions}
          onValueChange={onSelectSplitGroup}
          disabled={isWorking}
          open={isSplitSelectorOpen}
          onOpenChange={onSplitSelectorOpenChange}
          hideMobileTrigger
        />
        <div className="entry-mobile-sheet-confirm-buttons">
          <button
            type="button"
            className="subtle-cancel"
            disabled={isWorking}
            onClick={onCancelSplitPicker}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="entry-inline-actions entry-mobile-sheet-actions">
      <div className="entry-mobile-sheet-secondary-row">
        <button
          type="button"
          className="subtle-action entry-mobile-sheet-secondary"
          disabled={isWorking}
          onClick={onOpenAddToSplits}
        >
          {addToSplitsLabel}
        </button>
        <button
          type="button"
          className="subtle-action entry-mobile-sheet-secondary"
          disabled={isWorking}
          onClick={onDeleteEntry}
        >
          {deleteEntryLabel}
        </button>
      </div>
      <div className="entry-mobile-sheet-primary-row">
        <button type="button" className="subtle-cancel" onClick={onCancel}>{cancelLabel}</button>
        <button type="submit" className="dialog-primary" disabled={isSaveDisabled}>{saveLabel}</button>
      </div>
    </div>
  );
}
