import assert from "node:assert/strict";
import test from "node:test";

import { QueryClient } from "@tanstack/react-query";

import { createRouteDataOwner } from "../src/client/route-data-owner.js";

function setup() {
  const calls = [];
  const fetchPage = (request, options) => new Promise((resolve, reject) => calls.push({ request, options, resolve, reject }));
  let cleared = 0;
  const queryClient = new QueryClient();
  const owner = createRouteDataOwner({
    queryClient,
    onCacheCleared: () => { cleared += 1; },
    requestKeyOf: (request) => `${request.path}?${request.month}`
  });
  return { queryClient, owner, calls, fetchPage, cleared: () => cleared };
}

const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};
const month = (value) => ({ path: "/api/month-page", month: value });
const dto = (label) => ({ monthPage: { label } });

test("a load applies the page with its request key", async () => {
  const { owner, calls, fetchPage } = setup();
  const load = owner.load({ request: month("2026-05"), fetchPage });
  await flush();
  calls[0].resolve(dto("may"));
  assert.equal(await load, true);
  assert.deepEqual(owner.getSnapshot(), { data: dto("may"), requestKey: "/api/month-page?2026-05" });
});

test("navigating during a background refresh: the late refresh never replaces the new page", async () => {
  const { owner, calls, fetchPage } = setup();
  const refresh = owner.refresh({ request: month("2026-05"), run: () => Promise.all([fetchPage(month("2026-05"), { bypassCache: true })]) });
  await flush();
  const load = owner.load({ request: month("2026-04"), fetchPage });
  await flush();
  calls[1].resolve(dto("april"));
  assert.equal(await load, true);
  calls[0].resolve(dto("may-refreshed"));
  assert.equal(await refresh, null);
  assert.deepEqual(owner.getSnapshot(), { data: dto("april"), requestKey: "/api/month-page?2026-04" });
});

test("two rapid mutation refreshes: the first is superseded quietly, the second applies", async () => {
  const { owner, calls, fetchPage } = setup();
  const run = () => Promise.all([fetchPage(month("2026-05"), { bypassCache: true }), Promise.resolve("side work")]);
  const first = owner.refresh({ request: month("2026-05"), run });
  await flush();
  const second = owner.refresh({ request: month("2026-05"), run });
  await flush();
  calls[0].reject(new Error("CancelledError"));
  calls[1].resolve(dto("second"));
  assert.equal(await first, null);
  assert.deepEqual(await second, [dto("second"), "side work"]);
  assert.deepEqual(owner.getSnapshot().data, dto("second"));
});

test("a refresh that must not apply (Settings refreshed from another tab) returns its result only", async () => {
  const { owner, calls, fetchPage } = setup();
  const load = owner.load({ request: month("2026-05"), fetchPage });
  await flush();
  calls[0].resolve(dto("month"));
  await load;
  const settings = { path: "/api/settings-page", month: "" };
  const refresh = owner.refresh({ request: settings, run: () => Promise.all([fetchPage(settings, {})]), apply: false });
  await flush();
  calls[1].resolve({ settingsPage: {} });
  assert.deepEqual(await refresh, [{ settingsPage: {} }]);
  assert.deepEqual(owner.getSnapshot().data, dto("month"));

  // Nor does it supersede a load of the route that is open.
  const monthLoad = owner.load({ request: month("2026-04"), fetchPage });
  await flush();
  const hidden = owner.refresh({ request: settings, run: () => Promise.resolve([{ settingsPage: {} }]), apply: false });
  await hidden;
  calls[2].resolve(dto("april"));
  assert.equal(await monthLoad, true);
  assert.deepEqual(owner.getSnapshot().data, dto("april"));
});

test("a failed latest load clears the page and rethrows; aborted and superseded loads change nothing", async () => {
  const { owner, calls, fetchPage } = setup();
  const first = owner.load({ request: month("2026-05"), fetchPage });
  await flush();
  calls[0].resolve(dto("may"));
  await first;

  const controller = new AbortController();
  const aborted = owner.load({ request: month("2026-04"), fetchPage, signal: controller.signal });
  await flush();
  controller.abort();
  calls[1].reject(new DOMException("aborted", "AbortError"));
  assert.equal(await aborted, false);
  assert.deepEqual(owner.getSnapshot().data, dto("may"));

  const failing = owner.load({ request: month("2026-03"), fetchPage });
  await flush();
  calls[2].reject(new Error("Month exploded"));
  await assert.rejects(failing, /Month exploded/);
  assert.deepEqual(owner.getSnapshot(), { data: null, requestKey: "" });
});

test("a failing latest refresh rethrows and keeps the page", async () => {
  const { owner, calls, fetchPage } = setup();
  const load = owner.load({ request: month("2026-05"), fetchPage });
  await flush();
  calls[0].resolve(dto("kept"));
  await load;
  const refresh = owner.refresh({ request: month("2026-05"), run: () => Promise.all([fetchPage(month("2026-05"), {})]) });
  await flush();
  calls[1].reject(new Error("offline"));
  await assert.rejects(refresh, /offline/);
  assert.deepEqual(owner.getSnapshot().data, dto("kept"));
});

test("reset drops the page without discarding a load already running; clearCache removes only route pages", async () => {
  const { owner, calls, fetchPage, queryClient, cleared } = setup();
  const load = owner.load({ request: month("2026-05"), fetchPage });
  await flush();
  owner.reset();
  assert.deepEqual(owner.getSnapshot(), { data: null, requestKey: "" });
  calls[0].resolve(dto("may"));
  assert.equal(await load, true);
  assert.deepEqual(owner.getSnapshot().data, dto("may"));

  queryClient.setQueryData(["route-page", { path: "/api/month-page" }], 1);
  queryClient.setQueryData(["entries-page", { view: "household" }], 2);
  owner.clearCache();
  assert.equal(queryClient.getQueryData(["route-page", { path: "/api/month-page" }]), undefined);
  assert.equal(queryClient.getQueryData(["entries-page", { view: "household" }]), 2);
  assert.equal(cleared(), 1);
});
