import { X } from "lucide-react";
import { createPortal } from "react-dom";
import { ResponsiveSelect } from "./responsive-select";

export function EntryMobileSheet({
  title,
  description,
  errorMessage = "",
  saveLabel,
  cancelLabel = "Cancel",
  isSaveDisabled = false,
  secondaryAction = null,
  footerContent = null,
  onClose,
  onSave,
  children
}) {
  const sheet = (
    <>
      <button
        type="button"
        className="entry-composer-overlay"
        aria-label={`Close ${title.toLowerCase()}`}
        onClick={onClose}
      />
      <section className="entry-composer entry-mobile-sheet" role="dialog" aria-modal="true" aria-label={title}>
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
              <strong>{title}</strong>
              <p>{description}</p>
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
          {footerContent ?? (
            <div className="entry-inline-actions entry-mobile-sheet-actions">
              {secondaryAction}
              <button type="button" className="subtle-cancel" onClick={onClose}>{cancelLabel}</button>
              <button type="submit" className="dialog-primary" disabled={isSaveDisabled}>{saveLabel}</button>
            </div>
          )}
        </div>
        </form>
      </section>
    </>
  );

  if (typeof document === "undefined") {
    return sheet;
  }

  return createPortal(sheet, document.body);
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
