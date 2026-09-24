import { useCallback, useEffect, useMemo, useRef } from "react";

import { isEditableElement } from "./deferred-focus.js";
import { ROUTE_IDS, getRouteModuleState, loadRouteModule } from "./route-modules.js";
import { missingRouteBytes, readWarmupCosts } from "./route-warmup-costs.js";
import { createWarmupDataAdapter } from "./route-warmup-data.js";
import { buildVisitKey, evaluateWarmup, selectWarmupCandidates, selectWarmupMode } from "./route-warmup-policy.js";
import { createRouteWarmupScheduler } from "./route-warmup-scheduler.js";

// Wires browser signals into the route warmup scheduler: visibility, network
// hints, device mode, user interaction and editable focus. The latest route
// context lives in refs, so unrelated rerenders never reset the quiet period.
// Test override: window.__MONIES_MAP_WARMUP_MODE__ = "off" | "intent-only".

const INTERACTION_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"];
// A mouse sweeping across the tab strip is not intent; warm only after the
// pointer rests on a link this long.
const HOVER_INTENT_DELAY_MS = 100;

function matchQuery(query) {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query) : null;
}

function createBrowserIdle() {
  return {
    request(callback) {
      if (typeof window.requestIdleCallback === "function") {
        return { type: "idle", id: window.requestIdleCallback(callback, { timeout: 1000 }) };
      }
      return { type: "timeout", id: window.setTimeout(callback, 0) };
    },
    cancel(handle) {
      if (handle.type === "idle") {
        window.cancelIdleCallback?.(handle.id);
      } else {
        window.clearTimeout(handle.id);
      }
    }
  };
}

export function useRouteWarmup({ routeIdentity, routeWork, queryEpoch, queryClient, availableMonths, summaryRange }) {
  const visitKey = useMemo(() => buildVisitKey(routeIdentity), [routeIdentity]);
  const schedulerRef = useRef(null);
  const latestRef = useRef({ routeIdentity, routeWork, visitKey, availableMonths, summaryRange });
  latestRef.current = { routeIdentity, routeWork, visitKey, availableMonths, summaryRange };
  const lastInteractionAtRef = useRef(0);
  const usableSinceRef = useRef(0);
  const editableFocusedRef = useRef(false);
  // In-memory only: where the user went next from each visit in this tab.
  const recentDestinationsRef = useRef(new Map());
  const previousIdentityRef = useRef(null);

  const notify = useCallback((options = {}) => {
    schedulerRef.current?.updateContext({ visitKey: latestRef.current.visitKey, ...options });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }
    const now = () => performance.now();
    const narrowViewport = matchQuery("(max-width: 760px)");
    const coarsePointer = matchQuery("(pointer: coarse)");
    const readMode = () => selectWarmupMode({
      narrowViewport: narrowViewport ? narrowViewport.matches : null,
      coarsePointer: coarsePointer ? coarsePointer.matches : null
    });

    const clock = {
      now,
      setTimeout: (callback, delay) => window.setTimeout(callback, delay),
      clearTimeout: (id) => window.clearTimeout(id)
    };
    const scheduler = createRouteWarmupScheduler({
      clock,
      idle: createBrowserIdle(),
      loadModule: loadRouteModule,
      readInput: () => {
        const { routeWork: work } = latestRef.current;
        const connection = navigator.connection;
        return {
          mode: readMode(),
          page: {
            visible: document.visibilityState === "visible",
            online: navigator.onLine !== false,
            saveData: Boolean(connection?.saveData),
            effectiveType: connection?.effectiveType ?? null
          },
          work: {
            ready: work.ready,
            busy: work.busy || editableFocusedRef.current,
            requiredCount: work.requiredCount
          },
          quietSince: Math.max(lastInteractionAtRef.current, usableSinceRef.current),
          recentRequiredDurationMs: null,
          warmupMode: window.__MONIES_MAP_WARMUP_MODE__
        };
      },
      evaluate: evaluateWarmup,
      selectCandidates: () => {
        const { routeIdentity: identity, visitKey: key, availableMonths: months, summaryRange: range } = latestRef.current;
        return selectWarmupCandidates({
          mode: readMode(),
          identity,
          availableMonths: months ?? [],
          summaryRange: range ?? null,
          recentDestination: recentDestinationsRef.current.get(key) ?? null
        });
      },
      dataFor: createWarmupDataAdapter({ queryClient, clock }),
      costFor: (routeId) => {
        const state = getRouteModuleState(routeId);
        const loadedRouteIds = ROUTE_IDS.filter((id) => getRouteModuleState(id) === "loaded");
        return {
          alreadyLoaded: state === "loaded",
          pending: state === "pending",
          missingBytes: missingRouteBytes(readWarmupCosts(), routeId, loadedRouteIds)
        };
      }
    });
    schedulerRef.current = scheduler;

    const onInteraction = () => {
      lastInteractionAtRef.current = now();
      notify();
    };
    const onFocusIn = (event) => {
      if (isEditableElement(event.target)) {
        editableFocusedRef.current = true;
        notify();
      }
    };
    const onFocusOut = (event) => {
      if (editableFocusedRef.current && isEditableElement(event.target) && !isEditableElement(event.relatedTarget)) {
        editableFocusedRef.current = false;
        lastInteractionAtRef.current = now();
        notify();
      }
    };
    const onVisibilityChange = () => {
      // Returning to the tab starts a new quiet interval; the visit budget is
      // kept, so nothing missed while hidden is replayed.
      if (document.visibilityState === "visible") {
        lastInteractionAtRef.current = now();
      }
      notify();
    };
    const onSignalChange = () => notify();
    const listenerOptions = { capture: true, passive: true };

    for (const type of INTERACTION_EVENTS) {
      window.addEventListener(type, onInteraction, listenerOptions);
    }
    document.addEventListener("scroll", onInteraction, listenerOptions);
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", onFocusOut, true);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", onSignalChange);
    window.addEventListener("offline", onSignalChange);
    navigator.connection?.addEventListener?.("change", onSignalChange);
    narrowViewport?.addEventListener?.("change", onSignalChange);
    coarsePointer?.addEventListener?.("change", onSignalChange);
    notify();

    return () => {
      scheduler.dispose();
      if (schedulerRef.current === scheduler) {
        schedulerRef.current = null;
      }
      for (const type of INTERACTION_EVENTS) {
        window.removeEventListener(type, onInteraction, listenerOptions);
      }
      document.removeEventListener("scroll", onInteraction, listenerOptions);
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("focusout", onFocusOut, true);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", onSignalChange);
      window.removeEventListener("offline", onSignalChange);
      navigator.connection?.removeEventListener?.("change", onSignalChange);
      narrowViewport?.removeEventListener?.("change", onSignalChange);
      coarsePointer?.removeEventListener?.("change", onSignalChange);
    };
  }, [notify, queryClient]);

  // A new visit or a change in readiness re-evaluates. Becoming usable (page
  // loaded, or the last editor closed) starts a full quiet interval.
  useEffect(() => {
    const previous = previousIdentityRef.current;
    if (previous && buildVisitKey(previous) !== visitKey) {
      recentDestinationsRef.current.set(buildVisitKey(previous), routeIdentity);
    }
    previousIdentityRef.current = routeIdentity;
  }, [routeIdentity, visitKey]);

  useEffect(() => {
    if (routeWork.usable) {
      usableSinceRef.current = performance.now();
    }
    notify();
  }, [notify, routeWork.busy, routeWork.ready, routeWork.requiredCount, routeWork.usable, visitKey]);

  // Invalidation starts a new generation without refilling the visit budget.
  const firstEpochRef = useRef(true);
  useEffect(() => {
    if (firstEpochRef.current) {
      firstEpochRef.current = false;
      return;
    }
    notify({ newGeneration: true });
  }, [notify, queryEpoch]);

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
      const offer = (trigger) => schedulerRef.current?.offerIntent({ routeId, trigger });
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
