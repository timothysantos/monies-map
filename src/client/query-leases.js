// Required-consumer leases for query keys, plus the two ways the app fetches
// route data through TanStack Query: required reads (the visible route needs
// the data now) and speculative reads (optional warmup). Leases are
// scheduling metadata only; the query cache remains the single data store.

import { hashKey, isCancelledError } from "@tanstack/react-query";

import { WARMUP_LIMITS } from "./route-warmup-policy.js";

export function createRequiredLeases() {
  const counts = new Map();
  const listeners = new Map();

  return {
    // Take before the first cache read, release in finally. Release is
    // idempotent so a double finally cannot drop another consumer's lease.
    acquire(queryKey) {
      const hash = hashKey(queryKey);
      counts.set(hash, (counts.get(hash) ?? 0) + 1);
      for (const listener of [...(listeners.get(hash) ?? [])]) {
        listener();
      }
      let released = false;
      return () => {
        if (released) {
          return;
        }
        released = true;
        const next = (counts.get(hash) ?? 1) - 1;
        if (next > 0) {
          counts.set(hash, next);
        } else {
          counts.delete(hash);
        }
      };
    },
    isRequired(queryKey) {
      return (counts.get(hashKey(queryKey)) ?? 0) > 0;
    },
    // Notified whenever a required consumer acquires this key (promotion).
    onAcquire(queryKey, listener) {
      const hash = hashKey(queryKey);
      const set = listeners.get(hash) ?? new Set();
      set.add(listener);
      listeners.set(hash, set);
      return () => {
        set.delete(listener);
        if (!set.size) {
          listeners.delete(hash);
        }
      };
    }
  };
}

export const requiredLeases = createRequiredLeases();

// How long the latest required fetch that reached the network took. Mobile
// data warmup reads it as a recent network-health signal; a reading older
// than maxAgeMs is unknown, and unknown never admits data.
export function createRequiredTiming({ now = () => performance.now(), maxAgeMs = 5 * 60 * 1000 } = {}) {
  let latest = null;
  return {
    start() {
      const startedAt = now();
      return () => {
        latest = { durationMs: now() - startedAt, at: now() };
      };
    },
    read() {
      return latest && now() - latest.at <= maxAgeMs ? latest.durationMs : null;
    }
  };
}

export const requiredTiming = createRequiredTiming();

function abortError(message) {
  return new DOMException(message, "AbortError");
}

// Required read. Returns any cached data as today (freshness is the caller's
// refresh plan), otherwise fetches with TanStack's signal forwarded to the
// network. The caller's own signal only guards applying the result: it never
// cancels a request another consumer may share. If a joined in-flight fetch
// is cancelled underneath a live caller (an optional attempt or a cache
// clear), fetch once more instead of failing the route.
export async function fetchQueryWithLease(queryClient, {
  queryKey,
  fetcher,
  bypassCache = false,
  signal,
  leases = requiredLeases,
  timing = requiredTiming,
  abortMessage = "Request aborted.",
  retry = false
}) {
  if (signal?.aborted) {
    throw abortError(abortMessage);
  }
  const release = leases.acquire(queryKey);
  try {
    if (!bypassCache) {
      const cachedData = queryClient.getQueryData(queryKey);
      if (cachedData) {
        return cachedData;
      }
    }

    const options = {
      queryKey,
      // Only successful network fetches are timed: cache hits and failures
      // say nothing about how fast the network is right now.
      queryFn: async ({ signal: querySignal }) => {
        const finish = timing.start();
        const data = await fetcher({ signal: querySignal });
        finish();
        return data;
      },
      retry
    };
    let data;
    try {
      data = bypassCache
        ? await queryClient.fetchQuery({ ...options, staleTime: 0 })
        : await queryClient.ensureQueryData({ ...options, revalidateIfStale: true });
    } catch (error) {
      if (!isCancelledError(error) || signal?.aborted) {
        throw error;
      }
      data = await queryClient.fetchQuery({ ...options, staleTime: 0 });
    }

    if (signal?.aborted) {
      throw abortError(abortMessage);
    }
    return data;
  } finally {
    release();
  }
}

// Optional read for warmup. Never joins or cancels someone else's request:
// it does not start while the key is already fetching or already required.
// It is cancelled only while it stays exclusively speculative (no lease, no
// observer, still in flight): at the deadline or when the caller cancels
// (hide, busy, generation change). A required consumer arriving promotes it,
// which clears the deadline so the shared request finishes. The promise
// always resolves to { status } and never rejects.
/**
 * @param {any} queryClient
 * @param {{ queryKey: any, fetcher: any, leases?: any, clock?: Pick<typeof globalThis, "setTimeout" | "clearTimeout">, deadlineMs?: number }} options
 */
export function startSpeculativeQuery(queryClient, {
  queryKey,
  fetcher,
  leases = requiredLeases,
  clock = globalThis,
  deadlineMs = WARMUP_LIMITS.speculativeDeadlineMs
}) {
  const findQuery = () => queryClient.getQueryCache().find({ queryKey, exact: true });
  if (leases.isRequired(queryKey)) {
    return { started: false, reason: "required", cancel: () => false, isPromoted: () => false, promise: Promise.resolve({ status: "skipped" }) };
  }
  if (findQuery()?.state.fetchStatus === "fetching") {
    return { started: false, reason: "already-fetching", cancel: () => false, isPromoted: () => false, promise: Promise.resolve({ status: "skipped" }) };
  }

  let promoted = false;
  let settled = false;
  let deadline = null;
  const clearDeadline = () => {
    if (deadline !== null) {
      clock.clearTimeout(deadline);
      deadline = null;
    }
  };

  const cancel = () => {
    if (settled || promoted || leases.isRequired(queryKey)) {
      return false;
    }
    const query = findQuery();
    if (!query || query.state.fetchStatus !== "fetching" || query.getObserversCount() > 0) {
      return false;
    }
    clearDeadline();
    void queryClient.cancelQueries({ queryKey, exact: true });
    return true;
  };

  const stopListening = leases.onAcquire(queryKey, () => {
    promoted = true;
    clearDeadline();
  });
  deadline = clock.setTimeout(() => {
    deadline = null;
    cancel();
  }, deadlineMs);

  const promise = queryClient.fetchQuery({
    queryKey,
    queryFn: ({ signal }) => fetcher({ signal }),
    retry: false,
    staleTime: 0
  }).then(
    () => ({ status: "fulfilled" }),
    (error) => ({ status: isCancelledError(error) ? "cancelled" : "failed" })
  ).then((result) => {
    settled = true;
    clearDeadline();
    stopListening();
    return { ...result, promoted };
  });

  return { started: true, reason: "started", cancel, isPromoted: () => promoted, promise };
}
