import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { FocusScope } from "@radix-ui/react-focus-scope";
import { hideOthers } from "aria-hidden";
import { X } from "lucide-react";
import { RemoveScroll } from "react-remove-scroll";
import { ResponsiveSelect } from "./responsive-select";
import { InlineError } from "./ui-states";

// The mobile bottom sheet shared by Entries and Month. It behaves like the
// modal desktop dialogs: focus moves into the sheet on open and stays inside
// it, the rest of the page is hidden from screen readers and cannot be tapped
// or scrolled, Escape or a tap on the backdrop closes it (discarding the
// draft, as the desktop dialogs do), and focus returns to the control that
// opened it. While `isSubmitting` a save or delete is in flight, so Escape
// and backdrop taps are ignored rather than dropping the pending result.
//
// It does not use Radix's `modal` mode. That mode sets `pointer-events: none`
// on <body> and a scroll-lock custom property on it; both inherit, so on a
// 2,000-row month every row recomputed its style on open and again on close
// (about 150 ms on a throttled phone). The same behaviours are assembled here
// from the pieces Radix uses, without an inherited style change on <body>:
// - FocusScope (trapped, looping) keeps focus inside.
// - hideOthers sets aria-hidden on the page, an attribute no style reads.
// - RemoveScroll without its scrollbar styles blocks touch and wheel scroll
//   outside the sheet, and `overflow: hidden` on <html> (which does not
//   inherit) stops keyboard scrolling of the page.
// - The backdrop covers the viewport in every layout, so a tap outside the
//   sheet lands on it and closes the sheet instead of reaching the page.
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
  // The portal attaches the sheet after the first commit, so the node is
  // state rather than a ref read in a mount effect.
  const [sheet, setSheet] = useState(null);
  useEffect(() => (sheet ? hideOthers(sheet) : undefined), [sheet]);
  // Touch and wheel scrolling stay allowed inside the sheet.
  const scrollShards = useMemo(() => (sheet ? [sheet] : []), [sheet]);
  usePageKeyboardScrollLock();

  return (
    <Dialog.Root
      open
      modal={false}
      onOpenChange={(open) => {
        if (!open && !isSubmitting) {
          onClose();
        }
      }}
    >
      <Dialog.Portal>
        <RemoveScroll forwardProps removeScrollBar={false} allowPinchZoom shards={scrollShards}>
          <div className="entry-composer-overlay" />
        </RemoveScroll>
        <FocusScope
          asChild
          loop
          trapped
          onMountAutoFocus={(event) => {
            // Focus the sheet itself, not its first field, so opening a sheet
            // does not pop the phone keyboard. Editors that focus a field on
            // purpose still do so (then this does not run).
            event.preventDefault();
            const container = event.currentTarget;
            if (container instanceof HTMLElement) {
              container.focus({ preventScroll: true });
            }
          }}
          onUnmountAutoFocus={(event) => {
            event.preventDefault();
            const opener = openerRef.current;
            if (opener instanceof HTMLElement && opener.isConnected && opener !== document.body) {
              opener.focus({ preventScroll: true });
            }
          }}
        >
          <Dialog.Content
            ref={setSheet}
            className="entry-composer entry-mobile-sheet"
            aria-label={title}
            aria-modal="true"
            // The FocusScope above owns focus on open and close.
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => event.preventDefault()}
            // Focus cannot leave while trapped; never treat an attempt as a
            // dismissal (the desktop modal dialogs behave the same way).
            onFocusOutside={(event) => event.preventDefault()}
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
              <InlineError message={errorMessage} className="entry-submit-error" />
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
        </FocusScope>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// `overflow: hidden` on <html> stops Space, Page Down and arrow keys from
// scrolling the page behind the sheet. Unlike a change on <body>, it restyles
// only the root. Where the page shows a classic scrollbar (a narrow desktop
// window), a stable gutter keeps the page from shifting sideways.
function usePageKeyboardScrollLock() {
  useEffect(() => {
    const root = document.documentElement;
    const previous = { overflow: root.style.overflow, scrollbarGutter: root.style.scrollbarGutter };
    const hasClassicScrollbar = window.innerWidth - root.clientWidth > 0;
    root.style.overflow = "hidden";
    if (hasClassicScrollbar) {
      root.style.scrollbarGutter = "stable";
    }
    return () => {
      root.style.overflow = previous.overflow;
      root.style.scrollbarGutter = previous.scrollbarGutter;
    };
  }, []);
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
