// Summary's Subscriptions and bills for a view and scope, read once the top
// summary is usable (AGENTS.md "Load the active screen first"). Its one
// store is the query cache under queryKeys.repeatingCharges(): a second
// visit joins the kept answer, and a save that can change a charge (an
// entry, an import, a choice) reads it again once it settles.
//
// - Read through the shell's required read (`fetchRequiredQuery`:
//   fetchQueryWithLease), handed in so this chunk imports no first-screen
//   module. A failure leaves no answer: the card shows nothing, never an
//   error screen.

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { hashKey } from "@tanstack/react-query";

import { queryKeys } from "./query-keys";
import { requestRepeatingCharges } from "./repeating-charges-api";

export const REPEATING_CHARGES_MAX_AGE_MS = 5 * 60 * 1000;
const REFRESH_AFTER_SAVE_MS = 400;
// A page invalidated by a save: a charge may have changed.
const SAVE_QUERY_ROOTS = new Set(["entries-page", "imports-page", "month-page", "summary-page", "app-shell"]);

export function shouldFetchRepeatingCharges({ enabled, hasData, updatedAt, now }) {
  return enabled && (!hasData || now - updatedAt > REPEATING_CHARGES_MAX_AGE_MS);
}

/**
 * @param {{ queryClient: any, viewId: string, scope: string, enabled: boolean, fetchRequiredQuery: (options: any) => Promise<any> }} options
 */
export function useRepeatingCharges({ queryClient, viewId, scope, enabled, fetchRequiredQuery }) {
  const queryKey = useMemo(() => queryKeys.repeatingCharges(viewId, scope), [scope, viewId]);
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
    abortMessage: "Subscriptions request aborted.",
    fetcher: ({ signal: querySignal }) => requestRepeatingCharges(viewId, scope, { signal: querySignal })
  }), [fetchRequiredQuery, queryKey, scope, viewId]);

  useEffect(() => {
    if (!shouldFetchRepeatingCharges({ enabled, hasData: Boolean(answer), updatedAt, now: Date.now() })) {
      return undefined;
    }
    const controller = new AbortController();
    read(controller.signal).catch(() => {
      // Optional: no answer means no card, and the next visit tries again.
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
            // The kept answer stays; a failed refresh shows nothing new.
          });
        }, REFRESH_AFTER_SAVE_MS);
      }
    });
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [enabled, queryClient, read]);

  return { answer, refresh: read };
}
