import assert from "node:assert/strict";
import test from "node:test";

import { createEntriesDataOwner } from "../src/client/entries-data-owner.js";

const params = (month, view = "person-tim") => new URLSearchParams({ view, month });
const page = (month, description = `${month} entry`) => ({
  viewId: "person-tim",
  monthPage: { month, entries: [{ id: `${month}-1`, description }] },
  splitGroups: []
});

function setup() {
  const calls = [];
  const fetchPage = (request, options) => new Promise((resolve, reject) => calls.push({ request, options, resolve, reject }));
  const owner = createEntriesDataOwner({ initialPage: page("2026-05", "warm start") });
  let notifications = 0;
  owner.subscribe(() => { notifications += 1; });
  return { owner, calls, fetchPage, notifications: () => notifications };
}

test("a refresh of May that lands after the person moved to October never replaces October", async () => {
  const { owner, calls, fetchPage } = setup();
  const firstLoad = owner.load({ params: params("2026-05"), fetchPage });
  calls[0].resolve(page("2026-05"));
  assert.equal(await firstLoad, true);

  // An edit in May starts a refresh, then the person moves to October.
  const mayRefresh = owner.refresh({ params: params("2026-05"), fetchPage });
  const octoberLoad = owner.load({ params: params("2025-10"), fetchPage, showLoading: true });
  calls[2].resolve(page("2025-10"));
  assert.equal(await octoberLoad, true);
  assert.equal(owner.getSnapshot().page.monthPage.month, "2025-10");

  calls[1].resolve(page("2026-05", "late May"));
  assert.equal(await mayRefresh, null);
  assert.equal(owner.getSnapshot().page.monthPage.month, "2025-10");
  assert.equal(owner.getSnapshot().isLoading, false);
});

test("a superseded refresh does not end the loading state of the newer load", async () => {
  const { owner, calls, fetchPage } = setup();
  const firstLoad = owner.load({ params: params("2026-05"), fetchPage });
  calls[0].resolve(page("2026-05"));
  await firstLoad;

  const mayRefresh = owner.refresh({ params: params("2026-05"), fetchPage });
  const octoberLoad = owner.load({ params: params("2025-10"), fetchPage, showLoading: true });
  calls[1].reject(new Error("late May 500"));
  assert.equal(await mayRefresh, null, "a superseded failure is not reported");
  assert.equal(owner.getSnapshot().isLoading, true, "October is still loading");
  assert.equal(owner.getSnapshot().page.monthPage.month, "2026-05");

  calls[2].resolve(page("2025-10"));
  await octoberLoad;
  assert.deepEqual(
    { month: owner.getSnapshot().page.monthPage.month, isLoading: owner.getSnapshot().isLoading },
    { month: "2025-10", isLoading: false }
  );
});

test("a refresh made for a month that is no longer active does not fetch", async () => {
  const { owner, calls, fetchPage } = setup();
  const octoberLoad = owner.load({ params: params("2025-10"), fetchPage });
  calls[0].resolve(page("2025-10"));
  await octoberLoad;

  // A stale callback from the May screen (an edit that finished late).
  assert.equal(await owner.refresh({ params: params("2026-05"), fetchPage }), null);
  assert.equal(calls.length, 1);
  assert.equal(owner.getSnapshot().page.monthPage.month, "2025-10");
});

test("the latest refresh applies its page and its failure is rethrown with the page kept", async () => {
  const { owner, calls, fetchPage } = setup();
  const load = owner.load({ params: params("2026-05"), fetchPage });
  calls[0].resolve(page("2026-05"));
  await load;

  const refreshed = owner.refresh({ params: params("2026-05"), fetchPage, bypassCache: true });
  assert.equal(owner.getSnapshot().isLoading, true);
  assert.deepEqual(calls[1].options, { bypassCache: true });
  calls[1].resolve(page("2026-05", "after edit"));
  assert.equal((await refreshed).monthPage.entries[0].description, "after edit");
  assert.equal(owner.getSnapshot().page.monthPage.entries[0].description, "after edit");

  const failing = owner.refresh({ params: params("2026-05"), fetchPage });
  calls[2].reject(new Error("Entries page failed (500)"));
  await assert.rejects(failing, /Entries page failed/);
  assert.equal(owner.getSnapshot().page.monthPage.entries[0].description, "after edit");
  assert.equal(owner.getSnapshot().isLoading, false);
});

test("an aborted or failed load keeps the page on screen without throwing", async () => {
  const { owner, calls, fetchPage } = setup();
  const controller = new AbortController();
  const aborted = owner.load({ params: params("2026-05"), fetchPage, signal: controller.signal });
  controller.abort();
  calls[0].reject(new DOMException("Entries page request aborted.", "AbortError"));
  assert.equal(await aborted, false);

  const failed = owner.load({ params: params("2026-05"), fetchPage });
  calls[1].reject(new Error("Entries page failed (500)"));
  assert.equal(await failed, false);
  assert.equal(owner.getSnapshot().page.monthPage.entries[0].description, "warm start");
  assert.equal(owner.getSnapshot().isLoading, false);
});

test("a cached revisit loads without the loading state, and a warm start does not supersede the load", async () => {
  const { owner, calls, fetchPage } = setup();
  const load = owner.load({ params: params("2026-05"), fetchPage, showLoading: false });
  assert.equal(owner.getSnapshot().isLoading, false);

  owner.seed(page("2026-05", "shell warm start"));
  assert.equal(owner.getSnapshot().page.monthPage.entries[0].description, "shell warm start");
  calls[0].resolve(page("2026-05", "server page"));
  assert.equal(await load, true);
  assert.equal(owner.getSnapshot().page.monthPage.entries[0].description, "server page");
});

test("isActive tells a stale refresh apart before it clears any cache", async () => {
  const { owner, calls, fetchPage } = setup();
  const load = owner.load({ params: params("2025-10"), fetchPage });
  assert.equal(owner.isActive(params("2025-10")), true);
  assert.equal(owner.isActive(params("2026-05")), false);
  calls[0].resolve(page("2025-10"));
  await load;
});

test("a cache clear that cancels the latest load still ends its loading state", async () => {
  const { owner, calls, fetchPage } = setup();
  const load = owner.load({ params: params("2025-10"), fetchPage, showLoading: true });
  assert.equal(owner.getSnapshot().isLoading, true);
  const { CancelledError } = await import("@tanstack/react-query");
  calls[0].reject(new CancelledError());
  assert.equal(await load, false);
  assert.equal(owner.getSnapshot().isLoading, false);
});

// A failure while the page on screen still belongs to another month or view
// is a load failure of this page, not a refresh failure: the owner keeps the
// old page out of sight behind `loadError` instead of passing it off as the
// requested month.
test("a failed refresh while the previous month is still on screen becomes the page's load error, not a refresh failure", async () => {
  const { owner, calls, fetchPage } = setup();
  const mayLoad = owner.load({ params: params("2026-05"), fetchPage });
  calls[0].resolve(page("2026-05"));
  await mayLoad;

  // The person moves to October; a cross-tab edit cancels that load and
  // refreshes October, which fails.
  const octoberLoad = owner.load({ params: params("2025-10"), fetchPage, showLoading: true });
  const octoberRefresh = owner.refresh({ params: params("2025-10"), fetchPage, bypassCache: true });
  calls[1].reject(new Error("superseded"));
  assert.equal(await octoberLoad, false);
  calls[2].reject(new Error("Entries page failed. Entries exploded"));
  assert.equal(await octoberRefresh, null, "not rethrown, so no refresh notice");

  const snapshot = owner.getSnapshot();
  assert.deepEqual(snapshot.loadError, { message: "Entries page failed. Entries exploded" });
  assert.equal(snapshot.isLoading, false);
  assert.equal(snapshot.page.monthPage.month, "2026-05", "the old page is kept for drafts, not shown as October");
});

test("a failed first load of a month records the load error, and a later success or warm start clears it", async () => {
  const { owner, calls, fetchPage } = setup();
  const failed = owner.load({ params: params("2025-10"), fetchPage });
  calls[0].reject(new Error("Entries page failed (500)"));
  assert.equal(await failed, false);
  assert.deepEqual(owner.getSnapshot().loadError, { message: "Entries page failed (500)" });

  // The shell's page retry hands the page over as a warm start.
  owner.seed(page("2025-10", "retried"), params("2025-10"));
  assert.equal(owner.getSnapshot().loadError, null);
  assert.equal(owner.getSnapshot().page.monthPage.entries[0].description, "retried");

  const again = owner.load({ params: params("2025-09"), fetchPage });
  calls[1].reject(new Error("September failed"));
  await again;
  assert.deepEqual(owner.getSnapshot().loadError, { message: "September failed" });
  const back = owner.load({ params: params("2025-10"), fetchPage });
  assert.equal(owner.getSnapshot().loadError, null, "moving to another request drops the old error");
  calls[2].resolve(page("2025-10"));
  assert.equal(await back, true);
  assert.equal(owner.getSnapshot().loadError, null);
});

test("a failed load while this request's page is already on screen is rethrown as a background failure", async () => {
  const calls = [];
  const fetchPage = (request, options) => new Promise((resolve, reject) => calls.push({ request, options, resolve, reject }));
  const owner = createEntriesDataOwner({ initialPage: page("2026-05", "route page"), initialParams: params("2026-05") });
  const load = owner.load({ params: params("2026-05"), fetchPage });
  calls[0].reject(new Error("Entries page failed (500)"));
  await assert.rejects(load, /Entries page failed/);
  assert.equal(owner.getSnapshot().loadError, null, "the rows on screen are this month's");
  assert.equal(owner.getSnapshot().page.monthPage.entries[0].description, "route page");
  assert.equal(owner.getSnapshot().isLoading, false);
});

test("a cancelled load or refresh never becomes a load error", async () => {
  const { owner, calls, fetchPage } = setup();
  const { CancelledError } = await import("@tanstack/react-query");
  const load = owner.load({ params: params("2025-10"), fetchPage });
  calls[0].reject(new CancelledError());
  assert.equal(await load, false);
  const refresh = owner.refresh({ params: params("2025-10"), fetchPage });
  calls[1].reject(new CancelledError());
  await assert.rejects(refresh);
  assert.equal(owner.getSnapshot().loadError, null);
});
