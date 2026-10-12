import assert from "node:assert/strict";
import test from "node:test";

import { splitCardLock } from "../src/client/split-card-lock.js";

const checkpoints = [{ id: "cp-1", settlementDate: "2026-05-20" }];

test("a split in a simplified settlement locks with the settlement date and an Undo simplification target", () => {
  const lock = splitCardLock({ kind: "expense", id: "e1", settlementCheckpointId: "cp-1", isArchived: true, batchId: "b1" }, checkpoints);
  assert.deepEqual(lock, {
    checkpointId: "cp-1",
    batchId: null,
    message: "This split expense is part of the simplified settlement of 2026-05-20. Undo the simplification before changing it, so the settled amount still matches its activity.",
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
  assert.equal(lock.message, "This split expense is part of the Trip settle-up of 2026-05-17. Undo the settle-up before changing it, so the settled amount still matches its activity.");
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
