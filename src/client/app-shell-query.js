export const APPSHELL_PERSISTED_CACHE_KEY = "monies-map-appShell-cache-v2";

export function buildAppShellParams({ month, scope, summaryStart, summaryEnd }) {
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
  return new URLSearchParams({
    view: viewId,
    month
  });
}

export function readPersistedAppShell(cacheKey) {
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
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(APPSHELL_PERSISTED_CACHE_KEY);
  } catch {}
}
