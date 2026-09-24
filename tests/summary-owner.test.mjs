import assert from "node:assert/strict";
import test from "node:test";

import { QueryClient } from "@tanstack/react-query";

import { createSummaryOwner } from "../src/client/summary-owner.js";

// Deferred page and pill fetchers: each call waits until the test settles it.
function setup() {
  const calls = [];
  const deferred = (kind) => (params, options) => new Promise((resolve, reject) => {
    calls.push({ kind, params: params.toString(), options, resolve, reject });
  });
  let cleared = 0;
  const queryClient = new QueryClient();
  const owner = createSummaryOwner({
    queryClient,
    onCacheCleared: () => { cleared += 1; },
    fetchPage: deferred("page"),
    fetchPills: deferred("pills")
  });
  return { queryClient, owner, calls, cleared: () => cleared };
}

const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

const params = (view, start = "2025-06", end = "2026-05") => ({
  pageParams: new URLSearchParams({ view, month: "2026-05", summary_start: start, summary_end: end }),
  pillsParams: new URLSearchParams({ view })
});
const page = (label) => ({ summaryPage: { label } });
const pills = (label) => ({ accountPills: [label] });

function settle(calls, fromIndex, label) {
  calls[fromIndex].resolve(page(label));
  calls[fromIndex + 1].resolve(pills(label));
}

test("a load applies the page and pills together, keyed by the page request", async () => {
  const { owner, calls } = setup();
  const request = params("household");
  const load = owner.load(request);
  await flush();
  assert.deepEqual(calls.map((call) => call.kind), ["page", "pills"]);
  settle(calls, 0, "household");
  assert.equal(await load, true);
  assert.deepEqual(owner.getSnapshot(), { summaryPage: page("household"), accountPills: pills("household"), requestKey: request.pageParams.toString() });
});

test("person context: switching views mid-load shows only the newer view", async () => {
  const { owner, calls } = setup();
  const household = owner.load(params("household"));
  await flush();
  const tim = owner.load(params("person-tim"));
  await flush();
  settle(calls, 2, "tim");
  settle(calls, 0, "household");
  assert.equal(await tim, true);
  assert.equal(await household, false);
  assert.deepEqual(owner.getSnapshot().summaryPage, page("tim"));
  assert.match(owner.getSnapshot().requestKey, /view=person-tim/);
});

test("a failed latest load clears the pair and rethrows; an aborted one changes nothing", async () => {
  const { owner, calls } = setup();
  const first = owner.load(params("household"));
  await flush();
  settle(calls, 0, "household");
  await first;

  const controller = new AbortController();
  const aborted = owner.load({ ...params("household", "2025-12"), signal: controller.signal });
  await flush();
  controller.abort();
  calls[2].reject(new DOMException("aborted", "AbortError"));
  calls[3].resolve(pills("x"));
  assert.equal(await aborted, false);
  assert.deepEqual(owner.getSnapshot().summaryPage, page("household"));

  const failing = owner.load(params("household", "2025-11"));
  await flush();
  calls[4].reject(new Error("Summary exploded"));
  calls[5].resolve(pills("x"));
  await assert.rejects(failing, /Summary exploded/);
  assert.deepEqual(owner.getSnapshot(), { summaryPage: null, accountPills: null, requestKey: "" });
});

test("a refresh clears both caches, keeps the pair on screen meanwhile, and returns the fresh pair", async () => {
  const { owner, calls, cleared } = setup();
  const load = owner.load(params("household"));
  await flush();
  settle(calls, 0, "old");
  await load;

  const refresh = owner.refresh(params("household"));
  await flush();
  assert.equal(cleared(), 2);
  assert.equal(calls[2].options.bypassCache, true);
  assert.deepEqual(owner.getSnapshot().summaryPage, page("old"));
  settle(calls, 2, "new");
  assert.deepEqual(await refresh, { summaryPage: page("new"), summaryAccountPills: pills("new") });
  assert.deepEqual(owner.getSnapshot().summaryPage, page("new"));
});

test("two rapid saves: the first refresh is superseded (null, no failure), the second's data wins", async () => {
  const { owner, calls } = setup();
  const first = owner.refresh(params("household"));
  await flush();
  const second = owner.refresh(params("household"));
  await flush();
  // The second refresh's cache clear cancelled the first request underneath it.
  calls[0].reject(new Error("CancelledError"));
  calls[1].resolve(pills("stale"));
  settle(calls, 2, "second");
  assert.equal(await first, null);
  assert.deepEqual(await second, { summaryPage: page("second"), summaryAccountPills: pills("second") });
  assert.deepEqual(owner.getSnapshot().summaryPage, page("second"));
});

test("a range change during a note-save refresh wins over the refresh", async () => {
  const { owner, calls } = setup();
  const refresh = owner.refresh(params("household", "2025-06"));
  await flush();
  const load = owner.load(params("household", "2025-12"));
  await flush();
  settle(calls, 2, "new-range");
  settle(calls, 0, "old-range");
  assert.equal(await load, true);
  assert.equal(await refresh, null);
  assert.deepEqual(owner.getSnapshot().summaryPage, page("new-range"));
  assert.match(owner.getSnapshot().requestKey, /summary_start=2025-12/);
});

test("a failing latest refresh rethrows and keeps the pair", async () => {
  const { owner, calls } = setup();
  const load = owner.load(params("household"));
  await flush();
  settle(calls, 0, "kept");
  await load;
  const refresh = owner.refresh(params("household"));
  await flush();
  calls[2].reject(new Error("offline"));
  calls[3].resolve(pills("x"));
  await assert.rejects(refresh, /offline/);
  assert.deepEqual(owner.getSnapshot().summaryPage, page("kept"));
});

test("cache clears remove only the matching family and range", async () => {
  const { owner, queryClient, cleared } = setup();
  queryClient.setQueryData(["summary-page", { startMonth: "2025-06" }], 1);
  queryClient.setQueryData(["summary-page", { startMonth: "2025-12" }], 2);
  queryClient.setQueryData(["summary-account-pills", { viewId: "household" }], 3);
  queryClient.setQueryData(["route-page", { path: "/api/month-page" }], 4);
  owner.clearPageCache((key) => key.startMonth === "2025-06");
  assert.equal(queryClient.getQueryData(["summary-page", { startMonth: "2025-06" }]), undefined);
  assert.equal(queryClient.getQueryData(["summary-page", { startMonth: "2025-12" }]), 2);
  owner.clearPillsCache();
  assert.equal(queryClient.getQueryData(["summary-account-pills", { viewId: "household" }]), undefined);
  assert.equal(queryClient.getQueryData(["route-page", { path: "/api/month-page" }]), 4);
  assert.equal(cleared(), 2);
});
