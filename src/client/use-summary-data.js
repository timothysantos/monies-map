import { useRef, useState, useSyncExternalStore } from "react";

import { createSummaryOwner } from "./summary-owner.js";

// React binding for the Summary owner: one owner per App, its state read
// with useSyncExternalStore. The fetchers come from App (they also update the
// shell's loading status) and are read through a ref, so the owner never
// changes identity.
export function useSummaryData({ queryClient, onCacheCleared, fetchPage, fetchPills }) {
  const latestRef = useRef({ onCacheCleared, fetchPage, fetchPills });
  latestRef.current = { onCacheCleared, fetchPage, fetchPills };
  const [owner] = useState(() => createSummaryOwner({
    queryClient,
    onCacheCleared: () => latestRef.current.onCacheCleared?.(),
    fetchPage: (params, options) => latestRef.current.fetchPage(params, options),
    fetchPills: (params, options) => latestRef.current.fetchPills(params, options)
  }));
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  return {
    summaryPageData: state.summaryPage,
    summaryAccountPillsData: state.accountPills,
    summaryPageDataRequestKey: state.requestKey,
    summaryOwner: owner
  };
}
