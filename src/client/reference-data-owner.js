// Owner of reference data (accounts and categories), H12a. The query cache is
// the authoritative store; `data` is the last good DTO kept on screen while a
// refresh runs, so a refresh never blanks the shell. Every load and refresh
// takes a generation: a result or failure from a superseded request (for
// example one cancelled by a cross-tab refresh) is ignored instead of
// overwriting newer data or showing an error screen.

import { isCancelledError } from "@tanstack/react-query";

import { queryKeys } from "./query-keys.js";
import { buildRequestErrorMessage, describeAppShellError } from "./request-errors.js";
import { fetchWithTimeout } from "./request-timeout.js";

async function fetchReferenceDataJson() {
  const response = await fetchWithTimeout("/api/reference-data", {
    cache: "no-store"
  }, "Reference data request");
  if (!response.ok) {
    throw new Error(await buildRequestErrorMessage(response, "Reference data failed."));
  }
  return response.json();
}

function isAbort(error) {
  return (error instanceof DOMException && error.name === "AbortError") || isCancelledError(error);
}

export function createReferenceDataOwner({
  queryClient,
  onCacheCleared = () => {},
  reportIssue = () => {},
  fetcher = fetchReferenceDataJson
}) {
  const queryKey = queryKeys.referenceData();
  let state = { data: null, error: "" };
  let generation = 0;
  const listeners = new Set();

  const setState = (patch) => {
    state = { ...state, ...patch };
    for (const listener of [...listeners]) {
      listener();
    }
  };

  const read = ({ bypassCache }) => {
    if (!bypassCache) {
      const cached = queryClient.getQueryData(queryKey);
      if (cached) {
        return Promise.resolve(cached);
      }
    }
    return bypassCache
      ? queryClient.fetchQuery({ queryKey, queryFn: fetcher, retry: false, staleTime: 0 })
      : queryClient.ensureQueryData({ queryKey, queryFn: fetcher, retry: false, revalidateIfStale: true });
  };

  const clearCache = () => {
    onCacheCleared();
    queryClient.cancelQueries({ queryKey });
    queryClient.removeQueries({ queryKey });
  };

  // Clears the cache and fetches fresh data, keeping the last snapshot on
  // screen meanwhile. Throws only while it is still the latest request; a
  // superseded refresh resolves to null.
  const refresh = async () => {
    const mine = ++generation;
    clearCache();
    try {
      const data = await read({ bypassCache: true });
      if (mine !== generation) {
        return null;
      }
      setState({ data, error: "" });
      return data;
    } catch (error) {
      if (mine !== generation) {
        return null;
      }
      throw error;
    }
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,

    // First load: reuses the cache. A failure clears the snapshot and shows
    // the reference-data error screen.
    async load({ signal } = {}) {
      const mine = ++generation;
      try {
        const data = await read({ bypassCache: false });
        if (mine === generation && !signal?.aborted) {
          setState({ data, error: "" });
        }
      } catch (error) {
        if (mine !== generation || signal?.aborted || isAbort(error)) {
          return;
        }
        setState({ data: null, error: describeAppShellError(error) });
        reportIssue("Reference data load failed", error);
      }
    },

    refresh,

    // A refresh whose failure shows the error screen (cross-tab refresh and
    // the retry button).
    async refreshOrShowError(issueLabel) {
      try {
        return await refresh();
      } catch (error) {
        setState({ error: describeAppShellError(error) });
        reportIssue(issueLabel, error);
        return null;
      }
    },

    clearCache
  };
}
