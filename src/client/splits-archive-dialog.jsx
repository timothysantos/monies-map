import "./splits-list-sheets.css";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowRightLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

import { moniesClient } from "./monies-client-service";
import { SheetSwipeDismiss } from "./sheet-swipe";
import { SplitActivityGroups } from "./splits-activity";
import { BottomActions } from "./ui/lead-support-detail";
import { useKeyboardInset } from "./use-keyboard-inset";

const { format: formatService, splits: splitService } = moniesClient;

export function SplitArchiveDialog({
  archiveDialog,
  archivedBatches,
  selectedArchivedBatch,
  categories,
  viewId,
  onClose,
  onBackToList,
  onOpenBatch,
  onEditExpense,
  onEditSettlement,
  onViewLinkedEntry,
  onUndoSettleUp,
  isUndoingSettleUp = false,
  undoSettleUpError = ""
}) {
  // Batches grouped without a stored batch id (older rows) cannot be reopened.
  // Every sheet with a bottom bar follows the keyboard (it has no field here).
  const [content, setContent] = useState(null);
  useKeyboardInset(content);
  const canUndoSettleUp = Boolean(onUndoSettleUp && selectedArchivedBatch?.batchId && !selectedArchivedBatch.batchId.startsWith("split-batch-fallback-"));
  return (
    <Dialog.Root open={Boolean(archiveDialog)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="note-dialog-overlay" />
        <Dialog.Content ref={setContent} className="note-dialog-content split-dialog-content split-list-sheet split-archive-dialog">
          {/* A phone sheet that swipes down to close (nothing to lose). */}
          <SheetSwipeDismiss onClose={onClose} />
          <div className="note-dialog-head split-dialog-head">
            <div>
              <Dialog.Title>{selectedArchivedBatch ? selectedArchivedBatch.label : "Archived batches"}</Dialog.Title>
              <Dialog.Description>
                {selectedArchivedBatch
                  ? (selectedArchivedBatch.closedAt ? `Settled ${formatService.formatDateOnly(selectedArchivedBatch.closedAt)}` : "Settled batch")
                  : "Closed settle-up batches stay here as muted history."}
              </Dialog.Description>
            </div>
          </div>
          {selectedArchivedBatch ? (
            <div className="split-archive-dialog-body split-list-sheet-body" data-sheet-body>
              <button type="button" className="lsd-quiet split-archive-back" onClick={onBackToList}>
                <ChevronLeft size={16} aria-hidden="true" />
                Back to archived batches
              </button>
              {canUndoSettleUp ? (
                <div className="split-archive-undo">
                  <p className="share-row-meta">Settled activity keeps its amounts. To correct one, undo the settle-up: this activity opens again and the settle-up stays as a payment.</p>
                  <button
                    type="button"
                    className="lsd-quiet split-archive-undo-action"
                    onClick={() => onUndoSettleUp(selectedArchivedBatch.batchId)}
                    disabled={isUndoingSettleUp}
                  >
                    {isUndoingSettleUp ? "Undoing..." : "Undo settle-up"}
                  </button>
                  {undoSettleUpError ? <p className="form-error" role="alert">{undoSettleUpError}</p> : null}
                </div>
              ) : null}
              <div className="split-archive-batch-detail">
                <SplitActivityGroups
                  groups={selectedArchivedBatch.groups}
                  categories={categories}
                  archived
                  onEditExpense={onEditExpense}
                  onEditSettlement={onEditSettlement}
                  onViewLinkedEntry={onViewLinkedEntry}
                />
              </div>
            </div>
          ) : (
            <div className="split-archive-dialog-body split-archive-list-dialog split-list-sheet-body" data-sheet-body>
              <div className="lsd-rows split-archive-rows">
              {archivedBatches.map((batch) => {
                const summary = splitService.getArchivedBatchSummary(batch, viewId);
                return (
                  <button key={batch.batchId} type="button" className="split-archive-row" onClick={() => onOpenBatch(batch.batchId)}>
                    <span className="split-archive-row-date">{splitService.formatArchiveDate(batch.closedAt)}</span>
                    <span className="split-archive-row-icon category-icon category-icon-static" style={{ "--category-color": "#BF7D51" }}>
                      <ArrowRightLeft size={16} />
                    </span>
                    <span className="split-archive-row-copy">
                      <strong>{summary.title}</strong>
                      <small>{summary.subtitle}</small>
                    </span>
                    <span className="split-archive-row-meta">{batch.items.length} {batch.items.length === 1 ? "entry" : "entries"}</span>
                    <ChevronRight size={16} aria-hidden="true" className="split-archive-row-chevron" />
                  </button>
                );
              })}
              </div>
            </div>
          )}
          <BottomActions className="is-sheet-bar split-list-sheet-actions" primaryLabel="Close" onPrimary={onClose} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
