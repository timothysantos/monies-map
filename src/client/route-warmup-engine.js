import { isEditableElement } from "./deferred-focus.js";
import { missingRouteBytes, readWarmupCosts } from "./route-warmup-costs.js";
import { buildVisitKey, evaluateWarmup, selectWarmupCandidates, selectWarmupMode } from "./route-warmup-policy.js";
import { createRouteWarmupScheduler } from "./route-warmup-scheduler.js";

// The route warmup engine: wires browser signals into the scheduler
// (visibility, network hints, device mode, user interaction, editable focus)
// and follows the route as App reports it. It is a lazy chunk beside the first
// screen, loaded once the page is usable by use-route-warmup.js, and it
// imports no React and none of the first screen's shared modules (the glue
// hands it the route modules, the phone query and the timing read), so the
// bundler does not split the first screen's chunks around it
// (tests/first-screen-structure.test.mjs).
// The latest route context lives in variables, so unrelated updates never
// reset the quiet period.
// Test override: window.__MONIES_MAP_WARMUP_MODE__ = "off" | "intent-only".

const INTERACTION_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"];

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

/**
 * @param {{
 *   routeModules: { ids: readonly string[], load: (routeId: string) => Promise<unknown>, state: (routeId: string) => string },
 *   phoneLayoutQuery: string,
 *   dataFor: (candidate: any) => any,
 *   requiredTiming: { read: () => number | null },
 *   initial: { routeIdentity: any, routeWork: any, queryEpoch: any, availableMonths: any, summaryRange: any },
 *   onIntent: (offer: (routeId: string, trigger: string) => unknown) => void
 * }} options
 */
export function createRouteWarmupEngine({ routeModules, phoneLayoutQuery, dataFor, requiredTiming, initial, onIntent }) {
  const now = () => performance.now();
  let latest = { ...initial, visitKey: buildVisitKey(initial.routeIdentity) };
  let lastInteractionAt = 0;
  let usableSince = 0;
  let editableFocused = false;
  // In-memory only: where the user went next from each visit in this tab.
  const recentDestinations = new Map();
  let previousIdentity = null;

  // Same width as the phone layout; the coarse-pointer half stays local
  // because warmup cares about the device, not the layout.
  const narrowViewport = matchQuery(phoneLayoutQuery);
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
    loadModule: routeModules.load,
    readInput: () => {
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
          ready: latest.routeWork.ready,
          busy: latest.routeWork.busy || editableFocused,
          requiredCount: latest.routeWork.requiredCount
        },
        quietSince: Math.max(lastInteractionAt, usableSince),
        recentRequiredDurationMs: requiredTiming.read(),
        warmupMode: window.__MONIES_MAP_WARMUP_MODE__
      };
    },
    evaluate: evaluateWarmup,
    selectCandidates: () => selectWarmupCandidates({
      mode: readMode(),
      identity: latest.routeIdentity,
      availableMonths: latest.availableMonths ?? [],
      summaryRange: latest.summaryRange ?? null,
      recentDestination: recentDestinations.get(latest.visitKey) ?? null
    }),
    dataFor,
    costFor: (routeId) => {
      const state = routeModules.state(routeId);
      const loadedRouteIds = routeModules.ids.filter((id) => routeModules.state(id) === "loaded");
      return {
        alreadyLoaded: state === "loaded",
        pending: state === "pending",
        missingBytes: missingRouteBytes(readWarmupCosts(), routeId, loadedRouteIds)
      };
    }
  });

  const notify = (options = {}) => {
    scheduler.updateContext({ visitKey: latest.visitKey, ...options });
  };

  const onInteraction = () => {
    lastInteractionAt = now();
    notify();
  };
  const onFocusIn = (event) => {
    if (isEditableElement(event.target)) {
      editableFocused = true;
      notify();
    }
  };
  const onFocusOut = (event) => {
    if (editableFocused && isEditableElement(event.target) && !isEditableElement(event.relatedTarget)) {
      editableFocused = false;
      lastInteractionAt = now();
      notify();
    }
  };
  const onVisibilityChange = () => {
    // Returning to the tab starts a new quiet interval; the visit budget is
    // kept, so nothing missed while hidden is replayed.
    if (document.visibilityState === "visible") {
      lastInteractionAt = now();
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

  onIntent((routeId, trigger) => scheduler.offerIntent({ routeId, trigger }));
  notify();
  // The engine starts when the page is usable: a full quiet interval begins.
  previousIdentity = initial.routeIdentity;
  if (initial.routeWork.usable) usableSince = now();
  notify();

  return {
    // A new visit or a change in readiness re-evaluates. Becoming usable (page
    // loaded, or the last editor closed) starts a full quiet interval.
    // Invalidation starts a new generation without refilling the visit budget.
    update(next) {
      const before = latest;
      latest = { ...next, visitKey: buildVisitKey(next.routeIdentity) };
      if (previousIdentity && buildVisitKey(previousIdentity) !== latest.visitKey) {
        recentDestinations.set(buildVisitKey(previousIdentity), next.routeIdentity);
      }
      previousIdentity = next.routeIdentity;
      const readinessChanged = before.routeWork.busy !== next.routeWork.busy
        || before.routeWork.ready !== next.routeWork.ready
        || before.routeWork.requiredCount !== next.routeWork.requiredCount
        || before.routeWork.usable !== next.routeWork.usable
        || before.visitKey !== latest.visitKey;
      if (readinessChanged) {
        if (next.routeWork.usable) usableSince = now();
        notify();
      }
      if (before.queryEpoch !== next.queryEpoch) {
        notify({ newGeneration: true });
      }
    },
    dispose() {
      scheduler.dispose();
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
      onIntent(null);
    }
  };
}
