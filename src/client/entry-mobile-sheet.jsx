import { X } from "lucide-react";
import { createPortal } from "react-dom";
import { ResponsiveSelect } from "./responsive-select";

export function EntryMobileSheet({
  title,
  description,
  errorMessage = "",
  saveLabel,
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
              <button type="button" className="subtle-cancel" onClick={onClose}>Cancel</button>
              <button type="button" className="dialog-primary" disabled={isSaveDisabled} onClick={onSave}>{saveLabel}</button>
            </div>
          )}
        </div>
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
        <span className="entry-mobile-sheet-action-divider" aria-hidden="true">|</span>
        <button type="button" className="subtle-cancel" onClick={onCancel}>Cancel</button>
        <button type="button" className="dialog-primary" disabled={isSaveDisabled} onClick={onSave}>{saveLabel}</button>
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
      <span className="entry-mobile-sheet-action-divider" aria-hidden="true">|</span>
      <button type="button" className="subtle-cancel" onClick={onCancel}>Cancel</button>
      <button type="button" className="dialog-primary" disabled={isSaveDisabled} onClick={onSave}>{saveLabel}</button>
    </div>
  );
}
