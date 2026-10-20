import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { FocusScope } from "@radix-ui/react-focus-scope";
import { hideOthers } from "aria-hidden";
import { X } from "lucide-react";
import { RemoveScroll } from "react-remove-scroll";
import { ResponsiveSelect } from "./responsive-select";
import { SplitShareChoices } from "./split-share-choices";
import { findSheetOpener, returnFocusFromSheet } from "./sheet-focus-return";
import { SheetDiscardConfirm, SheetDragHandle, useSheetSwipeDismiss } from "./sheet-swipe";
import { InlineError } from "./ui-states";
import { useKeyboardInset } from "./use-keyboard-inset";
import { lockPageKeyboardScroll } from "./page-scroll-lock";

// The mobile bottom sheet shared by Entries and Month. It behaves like the
// modal desktop dialogs: focus moves into the sheet on open and stays inside
// it, the rest of the page is hidden from screen readers and cannot be tapped
// or scrolled, Escape or a tap on the backdrop closes it (discarding the
// draft, as the desktop dialogs do), and focus returns to the control that
// opened it (see sheet-focus-return.js: a tapped button is not focused on
// iPhone or iPad, so the opener is the control the tap landed on). While `isSubmitting` a save or delete is in flight, so Escape
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
// - The sheet lifts itself above the phone keyboard (use-keyboard-inset.js),
//   so its Save bar and the focused field stay in sight.
// - It swipes down to close (sheet-swipe.jsx; the grab bar is the cue).
//   `isDirty` says whether the draft changed since the sheet opened:
//   unchanged, the swipe closes it; changed, it springs back and asks
//   "Discard changes?". The body is `data-sheet-body`: a drag starts there
//   only while it is scrolled to its top.
export function EntryMobileSheet({
  title,
  description,
  // A dialog whose lead says what the sheet is about keeps the description
  // for assistive tech only (a class from lead-support-detail.css).
  descriptionClassName = "",
  // The close button's name; defaults to "Close {title}".
  closeLabel = undefined,
  // Dialogs opened from a clickable row or a form keep React's submit, click
  // and key events inside the sheet (see keepEventsInDialog in
  // category-edit-dialog.jsx).
  isolateEvents = false,
  // A sheet that must be answered has no close button.
  hideClose = false,
  className = "",
  headerAction = null,
  errorMessage = "",
  errorContent = null,
  saveLabel,
  cancelLabel = "Cancel",
  isSaveDisabled = false,
  isSubmitting = false,
  isDirty = false,
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
    openerRef.current = findSheetOpener();
  }
  // The portal attaches the sheet after the first commit, so the node is
  // state rather than a ref read in a mount effect.
  const [sheet, setSheet] = useState(null);
  useEffect(() => (sheet ? hideOthers(sheet) : undefined), [sheet]);
  // Touch and wheel scrolling stay allowed inside the sheet.
  const scrollShards = useMemo(() => (sheet ? [sheet] : []), [sheet]);
  usePageKeyboardScrollLock();
  useKeyboardInset(sheet);
  const swipe = useSheetSwipeDismiss({ sheet, isDirty, isSubmitting, onClose });
  const isTopSheet = useSheetStack();
  const eventGuards = isolateEvents ? {
    onSubmit: (event) => event.stopPropagation(),
    onClick: (event) => event.stopPropagation(),
    onKeyDown: (event) => event.stopPropagation()
  } : {};

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
          <div className="entry-composer-overlay" {...eventGuards} />
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
            returnFocusFromSheet(openerRef.current ?? null);
          }}
        >
          <Dialog.Content
            ref={setSheet}
            className={`entry-composer entry-mobile-sheet${className ? ` ${className}` : ""}`}
            aria-label={title}
            aria-modal="true"
            // The FocusScope above owns focus on open and close.
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => event.preventDefault()}
            // Focus cannot leave while trapped; never treat an attempt as a
            // dismissal (the desktop modal dialogs behave the same way).
            onFocusOutside={(event) => event.preventDefault()}
            {...swipe.contentProps}
            onPointerDownOutside={(event) => {
              if (!isTopSheet()) {
                event.preventDefault();
                return;
              }
              swipe.contentProps.onPointerDownOutside(event);
            }}
            {...eventGuards}
          >
            <SheetDragHandle />
            <form
              className="entry-mobile-sheet-form"
              inert={swipe.isConfirmOpen}
              onSubmit={(event) => {
                event.preventDefault();
                if (!isSaveDisabled) {
                  onSave();
                }
              }}
            >
            <div className="entry-mobile-sheet-scroll" data-sheet-body>
              <div className="note-dialog-head split-dialog-head entry-composer-head">
                <div className="entry-composer-copy">
                  <Dialog.Title asChild><strong>{title}</strong></Dialog.Title>
                  <Dialog.Description asChild><p className={descriptionClassName || undefined}>{description}</p></Dialog.Description>
                </div>
                <div className="entry-composer-head-actions">
                  {headerAction}
                  {hideClose ? null : (
                    <button
                      type="button"
                      className="icon-action subtle-cancel entry-composer-close"
                      aria-label={closeLabel ?? `Close ${title.toLowerCase()}`}
                      onClick={onClose}
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
              </div>
              {errorContent ?? <InlineError message={errorMessage} className="entry-submit-error" />}
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
            <SheetDiscardConfirm open={swipe.isConfirmOpen} onKeepEditing={swipe.keepEditing} onDiscard={swipe.discard} />
          </Dialog.Content>
        </FocusScope>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// The sheets that are open, the top one last. A sheet opened over another (a
// confirmation over the Edit entry sheet) is not part of the lower sheet's
// React tree, so a tap on it would count as "outside" for the one below and
// close it too. Only the top sheet answers an outside tap.
const openSheets = [];

function useSheetStack() {
  const idRef = useRef({});
  useEffect(() => {
    const id = idRef.current;
    openSheets.push(id);
    return () => {
      const index = openSheets.indexOf(id);
      if (index !== -1) {
        openSheets.splice(index, 1);
      }
    };
  }, []);
  return () => openSheets[openSheets.length - 1] === idRef.current;
}

// `overflow: hidden` on <html> while any sheet is open; counted across nested
// sheets (page-scroll-lock.js), so sheets closing together in any order give
// the page its scrolling back.
function usePageKeyboardScrollLock() {
  useEffect(() => lockPageKeyboardScroll(), []);
}

// While Add to splits asks which group, the sheet's bottom bar becomes the
// group question: the group picker opens over it, and Cancel backs out.
export function EntrySplitGroupPickerFooter({
  splitGroupId = "",
  splitGroupOptions = [],
  splitBasisPoints = 5000,
  sharePersonName = "First person",
  otherPersonName = undefined,
  isWorking = false,
  isSplitSelectorOpen = false,
  onSplitSelectorOpenChange,
  onSelectSplitGroup,
  onSplitBasisPointsChange,
  onConfirmSplit,
  onCancelSplitPicker
}) {
  const selectedGroup = splitGroupId
    ? splitGroupOptions.find((option) => option.value === splitGroupId)
    : null;
  if (selectedGroup) {
    return (
      <div className="entry-mobile-sheet-confirm-actions is-split-share">
        <button
          type="button"
          className="lsd-quiet entry-mobile-split-group"
          disabled={isWorking}
          onClick={() => onSplitSelectorOpenChange(true)}
        >
          {selectedGroup.label}
        </button>
        <span className="entry-mobile-sheet-confirm-copy">{sharePersonName}'s share</span>
        <SplitShareChoices personName={sharePersonName} otherPersonName={otherPersonName} value={splitBasisPoints} disabled={isWorking} onChange={onSplitBasisPointsChange} />
        <div className="entry-mobile-sheet-confirm-buttons">
          <button
            type="button"
            className="subtle-cancel"
            disabled={isWorking}
            onClick={onCancelSplitPicker}
          >
            Cancel
          </button>
          <button
            type="button"
            className="lsd-primary"
            disabled={isWorking}
            onClick={onConfirmSplit}
          >
            {isWorking ? "Adding..." : "Add to splits"}
          </button>
        </div>
      </div>
    );
  }
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
