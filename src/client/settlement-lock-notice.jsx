import { InlineError } from "./ui-states";

export const SPLIT_SETTLEMENT_LOCKED = "split_settlement_locked";

// The simplified settlement that refused a split or entry save, or null for
// any other failure. `recordKey` ties it to the form that showed it.
export function readSettlementLock(error, recordKey = "") {
  if (error?.code !== SPLIT_SETTLEMENT_LOCKED || !error?.checkpointId) {
    return null;
  }
  return { checkpointId: error.checkpointId, message: error.message, recordKey, undone: false };
}

// Takes the place of a form's error line when a simplified settlement refused
// the save: the server's explanation plus the one way forward, undoing that
// simplification. After the undo it confirms that the change can be saved.
export function SettlementLockNotice({ lock, isUndoing = false, onUndo }) {
  if (!lock) {
    return null;
  }
  if (lock.undone) {
    return (
      <p className="form-success settlement-lock-undone" role="status">
        Simplification undone. Its activity is open again, so you can save this change now.
      </p>
    );
  }
  return (
    <InlineError
      className="form-error settlement-lock-error"
      message={lock.message}
      retryLabel="Undo simplification"
      retryingLabel="Undoing..."
      isRetrying={isUndoing}
      onRetry={onUndo}
    />
  );
}
