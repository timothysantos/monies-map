// "Add to Splits" choice for the picked rows (design.md "Picking many"): a
// small popover under the bar's button on a wide screen, a sheet on a phone,
// built from the pieces Add to splits already uses for one entry (the group
// choices and the share pills, entries-route.css). It holds the group and
// the share, shows the plain preview line, and "Add N" confirms. Lazy: the
// pick bar fetches it when the choice first opens.
import "./category-pick.css";
import "./entries-pick.css";
import "./trip-events.css";
import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import { Check, X } from "lucide-react";
import { useState } from "react";

import { pickSplitsCopy as copy } from "./copy/pick-splits-copy";
import { previewLine, shareChoicesFor } from "./entry-pick-splits-model";
import { SheetSwipeDismiss } from "./sheet-swipe";
import { BottomActions } from "./ui-components";
import { useKeyboardInset } from "./use-keyboard-inset";
import { useRouteWorkBusy } from "./use-route-work-status";
import { useIsMobileLayout } from "./use-viewport";

/**
 * @param {{
 *   open: boolean, onOpenChange: (open: boolean) => void, anchorRef: { current: any },
 *   count: number, groups: Array<{ id: string, name: string }>, people: { payerName: string, otherName: string },
 *   initialGroupId: string,
 *   onChoose: (choice: { groupId: string, shareBasisPoints: number }) => Promise<{ ok: boolean, error?: string }>
 * }} props
 */
export function PickSplitsChoice({ open, onOpenChange, anchorRef, count, groups, people, initialGroupId, onChoose }) {
  const isMobile = useIsMobileLayout();
  useRouteWorkBusy(open);
  const close = () => onOpenChange(false);
  const title = copy.title(count);
  const body = <PickSplitsForm count={count} groups={groups} people={people} initialGroupId={initialGroupId} onChoose={onChoose} onClose={close} sheet={isMobile} />;
  if (isMobile) {
    return (
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        {open ? <PickSplitsSheet title={title} onClose={close}>{body}</PickSplitsSheet> : null}
      </Dialog.Root>
    );
  }
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Anchor virtualRef={anchorRef} />
      {open ? (
        <Popover.Portal>
          <Popover.Content
            className="category-popover trip-pick-popover pick-splits-popover"
            sideOffset={8}
            align="start"
            collisionPadding={12}
            aria-label={title}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              anchorRef?.current?.focus?.({ preventScroll: true });
            }}
          >
            <p className="trip-pick-title">{title}</p>
            {body}
          </Popover.Content>
        </Popover.Portal>
      ) : null}
    </Popover.Root>
  );
}

function PickSplitsSheet({ title, onClose, children }) {
  const [sheet, setSheet] = useState(/** @type {HTMLElement | null} */ (null));
  useKeyboardInset(sheet, { scrollFocused: false });
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="note-dialog-overlay" />
      <Dialog.Content
        ref={setSheet}
        className="note-dialog-content split-dialog-content mobile-select-dialog is-picker-sheet pick-splits-sheet"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <SheetSwipeDismiss onClose={onClose} />
        <div className="note-dialog-head mobile-select-head">
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description className="sr-only">{title}</Dialog.Description>
          <button type="button" className="icon-action subtle-cancel mobile-select-close" aria-label={copy.close} onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  );
}

function PickSplitsForm({ count, groups, people, initialGroupId, onChoose, onClose, sheet }) {
  const [groupId, setGroupId] = useState(initialGroupId);
  const [shareBasisPoints, setShareBasisPoints] = useState(5000);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const group = groups.find((candidate) => candidate.id === groupId) ?? null;
  const choices = shareChoicesFor(people);

  async function add() {
    if (pending) return;
    setPending(true);
    setError("");
    const result = await onChoose({ groupId, shareBasisPoints });
    setPending(false);
    if (result.ok) onClose();
    else setError(result.error ?? copy.saveFailed);
  }

  const addButton = (
    <button type="button" className="lsd-primary" data-pick-splits-add="" disabled={pending} onClick={() => void add()}>
      {pending ? copy.adding : copy.add(count)}
    </button>
  );
  return (
    <div className="pick-splits-form" data-pick-splits="">
      {groups.length > 1 ? (
        <fieldset className="entry-split-picker-field" disabled={pending}>
          <legend>{copy.groupLegend}</legend>
          {/* A wide screen's popover is short of room: its groups are the same pills as the share. */}
          <div className={sheet ? "entry-split-group-list" : "entry-split-share-choices"} role="radiogroup" aria-label={copy.groupLegend}>
            {groups.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                role="radio"
                aria-checked={groupId === candidate.id}
                className={`${sheet ? "entry-split-group-choice" : "entry-split-share-choice"}${groupId === candidate.id ? " is-selected" : ""}`}
                onClick={() => setGroupId(candidate.id)}
              >
                <span>{candidate.name}</span>
                {sheet ? (
                  <span className="entry-split-group-choice-mark" aria-hidden="true">
                    {groupId === candidate.id ? <Check size={15} strokeWidth={3} /> : null}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}
      <fieldset className="entry-split-picker-field" disabled={pending}>
        <legend>{copy.shareLegend}</legend>
        <div className="entry-split-share-choices" role="radiogroup" aria-label={copy.shareLegend}>
          {choices.map((choice) => (
            <button
              key={choice.basisPoints}
              type="button"
              role="radio"
              aria-checked={shareBasisPoints === choice.basisPoints}
              className={`entry-split-share-choice${shareBasisPoints === choice.basisPoints ? " is-selected" : ""}`}
              onClick={() => setShareBasisPoints(choice.basisPoints)}
            >
              {choice.label}
            </button>
          ))}
        </div>
      </fieldset>
      <p className="pick-splits-preview" data-pick-splits-preview="" role="status">
        {previewLine({ count, people, shareBasisPoints, group })}
      </p>
      {error ? <p className="entries-pick-bar-message" role="alert">{error}</p> : null}
      {sheet ? (
        <BottomActions className="is-sheet-bar" primary={addButton} secondary={<button type="button" className="lsd-quiet" onClick={onClose}>{copy.close}</button>} />
      ) : (
        <div className="pick-splits-actions">{addButton}</div>
      )}
    </div>
  );
}
