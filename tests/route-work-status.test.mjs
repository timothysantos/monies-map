import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRouteIdentity,
  buildRouteWorkKey,
  createRequiredWorkCounter,
  createRouteWorkRegistry,
  deriveRouteWork,
  withRequiredWork
} from "../src/client/route-work-status.js";

const summaryKey = buildRouteWorkKey(buildRouteIdentity({
  tabId: "summary", viewId: "household", month: "2026-05", scope: "direct_plus_shared", summaryStart: "2025-06", summaryEnd: "2026-05"
}));
const entriesKey = buildRouteWorkKey(buildRouteIdentity({
  tabId: "entries", viewId: "household", month: "2026-05", scope: "direct_plus_shared"
}));

test("route work keys include every data-relevant route field", () => {
  assert.equal(summaryKey, "summary|household|2026-05|direct_plus_shared|2025-06|2026-05");
  assert.equal(entriesKey, "entries|household|2026-05|direct_plus_shared||");
  const tim = buildRouteWorkKey(buildRouteIdentity({ tabId: "entries", viewId: "person-tim", month: "2026-05", scope: "direct_plus_shared" }));
  const april = buildRouteWorkKey(buildRouteIdentity({ tabId: "entries", viewId: "household", month: "2026-04", scope: "direct_plus_shared" }));
  const direct = buildRouteWorkKey(buildRouteIdentity({ tabId: "entries", viewId: "household", month: "2026-05", scope: "direct" }));
  assert.equal(new Set([entriesKey, tim, april, direct]).size, 4);
});

test("route identity ignores fields a route does not use and has no cosmetic inputs", () => {
  const settings = buildRouteIdentity({ tabId: "settings", viewId: "person-tim", month: "2026-05", scope: "direct", summaryStart: "2025-01" });
  assert.deepEqual({ ...settings }, { tabId: "settings", viewId: "", month: "", scope: "", summaryStart: "", summaryEnd: "" });
  assert.equal(Object.isFrozen(settings), true);
  const withFocus = buildRouteIdentity({ tabId: "summary", viewId: "household", month: "2026-05", scope: "direct_plus_shared", summaryStart: "2025-06", summaryEnd: "2026-05", summaryFocus: "overall" });
  assert.equal(buildRouteWorkKey(withFocus), summaryKey);
  const implicit = buildRouteIdentity({ tabId: "summary", viewId: "household", month: "2026-05", scope: "direct_plus_shared" });
  assert.equal(buildRouteWorkKey(implicit), "summary|household|2026-05|direct_plus_shared||");
});

test("a route with no report is never ready", () => {
  const registry = createRouteWorkRegistry();
  assert.deepEqual(registry.snapshot(summaryKey), { hasReport: false, ready: false, busy: false, busyOwnerIds: [] });
});

test("every owner reporting for the key must be ready", () => {
  const registry = createRouteWorkRegistry();
  registry.report({ ownerId: "panel", routeKey: entriesKey, ready: true, busy: false });
  registry.report({ ownerId: "list", routeKey: entriesKey, ready: false, busy: false });
  assert.equal(registry.snapshot(entriesKey).ready, false);
  registry.report({ ownerId: "list", routeKey: entriesKey, ready: true, busy: false });
  assert.equal(registry.snapshot(entriesKey).ready, true);
});

test("one idle owner cannot clear another owner's busy state; release clears only its owner", () => {
  const registry = createRouteWorkRegistry();
  registry.report({ ownerId: "editor", routeKey: entriesKey, ready: true, busy: true });
  registry.report({ ownerId: "panel", routeKey: entriesKey, ready: true, busy: false });
  assert.deepEqual(registry.snapshot(entriesKey).busyOwnerIds, ["editor"]);
  assert.equal(registry.release("panel"), true);
  assert.equal(registry.snapshot(entriesKey).busy, true);
  assert.equal(registry.release("editor"), true);
  assert.equal(registry.snapshot(entriesKey).busy, false);
  assert.equal(registry.release("unknown"), false);
});

test("a stale report for the previous route cannot make the new route ready, but its busy state still blocks", () => {
  const registry = createRouteWorkRegistry();
  registry.report({ ownerId: "summary-panel", routeKey: summaryKey, ready: true, busy: true });
  assert.deepEqual(registry.snapshot(entriesKey), { hasReport: false, ready: false, busy: true, busyOwnerIds: ["summary-panel"] });
});

test("identical reports do not notify; StrictMode report/release/report ends reported", () => {
  const registry = createRouteWorkRegistry();
  let notifications = 0;
  const unsubscribe = registry.subscribe(() => { notifications += 1; });
  assert.equal(registry.report({ ownerId: "a", routeKey: entriesKey, ready: true, busy: false }), true);
  assert.equal(registry.report({ ownerId: "a", routeKey: entriesKey, ready: true, busy: false }), false);
  registry.release("a");
  registry.report({ ownerId: "a", routeKey: entriesKey, ready: true, busy: false });
  assert.equal(notifications, 3);
  assert.equal(registry.version(), 3);
  assert.equal(registry.snapshot(entriesKey).ready, true);
  unsubscribe();
  registry.release("a");
  assert.equal(notifications, 3);
});

test("required work counter is nested, idempotent, and ends on failure", async () => {
  const counter = createRequiredWorkCounter();
  const endA = counter.begin("month refresh");
  const endB = counter.begin("summary refresh");
  assert.equal(counter.count(), 2);
  endA();
  endA();
  assert.equal(counter.count(), 1);
  assert.deepEqual(counter.labels(), ["summary refresh"]);
  endB();
  await assert.rejects(withRequiredWork(counter, "failing", async () => {
    assert.equal(counter.count(), 1);
    throw new Error("save failed");
  }), /save failed/);
  assert.equal(counter.count(), 0);
  assert.equal(await withRequiredWork(counter, "ok", async () => 42), 42);
});

const usableInput = {
  routeKey: entriesKey,
  hasPageView: true,
  isAppShellLoading: false,
  hasShellError: false,
  hasRouteError: false,
  hasReferenceData: true,
  routeDataReady: true,
  snapshot: { hasReport: true, ready: true, busy: false, busyOwnerIds: [] },
  requiredCount: 0,
  mobileContextOpen: false,
  loginRegistrationBlocking: false
};

test("route work is usable only when every gate passes", () => {
  assert.deepEqual(deriveRouteWork(usableInput), {
    routeKey: entriesKey, ready: true, busy: false, requiredCount: 0, usable: true, reason: "usable"
  });
});

for (const [reason, patch, expected] of [
  ["no-page-view", { hasPageView: false }, { ready: false, busy: false }],
  ["shell-loading", { isAppShellLoading: true }, { ready: false, busy: false }],
  ["shell-error", { hasShellError: true }, { ready: false, busy: false }],
  ["route-error", { hasRouteError: true }, { ready: false, busy: false }],
  ["no-reference-data", { hasReferenceData: false }, { ready: false, busy: false }],
  ["route-data-pending", { routeDataReady: false }, { ready: false, busy: false }],
  ["no-report", { snapshot: { hasReport: false, ready: false, busy: false, busyOwnerIds: [] } }, { ready: false, busy: false }],
  ["not-ready", { snapshot: { hasReport: true, ready: false, busy: false, busyOwnerIds: [] } }, { ready: false, busy: false }],
  ["mobile-context-open", { mobileContextOpen: true }, { ready: true, busy: true }],
  ["login-registration", { loginRegistrationBlocking: true }, { ready: true, busy: true }],
  ["busy", { snapshot: { hasReport: true, ready: true, busy: true, busyOwnerIds: ["editor"] } }, { ready: true, busy: true }],
  ["required-work", { requiredCount: 1 }, { ready: true, busy: false }]
]) {
  test(`route work reports ${reason}`, () => {
    const result = deriveRouteWork({ ...usableInput, ...patch });
    assert.equal(result.reason, reason);
    assert.equal(result.ready, expected.ready);
    assert.equal(result.busy, expected.busy);
    assert.equal(result.usable, false);
  });
}

test("ready reasons take precedence over busy reasons", () => {
  const result = deriveRouteWork({ ...usableInput, isAppShellLoading: true, mobileContextOpen: true, requiredCount: 2 });
  assert.equal(result.reason, "shell-loading");
  assert.equal(result.busy, true);
  assert.equal(result.requiredCount, 2);
});
