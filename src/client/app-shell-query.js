export const APPSHELL_PERSISTED_CACHE_KEY = "monies-map-appShell-cache-v2";

export function buildAppShellParams({ month, scope, summaryStart, summaryEnd }) {
  // Encode the shell query identity from the route state that actually
  // affects the shell payload.
  const params = new URLSearchParams({
    month,
    scope
  });
  if (summaryStart) {
    params.set("summary_start", summaryStart);
  }
  if (summaryEnd) {
    params.set("summary_end", summaryEnd);
  }
  return params;
}

export function buildEntriesShellParams({ viewId, month }) {
  // Encode the entries shell identity without dragging in unrelated route
  // state.
  return new URLSearchParams({
    view: viewId,
    month
  });
}

export function readPersistedAppShell(cacheKey) {
  // Restore the last shell payload only when the cache key still matches the
  // current route-derived request.
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const rawCache = window.localStorage.getItem(APPSHELL_PERSISTED_CACHE_KEY);
    if (!rawCache) {
      return null;
    }

    const parsedCache = JSON.parse(rawCache);
    if (parsedCache?.cacheKey !== cacheKey || !parsedCache?.data) {
      return null;
    }

    return parsedCache.data;
  } catch {
    return null;
  }
}

export function writePersistedAppShell(cacheKey, data) {
  // Persist the latest shell payload so a reload can reuse stable reference
  // data immediately.
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(APPSHELL_PERSISTED_CACHE_KEY, JSON.stringify({
      cacheKey,
      data,
      storedAt: Date.now()
    }));
  } catch {}
}

export function clearPersistedAppShell() {
  // Remove the persisted shell payload when mutation invalidation makes it
  // stale.
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(APPSHELL_PERSISTED_CACHE_KEY);
  } catch {}
}
