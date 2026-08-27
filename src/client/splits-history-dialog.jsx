import * as Dialog from "@radix-ui/react-dialog";
import { RotateCcw } from "lucide-react";

function formatHistoryMoney(item) {
  return new Intl.NumberFormat("en-SG", { style: "currency", currency: item.currency ?? "SGD" }).format(Math.abs(item.amountMinor) / 100);
}

export function SplitHistoryDialog({ open, history = [], isSubmitting = false, onClose, onRestore }) {
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
            )) : <p className="split-history-empty">No split activity has been recorded yet.</p>}
          </div>
          <div className="dialog-actions"><button type="button" className="subtle-cancel" onClick={onClose}>Close</button></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
