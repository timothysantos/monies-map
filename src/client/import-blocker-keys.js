import { useEffect, useRef } from "react";

// J and K step through the blockers of the file in review (next and
// previous, in blocker order) from anywhere on the Imports page. There is
// no hint on the page; the commit bar's "Jump to next" names the keys in
// its title, and the user guide lists them.

const TYPING_TAGS = new Set(["INPUT", "SELECT", "TEXTAREA"]);
// Anything open on top of the page: a popover (Radix gives it role
// "dialog"), a dialog or a mobile sheet.
const OVERLAY_SELECTOR = '[role="dialog"], [role="alertdialog"], [aria-modal="true"], [data-radix-popper-content-wrapper]';

/**
 * Which way a key press moves, or null when it is not a blocker jump: not J
 * or K, a modifier held, typing in a field, something open on top of the
 * page, or no preview in review. The field a J or K jump itself focused
 * (an account select) is not typing until the user does something else, so
 * a second press moves on instead of picking an option.
 *
 * @param {{ key: string, altKey?: boolean, ctrlKey?: boolean, metaKey?: boolean, shiftKey?: boolean, isComposing?: boolean, defaultPrevented?: boolean, target?: any }} event
 * @param {{ hasPreview: boolean, isOverlayOpen: boolean, jumpedElement?: any }} context
 * @returns {"next" | "previous" | null}
 */
export function readBlockerKey(event, { hasPreview, isOverlayOpen, jumpedElement = null }) {
  const key = String(event.key ?? "").toLowerCase();
  if (key !== "j" && key !== "k") {
    return null;
  }
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing || event.defaultPrevented) {
    return null;
  }
  if (!hasPreview || isOverlayOpen) {
    return null;
  }
  const target = event.target;
  const isTyping = Boolean(target) && (TYPING_TAGS.has(target.tagName) || target.isContentEditable === true);
  if (isTyping && target !== jumpedElement) {
    return null;
  }
  return key === "j" ? "next" : "previous";
}

/**
 * The blocker after (or before) the one last jumped to, by blocker order,
 * wrapping at either end. `cursorOrder` is the order of the blocker last
 * jumped to; it may be fixed and gone by now, so the walk carries on from
 * where it was. With no cursor, next is the first and previous the last.
 *
 * @template {{ order: number }} T
 * @param {T[]} blockers in blocker order
 * @param {number | null} cursorOrder
 * @param {"next" | "previous"} direction
 * @returns {T | undefined}
 */
export function pickAdjacentBlocker(blockers, cursorOrder, direction) {
  if (!blockers.length) {
    return undefined;
  }
  if (direction === "next") {
    return cursorOrder === null
      ? blockers[0]
      : blockers.find((blocker) => blocker.order > cursorOrder) ?? blockers[0];
  }
  return cursorOrder === null
    ? blockers.at(-1)
    : blockers.findLast((blocker) => blocker.order < cursorOrder) ?? blockers.at(-1);
}

function isOverlayOpen() {
  return Boolean(document.querySelector(OVERLAY_SELECTOR));
}

/**
 * Listens for J and K on the page while a preview is in review.
 * `onJump(blocker)` scrolls to the blocker and focuses its control; it
 * returns nothing. `cursorRef` holds the order of the blocker last jumped to
 * (chips and "Jump to next" set it too), so the keys continue from there.
 *
 * @param {{ hasPreview: boolean, blockers: { order: number }[], cursorRef: { current: number | null }, onJump: (blocker: any) => void }} input
 */
export function useImportBlockerKeys({ hasPreview, blockers, cursorRef, onJump }) {
  // The latest values, read when a key is pressed, so the listener is
  // attached once per preview rather than on every render.
  const latest = useRef({ blockers, onJump });
  latest.current = { blockers, onJump };
  useEffect(() => {
    if (!hasPreview) {
      return undefined;
    }
    let jumpedElement = null;
    function handleKeyDown(event) {
      const direction = readBlockerKey(event, { hasPreview, isOverlayOpen: isOverlayOpen(), jumpedElement });
      if (!direction) {
        return;
      }
      const blocker = pickAdjacentBlocker(latest.current.blockers, cursorRef.current, direction);
      if (!blocker) {
        return;
      }
      // Stops a select the last jump focused from picking an option.
      event.preventDefault();
      cursorRef.current = blocker.order;
      latest.current.onJump(blocker);
      jumpedElement = document.activeElement;
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [cursorRef, hasPreview]);
}
