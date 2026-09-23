import assert from "node:assert/strict";
import test from "node:test";

import { evaluateWarmup, selectWarmupCandidates } from "../src/client/route-warmup-policy.js";
import { createRouteWarmupScheduler } from "../src/client/route-warmup-scheduler.js";

// Deterministic time: advance() runs every timer due at or before the target,
// including timers scheduled while advancing (idle callbacks run as 0 ms timers).
function createFakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(callback, delay) {
      const id = nextId++;
      timers.set(id, { at: now + delay, callback });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    pending: () => timers.size,
    async advanceTo(target) {
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);
        if (!due.length) break;
        const [id, timer] = due[0];
        timers.delete(id);
        now = timer.at;
        timer.callback();
        await Promise.resolve();
      }
      now = target;
      await flush();
    }
  };
}

async function flush() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const identity = (tabId, viewId = "person-tim") => ({ tabId, viewId, month: "2026-05", scope: "direct_plus_shared", summaryStart: "", summaryEnd: "" });

// A host with mutable inputs, like the React hook: tests change fields and
// call updateContext, exactly as the hook does on each input change.
function createHost({ mode = "mobile", costs = { entries: 40_000, month: 30_000, summary: 20_000, splits: 30_000 } } = {}) {
  const clock = createFakeClock();
  const loads = [];
  const loadDeferreds = new Map();
  const loaded = new Set();
  const state = {
    mode,
    page: { visible: true, online: true, saveData: false, effectiveType: null },
    work: { ready: true, busy: false, requiredCount: 0 },
    quietSince: 0,
    warmupMode: undefined,
    identity: identity("summary"),
    costs
  };
  const scheduler = createRouteWarmupScheduler({
    clock,
    idle: {
      request: (callback) => clock.setTimeout(callback, 0),
      cancel: (handle) => clock.clearTimeout(handle)
    },
    loadModule(routeId) {
      loads.push({ routeId, at: clock.now() });
      const handle = deferred();
      loadDeferreds.set(routeId, handle);
      return handle.promise.then((module) => {
        loaded.add(routeId);
        return module;
      });
    },
    readInput: () => ({
      mode: state.mode,
      page: state.page,
      work: state.work,
      quietSince: state.quietSince,
      recentRequiredDurationMs: null,
      warmupMode: state.warmupMode
    }),
    evaluate: evaluateWarmup,
    selectCandidates: () => selectWarmupCandidates({ mode: state.mode, identity: state.identity }),
    costFor: (routeId) => ({
      alreadyLoaded: loaded.has(routeId),
      pending: false,
      missingBytes: state.costs[routeId] ?? null
    })
  });
  const visitKey = () => `${state.identity.tabId}|${state.identity.viewId}|${state.identity.month}`;
  return {
    clock,
    loads,
    loaded,
    state,
    scheduler,
    update: (options = {}) => scheduler.updateContext({ visitKey: visitKey(), ...options }),
    resolve: async (routeId) => { loadDeferreds.get(routeId).resolve({ routeId }); await flush(); },
    reject: async (routeId) => { loadDeferreds.get(routeId).reject(new Error("chunk failed")); await flush(); }
  };
}

test("W01: mobile usable at t=0 loads one module at 2,000 ms, not at 1,999 ms, and no data", async () => {
  const host = createHost();
  host.update();
  await host.clock.advanceTo(1_999);
  assert.deepEqual(host.loads, []);
  await host.clock.advanceTo(2_000);
  assert.deepEqual(host.loads, [{ routeId: "entries", at: 2_000 }]);
  await host.clock.advanceTo(30_000);
  assert.equal(host.loads.length, 1, "one automatic module per visit, and code-only");
});

test("W02: an editor opening at 1,999 ms blocks the start; closing it starts a full new quiet interval", async () => {
  const host = createHost();
  host.update();
  await host.clock.advanceTo(1_999);
  host.state.work = { ...host.state.work, busy: true };
  host.update();
  await host.clock.advanceTo(2_000);
  assert.deepEqual(host.loads, []);
  await host.clock.advanceTo(3_000);
  host.state.work = { ...host.state.work, busy: false };
  host.state.quietSince = 3_000;
  host.update();
  await host.clock.advanceTo(4_999);
  assert.deepEqual(host.loads, []);
  await host.clock.advanceTo(5_000);
  assert.deepEqual(host.loads, [{ routeId: "entries", at: 5_000 }]);
});

test("W03: a 50,001-byte module is not warmed automatically, but pointer-down loads it once", async () => {
  const host = createHost({ costs: { entries: 50_001 } });
  host.update();
  await host.clock.advanceTo(10_000);
  assert.deepEqual(host.loads, []);
  assert.deepEqual(host.scheduler.offerIntent({ routeId: "entries", trigger: "pointerdown" }), { allowed: true, reason: "ok" });
  assert.deepEqual(host.loads, [{ routeId: "entries", at: 10_000 }], "import starts synchronously on pointer-down");
});

test("W04 (unit part): save-data blocks automatic and intent warmup", async () => {
  const host = createHost();
  host.state.page = { ...host.state.page, saveData: true };
  host.update();
  await host.clock.advanceTo(10_000);
  assert.equal(host.scheduler.offerIntent({ routeId: "entries", trigger: "pointerdown" }).reason, "save-data");
  assert.deepEqual(host.loads, []);
});

test("W05: a failed automatic load keeps its slot spent and is not retried; a later explicit load can retry", async () => {
  const host = createHost();
  host.update();
  await host.clock.advanceTo(2_000);
  await host.reject("entries");
  assert.equal(host.scheduler.inspect().visit.moduleStarts, 1);
  assert.equal(host.scheduler.inspect().moduleInFlight, false);
  host.update();
  await host.clock.advanceTo(20_000);
  assert.equal(host.loads.length, 1, "no automatic retry in the same visit");
  host.scheduler.offerIntent({ routeId: "entries", trigger: "focus" });
  assert.equal(host.loads.length, 2, "not stuck as pending after the failure");
});

test("W06: two automatic starts in 60 s block a third until the oldest is exactly 60,000 ms old", async () => {
  const host = createHost();
  const visitAt = async (tabId, at) => {
    host.state.identity = identity(tabId);
    host.state.quietSince = at - 2_000;
    await host.clock.advanceTo(at - 1);
    host.update();
    await host.clock.advanceTo(at);
  };
  await visitAt("summary", 2_000);
  await host.resolve("entries");
  host.loaded.delete("entries");
  await visitAt("month", 12_000);
  await host.resolve("entries");
  host.loaded.delete("entries");
  assert.deepEqual(host.loads.map((load) => load.at), [2_000, 12_000]);
  await visitAt("summary", 61_999);
  assert.equal(host.loads.length, 2, "third start denied while two starts are inside the window");
  await visitAt("month", 62_000);
  assert.deepEqual(host.loads.map((load) => load.at), [2_000, 12_000, 62_000]);
});

test("W07: repeated pointer and focus intent for a pending module calls the loader once", async () => {
  const host = createHost();
  host.update();
  host.scheduler.offerIntent({ routeId: "month", trigger: "pointerdown" });
  assert.equal(host.scheduler.offerIntent({ routeId: "month", trigger: "focus" }).reason, "already-pending");
  host.scheduler.offerIntent({ routeId: "month", trigger: "pointerdown" });
  assert.deepEqual(host.loads.map((load) => load.routeId), ["month"]);
  await host.resolve("month");
  assert.equal(host.scheduler.offerIntent({ routeId: "month", trigger: "focus" }).reason, "already-loaded");
});

test("W08: switching routes before the timer fires cancels the old candidate", async () => {
  const host = createHost();
  host.update();
  await host.clock.advanceTo(1_000);
  host.state.identity = identity("entries");
  host.state.quietSince = 1_000;
  host.update();
  await host.clock.advanceTo(10_000);
  assert.deepEqual(host.loads, [], "Entries has no automatic mobile candidate, and Summary's was cancelled");
  assert.equal(host.clock.pending(), 0);
});

test("W09: an import that resolves after a route change stays reusable and starts nothing", async () => {
  const host = createHost();
  host.update();
  await host.clock.advanceTo(2_000);
  assert.equal(host.loads.length, 1);
  host.state.identity = identity("splits");
  host.state.quietSince = 2_500;
  await host.clock.advanceTo(2_500);
  host.update();
  await host.resolve("entries");
  await host.clock.advanceTo(30_000);
  assert.equal(host.loads.length, 1);
  assert.equal(host.loaded.has("entries"), true);
  assert.equal(host.scheduler.inspect().moduleInFlight, false);
});

test("W16: hide and resume three times keeps the visit budget and never bursts", async () => {
  const host = createHost();
  host.update();
  await host.clock.advanceTo(2_000);
  await host.resolve("entries");
  host.loaded.delete("entries");
  for (let round = 0; round < 3; round += 1) {
    host.state.page = { ...host.state.page, visible: false };
    host.update();
    await host.clock.advanceTo(host.clock.now() + 5_000);
    host.state.page = { ...host.state.page, visible: true };
    host.state.quietSince = host.clock.now();
    host.update();
    await host.clock.advanceTo(host.clock.now() + 5_000);
  }
  assert.equal(host.loads.length, 1);
  assert.equal(host.scheduler.inspect().visit.moduleStarts, 1);
});

test("W17: rerenders with the same visit keep one timer and do not reset the budget", async () => {
  const host = createHost();
  host.update();
  for (let i = 0; i < 20; i += 1) host.update();
  assert.equal(host.clock.pending(), 1);
  await host.clock.advanceTo(2_000);
  await host.resolve("entries");
  host.loaded.delete("entries");
  for (let i = 0; i < 20; i += 1) host.update();
  await host.clock.advanceTo(20_000);
  assert.equal(host.loads.length, 1);
});

test("a query epoch change starts a new generation without refilling the visit budget", async () => {
  const host = createHost();
  host.update();
  await host.clock.advanceTo(1_000);
  const before = host.scheduler.inspect().generation;
  host.update({ newGeneration: true });
  assert.equal(host.scheduler.inspect().generation, before + 1);
  await host.clock.advanceTo(2_000);
  assert.equal(host.loads.length, 1);
  host.update({ newGeneration: true });
  await host.clock.advanceTo(20_000);
  assert.equal(host.loads.length, 1);
});

test("W20: dispose clears timers, and a pending import resolving later enqueues nothing", async () => {
  const host = createHost();
  host.update();
  await host.clock.advanceTo(2_000);
  host.scheduler.dispose();
  assert.equal(host.clock.pending(), 0);
  await host.resolve("entries");
  host.update();
  assert.equal(host.scheduler.offerIntent({ routeId: "month", trigger: "pointerdown" }).reason, "disposed");
  await host.clock.advanceTo(30_000);
  assert.equal(host.loads.length, 1);
  assert.equal(host.clock.pending(), 0);
});

test("StrictMode-like create, dispose, create leaves exactly one live timer", async () => {
  const first = createHost();
  first.update();
  first.scheduler.dispose();
  assert.equal(first.clock.pending(), 0);
  const second = createHost();
  second.update();
  assert.equal(second.clock.pending(), 1);
});

test("intent replaces the pending automatic guess for the current visit", async () => {
  const host = createHost();
  host.update();
  await host.clock.advanceTo(500);
  host.scheduler.offerIntent({ routeId: "month", trigger: "pointerdown" });
  await host.clock.advanceTo(10_000);
  assert.deepEqual(host.loads.map((load) => load.routeId), ["month"]);
  assert.equal(host.scheduler.inspect().visit.moduleStarts, 0, "intent is not charged to the automatic budget");
});

test("an already-loaded candidate is skipped without spending the slot", async () => {
  const host = createHost({ mode: "desktop" });
  host.loaded.add("entries");
  host.update();
  await host.clock.advanceTo(1_200);
  assert.deepEqual(host.loads, []);
  assert.equal(host.scheduler.inspect().visit.moduleStarts, 0);
});

test("unknown module cost blocks automatic mobile warmup but not desktop", async () => {
  const mobile = createHost({ costs: {} });
  mobile.update();
  await mobile.clock.advanceTo(10_000);
  assert.deepEqual(mobile.loads, []);
  const desktop = createHost({ mode: "desktop", costs: {} });
  desktop.update();
  await desktop.clock.advanceTo(1_199);
  assert.deepEqual(desktop.loads, []);
  await desktop.clock.advanceTo(1_200);
  assert.deepEqual(desktop.loads, [{ routeId: "entries", at: 1_200 }]);
});

test("warmup mode overrides: intent-only keeps link intent, off disables everything", async () => {
  const intentOnly = createHost();
  intentOnly.state.warmupMode = "intent-only";
  intentOnly.update();
  await intentOnly.clock.advanceTo(10_000);
  assert.deepEqual(intentOnly.loads, []);
  assert.equal(intentOnly.scheduler.offerIntent({ routeId: "month", trigger: "pointerdown" }).allowed, true);
  const off = createHost();
  off.state.warmupMode = "off";
  off.update();
  await off.clock.advanceTo(10_000);
  assert.equal(off.scheduler.offerIntent({ routeId: "month", trigger: "pointerdown" }).reason, "warmup-off");
  assert.deepEqual(off.loads, []);
});

test("a synchronous loader throw is contained and the route is not left pending", async () => {
  const clock = createFakeClock();
  let calls = 0;
  const scheduler = createRouteWarmupScheduler({
    clock,
    idle: { request: (callback) => clock.setTimeout(callback, 0), cancel: (handle) => clock.clearTimeout(handle) },
    loadModule: () => { calls += 1; throw new Error("boom"); },
    readInput: () => ({ mode: "desktop", page: { visible: true, online: true, saveData: false, effectiveType: null }, work: { ready: true, busy: false, requiredCount: 0 }, quietSince: 0 }),
    evaluate: evaluateWarmup,
    selectCandidates: () => [],
    costFor: () => ({ alreadyLoaded: false, pending: false, missingBytes: 1 })
  });
  assert.equal(scheduler.offerIntent({ routeId: "month", trigger: "focus" }).allowed, true);
  await flush();
  assert.deepEqual(scheduler.inspect().pendingRoutes, []);
  scheduler.offerIntent({ routeId: "month", trigger: "focus" });
  assert.equal(calls, 2);
});

test("a quiet period still running at idle time retries no sooner than 250 ms (never a busy loop)", async () => {
  const clock = createFakeClock();
  let quietSince = 0;
  let evaluations = 0;
  const scheduler = createRouteWarmupScheduler({
    clock,
    idle: { request: (callback) => clock.setTimeout(callback, 0), cancel: (handle) => clock.clearTimeout(handle) },
    loadModule: () => Promise.resolve({}),
    readInput: () => ({ mode: "desktop", page: { visible: true, online: true, saveData: false, effectiveType: null }, work: { ready: true, busy: false, requiredCount: 0 }, quietSince }),
    // A policy that disagrees with the scheduler's quiet window.
    evaluate: () => { evaluations += 1; return { allowed: false, reason: "quiet-period" }; },
    selectCandidates: () => [{ kind: "module", routeId: "entries" }],
    costFor: () => ({ alreadyLoaded: false, pending: false, missingBytes: 1 })
  });
  scheduler.updateContext({ visitKey: "summary" });
  await clock.advanceTo(1_200);
  assert.equal(evaluations, 1);
  await clock.advanceTo(1_449);
  assert.equal(evaluations, 1);
  await clock.advanceTo(1_450);
  assert.equal(evaluations, 2);
  scheduler.dispose();
});

test("the warmup override is read when the timer fires, not only when it is armed", async () => {
  const host = createHost();
  host.update();
  await host.clock.advanceTo(1_000);
  host.state.warmupMode = "intent-only";
  await host.clock.advanceTo(10_000);
  assert.deepEqual(host.loads, []);
});
