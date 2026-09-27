import { createContext, createElement, useContext, useEffect, useId, useMemo, useSyncExternalStore } from "react";

// Route panels and their delegated editors report readiness and busy state
// through this context; they never receive the registry or App setters.
const RouteWorkContext = createContext({ registry: null, routeKey: null });
// Never equal to a real route key (those always start with a tab ID).
const INACTIVE_ROUTE_KEY = "";

// App wraps the rendered route element. routeKey is null while a previous
// page is kept on screen, so that page cannot make the new route ready.
export function RouteWorkProvider({ registry, routeKey, children }) {
  // A stable value keeps App re-renders from re-rendering every reporting
  // panel and row; only a route key change reaches them.
  const value = useMemo(() => ({ registry, routeKey }), [registry, routeKey]);
  return createElement(RouteWorkContext.Provider, { value }, children);
}

// Reports this mounted instance only. Dependencies are primitives, so
// rerenders do not re-report, and StrictMode's setup/cleanup/setup sequence
// ends with exactly one report.
export function useRouteWorkReport({ ready = true, busy = false } = {}) {
  const { registry, routeKey } = useContext(RouteWorkContext);
  const ownerId = useId();
  const isReady = Boolean(ready);
  const isBusy = Boolean(busy);

  useEffect(() => {
    if (!registry) {
      return undefined;
    }
    // A page kept on screen during a transition gets a null key: it reports
    // under an inactive key, so it cannot make the new route ready, but an
    // editor still open on it keeps blocking optional work.
    registry.report({ ownerId, routeKey: routeKey ?? INACTIVE_ROUTE_KEY, ready: isReady, busy: isBusy });
    return undefined;
  }, [isBusy, isReady, ownerId, registry, routeKey]);

  useEffect(() => {
    if (!registry) {
      return undefined;
    }
    return () => {
      registry.release(ownerId);
    };
  }, [ownerId, registry]);
}

// Delegated editors and rows report only while busy, so mounting a long list
// adds no registry traffic. Route panels use useRouteWorkReport instead,
// because a route with no report is never ready.
export function useRouteWorkBusy(busy) {
  const { registry, routeKey } = useContext(RouteWorkContext);
  const ownerId = useId();
  const isBusy = Boolean(busy);

  useEffect(() => {
    if (!registry || !isBusy) {
      return undefined;
    }
    registry.report({ ownerId, routeKey: routeKey ?? INACTIVE_ROUTE_KEY, ready: true, busy: true });
    return () => {
      registry.release(ownerId);
    };
  }, [isBusy, ownerId, registry, routeKey]);
}

export function useRouteWorkSnapshot(registry, routeKey) {
  // Encode the aggregate as a string so App re-renders only when readiness or
  // busy state for the active route actually changes, not on every report.
  const encoded = useSyncExternalStore(
    registry.subscribe,
    () => encodeSnapshot(registry.snapshot(routeKey)),
    () => encodeSnapshot(registry.snapshot(routeKey))
  );
  return useMemo(() => ({
    hasReport: encoded[0] === "1",
    ready: encoded[1] === "1",
    busy: encoded[2] === "1"
  }), [encoded]);
}

function encodeSnapshot(snapshot) {
  return `${snapshot.hasReport ? 1 : 0}${snapshot.ready ? 1 : 0}${snapshot.busy ? 1 : 0}`;
}

export function useRequiredWorkCount(counter) {
  return useSyncExternalStore(counter.subscribe, counter.count, counter.count);
}
