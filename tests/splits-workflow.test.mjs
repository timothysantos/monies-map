import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLinkedSplitRefreshOptions,
  buildSplitArchiveRefreshPlan,
  createSplitRefreshGuard
} from "../src/client/splits-workflow.js";

test("linked split refreshes stay narrow until a ledger transaction exists", () => {
  assert.deepEqual(buildLinkedSplitRefreshOptions(null), {
    broadcast: true,
    invalidateEntries: false,
    invalidateMonth: false,
    invalidateSummary: false
  });

  assert.deepEqual(buildLinkedSplitRefreshOptions("txn-123"), {
    broadcast: true,
    invalidateEntries: true,
    invalidateMonth: true,
    invalidateSummary: true
  });
});

test("archive refresh plan keeps the exception explicit and named", () => {
  assert.deepEqual(buildSplitArchiveRefreshPlan(), {
    refreshShell: true,
    reason: "archive content still rides the main splits page payload"
  });
});

test("split refresh guards only clear the latest in-flight refresh", () => {
  const guard = createSplitRefreshGuard();

  const first = guard.next();
  const second = guard.next();

  assert.equal(guard.isCurrent(first), false);
  assert.equal(guard.isCurrent(second), true);
});
