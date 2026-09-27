// Owner of generic route page data (H12c): Month, Splits, Imports and
// Settings pages fetched through the "route-page" query family. The query
// cache is authoritative; the owner keeps the last applied page and the
// request key it was fetched for, so the shell can tell whether the page on
// screen belongs to the active route. Every load and refresh takes a
// generation: a refresh that finishes after a newer navigation or refresh
// never overwrites the newer page, and its failure is not reported.

import { isCancelledError } from "@tanstack/react-query";

function isAbort(error) {
  return (error instanceof DOMException && error.name === "AbortError") || isCancelledError(error);
}

export function createRouteDataOwner({ queryClient, onCacheCleared = () => {}, requestKeyOf }) {
  let state = { data: null, requestKey: "" };
  let generation = 0;
  const listeners = new Set();

  const setState = (next) => {
    state = next;
    for (const listener of [...listeners]) {
      listener();
    }
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,

    // Route load for the active request. Resolves true when applied, false
    // when aborted or superseded. A failure of the latest load clears the
    // page and rethrows, so the page error screen can show.
    async load({ request, fetchPage, signal }) {
      const mine = ++generation;
      try {
        const data = await fetchPage(request, { signal });
        if (mine !== generation || signal?.aborted) {
          return false;
        }
        setState({ data, requestKey: requestKeyOf(request) });
        return true;
      } catch (error) {
        if (mine !== generation || signal?.aborted || isAbort(error)) {
          return false;
        }
        setState({ data: null, requestKey: "" });
        throw error;
      }
    },

    // A mutation refresh: `run` performs the page fetch plus any side work
    // and resolves to an array whose first item is the page. The page is
    // applied only while this is the latest request (and `apply` allows it).
    // Returns run's result; a superseded refresh resolves to null instead of
    // applying or failing.
    async refresh({ request, run, apply = true }) {
      // A refresh whose page will not be shown (Settings refreshed while
      // another route is open) must not supersede that route's own load.
      if (!apply) {
        return run();
      }
      const mine = ++generation;
      try {
        const result = await run();
        if (mine !== generation) {
          return null;
        }
        setState({ data: result[0], requestKey: requestKeyOf(request) });
        return result;
      } catch (error) {
        if (mine !== generation) {
          return null;
        }
        throw error;
      }
    },

    // Drops the page on screen (a full shell reload), without cancelling a
    // load that is already running for the active route.
    reset() {
      setState({ data: null, requestKey: "" });
    },

    clearCache() {
      onCacheCleared();
      queryClient.cancelQueries({ queryKey: ["route-page"] });
      queryClient.removeQueries({ queryKey: ["route-page"] });
    }
  };
}
