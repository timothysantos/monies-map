import * as Popover from "@radix-ui/react-popover";
import { Archive, Trash2, X } from "lucide-react";
import { cloneElement, useState } from "react";

import { messages } from "./copy/en-SG";
import { ConfirmLead, SheetDialog } from "./sheet-dialog";
import { InlineError } from "./ui-states";
import { useIsMobileLayout } from "./use-viewport";

// A small button that asks in the app before it deletes (or archives, or rolls
// back) a row: a popover beside the button on a wide screen, and on a phone the
// shared bottom sheet (sheet-dialog.jsx) with the rose confirm button in the
// bottom bar, under the thumb. `destructive: false` is a calmer ask (Archive
// account): the same sheet with a neutral lead and the primary button.
// `prompt` is the sentence that says what happens; `onConfirm` may throw, and
// the message shows inside the open ask.
export function DeleteRowButton({
  label,
  onConfirm,
  triggerLabel,
  confirmLabel = "Confirm",
  destructive = true,
  prompt = undefined,
  buttonClassName = "",
  children = null
}) {
  const [open, setOpen] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState("");
  const isSheet = useIsMobileLayout();
  const accessibleLabel = triggerLabel ?? `Delete ${label}`;
  const sentence = prompt ?? <>You are deleting <strong>{label}</strong>. Confirm?</>;

  async function handleConfirm() {
    setIsWorking(true);
    setError("");
    try {
      await onConfirm?.();
      setOpen(false);
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : "The action could not finish.");
    } finally {
      setIsWorking(false);
    }
  }

  function close() {
    if (isWorking) {
      return;
    }
    setOpen(false);
    setError("");
  }

  const trigger = (
    <button
      type="button"
      className={destructive ? `subtle-remove ${buttonClassName}`.trim() : `icon-action ${buttonClassName}`.trim()}
      aria-label={accessibleLabel}
      disabled={isWorking}
      onClick={(event) => event.stopPropagation()}
    >
      {children ?? (destructive ? <span aria-hidden="true">&times;</span> : <X size={16} />)}
    </button>
  );

  if (isSheet) {
    return (
      <>
        {cloneElement(trigger, {
          "aria-haspopup": "dialog",
          "aria-expanded": open,
          onClick: (event) => {
            event.stopPropagation();
            setOpen(true);
          }
        })}
        {open ? (
          <SheetDialog
            tone={destructive ? "danger" : undefined}
            className="delete-row-sheet"
            title={accessibleLabel}
            description={sentence}
            descriptionHidden
            lead={(
              <ConfirmLead neutral={!destructive} icon={destructive ? Trash2 : Archive} title={label}>
                <p className="lsd-note">{sentence}</p>
              </ConfirmLead>
            )}
            errorMessage={error}
            primaryLabel={isWorking ? messages.common.working : confirmLabel}
            primaryDisabled={isWorking}
            isSubmitting={isWorking}
            onSubmit={handleConfirm}
            onClose={close}
          />
        ) : null}
      </>
    );
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (isWorking) {
          return;
        }
        setOpen(nextOpen);
        if (!nextOpen) {
          setError("");
        }
      }}
    >
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="delete-popover"
          sideOffset={8}
          align="end"
          onClick={(event) => event.stopPropagation()}
        >
          <p>{sentence}</p>
          <InlineError message={error} />
          <div className="delete-popover-actions">
            <Popover.Close asChild>
              <button type="button" className="subtle-action" disabled={isWorking}>
                Cancel
              </button>
            </Popover.Close>
            <button
              type="button"
              className={`subtle-action ${destructive ? "subtle-danger" : ""}`}
              disabled={isWorking}
              onClick={() => void handleConfirm()}
            >
              {isWorking ? messages.common.working : confirmLabel}
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
