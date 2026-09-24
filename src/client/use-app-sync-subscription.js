import { useEffect, useRef } from "react";

import { APP_SYNC_CHANNEL, APP_SYNC_EVENT_TYPES, APP_SYNC_STORAGE_KEY } from "./app-sync.js";

// Reads one cross-tab payload from a storage event, or null when the event
// is not an app sync message.
export function parseAppSyncStorageEvent(event, storageKey = APP_SYNC_STORAGE_KEY) {
  if (event?.key !== storageKey || !event.newValue) {
    return null;
  }
  try {
    const payload = JSON.parse(event.newValue);
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

// Routes one cross-tab payload to its handler. `source` says whether it came
// from the BroadcastChannel or the storage fallback, because a shell refresh
// arriving through storage also clears the Summary caches.
export function dispatchAppSyncEvent(payload, source, handlers) {
  switch (payload?.type) {
    case APP_SYNC_EVENT_TYPES.appShellRefresh:
      handlers.onShellRefresh?.(source);
      return true;
    case APP_SYNC_EVENT_TYPES.splitMutation:
      handlers.onSplitMutation?.(payload);
      return true;
    case APP_SYNC_EVENT_TYPES.entryMutation:
      handlers.onEntryMutation?.(payload);
      return true;
    case APP_SYNC_EVENT_TYPES.summaryMutation:
      handlers.onSummaryMutation?.(payload);
      return true;
    default:
      return false;
  }
}

// Subscribes to cross-tab sync messages for the life of the component and
// keeps the BroadcastChannel in `channelRef`, which the publishers use.
// Handlers are read through a ref, so changing them never resubscribes.
export function useAppSyncSubscription(channelRef, handlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    let channel = null;
    if ("BroadcastChannel" in window) {
      channel = new window.BroadcastChannel(APP_SYNC_CHANNEL);
      channelRef.current = channel;
      channel.onmessage = (event) => {
        dispatchAppSyncEvent(event.data, "channel", handlersRef.current);
      };
    }

    const handleStorage = (event) => {
      const payload = parseAppSyncStorageEvent(event);
      if (payload) {
        dispatchAppSyncEvent(payload, "storage", handlersRef.current);
      }
    };
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener("storage", handleStorage);
      if (channel) {
        channel.close();
        channelRef.current = null;
      }
    };
  }, [channelRef]);
}
