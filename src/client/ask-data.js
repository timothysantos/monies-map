// What the Ask page reads from the server: nothing of its own. It shows the
// shell's people, wallets and categories, and borrows two existing page
// DTOs from the query cache, which stays their one store:
//
// - The Entries page DTO of a view and month (split groups for the Splits
//   switch, and a saved entry for the Apple Pay Shortcut's confirmed card).
//   Read from the cache when Entries or Splits already loaded it, otherwise
//   fetched only when the card needs it, through the shell's own route-page
//   read (App.jsx fetchRoutePageResponse: fetchQueryWithLease with the
//   Entries route's query key), so going "Back to Entries" joins the same
//   data instead of loading it again.
// - The Summary page DTO and wallet pills already cached for this view, for
//   the "since you last looked" card. Never fetched here: Ask opens without
//   a page request and without AI (AGENTS.md, "Optional AI Assistance").

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { hashKey } from "@tanstack/react-query";

import { buildEntriesPageParams } from "./app-routing";
import { summarizeFilterAnswer } from "./ask-filter-answer";
import { queryKeys } from "./query-keys";

function useQueryCacheValue(queryClient, queryKey) {
  const hash = hashKey(queryKey);
  const subscribe = useCallback((listener) => queryClient.getQueryCache().subscribe((event) => {
    if (event?.query?.queryHash === hash) {
      listener();
    }
  }), [hash, queryClient]);
  const read = useCallback(() => queryClient.getQueryData(queryKey) ?? null, [queryClient, hash]); // eslint-disable-line react-hooks/exhaustive-deps
  return useSyncExternalStore(subscribe, read, read);
}

// One view and month of the Entries page DTO. `enabled` loads it when the
// cache has none; `refresh` re-reads it from the server after a save.
// `fetchEntriesPage(params, { bypassCache, signal })` is the shell's
// required read for that page.
export function useAskEntriesPage({ queryClient, fetchEntriesPage, viewId, month, fromMonth = "", enabled }) {
  // A run of days that starts in an earlier month reads those months too,
  // the same request (and cache entry) the Entries page makes for it.
  const params = useMemo(() => withFromMonth(buildEntriesPageParams({ viewId, month }), fromMonth, month), [fromMonth, month, viewId]);
  const queryKey = useMemo(() => queryKeys.entriesPage(params), [params]);
  const page = useQueryCacheValue(queryClient, queryKey);
  const [status, setStatus] = useState("idle");

  useEffect(() => {
    if (!enabled || !month || page) {
      return undefined;
    }
    const controller = new AbortController();
    setStatus("loading");
    fetchEntriesPage(params, { signal: controller.signal })
      .then(() => setStatus("ready"))
      .catch((error) => {
        if (!controller.signal.aborted && error?.name !== "AbortError") {
          setStatus("error");
        }
      });
    return () => controller.abort();
  }, [enabled, fetchEntriesPage, month, page, params]);

  const refresh = useCallback(() => fetchEntriesPage(params, { bypassCache: true }), [fetchEntriesPage, params]);
  return { page, status: page ? "ready" : status, refresh };
}

function withFromMonth(params, fromMonth, month) {
  if (fromMonth && fromMonth < month) params.set("from", fromMonth);
  return params;
}

/** The first month an answer's run of days reaches back to, or "". */
export function answerFromMonth(filter) {
  const from = String(filter?.dayFrom ?? "").slice(0, 7);
  return filter?.dayTo && from && from < filter.month ? from : "";
}

// The one entry an Entries answer showed, from the same cached page and the
// same selector the answer card used, or "" when it showed none or several
// (or its page is not cached).
export function onlyEntryOfAnswer(queryClient, filter, accounts = []) {
  if (!filter?.month) return "";
  const page = queryClient.getQueryData(queryKeys.entriesPage(withFromMonth(buildEntriesPageParams({ viewId: filter.viewId, month: filter.month }), answerFromMonth(filter), filter.month)));
  if (!page?.monthPage || page.monthPage.month !== filter.month) return "";
  const { entryIds } = summarizeFilterAnswer(page, filter, { accounts });
  return entryIds.length === 1 ? entryIds[0] : "";
}

// Split groups the card can share an expense to: from this view's Entries
// page when it is here, else from any cached Entries or Splits page of the
// view. Non-group expenses come first, as in the Entries composer.
export function readCachedSplitGroups(queryClient, viewId) {
  for (const [key, data] of queryClient.getQueriesData({ queryKey: ["entries-page"] })) {
    if (data?.splitGroups?.length && (key?.[1]?.view ?? "household") === viewId) {
      return data.splitGroups.map((group) => ({ id: group.id, name: group.name }));
    }
  }
  for (const [, data] of queryClient.getQueriesData({ queryKey: ["splits-page"] })) {
    const groups = data?.splitsPage?.groups;
    if (groups?.length) {
      return groups.map((group) => ({ id: group.id, name: group.name }));
    }
  }
  return null;
}

// The newest cached Summary page of this view and scope that covers the
// month, with its view's wallet pills, or null.
export function readCachedSummary(queryClient, { viewId, scope, month }) {
  let best = null;
  for (const [key, data] of queryClient.getQueriesData({ queryKey: ["summary-page"] })) {
    const keyParams = key?.[1] ?? {};
    const summaryPage = data?.summaryPage;
    if (!summaryPage || (keyParams.viewId ?? "household") !== viewId || (keyParams.scope ?? "direct_plus_shared") !== scope) {
      continue;
    }
    const months = summaryPage.rangeMonths ?? [];
    if (!months.includes(month)) {
      continue;
    }
    if (!best || (summaryPage.rangeEndMonth ?? "") > (best.summaryPage.rangeEndMonth ?? "")) {
      best = data;
    }
  }
  if (!best) {
    return null;
  }
  const pills = queryClient.getQueryData(queryKeys.summaryAccountPills({ viewId }));
  return { summaryPage: { ...best.summaryPage, accountPills: pills?.accountPills ?? [] }, label: best.label };
}

export function useCachedSummary(queryClient, { viewId, scope, month, enabled }) {
  const subscribe = useCallback((listener) => queryClient.getQueryCache().subscribe((event) => {
    const family = event?.query?.queryKey?.[0];
    if (family === "summary-page" || family === "summary-account-pills") {
      listener();
    }
  }), [queryClient]);
  // A stable snapshot: re-read only when a summary query changes.
  const [version, setVersion] = useState(0);
  useEffect(() => (enabled ? subscribe(() => setVersion((value) => value + 1)) : undefined), [enabled, subscribe]);
  return useMemo(
    () => (enabled ? readCachedSummary(queryClient, { viewId, scope, month }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, month, queryClient, scope, viewId, version]
  );
}
