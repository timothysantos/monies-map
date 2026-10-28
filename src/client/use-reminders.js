// The reminders for a view, read when Ask opens (docs/flows/reminders-flow.md,
// "Loading"). Their one store is the query cache under queryKeys.reminders():
// the Ask tab's dot (reminders-cue.js) reads the same entry.
//
// - Read lazily: only once Ask is usable, through the shell's required read
//   (`fetchRequiredQuery`: fetchQueryWithLease), so a second Ask joins the
//   same request or the answer kept for a minute. Never on the first screen,
//   never blocking Ask: a failure leaves no answer and nothing on screen. The
//   read is passed in rather than imported (query-leases.js in a route chunk
//   makes the bundler split the entry).
// - Read again when a save that can clear a reminder invalidates a page
//   (import, entry, Splits, month note), once it settles.

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { hashKey } from "@tanstack/react-query";

import { queryKeys } from "./query-keys";
import { requestReminders } from "./reminders-api";

export const REMINDERS_MAX_AGE_MS = 60 * 1000;
const REFRESH_AFTER_SAVE_MS = 400;
// A page invalidated by a save: something a reminder reads may have changed.
const SAVE_QUERY_ROOTS = new Set(["entries-page", "splits-page", "imports-page", "month-page", "summary-page", "summary-account-pills", "app-shell"]);

export function shouldFetchReminders({ enabled, hasData, updatedAt, now }) {
  return enabled && (!hasData || now - updatedAt > REMINDERS_MAX_AGE_MS);
}

/**
 * @param {{ queryClient: any, viewId: string, enabled: boolean, fetchRequiredQuery: (options: any) => Promise<any>, fetchImpl?: typeof fetch }} options
 */
export function useReminders({ queryClient, viewId, enabled, fetchRequiredQuery, fetchImpl = undefined }) {
  const queryKey = useMemo(() => queryKeys.reminders(viewId), [viewId]);
  const hash = hashKey(queryKey);
  const subscribe = useCallback((listener) => queryClient.getQueryCache().subscribe((event) => {
    if (event?.query?.queryHash === hash) {
      listener();
    }
  }), [hash, queryClient]);
  const readAnswer = useCallback(() => queryClient.getQueryData(queryKey) ?? null, [queryClient, queryKey]);
  const readUpdatedAt = useCallback(() => queryClient.getQueryState(queryKey)?.dataUpdatedAt ?? 0, [queryClient, queryKey]);
  const answer = useSyncExternalStore(subscribe, readAnswer, readAnswer);
  const updatedAt = useSyncExternalStore(subscribe, readUpdatedAt, readUpdatedAt);

  const read = useCallback((signal) => fetchRequiredQuery({
    queryKey,
    bypassCache: true,
    signal,
    abortMessage: "Reminders request aborted.",
    fetcher: ({ signal: querySignal }) => requestReminders(viewId, { signal: querySignal, ...(fetchImpl ? { fetchImpl } : {}) })
  }), [fetchImpl, fetchRequiredQuery, queryKey, viewId]);

  useEffect(() => {
    if (!shouldFetchReminders({ enabled, hasData: Boolean(answer), updatedAt, now: Date.now() })) {
      return undefined;
    }
    const controller = new AbortController();
    read(controller.signal).catch(() => {
      // Optional: no answer means no reminders, and the next visit tries again.
    });
    return () => controller.abort();
    // A failed read changes neither value, so it is not retried in a loop.
  }, [answer, enabled, read, updatedAt]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    let timer = 0;
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event?.type === "updated" && event.action?.type === "invalidate" && SAVE_QUERY_ROOTS.has(event.query?.queryKey?.[0])) {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          read(undefined).catch(() => {
            // Kept answer stays; a failed refresh shows nothing new.
          });
        }, REFRESH_AFTER_SAVE_MS);
      }
    });
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [enabled, queryClient, read]);

  return answer;
}
