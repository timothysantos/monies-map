import "./splits-list-sheets.css";
import * as Dialog from "@radix-ui/react-dialog";
import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { messages } from "./copy/en-SG";
import { splitHistoryActionLabel } from "./enum-labels";
import { moniesClient } from "./monies-client-service";
import { SheetSwipeDismiss } from "./sheet-swipe";
import { BottomActions } from "./ui/lead-support-detail";
import { EmptyState, InlineError } from "./ui-states";
import { useKeyboardInset } from "./use-keyboard-inset";

const { format: formatService } = moniesClient;

function formatHistoryMoney(item) {
  return formatService.moneyWithCurrency(Math.abs(item.amountMinor), item.currency ?? "SGD");
}

// Split activity history (design.md, "Lead · Support · Detail"): the head,
// one rounded group of rows (what it was, then where, how much, what
// happened and when; Restore at the right) and Close at the bottom.
export function SplitHistoryDialog({ open, history = [], error = "", isSubmitting = false, onClose, onRestore }) {
  // Every sheet with a bottom bar follows the keyboard (it has no field here).
  const [content, setContent] = useState(null);
  useKeyboardInset(content);
  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="note-dialog-overlay" />
        <Dialog.Content ref={setContent} className="note-dialog-content split-dialog-content split-list-sheet split-history-dialog">
          {/* A phone sheet that swipes down to close (nothing to lose); the
              list is its body, so a drag there moves the sheet only from
              the list's top. */}
          <SheetSwipeDismiss onClose={onClose} />
          <div className="note-dialog-head split-dialog-head">
            <div>
              <Dialog.Title>Split activity history</Dialog.Title>
              <Dialog.Description>Review deleted and restored split records. Restore keeps the original split and ledger link.</Dialog.Description>
            </div>
          </div>
          <div className="split-list-sheet-body" data-sheet-body>
            {history.length ? (
              <div className="lsd-rows split-history-list">
                {history.map((item) => (
                  <article className="split-history-row" key={item.id}>
                    <div>
                      <strong>{item.description}</strong>
                      <small>{item.groupName ?? "Non-group expenses"} · {formatHistoryMoney(item)} · {splitHistoryActionLabel(item.action)} · {item.occurredAt}</small>
                    </div>
                    {item.canRestore ? <button type="button" className="lsd-quiet split-history-restore" disabled={isSubmitting} onClick={() => onRestore(item)}><RotateCcw size={15} aria-hidden="true" /> Restore</button> : null}
                  </article>
                ))}
              </div>
            ) : <EmptyState>{messages.splits.historyEmpty}</EmptyState>}
            <InlineError message={error} />
          </div>
          <BottomActions className="is-sheet-bar split-list-sheet-actions" primaryLabel="Close" onPrimary={onClose} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
