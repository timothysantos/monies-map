import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { createReferenceDataOwner } from "./reference-data-owner.js";

// React binding for the reference-data owner: one owner per App, its state
// read with useSyncExternalStore, and the first load started on mount.
export function useReferenceData({ queryClient, onCacheCleared, reportIssue }) {
  const latestRef = useRef({ onCacheCleared, reportIssue });
  latestRef.current = { onCacheCleared, reportIssue };
  const [owner] = useState(() => createReferenceDataOwner({
    queryClient,
    onCacheCleared: () => latestRef.current.onCacheCleared?.(),
    reportIssue: (label, error) => latestRef.current.reportIssue?.(label, error)
  }));
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);

  useEffect(() => {
    const controller = new AbortController();
    void owner.load({ signal: controller.signal });
    return () => controller.abort();
  }, [owner]);

  return { referenceData: state.data, referenceDataError: state.error, referenceDataOwner: owner };
}
