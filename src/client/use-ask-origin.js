import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

import { ASK_ORIGIN_EVENT, forgetAskOrigin, readAskOrigin } from "./ask-origin";

// The Entries and Splits side of Ask's way back (ask-origin.js,
// docs/flows/ask-flow.md "Back to where you were"). Ships with those
// routes, never the first screen.

function sessionStore() {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

// The page adds its open sheet and draft to the place the shell's + keeps
// just before it opens Ask: `readSheet` returns an AskOriginSheet or null.
export function useAskOriginSheet(readSheet) {
  const readSheetRef = useRef(readSheet);
  useEffect(() => {
    readSheetRef.current = readSheet;
  });
  useEffect(() => {
    const listener = (event) => {
      const detail = /** @type {CustomEvent} */ (event).detail;
      if (detail && typeof detail === "object") {
        detail.sheet = readSheetRef.current() ?? null;
      }
    };
    window.addEventListener(ASK_ORIGIN_EVENT, listener);
    return () => window.removeEventListener(ASK_ORIGIN_EVENT, listener);
  }, []);
}

// Each place is put back once per page life: forward and back again, or a
// rerender, does not move the person a second time.
const restoredOriginIds = new Set();

// Puts the page back as it was when Ask opened, once its data is `ready`:
// the sheet first (`onSheet`), then the window's scroll. Only a page that
// came back to the history entry the + kept (or that Ask opened with the
// kept place) has `state.askReturn`; read when the page mounts.
export function useAskReturn({ ready, onSheet = undefined }) {
  const location = useLocation();
  const [origin] = useState(() => readAskOrigin(location.state?.askReturn));
  const onSheetRef = useRef(onSheet);
  const stopScrollRef = useRef(() => {});
  useEffect(() => {
    onSheetRef.current = onSheet;
  });
  useEffect(() => () => stopScrollRef.current(), []);
  useEffect(() => {
    if (!origin || !ready || restoredOriginIds.has(origin.id)) {
      return;
    }
    restoredOriginIds.add(origin.id);
    forgetAskOrigin(sessionStore(), origin);
    if (origin.sheet) {
      onSheetRef.current?.(origin.sheet);
    }
    stopScrollRef.current = restoreWindowScroll(origin.scrollY);
  }, [origin, ready]);
}

const USER_SCROLL_EVENTS = ["wheel", "touchstart", "keydown", "pointerdown"];

// Rows render over a few frames (content-visibility, late sections above
// the list), so the place is set again each frame until it holds for ten
// frames, for two seconds at most, and never after the person scrolls.
function restoreWindowScroll(top) {
  if (!(top > 0)) {
    return () => {};
  }
  let frame = 0;
  let frames = 0;
  let held = 0;
  const stop = () => {
    window.cancelAnimationFrame(frame);
    for (const type of USER_SCROLL_EVENTS) window.removeEventListener(type, stop);
  };
  for (const type of USER_SCROLL_EVENTS) window.addEventListener(type, stop, { passive: true });
  const step = () => {
    frames += 1;
    const room = document.documentElement.scrollHeight - window.innerHeight;
    const target = Math.max(0, Math.min(top, room));
    if (Math.abs(window.scrollY - target) > 1) {
      window.scrollTo({ top: target, behavior: "instant" });
    }
    held = room >= top && Math.abs(window.scrollY - top) <= 1 ? held + 1 : 0;
    if (held >= 10 || frames >= 120) {
      stop();
      return;
    }
    frame = window.requestAnimationFrame(step);
  };
  step();
  return stop;
}
