import { formatDayMonthYear } from "./copy/ask-copy";

// A split expense that is settled (in a simplified settlement or a closed
// group settle-up) opens its card read-only, with a short reason and the
// Undo button under it. The server still refuses a change to a settled
// split (split_settlement_locked), so a stale page cannot change one.

// A batch grouped without a stored id (older rows) cannot be reopened.
const FALLBACK_BATCH_PREFIX = "split-batch-fallback-";

// The lock of a split activity item, in the shape SettlementLockNotice and
// undoSettlementLock read, or null when the split is open. `recordKey` ties
// it to the card that shows it; `canUndo` is false for a batch that cannot
// be reopened.
export function splitCardLock(item, checkpoints = [], recordKey = `expense:${item?.id}`) {
  if (!item || item.kind !== "expense") {
    return null;
  }
  if (item.settlementCheckpointId) {
    const settlementDate = checkpoints.find((checkpoint) => checkpoint.id === item.settlementCheckpointId)?.settlementDate;
    const day = formatDayMonthYear(settlementDate);
    return {
      checkpointId: item.settlementCheckpointId,
      batchId: null,
      message: `${day ? `Simplified on ${day}` : "Simplified"}. Undo the simplification to change it.`,
      recordKey,
      undone: false,
      canUndo: true
    };
  }
  if (item.isArchived && item.batchId) {
    const day = formatDayMonthYear(String(item.batchClosedAt ?? "").slice(0, 10));
    return {
      checkpointId: null,
      batchId: item.batchId,
      message: `${day ? `Settled on ${day}` : "Settled"}. Undo the settle-up to change it.`,
      recordKey,
      undone: false,
      canUndo: !item.batchId.startsWith(FALLBACK_BATCH_PREFIX)
    };
  }
  return null;
}
