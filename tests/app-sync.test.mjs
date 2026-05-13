import assert from "node:assert/strict";
import test from "node:test";

import {
  APP_SYNC_CHANNEL,
  APP_SYNC_EVENT_TYPES,
  APP_SYNC_STORAGE_KEY,
  broadcastAppShellRefresh,
  buildSplitMutationSyncEvent,
  isMonthWithinRange,
  publishAppSyncEvent
} from "../src/client/app-sync.js";

test("app sync constants stay explicit and stable", () => {
  assert.equal(APP_SYNC_CHANNEL, "monies-map-app-sync");
  assert.equal(APP_SYNC_STORAGE_KEY, "monies-map-app-sync");
  assert.deepEqual(APP_SYNC_EVENT_TYPES, {
    appShellRefresh: "app-shell-refresh",
    entryMutation: "entry-mutation",
    splitMutation: "split-mutation"
  });
});

test("buildSplitMutationSyncEvent keeps split payloads narrow", () => {
  const event = buildSplitMutationSyncEvent({
    month: "2026-04",
    invalidateEntries: true,
    invalidateMonth: false,
    invalidateSummary: true,
    refreshShell: false
  });

  assert.equal(event.type, "split-mutation");
  assert.equal(event.month, "2026-04");
  assert.equal(event.invalidateEntries, true);
  assert.equal(event.invalidateMonth, false);
  assert.equal(event.invalidateSummary, true);
  assert.equal(event.refreshShell, false);
  assert.equal(typeof event.ts, "number");
});

test("isMonthWithinRange keeps range checks inclusive and bounded", () => {
  assert.equal(isMonthWithinRange("2026-04", "2026-01", "2026-04"), true);
  assert.equal(isMonthWithinRange("2025-12", "2026-01", "2026-04"), false);
  assert.equal(isMonthWithinRange("2026-05", "2026-01", "2026-04"), false);
  assert.equal(isMonthWithinRange(null, "2026-01", "2026-04"), false);
});

test("publishAppSyncEvent writes both broadcast and storage transport paths", () => {
  const originalWindow = globalThis.window;
  const posted = [];
  const stored = [];

  globalThis.window = {
    localStorage: {
      setItem(key, value) {
        stored.push([key, value]);
      }
    }
  };

  try {
    publishAppSyncEvent({
      current: {
        postMessage(payload) {
          posted.push(payload);
        }
      }
    }, { type: "app-shell-refresh", ts: 123 });
  } finally {
    globalThis.window = originalWindow;
  }

  assert.deepEqual(posted, [{ type: "app-shell-refresh", ts: 123 }]);
  assert.deepEqual(stored, [["monies-map-app-sync", JSON.stringify({ type: "app-shell-refresh", ts: 123 })]]);
});

test("broadcastAppShellRefresh emits the shell refresh event type", () => {
  const originalWindow = globalThis.window;
  const calls = [];

  globalThis.window = {
    localStorage: {
      setItem(key, value) {
        calls.push([key, value]);
      }
    }
  };

  try {
    broadcastAppShellRefresh({ current: null });
  } finally {
    globalThis.window = originalWindow;
  }

  assert.equal(calls.length, 1);
  const payload = JSON.parse(calls[0][1]);
  assert.equal(payload.type, APP_SYNC_EVENT_TYPES.appShellRefresh);
  assert.equal(typeof payload.ts, "number");
});
