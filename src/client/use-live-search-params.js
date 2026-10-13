import { useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";

// react-router's useSearchParams, with one change: a functional update
// (`setSearchParams((current) => next)`) starts from the URL as it is now,
// not from the params of the last render.
//
// react-router builds `current` from the params its hook saw when the
// component last rendered. A navigation changes the URL at once (the
// browser history is written synchronously) but the page re-renders a
// moment later, and two quick taps in a row (Reset filters, then a scope)
// would build the second URL from the stale params and bring the cleared
// filters back. Reading window.location instead makes every setter build on
// whatever the last one wrote, whichever component wrote it.
//
// The setter keeps one identity across renders, so memoized callbacks that
// list it as a dependency are not rebuilt by every URL change.

/** The search params of the URL as it is now (the browser's, under BrowserRouter). */
export function readLiveSearchParams(fallback) {
  if (typeof window !== "undefined" && window.location && typeof window.location.search === "string") {
    return new URLSearchParams(window.location.search);
  }
  return new URLSearchParams(fallback);
}

/**
 * @returns {[URLSearchParams, (next: any, options?: any) => void]}
 */
export function useLiveSearchParams() {
  const [searchParams, setRouterSearchParams] = useSearchParams();
  const latest = useRef({ searchParams, setRouterSearchParams });
  latest.current = { searchParams, setRouterSearchParams };
  const setSearchParams = useCallback((next, options) => {
    const { searchParams: rendered, setRouterSearchParams: set } = latest.current;
    set(typeof next === "function" ? next(readLiveSearchParams(rendered)) : next, options);
  }, []);
  return [searchParams, setSearchParams];
}
