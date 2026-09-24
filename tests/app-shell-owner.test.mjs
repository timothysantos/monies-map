import assert from "node:assert/strict";
import test from "node:test";

import { createAppShellOwner } from "../src/client/app-shell-owner.js";
import { APP_SYNC_STORAGE_KEY } from "../src/client/app-sync.js";
import { dispatchAppSyncEvent, parseAppSyncStorageEvent } from "../src/client/use-app-sync-subscription.js";

test("only the latest shell request may apply or fail", () => {
  const owner = createAppShellOwner();
  const notices = [];
  owner.subscribe(() => notices.push(owner.getSnapshot()));

  const slow = owner.begin();
  const fresh = owner.begin();
  assert.equal(owner.apply(fresh, { household: "new" }), true);
  assert.equal(owner.apply(slow, { household: "old" }), false);
  assert.equal(owner.fail(slow, "Shell exploded"), false);
  assert.deepEqual(owner.getSnapshot(), { shell: { household: "new" }, error: "" });
  assert.equal(notices.length, 1);
});

test("a warm start applies twice under one token; a failure clears the shell and shows the error", () => {
  const owner = createAppShellOwner();
  const token = owner.begin();
  assert.equal(owner.apply(token, { phase: "entries-shell" }), true);
  assert.equal(owner.apply(token, { phase: "full" }), true);
  assert.deepEqual(owner.getSnapshot().shell, { phase: "full" });
  assert.equal(owner.isLatest(token), true);

  const failing = owner.begin();
  assert.equal(owner.isLatest(token), false);
  assert.equal(owner.fail(failing, "Shell exploded"), true);
  assert.deepEqual(owner.getSnapshot(), { shell: null, error: "Shell exploded" });
  // A later success clears the error.
  const retry = owner.begin();
  owner.apply(retry, { household: "back" });
  assert.deepEqual(owner.getSnapshot(), { shell: { household: "back" }, error: "" });
});

test("a failure from a superseded request is marked so shared handlers can skip it", () => {
  const owner = createAppShellOwner();
  const old = owner.begin();
  const current = owner.begin();
  const staleFailure = owner.markIfSuperseded(old, new Error("slow and failed"));
  const currentFailure = owner.markIfSuperseded(current, new Error("current failed"));
  assert.equal(owner.isSuperseded(staleFailure), true);
  assert.equal(owner.isSuperseded(currentFailure), false);

  // Two callers joined to one query share one error: marking the stale
  // caller's failure must not hide it from the latest caller.
  const shared = new Error("shared query failed");
  const stale = owner.markIfSuperseded(old, shared);
  const latest = owner.markIfSuperseded(current, shared);
  assert.equal(owner.isSuperseded(stale), true);
  assert.equal(stale.cause, shared);
  assert.equal(latest, shared);
  assert.equal(owner.isSuperseded(latest), false);
  assert.equal(owner.isSuperseded(null), false);
  owner.failLatest("current failed");
  assert.deepEqual(owner.getSnapshot(), { shell: null, error: "current failed" });
});

test("storage events are read only for the app sync key with valid JSON", () => {
  assert.deepEqual(parseAppSyncStorageEvent({ key: APP_SYNC_STORAGE_KEY, newValue: JSON.stringify({ type: "app-shell-refresh" }) }), { type: "app-shell-refresh" });
  assert.equal(parseAppSyncStorageEvent({ key: "other", newValue: "{}" }), null);
  assert.equal(parseAppSyncStorageEvent({ key: APP_SYNC_STORAGE_KEY, newValue: null }), null);
  assert.equal(parseAppSyncStorageEvent({ key: APP_SYNC_STORAGE_KEY, newValue: "{not json" }), null);
});

test("each sync type reaches exactly its handler, with the shell refresh source", () => {
  const calls = [];
  const handlers = {
    onShellRefresh: (source) => calls.push(["shell", source]),
    onSplitMutation: (payload) => calls.push(["split", payload.month]),
    onEntryMutation: (payload) => calls.push(["entry", payload.month]),
    onSummaryMutation: (payload) => calls.push(["summary", payload.month])
  };
  assert.equal(dispatchAppSyncEvent({ type: "app-shell-refresh" }, "channel", handlers), true);
  assert.equal(dispatchAppSyncEvent({ type: "app-shell-refresh" }, "storage", handlers), true);
  dispatchAppSyncEvent({ type: "split-mutation", month: "2026-05" }, "channel", handlers);
  dispatchAppSyncEvent({ type: "entry-mutation", month: "2026-04" }, "storage", handlers);
  dispatchAppSyncEvent({ type: "summary-mutation", month: "2026-03" }, "channel", handlers);
  assert.equal(dispatchAppSyncEvent({ type: "unknown" }, "channel", handlers), false);
  assert.equal(dispatchAppSyncEvent(null, "channel", handlers), false);
  assert.deepEqual(calls, [
    ["shell", "channel"],
    ["shell", "storage"],
    ["split", "2026-05"],
    ["entry", "2026-04"],
    ["summary", "2026-03"]
  ]);
});
