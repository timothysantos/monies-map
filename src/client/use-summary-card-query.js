// One optional Summary card's data (Investments over time, Tax reliefs),
// read once the top summary is usable (AGENTS.md "Load the active screen
// first"), the way useRepeatingCharges reads Subscriptions and bills. Its one
// store is the query cache under the card's key: a second visit joins the
// kept answer, and a save that can change it (an entry, an import) reads it
// again once it settles.
//
// - Read through the shell's required read (`fetchRequiredQuery`:
//   fetchQueryWithLease), handed in so this chunk imports no first-screen
//   module. A failure leaves no answer: the card shows nothing, never an
//   error screen.

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { hashKey } from "@tanstack/react-query";

export const SUMMARY_CARD_MAX_AGE_MS = 5 * 60 * 1000;
const REFRESH_AFTER_SAVE_MS = 400;
// A page invalidated by a save: the card's figures may have changed.
const SAVE_QUERY_ROOTS = new Set(["entries-page", "imports-page", "month-page", "summary-page", "app-shell"]);

/**
 * @param {{ queryClient: any, queryKey: any[], enabled: boolean, fetchRequiredQuery: (options: any) => Promise<any>, fetcher: (options: { signal?: AbortSignal }) => Promise<any>, abortMessage: string }} options
 */
export function useSummaryCardQuery({ queryClient, queryKey, enabled, fetchRequiredQuery, fetcher, abortMessage }) {
  const hash = hashKey(queryKey);
  const subscribe = useCallback((listener) => queryClient.getQueryCache().subscribe((event) => {
    if (event?.query?.queryHash === hash) {
      listener();
    }
  }), [hash, queryClient]);
  const readAnswer = useCallback(() => queryClient.getQueryData(JSON.parse(hash)) ?? null, [hash, queryClient]);
  const readUpdatedAt = useCallback(() => queryClient.getQueryState(JSON.parse(hash))?.dataUpdatedAt ?? 0, [hash, queryClient]);
  const answer = useSyncExternalStore(subscribe, readAnswer, readAnswer);
  const updatedAt = useSyncExternalStore(subscribe, readUpdatedAt, readUpdatedAt);

  const read = useCallback((signal) => fetchRequiredQuery({
    queryKey: JSON.parse(hash),
    bypassCache: true,
    signal,
    abortMessage,
    fetcher: ({ signal: querySignal }) => fetcher({ signal: querySignal })
  }), [abortMessage, fetchRequiredQuery, fetcher, hash]);

  useEffect(() => {
    if (!enabled || (answer && Date.now() - updatedAt <= SUMMARY_CARD_MAX_AGE_MS)) {
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

  return answer;
}
