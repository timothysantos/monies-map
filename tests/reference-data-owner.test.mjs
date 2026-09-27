import assert from "node:assert/strict";
import test from "node:test";

import { QueryClient } from "@tanstack/react-query";

import { createReferenceDataOwner } from "../src/client/reference-data-owner.js";
import { queryKeys } from "../src/client/query-keys.js";

// Real QueryClient, deferred transport: each fetch waits until the test
// resolves or rejects it.
function setup() {
  const calls = [];
  const fetcher = () => new Promise((resolve, reject) => calls.push({ resolve, reject }));
  const issues = [];
  let cleared = 0;
  const queryClient = new QueryClient();
  const owner = createReferenceDataOwner({
    queryClient,
    fetcher,
    onCacheCleared: () => { cleared += 1; },
    reportIssue: (label, error) => issues.push({ label, message: error.message })
  });
  const states = [];
  owner.subscribe(() => states.push(owner.getSnapshot()));
  return { queryClient, owner, calls, issues, states, cleared: () => cleared };
}

const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

const V1 = { accounts: [{ id: "acct-1", name: "UOB One" }], categories: [{ id: "cat-bills", name: "Bills" }] };
const V2 = { accounts: [{ id: "acct-1", name: "UOB One renamed" }], categories: [{ id: "cat-bills", name: "Bills" }] };

test("the first load fills the snapshot from one request, and a second load reuses the cache", async () => {
  const { owner, calls, queryClient } = setup();
  const load = owner.load();
  await flush();
  assert.equal(calls.length, 1);
  calls[0].resolve(V1);
  await load;
  assert.deepEqual(owner.getSnapshot(), { data: V1, error: "" });
  assert.deepEqual(queryClient.getQueryData(queryKeys.referenceData()), V1);
  await owner.load();
  assert.equal(calls.length, 1, "cached data makes no request");
});

test("a failed first load shows the error screen state and reports the issue", async () => {
  const { owner, calls, issues } = setup();
  const load = owner.load();
  await flush();
  calls[0].reject(new Error("Reference data failed. boom"));
  await load;
  assert.equal(owner.getSnapshot().data, null);
  assert.match(owner.getSnapshot().error, /boom/);
  assert.deepEqual(issues.map((issue) => issue.label), ["Reference data load failed"]);
});

test("an aborted first load changes nothing", async () => {
  const { owner, calls, states } = setup();
  const controller = new AbortController();
  const load = owner.load({ signal: controller.signal });
  await flush();
  controller.abort();
  calls[0].resolve(V1);
  await load;
  assert.deepEqual(owner.getSnapshot(), { data: null, error: "" });
  assert.equal(states.length, 0);
});

test("a refresh keeps the old snapshot on screen until fresh data arrives, and clears the cache first", async () => {
  const { owner, calls, states, cleared } = setup();
  const load = owner.load();
  await flush();
  calls[0].resolve(V1);
  await load;
  const refresh = owner.refresh();
  await flush();
  assert.equal(cleared(), 1);
  assert.equal(owner.getSnapshot().data, V1, "no blank shell during the refresh");
  calls[1].resolve(V2);
  assert.deepEqual(await refresh, V2);
  assert.deepEqual(owner.getSnapshot(), { data: V2, error: "" });
  assert.ok(states.every((state) => state.data !== null));
});

test("out of order: a refresh superseded by a newer one never overwrites it or shows an error", async () => {
  const { owner, calls, issues } = setup();
  const load = owner.load();
  await flush();
  calls[0].resolve(V1);
  await load;

  const first = owner.refreshOrShowError("Reference data refresh failed");
  await flush();
  const second = owner.refreshOrShowError("Reference data refresh failed");
  await flush();
  // The second refresh cancelled the first request; resolve the newer one.
  calls.at(-1).resolve(V2);
  assert.equal(await first, null);
  assert.deepEqual(await second, V2);
  assert.deepEqual(owner.getSnapshot(), { data: V2, error: "" });
  assert.deepEqual(issues, []);
});

test("out of order: a late success from an older request is ignored", async () => {
  const { owner, calls } = setup();
  const load = owner.load();
  await flush();
  const refresh = owner.refresh();
  await flush();
  // The initial load was cancelled by the refresh; the refresh answers first,
  // then a stale transport answer arrives for the first request.
  calls[1].resolve(V2);
  await refresh;
  calls[0].resolve(V1);
  await load;
  assert.deepEqual(owner.getSnapshot(), { data: V2, error: "" });
});

test("a cancelled first load caused by a refresh is not an error", async () => {
  const { owner, calls, issues } = setup();
  const load = owner.load();
  await flush();
  const refresh = owner.refresh();
  await flush();
  await load;
  assert.equal(owner.getSnapshot().error, "");
  calls.at(-1).resolve(V1);
  await refresh;
  assert.deepEqual(owner.getSnapshot(), { data: V1, error: "" });
  assert.deepEqual(issues, []);
});

test("a failing latest refresh keeps the snapshot and shows the error; plain refresh rethrows", async () => {
  const { owner, calls, issues } = setup();
  const load = owner.load();
  await flush();
  calls[0].resolve(V1);
  await load;

  const shown = owner.refreshOrShowError("Reference data retry failed");
  await flush();
  calls[1].reject(new Error("Reference data failed. offline"));
  assert.equal(await shown, null);
  assert.equal(owner.getSnapshot().data, V1);
  assert.match(owner.getSnapshot().error, /offline/);
  assert.deepEqual(issues.map((issue) => issue.label), ["Reference data retry failed"]);

  const plain = owner.refresh();
  await flush();
  calls[2].reject(new Error("Reference data failed. again"));
  await assert.rejects(plain, /again/);
});
