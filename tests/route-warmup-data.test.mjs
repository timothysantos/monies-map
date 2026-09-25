import assert from "node:assert/strict";
import test from "node:test";

import { QueryClient, hashKey } from "@tanstack/react-query";

import { buildEntriesPageParams, buildRoutePageRequest } from "../src/client/app-routing.js";
import { queryKeys, summaryPageKeyFromParams } from "../src/client/query-keys.js";
import { buildSummaryPageParams } from "../src/client/summary-query.js";
import { WARMUP_STALE_MS, buildSpeculativeRequest, createWarmupDataAdapter, fetchSpeculativeJson, isFresh } from "../src/client/route-warmup-data.js";

const identity = (tabId, patch = {}) => ({ tabId, viewId: "person-tim", month: "2026-05", scope: "direct_plus_shared", summaryStart: "", summaryEnd: "", ...patch });

test("speculative keys equal the keys the required readers use", () => {
  const entries = buildSpeculativeRequest({ purpose: "entries-page", identity: identity("entries") });
  assert.deepEqual(entries.queryKey, queryKeys.routeRequestKey(buildRoutePageRequest({ tabId: "entries", viewId: "person-tim", month: "2026-05", scope: "direct_plus_shared" })));
  assert.deepEqual(entries.queryKey, queryKeys.entriesPage(buildEntriesPageParams({ viewId: "person-tim", month: "2026-05" })));
  assert.equal(entries.url, "/api/entries-page?view=person-tim&month=2026-05");

  const month = buildSpeculativeRequest({ purpose: "month-page", identity: identity("month", { month: "2026-04" }) });
  assert.deepEqual(month.queryKey, ["month-page", { month: "2026-04", scope: "direct_plus_shared", viewId: "person-tim" }]);
  assert.equal(month.url, "/api/month-page?view=person-tim&month=2026-04&scope=direct_plus_shared");

  const range = identity("summary", { summaryStart: "2025-07", summaryEnd: "2025-09" });
  const summary = buildSpeculativeRequest({ purpose: "summary-page", identity: range });
  assert.deepEqual(summary.queryKey, summaryPageKeyFromParams(buildSummaryPageParams({ viewId: "person-tim", month: "2026-05", scope: "direct_plus_shared", summaryStart: "2025-07", summaryEnd: "2025-09" })));
  assert.equal(summary.url, "/api/summary-page?view=person-tim&month=2026-05&scope=direct_plus_shared&summary_start=2025-07&summary_end=2025-09");

  const imports = buildSpeculativeRequest({ purpose: "imports-page", identity: identity("imports") });
  assert.deepEqual(imports.queryKey, queryKeys.importsPage());
  assert.deepEqual(imports.queryKey, queryKeys.routeRequestKey(buildRoutePageRequest({ tabId: "imports" })));
  assert.equal(buildSpeculativeRequest({ purpose: "splits-page", identity: identity("splits") }), null, "no Splits data warmup");
});

test("freshness reads the query state: present, not invalidated, and within the family's stale time", async () => {
  const queryClient = new QueryClient();
  const key = queryKeys.importsPage();
  assert.equal(isFresh(queryClient, key, WARMUP_STALE_MS["imports-page"], Date.now()), false, "absent");
  queryClient.setQueryData(key, { importsPage: {} }, { updatedAt: 1_000 });
  assert.equal(isFresh(queryClient, key, 5 * 60 * 1000, 1_000 + 5 * 60 * 1000 - 1), true);
  assert.equal(isFresh(queryClient, key, 5 * 60 * 1000, 1_000 + 5 * 60 * 1000), false, "aged out");
  assert.equal(isFresh(queryClient, key, Infinity, 10 ** 12), true, "route pages never age out");
  await queryClient.invalidateQueries({ queryKey: key, refetchType: "none" });
  assert.equal(isFresh(queryClient, key, Infinity, 2_000), false, "invalidated data is not fresh");
});

test("the adapter reports a stable key, freshness and admission, and starts one speculative request", async () => {
  const queryClient = new QueryClient();
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url, options) => {
    urls.push({ url, signal: options.signal });
    return new Response(JSON.stringify({ viewId: "person-tim", monthPage: { month: "2026-05", entries: [] } }), { status: 200 });
  };
  try {
    const adapter = createWarmupDataAdapter({ queryClient, now: () => 5_000, clock: { setTimeout: () => 1, clearTimeout: () => {} } });
    const candidate = { kind: "data", purpose: "entries-page", routeId: "entries", identity: identity("entries") };
    const data = adapter(candidate);
    const key = queryKeys.entriesPage(buildEntriesPageParams({ viewId: "person-tim", month: "2026-05" }));
    assert.equal(data.key, hashKey(key));
    assert.equal(data.fresh, false);
    assert.deepEqual(data.admission, { responseBytes: 37_975, handlerMs: 25 }, "the measured Entries admission");
    assert.equal(adapter({ kind: "data", purpose: "imports-page", routeId: "imports", identity: identity("imports") }).admission, null, "unmeasured families stay unknown");
    const handle = data.start();
    assert.equal(handle.started, true);
    assert.deepEqual(await handle.promise, { status: "fulfilled", promoted: false });
    assert.deepEqual(urls.map((call) => call.url), ["/api/entries-page?view=person-tim&month=2026-05"]);
    assert.ok(urls[0].signal instanceof AbortSignal);
    assert.equal(queryClient.getQueryData(key).viewId, "person-tim");
    assert.equal(adapter(candidate).fresh, true, "cached for the next pass");
    assert.equal(adapter({ ...candidate, purpose: "unknown" }), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("speculative fetches make exactly one attempt and treat non-OK responses as failures", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => { calls += 1; return new Response("Your worker restarted mid-request", { status: 503 }); };
    await assert.rejects(fetchSpeculativeJson("/api/month-page?view=household"), /Warmup request failed \(503\)/);
    assert.equal(calls, 1);
    globalThis.fetch = async () => new Response('{"ok":true}', { status: 200 });
    assert.deepEqual(await fetchSpeculativeJson("/api/month-page"), { ok: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
