import * as Popover from "@radix-ui/react-popover";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { useState } from "react";

import { planStudioCopy } from "./copy/plan-studio-copy";
import { ConfirmLead, SheetDialog } from "./sheet-dialog";

const copy = planStudioCopy;

/**
 * Asks in the app before a line is removed from the month's plan: a danger
 * dialog (a bottom sheet on a phone) with Cancel first. The removal itself is
 * the Month page's own command; a refusal shows inside the dialog.
 */
function RemoveLineDialog({ label, onConfirm, onClose }) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  async function confirm() {
    setWorking(true);
    setError("");
    try {
      await onConfirm();
      onClose();
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : copy.removeLine.failed);
      setWorking(false);
    }
  }
  return (
    <SheetDialog
      tone="danger"
      className="ps-remove-dialog"
      title={copy.removeLine.title(label)}
      description={copy.removeLine.text(label)}
      descriptionHidden
      lead={(
        <ConfirmLead icon={Trash2} title={label}>
          <p className="lsd-note">{copy.removeLine.text(label)}</p>
        </ConfirmLead>
      )}
      errorMessage={error}
      primaryLabel={copy.removeLine.confirm}
      primaryDisabled={working}
      isSubmitting={working}
      onSubmit={confirm}
      onClose={onClose}
    />
  );
}

/**
 * A row's menu: the things the plan tables do that a slider cannot (a note,
 * the line's details, matching entries, removing it). The entries behind the
 * line open from its status line, as every figure does.
 * The same Radix popover as the amount editor; each item closes it and hands
 * the row to the Month page, whose own dialogs and commands do the work.
 * `actions` holds only what applies to this row (a combined household line
 * has none, an income line cannot match entries).
 */
export function RowMenu({ row, actions }) {
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const items = [
    actions.editNote ? { key: "note", label: copy.menu.editNote, run: actions.editNote } : null,
    actions.editDetails ? { key: "details", label: copy.menu.editDetails, run: actions.editDetails } : null,
    actions.matchEntries ? { key: "match", label: copy.menu.matchEntries, run: actions.matchEntries } : null,
    actions.remove ? { key: "remove", label: copy.menu.remove, run: () => setRemoving(true), danger: true } : null
  ].filter(Boolean);
  if (!items.length) return null;
  return (
    <>
      <Popover.Root modal open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button type="button" className="ps-icon-button" aria-label={copy.menu.open(row.label)} aria-haspopup="menu" data-ps-menu-button>
            <MoreHorizontal size={18} aria-hidden="true" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className="ps-pop ps-menu" side="bottom" align="end" sideOffset={6} collisionPadding={12} role="menu" aria-label={copy.menu.open(row.label)}>
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                className={`ps-menu-item${item.danger ? " is-danger" : ""}`}
                data-ps-menu-item={item.key}
                onClick={() => {
                  setOpen(false);
                  item.run();
                }}
              >
                {item.label}
              </button>
            ))}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {removing ? <RemoveLineDialog label={row.label} onConfirm={actions.remove} onClose={() => setRemoving(false)} /> : null}
    </>
  );
}
