// The settled rows the Splits page does not send (docs/flows/splits-flow.md,
// "Settled sections load on demand"): a settled section's rows load when it
// is opened, a search looks inside the group's settled sections on the
// server, and a deep link to a settled split expense loads its section.
//
// The TanStack Query cache is the one store (one entry per section, search
// and deep link); this hook only reads it and starts the reads. A required
// read (an open section, a search) goes through fetchQueryWithLease; a hover
// or focus on a section's heading on a wide screen starts a speculative one
// (startSpeculativeQuery) that the click then joins. Both come from the
// shell as `fetchRequiredQuery` and `startOptionalQuery` (App.jsx), so this
// route chunk does not import query-leases. A failed read stays failed until
// the person taps Try again, so it never loops. A split save that refreshes
// the page clears every "splits-settled-" entry with the page's own
// (App.jsx, clearSplitMutationCaches), and the open sections read again.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { buildRequestErrorMessage } from "./request-errors";

// The cache keys (every family starts "splits-settled-", which is how a
// split save clears them).
const SETTLED_KEY_PREFIX = "splits-settled-";
export const settledQueryKeys = {
  // One settled section's rows.
  rows: ({ viewId, checkpointId, groupId }) => ["splits-settled-rows", { viewId, checkpointId, groupId }],
  // The section of a split expense a deep link names.
  record: ({ viewId, recordId }) => ["splits-settled-record", { viewId, recordId }],
  // A group's settled records that match a Splits search.
  search: ({ viewId, groupId, query }) => ["splits-settled-search", { viewId, groupId, query }]
};

// A search waits for a short pause in typing before it asks the server.
export const SETTLED_SEARCH_DELAY_MS = 250;

async function getJson(path, signal, fallback) {
  const response = await fetch(path, { cache: "no-store", signal });
  if (!response.ok) {
    throw new Error(await buildRequestErrorMessage(response, fallback));
  }
  return response.json();
}

export function settledRowsPath({ viewId, checkpointId, groupId }) {
  return `/api/splits/settled-rows?${new URLSearchParams({ view: viewId, checkpoint: checkpointId, group: groupId })}`;
}

export function settledRecordPath({ viewId, recordId }) {
  return `/api/splits/settled-rows?${new URLSearchParams({ view: viewId, record: recordId })}`;
}

export function settledSearchPath({ viewId, groupId, query }) {
  return `/api/splits/settled-search?${new URLSearchParams({ view: viewId, group: groupId, q: query })}`;
}

// "idle" (never asked), "loading", "ready" (with data) or "error".
export function settledQueryState(queryClient, queryKey) {
  const state = queryClient.getQueryState(queryKey);
  if (state?.data) {
    return { status: "ready", data: state.data, isFetching: state.fetchStatus === "fetching" };
  }
  if (state?.fetchStatus === "fetching") {
    return { status: "loading", data: null };
  }
  if (state?.status === "error") {
    return { status: "error", data: null, error: state.error };
  }
  return { status: "idle", data: null };
}

/**
 * The deep link's read: the section that holds a settled split expense, with
 * its rows. The rows also fill that section's own cache entry, so opening
 * the section shows them at once. Resolves null when the expense is not in a
 * settled section (or the read failed).
 */
export async function loadSettledRecordSection(queryClient, fetchRequiredQuery, { viewId, recordId }) {
  try {
    const data = await fetchRequiredQuery({
      queryKey: settledQueryKeys.record({ viewId, recordId }),
      signal: undefined,
      abortMessage: "Settled split request aborted.",
      fetcher: ({ signal }) => getJson(settledRecordPath({ viewId, recordId }), signal, "Settled split rows failed.")
    });
    if (!data?.checkpointId || !data.items?.length) {
      return null;
    }
    const sectionKey = settledQueryKeys.rows({ viewId, checkpointId: data.checkpointId, groupId: data.groupId });
    if (!queryClient.getQueryData(sectionKey)) {
      queryClient.setQueryData(sectionKey, data);
    }
    return data;
  } catch {
    return null;
  }
}

/**
 * The settled rows of the open group: each section's state, the search's
 * matches, and the calls that load them. `checkpointIds` are the group's
 * settled sections, `openIds` the ones open on screen.
 */
export function useSettledSplitRows({ queryClient, fetchRequiredQuery, startOptionalQuery, viewId, groupId, checkpointIds, openIds, searchQuery = "", canPrefetch = false }) {
  const versionRef = useRef(0);
  const subscribe = useCallback((listener) => queryClient.getQueryCache().subscribe((event) => {
    if (String(event?.query?.queryKey?.[0] ?? "").startsWith(SETTLED_KEY_PREFIX)) {
      versionRef.current += 1;
      listener();
    }
  }), [queryClient]);
  const readVersion = useCallback(() => versionRef.current, []);
  const version = useSyncExternalStore(subscribe, readVersion, readVersion);

  const sectionKey = useCallback((checkpointId) => settledQueryKeys.rows({ viewId, checkpointId, groupId }), [groupId, viewId]);
  const sectionFetcher = useCallback((checkpointId) => ({ signal }) => getJson(
    settledRowsPath({ viewId, checkpointId, groupId }),
    signal,
    "Settled split rows failed."
  ), [groupId, viewId]);

  const loadSection = useCallback((checkpointId) => fetchRequiredQuery({
    queryKey: sectionKey(checkpointId),
    signal: undefined,
    abortMessage: "Settled split rows request aborted.",
    fetcher: sectionFetcher(checkpointId)
  }).catch(() => null), [fetchRequiredQuery, sectionFetcher, sectionKey]);

  // Open sections read their rows once; a failure waits for Try again.
  useEffect(() => {
    for (const checkpointId of openIds) {
      if (checkpointIds.includes(checkpointId) && settledQueryState(queryClient, sectionKey(checkpointId)).status === "idle") {
        void loadSection(checkpointId);
      }
    }
  }, [checkpointIds, loadSection, openIds, queryClient, sectionKey, version]);

  // A wide screen's hover or focus on a section heading starts its read early.
  const prefetchSection = useCallback((checkpointId) => {
    if (!canPrefetch || !startOptionalQuery || settledQueryState(queryClient, sectionKey(checkpointId)).status !== "idle") {
      return;
    }
    startOptionalQuery({ queryKey: sectionKey(checkpointId), fetcher: sectionFetcher(checkpointId) });
  }, [canPrefetch, queryClient, sectionFetcher, sectionKey, startOptionalQuery]);

  const trimmedQuery = searchQuery.trim();
  const [settledQuery, setSettledQuery] = useState(trimmedQuery);
  useEffect(() => {
    if (!trimmedQuery) {
      setSettledQuery("");
      return undefined;
    }
    const timer = setTimeout(() => setSettledQuery(trimmedQuery), SETTLED_SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [trimmedQuery]);
  const searchesSettled = Boolean(trimmedQuery) && checkpointIds.length > 0;
  const searchKey = useMemo(
    () => (searchesSettled && settledQuery ? settledQueryKeys.search({ viewId, groupId, query: settledQuery }) : null),
    [groupId, searchesSettled, settledQuery, viewId]
  );
  const loadSearch = useCallback(() => {
    if (!searchKey) {
      return Promise.resolve(null);
    }
    return fetchRequiredQuery({
      queryKey: searchKey,
      signal: undefined,
      abortMessage: "Settled split search aborted.",
      fetcher: ({ signal }) => getJson(settledSearchPath({ viewId, groupId, query: settledQuery }), signal, "Settled split search failed.")
    }).catch(() => null);
  }, [fetchRequiredQuery, groupId, searchKey, settledQuery, viewId]);
  useEffect(() => {
    if (searchKey && settledQueryState(queryClient, searchKey).status === "idle") {
      void loadSearch();
    }
  }, [loadSearch, queryClient, searchKey, version]);

  // While the person types, the last answer stays on screen (narrowed on the
  // page by the current words) until the new one arrives.
  const lastSearchRef = useRef(null);
  const search = useMemo(() => {
    if (!searchesSettled) {
      lastSearchRef.current = null;
      return { status: "off", items: [] };
    }
    const state = searchKey ? settledQueryState(queryClient, searchKey) : { status: "loading", data: null };
    if (state.status === "ready") {
      lastSearchRef.current = state.data;
      return { status: settledQuery === trimmedQuery ? "ready" : "loading", items: state.data.items ?? [], truncated: Boolean(state.data.truncated) };
    }
    const previous = lastSearchRef.current?.groupId === groupId ? lastSearchRef.current : null;
    return { status: state.status === "error" ? "error" : "loading", items: previous?.items ?? [] };
    // `version` re-reads the cache when a read lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, queryClient, searchKey, searchesSettled, settledQuery, trimmedQuery, version]);

  const sections = useMemo(() => {
    const byId = new Map();
    for (const checkpointId of checkpointIds) {
      const state = settledQueryState(queryClient, sectionKey(checkpointId));
      byId.set(checkpointId, { status: state.status, items: state.data?.items ?? [], truncated: Boolean(state.data?.truncated) });
    }
    return byId;
    // `version` re-reads the cache when a read lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkpointIds, queryClient, sectionKey, version]);

  // A settled row the page holds now (an open section's or a search's).
  const findItem = useCallback((kind, id) => {
    for (const section of sections.values()) {
      const item = section.items.find((candidate) => candidate.kind === kind && candidate.id === id);
      if (item) {
        return item;
      }
    }
    return search.items.find((candidate) => candidate.kind === kind && candidate.id === id) ?? null;
  }, [search.items, sections]);

  return {
    sections,
    search,
    loadSection,
    prefetchSection,
    retrySearch: loadSearch,
    findItem
  };
}
