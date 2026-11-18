import { useEffect } from "react";

import { attachKeyboardInset } from "./use-keyboard-inset";

/**
 * Ask on a phone with the keyboard up (design.md "Ask page", "Sheets and the
 * keyboard"). iPhone Safari keeps the layout viewport and only shrinks the
 * visual viewport, so the fixed Ask page would leave its message box and Send
 * under the keyboard. The page takes `--keyboard-inset` (use-keyboard-inset.js)
 * and ask-route.css lifts its bottom edge above the keyboard. When the
 * conversation box gets shorter (the keyboard opens, the message box grows),
 * its bottom edge stays put, so the latest reply stays in sight.
 * @param {{ current: HTMLElement | null }} pageRef
 * @param {{ current: HTMLElement | null }} threadRef
 * @param {boolean} enabled false in the desktop dock
 */
export function useAskKeyboardFit(pageRef, threadRef, enabled) {
  useEffect(() => {
    if (!enabled) return undefined;
    const detach = attachKeyboardInset(pageRef.current, undefined, { scrollFocused: false });
    const thread = threadRef.current;
    if (!thread || typeof ResizeObserver === "undefined") return detach;
    let lastHeight = thread.clientHeight;
    const observer = new ResizeObserver(() => {
      const height = thread.clientHeight;
      if (height < lastHeight) {
        const focused = document.activeElement;
        if (focused instanceof HTMLElement && focused !== thread && thread.contains(focused)) {
          // A field being typed in on a card ("What it was" under a receipt
          // preview) stays in sight rather than the conversation's end.
          const field = focused.getBoundingClientRect();
          const box = thread.getBoundingClientRect();
          if (field.top < box.top) thread.scrollTop -= box.top - field.top + 8;
          else if (field.bottom > box.bottom) thread.scrollTop += Math.min(field.bottom - box.bottom + 8, field.top - box.top - 8);
        } else {
          thread.scrollTop += lastHeight - height;
        }
      }
      lastHeight = height;
    });
    observer.observe(thread);
    return () => {
      observer.disconnect();
      detach();
    };
  }, [pageRef, threadRef, enabled]);
}
