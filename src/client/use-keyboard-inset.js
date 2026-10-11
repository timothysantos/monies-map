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

/** Keeps `--keyboard-inset` on the sheet in step with the phone keyboard. */
export function useKeyboardInset(element) {
  useEffect(() => {
    const viewport = typeof window === "undefined" ? null : window.visualViewport;
    if (!element || !viewport) {
      return undefined;
    }
    let lastInset = -1;
    let frame = 0;
    const update = () => {
      frame = 0;
      const inset = keyboardInsetFor({
        layoutHeight: window.innerHeight,
        viewportHeight: viewport.height,
        viewportOffsetTop: viewport.offsetTop,
        scale: viewport.scale ?? 1
      });
      if (inset === lastInset) {
        return;
      }
      lastInset = inset;
      element.style.setProperty("--keyboard-inset", `${inset}px`);
      const focused = document.activeElement;
      if (inset > 0 && focused instanceof HTMLElement && element.contains(focused)) {
        focused.scrollIntoView({ block: "nearest" });
      }
    };
    const schedule = () => {
      if (!frame) {
        frame = window.requestAnimationFrame(update);
      }
    };
    update();
    viewport.addEventListener("resize", schedule);
    viewport.addEventListener("scroll", schedule);
    return () => {
      viewport.removeEventListener("resize", schedule);
      viewport.removeEventListener("scroll", schedule);
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      element.style.removeProperty("--keyboard-inset");
    };
  }, [element]);
}
