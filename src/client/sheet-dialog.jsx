import "./sheet-dialog.css";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { EntryMobileSheet } from "./entry-mobile-sheet";
import { InlineError } from "./ui-states";
import { BottomActions, LeadCard } from "./ui/lead-support-detail";
import { useIsMobileLayout } from "./use-viewport";

// The one frame for the app's dialogs and small sheets (design.md, "Lead ·
// Support · Detail"). The caller gives it the copy, a lead, the rows or
// fields, and the actions; it gives them the layout of the phone or the wide
// screen, so every dialog reads the same:
// - phone: the shared EntryMobileSheet (grab handle, swipe down, "Discard
//   changes?" when `isDirty`, lifts above the keyboard) with the actions in
//   the sheet's own bottom bar, under the thumb;
// - wide screen: a centred Radix dialog with the same head, lead, rows and
//   actions bar.
// The dialog is mounted while it is open; callers render it conditionally.
// `onSubmit` is what the primary button and Enter do. A destructive
// confirmation passes `tone="danger"`: the primary button is rose, and the
// Cancel button sits first so it is the one under a thumb that slips.
//
// Props worth knowing:
// - `lead`: a LeadCard (or any node) for what the dialog is about.
// - `descriptionHidden`: the lead already says it; keep the description for
//   assistive tech only.
// - `quietLabel` / `onQuiet`: the action at the start of the bar. It is
//   Cancel unless a dialog sets it ("Close" on a dialog with nothing to save).
// - `destructive`: a ready node for a separate destructive action at the start.
// - `hideSubmit`: a dialog that only reads or acts through its own rows.

// The dialog is portalled out of the DOM, but React still bubbles its events
// through the component tree into whatever opened it (an entry form's submit,
// a list row's click and Enter). Stopping them here keeps what a dialog does
// to the dialog. Pointer-down is left alone: Radix dismisses on it.
const keepEventsInDialog = {
  onSubmit: (event) => event.stopPropagation(),
  onClick: (event) => event.stopPropagation(),
  onKeyDown: (event) => event.stopPropagation()
};

// The first field of the dialog takes focus on a wide screen, so typing starts
// at once and the close button does not show a focus ring. A dialog with no
// field (a confirmation) focuses the dialog itself.
function focusFirstField(event) {
  event.preventDefault();
  const content = event.currentTarget;
  if (!(content instanceof HTMLElement)) {
    return;
  }
  const field = content.querySelector("[data-autofocus], .sheet-dialog-body input:not([type=hidden]):not([disabled]), .sheet-dialog-body textarea:not([disabled]), .sheet-dialog-body select:not([disabled])");
  (field instanceof HTMLElement ? field : content).focus({ preventScroll: true });
}

/**
 * The danger-toned lead: a rose bubble, what is about to go, and what it was.
 * @param {{ icon?: any, title: any, subtitle?: any, amount?: any, tone?: string, chips?: any, children?: any }} props
 */
export function ConfirmLead({ icon, title, subtitle = null, amount = null, tone = undefined, chips = null, children = null }) {
  return (
    <LeadCard
      className="sheet-dialog-lead is-danger"
      category={{ icon }}
      accentColor="var(--pastel-rose-ink)"
      title={title}
      subtitle={subtitle}
      amount={amount}
      tone={tone}
      chips={chips}
    >
      {children}
    </LeadCard>
  );
}

/**
 * @param {{
 *   title: string, description?: any, descriptionHidden?: boolean, closeLabel?: string,
 *   className?: string, tone?: "danger", lead?: any, errorMessage?: string, errorContent?: any,
 *   children?: any, primaryLabel?: any, primaryDisabled?: boolean, onSubmit?: () => void,
 *   quietLabel?: any, onQuiet?: () => void, destructive?: any, secondary?: any, hideSubmit?: boolean,
 *   isSubmitting?: boolean, isDirty?: boolean, onClose: () => void, wide?: boolean, asSheet?: boolean
 * }} props
 */
export function SheetDialog({
  title,
  description = null,
  descriptionHidden = false,
  closeLabel = undefined,
  className = "",
  tone = undefined,
  lead = null,
  errorMessage = "",
  errorContent = null,
  children = null,
  primaryLabel = null,
  primaryDisabled = false,
  onSubmit = undefined,
  quietLabel = "Cancel",
  onQuiet = undefined,
  destructive = null,
  secondary = null,
  hideSubmit = false,
  isSubmitting = false,
  isDirty = false,
  onClose,
  wide = false,
  asSheet = undefined
}) {
  // The phone layout by default; Month also opens its sheets on a portrait
  // tablet, which passes `asSheet`.
  const isPhoneLayout = useIsMobileLayout();
  const isMobile = asSheet ?? isPhoneLayout;
  const isDanger = tone === "danger";
  const close = () => {
    if (!isSubmitting) {
      onClose();
    }
  };
  const submit = () => {
    if (!primaryDisabled && !isSubmitting) {
      void onSubmit?.();
    }
  };
  const primary = !hideSubmit && primaryLabel ? (
    <button
      type="submit"
      className={`lsd-primary dialog-primary${isDanger ? " is-danger" : ""}`}
      disabled={primaryDisabled}
    >
      {primaryLabel}
    </button>
  ) : null;
  const actions = (barClass) => (
    <BottomActions
      className={barClass}
      destructive={destructive}
      quietLabel={quietLabel}
      quietDisabled={isSubmitting}
      onQuiet={onQuiet ?? close}
      secondary={secondary}
      primary={primary}
    />
  );
  const body = (
    <div className="sheet-dialog-body">
      {lead}
      {children}
    </div>
  );
  const frameClass = `sheet-dialog${isDanger ? " is-danger" : ""}${className ? ` ${className}` : ""}`;

  if (isMobile) {
    return (
      <EntryMobileSheet
        className={`is-dialog-sheet ${frameClass}`}
        title={title}
        description={description}
        descriptionClassName={descriptionHidden ? "lsd-sr-only" : ""}
        closeLabel={closeLabel}
        isolateEvents
        errorMessage={errorMessage}
        errorContent={errorContent}
        saveLabel={typeof primaryLabel === "string" ? primaryLabel : ""}
        isSaveDisabled={primaryDisabled || hideSubmit}
        isSubmitting={isSubmitting}
        isDirty={isDirty}
        onClose={onClose}
        onSave={submit}
        footerContent={actions("is-sheet-bar")}
      >
        {body}
      </EntryMobileSheet>
    );
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="note-dialog-overlay" {...keepEventsInDialog} />
        <Dialog.Content
          className={`note-dialog-content ${frameClass}${wide ? " is-wide" : ""}`}
          onOpenAutoFocus={focusFirstField}
          {...keepEventsInDialog}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <div className="note-dialog-head sheet-dialog-head">
              <div className="sheet-dialog-copy">
                <Dialog.Title>{title}</Dialog.Title>
                <Dialog.Description className={descriptionHidden ? "lsd-sr-only" : undefined}>{description}</Dialog.Description>
              </div>
              <button
                type="button"
                className="icon-action subtle-cancel"
                aria-label={closeLabel ?? `Close ${title.toLowerCase()}`}
                disabled={isSubmitting}
                onClick={close}
              >
                <X size={16} />
              </button>
            </div>
            {errorContent ?? <InlineError message={errorMessage} />}
            {body}
            {actions("is-dialog-bar")}
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
