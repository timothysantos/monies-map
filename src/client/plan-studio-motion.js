import { useEffect, useRef, useState, useSyncExternalStore } from "react";

// Plan Studio's motion (design.md "Plan Studio"): numbers roll to their new
// value and bars flow, both in under half a second, and both are off under
// prefers-reduced-motion (the number simply changes, CSS drops the
// transitions).
const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const list = window.matchMedia(QUERY);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

const read = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(QUERY).matches;

export function usePrefersReducedMotion() {
  return useSyncExternalStore(subscribe, read, () => false);
}

const ROLL_MS = 420;

/**
 * The number to show while `value` rolls toward its new amount (a cubic ease
 * out). Under reduced motion, or the first time, it is the value itself.
 */
export function useRollingNumber(value) {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(value);
  const shownRef = useRef(value);
  useEffect(() => {
    if (reduced || shownRef.current === value) {
      shownRef.current = value;
      setShown(value);
      return undefined;
    }
    const from = shownRef.current;
    const started = performance.now();
    let frame = 0;
    const step = (now) => {
      const progress = Math.min(1, (now - started) / ROLL_MS);
      const eased = 1 - (1 - progress) ** 3;
      const next = progress === 1 ? value : Math.round(from + (value - from) * eased);
      shownRef.current = next;
      setShown(next);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, reduced]);
  return shown;
}
