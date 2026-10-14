import * as Dialog from "@radix-ui/react-dialog";
import { useRef, useState } from "react";

import { messages } from "./copy/en-SG";
import { InlineError } from "./ui-states";
import "./import-rollback-confirm.css";

// "Roll back this import" asks in the app, in a sheet at the bottom of a
// phone and a dialog on a wide screen, instead of a small floating note.
// Cancel and the confirming action sit in the bottom bar (the confirming one
// last, under the thumb). A refused rollback keeps the sheet open and says why
// (the old note's `delete-popover` class stays on it for that reason: the
// reason is read from it). Nothing changes until the confirming action.
/**
 * @param {{
 *   label?: string, triggerLabel: string, title?: string, confirmLabel: string, prompt: any,
 *   onConfirm: () => Promise<any> | any, buttonClassName?: string, bareTrigger?: boolean, children?: any
 * }} props
 */
// `title` words the dialog when it differs from the trigger; `bareTrigger`
// drops the quiet-link look so the caller's own button classes apply.
export function ImportRollbackConfirm({ triggerLabel, title = "", confirmLabel, prompt, onConfirm, buttonClassName = "", bareTrigger = false, children = null }) {
  // A second tap before the first finishes must not run the action twice.
  const inFlight = useRef(false);
  const [open, setOpen] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState("");

  async function handleConfirm() {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setIsWorking(true);
    setError("");
    try {
      await onConfirm?.();
      setOpen(false);
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : "The action could not finish.");
    } finally {
      inFlight.current = false;
      setIsWorking(false);
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (isWorking) {
          return;
        }
        setOpen(next);
        if (!next) {
          setError("");
        }
      }}
    >
      <Dialog.Trigger asChild>
        <button type="button" className={`${bareTrigger ? "" : "import-rollback-trigger "}${buttonClassName}`.trim()} aria-label={triggerLabel} disabled={isWorking}>
          {children ?? triggerLabel}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="note-dialog-overlay" />
        <Dialog.Content className="note-dialog-content delete-popover import-rollback-sheet">
          <div className="import-rollback-head">
            <Dialog.Title>{title || triggerLabel}</Dialog.Title>
            <Dialog.Description>{prompt}</Dialog.Description>
          </div>
          <InlineError message={error} />
          <div className="import-rollback-actions">
            <button type="button" className="lsd-quiet" disabled={isWorking} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" className="lsd-primary" disabled={isWorking} onClick={() => void handleConfirm()}>
              {isWorking ? messages.common.working : confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
