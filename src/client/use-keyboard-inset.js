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
 * The inset plus the height the keyboard leaves visible (0 with no keyboard).
 * A sheet that must not follow its content (the category list) sizes itself
 * to the visible height, anchored to the top of the visible area.
 */
export function keyboardFrameFor(viewport) {
  const inset = keyboardInsetFor(viewport);
  return { inset, visibleHeight: inset > 0 ? Math.round(viewport.viewportHeight) : 0 };
}

/**
 * Keeps `--keyboard-inset` on `element` in step with the phone keyboard
 * until the returned function detaches it, with `--keyboard-visible-height`
 * and a `data-keyboard` flag while the keyboard is up. `win` is the window (a
 * stand-in in tests). Without an element or a visual viewport it does
 * nothing. `scrollFocused: false` is for a sheet already sized to the visible
 * area: scrolling its field into view would only shift the sheet's own head
 * out of sight.
 * @param {HTMLElement | null} element
 * @param {any} [win]
 * @param {{ scrollFocused?: boolean }} [options]
 * @returns {() => void}
 */
export function attachKeyboardInset(element, win = typeof window === "undefined" ? null : window, { scrollFocused = true } = {}) {
  const viewport = win?.visualViewport ?? null;
  if (!element || !viewport) {
    return () => {};
  }
  let lastInset = -1;
  let lastVisible = -1;
  let frame = 0;
  const update = () => {
    frame = 0;
    const { inset, visibleHeight } = keyboardFrameFor({
      layoutHeight: win.innerHeight,
      viewportHeight: viewport.height,
      viewportOffsetTop: viewport.offsetTop,
      scale: viewport.scale ?? 1
    });
    if (inset === lastInset && visibleHeight === lastVisible) {
      return;
    }
    lastInset = inset;
    lastVisible = visibleHeight;
    element.style.setProperty("--keyboard-inset", `${inset}px`);
    if (inset > 0) {
      element.style.setProperty("--keyboard-visible-height", `${visibleHeight}px`);
    } else {
      element.style.removeProperty("--keyboard-visible-height");
    }
    element.toggleAttribute?.("data-keyboard", inset > 0);
    const focused = win.document.activeElement;
    if (scrollFocused && inset > 0 && focused instanceof win.HTMLElement && element.contains(focused)) {
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
    element.style.removeProperty("--keyboard-visible-height");
    element.toggleAttribute?.("data-keyboard", false);
  };
}

/**
 * The hook every bottom sheet with a bottom bar uses (EntryMobileSheet, the
 * Splits expense dialog on a phone), so the bar and the focused field stay
 * above the keyboard.
 * @param {HTMLElement | null} element
 * @param {{ scrollFocused?: boolean }} [options]
 */
export function useKeyboardInset(element, options = undefined) {
  const scrollFocused = options?.scrollFocused;
  useEffect(() => attachKeyboardInset(element, undefined, { scrollFocused }), [element, scrollFocused]);
}
