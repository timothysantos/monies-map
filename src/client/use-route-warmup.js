import { useCallback, useEffect, useRef } from "react";

import { createWarmupDataAdapter } from "./route-warmup-data.js";
import { requiredTiming } from "./query-leases.js";
import { ROUTE_IDS, getRouteModuleState, loadRouteModule } from "./route-modules.js";
import { MOBILE_LAYOUT_QUERY } from "./use-viewport.js";

// First-screen half of route warmup: the stable per-route handlers for the
// tab links, and the effect that loads the engine. The engine itself (policy,
// scheduler, data adapter: route-warmup-engine.js) is a lazy chunk fetched
// the first time the page is usable; it plugs its scheduler in here. Until
// then a hover or focus offers nothing, which the policy would have refused
// anyway on a page that is not usable yet.
// Test override: window.__MONIES_MAP_WARMUP_MODE__ = "off" | "intent-only".

// A mouse sweeping across the tab strip is not intent; warm only after the
// pointer rests on a link this long.
const HOVER_INTENT_DELAY_MS = 100;

export const warmupBridge = {
  /** @type {null | ((routeId: string, trigger: string) => unknown)} */
  offerIntent: null
};

const ROUTE_MODULES = Object.freeze({ ids: ROUTE_IDS, load: loadRouteModule, state: getRouteModuleState });

/**
 * Loads the warmup engine once the page is usable and keeps it following the
 * route. An engine that fails to load only means no optional warmup.
 * @param {{ routeIdentity: any, routeWork: any, queryEpoch: any, queryClient: any, availableMonths: any, summaryRange: any }} context
 */
export function useRouteWarmupEngine(context) {
  const { routeIdentity, routeWork, queryEpoch, queryClient, availableMonths, summaryRange } = context;
  const armedRef = useRef(false);
  if (routeWork.usable) armedRef.current = true;
  const armed = armedRef.current;
  const latestRef = useRef(context);
  latestRef.current = context;
  const engineRef = useRef(null);

  useEffect(() => {
    if (!armed) return undefined;
    let cancelled = false;
    import("./route-warmup-engine.js").then(({ createRouteWarmupEngine }) => {
      if (cancelled) return;
      engineRef.current = createRouteWarmupEngine({
        routeModules: ROUTE_MODULES,
        dataFor: createWarmupDataAdapter({ queryClient, clock: window }),
        phoneLayoutQuery: MOBILE_LAYOUT_QUERY,
        requiredTiming,
        initial: latestRef.current,
        onIntent: (offer) => { warmupBridge.offerIntent = offer; }
      });
    }, () => {});
    return () => {
      cancelled = true;
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, [armed, queryClient]);

  useEffect(() => {
    engineRef.current?.update({ routeIdentity, routeWork, queryEpoch, availableMonths, summaryRange });
  }, [routeIdentity, routeWork, queryEpoch, availableMonths, summaryRange]);
}

export function useRouteWarmup() {
  // Stable per-route handlers for NavLink. They never prevent default or
  // delay navigation; the click itself always loads through loadRouteModule.
  const intentPropsRef = useRef(new Map());
  const hoverTimersRef = useRef(new Map());
  useEffect(() => () => {
    for (const timer of hoverTimersRef.current.values()) {
      window.clearTimeout(timer);
    }
    hoverTimersRef.current.clear();
  }, []);
  return useCallback((routeId) => {
    if (!intentPropsRef.current.has(routeId)) {
      const offer = (trigger) => warmupBridge.offerIntent?.(routeId, trigger);
      const cancelHover = () => {
        window.clearTimeout(hoverTimersRef.current.get(routeId));
        hoverTimersRef.current.delete(routeId);
      };
      intentPropsRef.current.set(routeId, {
        onPointerEnter: (event) => {
          if (event.pointerType !== "mouse") return;
          cancelHover();
          hoverTimersRef.current.set(routeId, window.setTimeout(() => {
            hoverTimersRef.current.delete(routeId);
            offer("hover");
          }, HOVER_INTENT_DELAY_MS));
        },
        onPointerLeave: cancelHover,
        onFocus: (event) => {
          if (event.currentTarget?.matches?.(":focus-visible")) offer("focus");
        },
        onPointerDown: (event) => {
          if (event.pointerType === "touch" || event.pointerType === "pen") offer("pointerdown");
        }
      });
    }
    return intentPropsRef.current.get(routeId);
  }, []);
}
