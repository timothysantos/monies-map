import assert from "node:assert/strict";
import test from "node:test";

import { CancelledError } from "@tanstack/react-query";

import { createRefreshNoticeOwner, isQuietRefreshFailure } from "../src/client/refresh-notice.js";

function setup(routeKey = "month|household|2026-05") {
  const owner = createRefreshNoticeOwner();
  owner.setRouteKey(routeKey);
  let notifications = 0;
  owner.subscribe(() => { notifications += 1; });
  return { owner, notifications: () => notifications };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test("a failed background refresh resolves to null and raises the notice with its retry", async () => {
  const { owner, notifications } = setup();
  const retry = () => Promise.resolve("retried");
  const result = await owner.settle(() => Promise.reject(new Error("500 from month page")), { retry });

  assert.equal(result, null);
  assert.equal(owner.getSnapshot().notice.id, 1);
  assert.deepEqual(owner.getSnapshot().notice.retries, [retry]);
  assert.equal(notifications(), 1);
});

test("a successful refresh passes its result through and raises nothing", async () => {
  const { owner, notifications } = setup();
  const result = await owner.settle(() => Promise.resolve({ monthPage: { month: "2026-05" } }));

  assert.deepEqual(result, { monthPage: { month: "2026-05" } });
  assert.equal(owner.getSnapshot().notice, null);
  assert.equal(notifications(), 0);
});

test("a synchronous throw in the task is contained like a rejection", async () => {
  const { owner } = setup();
  const result = await owner.settle(() => { throw new Error("boom"); });

  assert.equal(result, null);
  assert.ok(owner.getSnapshot().notice);
});

test("aborted and cancelled refreshes stay silent", async () => {
  const { owner, notifications } = setup();
  await owner.settle(() => Promise.reject(new DOMException("Page request aborted.", "AbortError")));
  await owner.settle(() => Promise.reject(new CancelledError()));

  assert.equal(owner.getSnapshot().notice, null);
  assert.equal(notifications(), 0);
  assert.equal(isQuietRefreshFailure(new Error("Page request failed (500)")), false);
});

test("a refresh that fails after the person moved to another route stays silent", async () => {
  const { owner, notifications } = setup("month|household|2026-05");
  const pending = deferred();
  const settled = owner.settle(() => pending.promise);

  owner.setRouteKey("month|household|2025-10");
  pending.reject(new Error("late 500 for May"));

  assert.equal(await settled, null);
  assert.equal(owner.getSnapshot().notice, null);
  assert.equal(notifications(), 0);
});

test("moving to another route clears the previous route's notice", async () => {
  const { owner } = setup("month|household|2026-05");
  await owner.settle(() => Promise.reject(new Error("500")));
  assert.ok(owner.getSnapshot().notice);

  owner.setRouteKey("month|household|2026-05");
  assert.ok(owner.getSnapshot().notice, "the same route key keeps the notice");

  owner.setRouteKey("entries|household|2026-05");
  assert.equal(owner.getSnapshot().notice, null);
});

test("retry hides the notice, reruns the refresh, and raises it again only if that fails too", async () => {
  const { owner } = setup();
  let attempts = 0;
  const flaky = () => {
    attempts += 1;
    return attempts < 3 ? Promise.reject(new Error(`attempt ${attempts} failed`)) : Promise.resolve("ok");
  };
  await owner.settle(flaky, { retry: flaky });
  assert.equal(owner.getSnapshot().notice.id, 1);

  owner.retry();
  assert.equal(owner.getSnapshot().notice, null, "hidden while the retry runs");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(owner.getSnapshot().notice.id, 2, "the second failure raises a new notice");

  owner.retry();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(attempts, 3);
  assert.equal(owner.getSnapshot().notice, null);
});

test("dismiss hides the notice without running anything", async () => {
  const { owner } = setup();
  let retried = 0;
  await owner.settle(() => Promise.reject(new Error("500")), { retry: () => { retried += 1; } });
  owner.dismiss();

  assert.equal(owner.getSnapshot().notice, null);
  assert.equal(retried, 0);
});

test("when several refreshes fail, Refresh now reruns every one of them", async () => {
  const { owner } = setup();
  const reran = [];
  const monthRetry = () => { reran.push("month"); return Promise.resolve(); };
  const shellRetry = () => { reran.push("shell"); return Promise.resolve(); };
  // A Month save: the page refresh and its nested shell refresh both fail.
  await Promise.all([
    owner.settle(() => Promise.reject(new Error("shell 500")), { retry: shellRetry }),
    owner.settle(() => Promise.reject(new Error("month 500")), { retry: monthRetry })
  ]);
  assert.equal(owner.getSnapshot().notice.retries.length, 2);

  owner.retry();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(reran.sort(), ["month", "shell"]);
  assert.equal(owner.getSnapshot().notice, null);
});

test("the same retry reported twice runs once", async () => {
  const { owner } = setup();
  let runs = 0;
  const retry = () => { runs += 1; return Promise.resolve(); };
  await owner.settle(() => Promise.reject(new Error("500")), { retry });
  await owner.settle(() => Promise.reject(new Error("500")), { retry });
  assert.equal(owner.getSnapshot().notice.retries.length, 1);
  owner.retry();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(runs, 1);
});
