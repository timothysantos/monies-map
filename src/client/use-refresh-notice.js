import { useCallback, useLayoutEffect, useState, useSyncExternalStore } from "react";

import { createRefreshNoticeOwner } from "./refresh-notice.js";

// React binding for the background refresh notice. The owner follows the
// active route key so a route change clears the previous route's notice and
// silences its late failures.
export function useRefreshNotice(routeKey) {
  const [owner] = useState(createRefreshNoticeOwner);
  const { notice } = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  useLayoutEffect(() => {
    owner.setRouteKey(routeKey);
  }, [owner, routeKey]);
  const runBackgroundRefresh = useCallback((task, retry = task) => owner.settle(task, { retry }), [owner]);
  return { refreshNotice: notice, refreshNoticeOwner: owner, runBackgroundRefresh };
}
