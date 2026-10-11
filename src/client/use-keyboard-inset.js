import { useEffect } from "react";

// iPhone Safari keeps the layout viewport when the keyboard opens and only
// shrinks the visual viewport, so a sheet fixed to the bottom of the layout
// viewport would sit under the keyboard with its Save bar. The sheet sets
// `--keyboard-inset` to the height the keyboard covers and lifts itself by
// it (public/styles.css, "Mobile sheet"), then scrolls the focused field
// back into view inside its own scroll area. Smaller gaps (the toolbar
// collapsing) and a pinch zoom are not a keyboard.
const MIN_KEYBOARD_HEIGHT = 120;

export function keyboardInsetFor({ layoutHeight, viewportHeight, viewportOffsetTop, scale }) {
  if (scale > 1.01) {
    return 0;
  }
  const covered = Math.round(layoutHeight - viewportHeight - viewportOffsetTop);
  return covered >= MIN_KEYBOARD_HEIGHT ? covered : 0;
}

/**
 * Keeps `--keyboard-inset` on `element` in step with the phone keyboard
 * until the returned function detaches it. `win` is the window (a stand-in
 * in tests). Without an element or a visual viewport it does nothing.
 * @param {HTMLElement | null} element
 * @param {any} [win]
 * @returns {() => void}
 */
export function attachKeyboardInset(element, win = typeof window === "undefined" ? null : window) {
  const viewport = win?.visualViewport ?? null;
  if (!element || !viewport) {
    return () => {};
  }
  let lastInset = -1;
  let frame = 0;
  const update = () => {
    frame = 0;
    const inset = keyboardInsetFor({
      layoutHeight: win.innerHeight,
      viewportHeight: viewport.height,
      viewportOffsetTop: viewport.offsetTop,
      scale: viewport.scale ?? 1
    });
    if (inset === lastInset) {
      return;
    }
    lastInset = inset;
    element.style.setProperty("--keyboard-inset", `${inset}px`);
    const focused = win.document.activeElement;
    if (inset > 0 && focused instanceof win.HTMLElement && element.contains(focused)) {
      focused.scrollIntoView({ block: "nearest" });
    }
  };
  const schedule = () => {
    if (!frame) {
      frame = win.requestAnimationFrame(update);
    }
  };
  update();
  viewport.addEventListener("resize", schedule);
  viewport.addEventListener("scroll", schedule);
  return () => {
    viewport.removeEventListener("resize", schedule);
    viewport.removeEventListener("scroll", schedule);
    if (frame) {
      win.cancelAnimationFrame(frame);
    }
    element.style.removeProperty("--keyboard-inset");
  };
}

/**
 * The hook every bottom sheet with a bottom bar uses (EntryMobileSheet, the
 * Splits expense dialog on a phone), so the bar and the focused field stay
 * above the keyboard.
 * @param {HTMLElement | null} element
 */
export function useKeyboardInset(element) {
  useEffect(() => attachKeyboardInset(element), [element]);
}
