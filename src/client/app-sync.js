export const APP_SYNC_CHANNEL = "monies-map-app-sync";
export const APP_SYNC_STORAGE_KEY = "monies-map-app-sync";

export const APP_SYNC_EVENT_TYPES = {
  appShellRefresh: "app-shell-refresh",
  splitMutation: "split-mutation"
};

export function publishAppSyncEvent(syncChannelRef, payload) {
  try {
    syncChannelRef.current?.postMessage(payload);
  } catch {}

  try {
    window.localStorage.setItem(APP_SYNC_STORAGE_KEY, JSON.stringify(payload));
  } catch {}
}

export function broadcastAppShellRefresh(syncChannelRef) {
  publishAppSyncEvent(syncChannelRef, {
    type: APP_SYNC_EVENT_TYPES.appShellRefresh,
    ts: Date.now()
  });
}

export function buildSplitMutationSyncEvent({
  month,
  invalidateEntries = false,
  invalidateMonth = false,
  invalidateSummary = false,
  refreshShell = false
}) {
  return {
    type: APP_SYNC_EVENT_TYPES.splitMutation,
    ts: Date.now(),
    month,
    invalidateEntries,
    invalidateMonth,
    invalidateSummary,
    refreshShell
  };
}

export function isMonthWithinRange(month, startMonth, endMonth) {
  if (!month) {
    return false;
  }

  if (startMonth && month < startMonth) {
    return false;
  }

  if (endMonth && month > endMonth) {
    return false;
  }

  return true;
}
