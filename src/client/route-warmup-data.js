// Turns abstract warmup data candidates into exact speculative requests.
// Keys come from the same builders the required readers use (H02), so a
// warmed response lands exactly where the next page looks for it, and a
// required read of the same key joins the in-flight request instead of
// starting another. Speculative requests make one attempt and never touch
// the shell's loading labels.

import { hashKey } from "@tanstack/react-query";

import { buildEntriesPageParams, buildRoutePageRequest } from "./app-routing.js";
import { startSpeculativeQuery } from "./query-leases.js";
import { queryKeys, summaryPageKeyFromParams } from "./query-keys.js";
import { fetchTextWithTransientWorkerRetry } from "./request-timeout.js";
import { admissionFor } from "./route-warmup-admissions.js";
import { buildSummaryPageParams } from "./summary-query.js";

// How long cached data counts as fresh for each family. Route pages keep
// today's policy: present and not invalidated is fresh. Summary ranges also
// age out because implicit-range invalidation is known to miss (audit §H02).
export const WARMUP_STALE_MS = Object.freeze({
  "entries-page": Infinity,
  "month-page": Infinity,
  "summary-page": 30_000,
  "imports-page": 5 * 60 * 1000
});

export function buildSpeculativeRequest(candidate) {
  const { purpose, identity } = candidate;
  if (purpose === "entries-page") {
    const params = buildEntriesPageParams({ viewId: identity.viewId, month: identity.month });
    return { family: purpose, queryKey: queryKeys.entriesPage(params), url: `/api/entries-page?${params.toString()}` };
  }
  if (purpose === "month-page") {
    const request = buildRoutePageRequest({ tabId: "month", viewId: identity.viewId, month: identity.month, scope: identity.scope });
    return { family: purpose, queryKey: queryKeys.routeRequestKey(request), url: `${request.path}?${request.params.toString()}` };
  }
  if (purpose === "summary-page") {
    const params = buildSummaryPageParams({
      viewId: identity.viewId,
      month: identity.month,
      scope: identity.scope,
      summaryStart: identity.summaryStart,
      summaryEnd: identity.summaryEnd
    });
    return { family: purpose, queryKey: summaryPageKeyFromParams(params), url: `/api/summary-page?${params.toString()}` };
  }
  if (purpose === "imports-page") {
    return { family: purpose, queryKey: queryKeys.importsPage(), url: "/api/imports-page" };
  }
  return null;
}

// Presence alone is not freshness: invalidated or aged data is refetched.
export function isFresh(queryClient, queryKey, staleMs, now) {
  const state = queryClient.getQueryState(queryKey);
  if (!state || state.data === undefined || state.isInvalidated) {
    return false;
  }
  return staleMs === Infinity || state.dataUpdatedAt + staleMs > now;
}

export async function fetchSpeculativeJson(url, { signal = undefined } = {}) {
  const { response, responseText } = await fetchTextWithTransientWorkerRetry(url, {
    cache: "no-store",
    requestLabel: "Warmup request",
    signal,
    maxAttempts: 1
  });
  if (!response.ok) {
    throw new Error(`Warmup request failed (${response.status}).`);
  }
  return responseText ? JSON.parse(responseText) : null;
}

/** @param {{ queryClient: any, now?: () => number, clock?: Pick<typeof globalThis, "setTimeout" | "clearTimeout"> }} options */
export function createWarmupDataAdapter({ queryClient, now = () => Date.now(), clock = globalThis }) {
  return (candidate) => {
    const request = buildSpeculativeRequest(candidate);
    if (!request) {
      return null;
    }
    return {
      key: hashKey(request.queryKey),
      fresh: isFresh(queryClient, request.queryKey, WARMUP_STALE_MS[request.family], now()),
      admission: admissionFor(request.family, candidate.identity),
      start: () => startSpeculativeQuery(queryClient, {
        queryKey: request.queryKey,
        fetcher: ({ signal }) => fetchSpeculativeJson(request.url, { signal }),
        clock
      })
    };
  };
}
