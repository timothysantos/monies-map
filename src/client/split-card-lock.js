// A split expense that is settled (in a simplified settlement or a closed
// group settle-up) opens its card read-only, with the reason and the Undo
// button. The reason is the server's own lock sentence for a refused save
// (split-settlement-lock.ts, buildSplitSettlementLockedMessage) worded for
// "changing it" in general, so what a refusal says and what the card says
// match. The server still refuses a change to a settled split.
const REASON = "so the settled amount still matches its activity";

// A batch grouped without a stored id (older rows) cannot be reopened.
const FALLBACK_BATCH_PREFIX = "split-batch-fallback-";

// The lock of a split activity item, in the shape SettlementLockNotice and
// undoSettlementLock read, or null when the split is open. `canUndo` is
// false for a batch that cannot be reopened.
export function splitCardLock(item, checkpoints = []) {
  if (!item || item.kind !== "expense") {
    return null;
  }
  const recordKey = `expense:${item.id}`;
  if (item.settlementCheckpointId) {
    const settlementDate = checkpoints.find((checkpoint) => checkpoint.id === item.settlementCheckpointId)?.settlementDate;
    const settlement = settlementDate ? `simplified settlement of ${settlementDate}` : "simplified settlement";
    return {
      checkpointId: item.settlementCheckpointId,
      batchId: null,
      message: `This split expense is part of the ${settlement}. Undo the simplification before changing it, ${REASON}.`,
      recordKey,
      undone: false,
      canUndo: true
    };
  }
  if (item.isArchived && item.batchId) {
    const closedOn = String(item.batchClosedAt ?? "").slice(0, 10);
    const settleUp = `${item.groupName || "Non-group expenses"} settle-up${closedOn ? ` of ${closedOn}` : ""}`;
    return {
      checkpointId: null,
      batchId: item.batchId,
      message: `This split expense is part of the ${settleUp}. Undo the settle-up before changing it, ${REASON}.`,
      recordKey,
      undone: false,
      canUndo: !item.batchId.startsWith(FALLBACK_BATCH_PREFIX)
    };
  }
  return null;
}
