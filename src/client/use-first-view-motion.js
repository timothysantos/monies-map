import { useEffect, useRef, useState } from "react";

// A chart's first view (design.md "Motion"): the marks wait hidden ("armed")
// until at least `threshold` of the element is on screen, play once
// ("playing"), then rest ("done") with nothing left on them. The state is a
// data attribute on the element, not React state: a re-render would hand a
// chart new children while the marks are drawing. Nothing animates for
// reduced motion or on the server ("off": the final state at once), and
// without IntersectionObserver the marks simply rest. One observer per
// element, disconnected after the first view. Only the marks draw: every
// figure is in the DOM from the start (the CSS animates transforms and
// stroke dashes, never a number).
//
// Used as `const { ref, motion } = useFirstViewMotion({ attribute: "chartMotion" })`
// and `<div ref={ref} data-chart-motion={motion}>`; the CSS keys on that
// attribute's three values.

const prefersReducedMotion = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const initialMotion = () => (typeof window === "undefined" || prefersReducedMotion() ? "off" : "armed");

/**
 * @param {{ attribute?: string, playMs?: number, threshold?: number }} [options] `attribute` is the dataset key (camelCase) the state is kept in.
 */
export function useFirstViewMotion({ attribute = "chartMotion", playMs = 1100, threshold = 0.5 } = {}) {
  const ref = useRef(null);
  const [motion] = useState(initialMotion);
  useEffect(() => {
    const element = ref.current;
    if (motion !== "armed" || !element) return undefined;
    let timer = 0;
    const play = () => {
      element.dataset[attribute] = "playing";
      timer = window.setTimeout(() => { element.dataset[attribute] = "done"; }, playMs);
    };
    if (typeof IntersectionObserver === "undefined") {
      element.dataset[attribute] = "done";
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        play();
      }
    }, { threshold });
    observer.observe(element);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [motion, attribute, playMs, threshold]);
  return { ref, motion };
}
