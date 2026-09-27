import { InlineError } from "./ui-states";

export const SPLIT_SETTLEMENT_LOCKED = "split_settlement_locked";

// The settlement that refused a split or entry save, or null for any other
// failure: a simplified settlement (checkpointId) or a group settle-up
// (batchId). `recordKey` ties it to the form that showed it.
export function readSettlementLock(error, recordKey = "") {
  if (error?.code !== SPLIT_SETTLEMENT_LOCKED || (!error?.checkpointId && !error?.batchId)) {
    return null;
  }
  return {
    checkpointId: error.checkpointId ?? null,
    batchId: error.checkpointId ? null : error.batchId,
    message: error.message,
    recordKey,
    undone: false
  };
}

// The endpoint that releases the locked activity: Undo simplification
// reopens the checkpoint, Undo settle-up reopens the batch the settle-up
// closed.
export function settlementLockUndoRequest(lock) {
  return lock.checkpointId
    ? { url: "/api/splits/checkpoints/reopen", body: { checkpointId: lock.checkpointId }, failure: "Failed to undo the simplification." }
    : { url: "/api/splits/batches/reopen", body: { batchId: lock.batchId }, failure: "Failed to undo the settle-up." };
}

// Takes the place of a form's error line when a settlement refused the save:
// the server's explanation plus the one way forward, undoing that
// simplification or settle-up. After the undo it confirms that the change
// can be saved.
export function SettlementLockNotice({ lock, isUndoing = false, onUndo }) {
  if (!lock) {
    return null;
  }
  const isGroupSettleUp = !lock.checkpointId;
  if (lock.undone) {
    return (
      <p className="form-success settlement-lock-undone" role="status">
        {isGroupSettleUp ? "Settle-up undone." : "Simplification undone."} Its activity is open again, so you can save this change now.
      </p>
    );
  }
  return (
    <InlineError
      className="form-error settlement-lock-error"
      message={lock.message}
      retryLabel={isGroupSettleUp ? "Undo settle-up" : "Undo simplification"}
      retryingLabel="Undoing..."
      isRetrying={isUndoing}
      onRetry={onUndo}
    />
  );
}
