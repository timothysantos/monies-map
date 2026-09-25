import { useSyncExternalStore } from "react";

// The one place that knows the app's layout breakpoints. Render code reads a
// subscribed hook so a resize or rotation switches layout without a reload;
// event handlers and effects read the plain function at the moment they run.

// Matches the `@media (max-width: 760px)` blocks in public/styles.css, where
// the app switches to its phone layout.
export const MOBILE_LAYOUT_MAX_WIDTH = 760;
export const MOBILE_LAYOUT_QUERY = `(max-width: ${MOBILE_LAYOUT_MAX_WIDTH}px)`;

// Month plan rows also use the mobile sheet on a portrait tablet, where the
// CSS keeps the desktop table but inline money editing is cramped. This is
// wider than the phone layout on purpose; do not fold it into it.
export const MONTH_SHEET_LAYOUT_QUERY = `${MOBILE_LAYOUT_QUERY}, (max-width: 1024px) and (orientation: portrait)`;

function currentWindow() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" ? window : null;
}

// Fresh read for event handlers and effects. It asks matchMedia every call, so
// the answer is the viewport at the moment of the event.
export function matchesMediaQuery(query) {
  return currentWindow()?.matchMedia(query).matches ?? false;
}

export function isMobileLayout() {
  return matchesMediaQuery(MOBILE_LAYOUT_QUERY);
}

export function isMonthSheetLayout() {
  return matchesMediaQuery(MONTH_SHEET_LAYOUT_QUERY);
}

// One MediaQueryList per query and window, shared by every subscribed
// component, so a table of rows does not call matchMedia on each render.
const mediaListsByWindow = new WeakMap();
const storesByQuery = new Map();

function readMediaList(query) {
  const win = currentWindow();
  if (!win) {
    return null;
  }
  let lists = mediaListsByWindow.get(win);
  if (!lists) {
    lists = new Map();
    mediaListsByWindow.set(win, lists);
  }
  let list = lists.get(query);
  if (!list) {
    list = win.matchMedia(query);
    lists.set(query, list);
  }
  return list;
}

// A useSyncExternalStore source for one media query. Without a window (server
// render, unit tests) it reports false, the desktop layout, and never throws.
export function getMediaQueryStore(query) {
  let store = storesByQuery.get(query);
  if (store) {
    return store;
  }
  store = {
    subscribe(onChange) {
      const list = readMediaList(query);
      if (!list) {
        return () => {};
      }
      if (typeof list.addEventListener === "function") {
        list.addEventListener("change", onChange);
        return () => list.removeEventListener("change", onChange);
      }
      // Safari before 14 only has the deprecated listener API.
      list.addListener?.(onChange);
      return () => list.removeListener?.(onChange);
    },
    getSnapshot() {
      return readMediaList(query)?.matches ?? false;
    },
    getServerSnapshot() {
      return false;
    }
  };
  storesByQuery.set(query, store);
  return store;
}

export function useMediaQuery(query) {
  const store = getMediaQueryStore(query);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
}

export function useIsMobileLayout() {
  return useMediaQuery(MOBILE_LAYOUT_QUERY);
}

export function useIsMonthSheetLayout() {
  return useMediaQuery(MONTH_SHEET_LAYOUT_QUERY);
}
