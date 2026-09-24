import { useRef, useState, useSyncExternalStore } from "react";

import { createRouteDataOwner } from "./route-data-owner.js";

// React binding for the generic route data owner (Month, Splits, Imports,
// Settings pages).
export function useRouteData({ queryClient, onCacheCleared, requestKeyOf }) {
  const latestRef = useRef({ onCacheCleared });
  latestRef.current = { onCacheCleared };
  const [owner] = useState(() => createRouteDataOwner({
    queryClient,
    onCacheCleared: () => latestRef.current.onCacheCleared?.(),
    requestKeyOf
  }));
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  return { routePageData: state.data, routePageDataRequestKey: state.requestKey, routeDataOwner: owner };
}
