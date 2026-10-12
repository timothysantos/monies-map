import assert from "node:assert/strict";
import test from "node:test";

import { splitCardLock } from "../src/client/split-card-lock.js";

const checkpoints = [{ id: "cp-1", settlementDate: "2026-05-20" }];

test("a split in a simplified settlement locks with the settlement date and an Undo simplification target", () => {
  const lock = splitCardLock({ kind: "expense", id: "e1", settlementCheckpointId: "cp-1", isArchived: true, batchId: "b1" }, checkpoints);
  assert.deepEqual(lock, {
    checkpointId: "cp-1",
    batchId: null,
    message: "Simplified on 20 May 2026. Undo the simplification to change it.",
    recordKey: "expense:e1",
    undone: false,
    canUndo: true
  });
});

test("a split in a closed group batch locks with the group and the day it was settled", () => {
  const lock = splitCardLock({ kind: "expense", id: "e2", isArchived: true, batchId: "batch-9", batchClosedAt: "2026-05-17", groupName: "Trip" });
  assert.equal(lock.batchId, "batch-9");
  assert.equal(lock.checkpointId, null);
  assert.equal(lock.canUndo, true);
  assert.equal(lock.message, "Settled on 17 May 2026. Undo the settle-up to change it.");
});

test("an older batch without a stored id has no Undo", () => {
  const lock = splitCardLock({ kind: "expense", id: "e3", isArchived: true, batchId: "split-batch-fallback-1", batchClosedAt: "2026-05-17" });
  assert.equal(lock.canUndo, false);
});

test("an open split, a settlement row and a missing item are not locked", () => {
  assert.equal(splitCardLock({ kind: "expense", id: "e4", isArchived: false }, checkpoints), null);
  assert.equal(splitCardLock({ kind: "settlement", id: "s1", settlementCheckpointId: "cp-1" }, checkpoints), null);
  assert.equal(splitCardLock(undefined, checkpoints), null);
});

test("a September date reads Sep, and the record key follows the card that shows it", () => {
  const lock = splitCardLock({ kind: "expense", id: "e5", isArchived: true, batchId: "b2", batchClosedAt: "2026-09-03" }, [], "inline:expense:e5");
  assert.equal(lock.message, "Settled on 3 Sep 2026. Undo the settle-up to change it.");
  assert.equal(lock.recordKey, "inline:expense:e5");
});
