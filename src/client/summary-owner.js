// Owner of the Summary page data (H12b): the range DTO and the account pills,
// fetched together for one request key. The query caches are authoritative;
// the owner keeps the last loaded pair (and the key it was loaded for) on
// screen while the next load or refresh runs. Every load and refresh takes a
// generation, so a superseded request (a range change during a note save, or
// a second save cancelling the first) never overwrites newer data, clears
// it, or reports a failure.

import { isCancelledError } from "@tanstack/react-query";

function isAbort(error) {
  return (error instanceof DOMException && error.name === "AbortError") || isCancelledError(error);
}

function removeFamily(queryClient, family, predicate) {
  const matches = (query) => (
    query.queryKey?.[0] === family
    && (!predicate || predicate(query.queryKey?.[1] ?? {}))
  );
  queryClient.cancelQueries({ predicate: matches });
  queryClient.removeQueries({ predicate: matches });
}

export function createSummaryOwner({ queryClient, onCacheCleared = () => {}, fetchPage, fetchPills }) {
  let state = { summaryPage: null, accountPills: null, requestKey: "" };
  let generation = 0;
  const listeners = new Set();

  const setState = (next) => {
    state = next;
    for (const listener of [...listeners]) {
      listener();
    }
  };

  // Summary range DTOs and wallet pills live in their own query families, so
  // they clear separately from the generic route-page cache. A predicate
  // receives the key's params object.
  const clearPageCache = (predicate) => {
    onCacheCleared();
    removeFamily(queryClient, "summary-page", predicate);
  };
  const clearPillsCache = (predicate) => {
    onCacheCleared();
    removeFamily(queryClient, "summary-account-pills", predicate);
  };

  const fetchPair = (pageParams, pillsParams, options) => Promise.all([
    fetchPage(pageParams, options),
    fetchPills(pillsParams, options)
  ]);

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,

    // Route load for the active range. Resolves true when applied, false
    // when aborted or superseded. A failure of the latest load clears the
    // pair and rethrows, so the page error screen can show.
    async load({ pageParams, pillsParams, signal }) {
      const mine = ++generation;
      try {
        const [summaryPage, accountPills] = await fetchPair(pageParams, pillsParams, { signal });
        if (mine !== generation || signal?.aborted) {
          return false;
        }
        setState({ summaryPage, accountPills, requestKey: pageParams.toString() });
        return true;
      } catch (error) {
        if (mine !== generation || signal?.aborted || isAbort(error)) {
          return false;
        }
        setState({ summaryPage: null, accountPills: null, requestKey: "" });
        throw error;
      }
    },

    // Refetch after a mutation, keeping the current pair on screen. Returns
    // the fresh pair, or null when a newer load or refresh superseded it; a
    // failure of the latest refresh is rethrown and leaves the pair as is.
    async refresh({ pageParams, pillsParams, bypassCache = true }) {
      const mine = ++generation;
      if (bypassCache) {
        clearPageCache();
        clearPillsCache();
      }
      try {
        const [summaryPage, accountPills] = await fetchPair(pageParams, pillsParams, { bypassCache });
        if (mine !== generation) {
          return null;
        }
        setState({ summaryPage, accountPills, requestKey: pageParams.toString() });
        return { summaryPage, summaryAccountPills: accountPills };
      } catch (error) {
        if (mine !== generation) {
          return null;
        }
        throw error;
      }
    },

    clearPageCache,
    clearPillsCache
  };
}
