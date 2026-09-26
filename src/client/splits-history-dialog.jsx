import * as Dialog from "@radix-ui/react-dialog";
import { RotateCcw } from "lucide-react";
import { messages } from "./copy/en-SG";
import { moniesClient } from "./monies-client-service";
import { EmptyState, InlineError } from "./ui-states";

const { format: formatService } = moniesClient;

function formatHistoryMoney(item) {
  return formatService.moneyWithCurrency(Math.abs(item.amountMinor), item.currency ?? "SGD");
}

export function SplitHistoryDialog({ open, history = [], error = "", isSubmitting = false, onClose, onRestore }) {
  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="note-dialog-overlay" />
        <Dialog.Content className="note-dialog-content split-dialog-content split-history-dialog">
          <div className="note-dialog-head split-dialog-head">
            <Dialog.Title>Split activity history</Dialog.Title>
            <Dialog.Description>Review deleted and restored split records. Restore keeps the original split and ledger link.</Dialog.Description>
          </div>
          <div className="split-history-list">
            {history.length ? history.map((item) => (
              <article className="split-history-row" key={item.id}>
                <div>
                  <strong>{item.description}</strong>
                  <small>{item.groupName ?? "Non-group expenses"} · {formatHistoryMoney(item)} · {item.action} · {item.occurredAt}</small>
                </div>
                {item.canRestore ? <button type="button" className="subtle-action" disabled={isSubmitting} onClick={() => onRestore(item)}><RotateCcw size={15} /> Restore</button> : null}
              </article>
            )) : <EmptyState>{messages.splits.historyEmpty}</EmptyState>}
          </div>
          <InlineError message={error} />
          <div className="dialog-actions"><button type="button" className="subtle-cancel" onClick={onClose}>Close</button></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
