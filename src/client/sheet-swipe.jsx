import "./ui/lead-support-detail.css";
import "./sheet-swipe.css";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { sheetSwipeCopy as copy } from "./copy/sheet-swipe-copy";
import { createSheetSwipeController } from "./sheet-swipe-controller";

// Swipe down to close a phone bottom sheet (design.md, "Mobile Sheet"). The
// shared sheet (EntryMobileSheet) and the phone Splits expense dialog use it
// the same way:
//
//   const swipe = useSheetSwipeDismiss({ sheet, isDirty, isSubmitting, onClose });
//   <Content ref={setSheet} {...swipe.contentProps}>
//     <SheetDragHandle />
//     <form inert={swipe.isConfirmOpen}>...</form>
//     <SheetDiscardConfirm open={swipe.isConfirmOpen} ... />
//
// The sheet follows the finger and the gesture rules live in
// sheet-swipe-controller.js. A drag starts from the grab bar and header, or
// from the body (marked `data-sheet-body`) while it is scrolled to its top;
// never from a scrollable list or chip row inside it. The touch listeners
// are passive except touchmove, which cancels the browser's scrolling only
// once a downward drag of the sheet itself has begun, and the sheet never
// sets touch-action, so every scrollable child keeps native scrolling. A clean sheet closes straight away; a sheet
// whose draft changed springs back and asks "Discard changes?" in a bar at
// its bottom (never a system confirm). While a save is in flight the swipe
// is ignored, as Escape is. Motion is skipped under prefers-reduced-motion.

const SETTLE_MS = 200;
const DISMISS_MS = 180;
const EASE_OUT = "cubic-bezier(0.2, 0.8, 0.2, 1)";
// A click right after a drag is the end of the drag, not a tap.
const CLICK_AFTER_DRAG_MS = 400;
const NON_TEXT_INPUTS = new Set(["checkbox", "radio", "button", "submit", "reset", "image", "file", "color"]);

// Where a touch must not start a drag: typing, selecting or a native
// picker in a text field, or content that opts out.
function startsInTextField(target, sheet) {
  if (!(target instanceof Element) || !sheet.contains(target)) {
    return false;
  }
  const field = target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), [data-sheet-swipe='off']");
  if (!field || !sheet.contains(field)) {
    return false;
  }
  return !(field instanceof HTMLInputElement && NON_TEXT_INPUTS.has(field.type));
}

// From the touch up to the sheet: the vertical scroll offsets on the way
// (content scrolled away from its top keeps the drag for scrolling), and
// whether the touch is inside a scrollable element other than the sheet's
// body (`data-sheet-body`): a long list or a sideways chip row keeps every
// touch, so its own scrolling is never taken over.
function scrollContextBetween(target, sheet) {
  const scrollTops = [];
  let startsInNestedScroller = false;
  for (let node = target instanceof Element ? target : null; node; node = node.parentElement) {
    scrollTops.push(node.scrollTop);
    if (node === sheet) {
      break;
    }
    if (!node.hasAttribute("data-sheet-body") && isScrollable(node)) {
      startsInNestedScroller = true;
    }
  }
  return { scrollTops, startsInNestedScroller };
}

function isScrollable(node) {
  const canScrollY = node.scrollHeight > node.clientHeight + 1;
  const canScrollX = node.scrollWidth > node.clientWidth + 1;
  if (!canScrollY && !canScrollX) {
    return false;
  }
  const style = window.getComputedStyle(node);
  const scrolls = (value) => value === "auto" || value === "scroll";
  return (canScrollY && scrolls(style.overflowY)) || (canScrollX && scrolls(style.overflowX));
}

function hasTextSelection() {
  const selection = window.getSelection?.();
  return Boolean(selection && !selection.isCollapsed && selection.toString().trim());
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/**
 * Swipe down to dismiss for one sheet element. `enabled` is false where the
 * same component is a centred desktop dialog.
 * @param {{ sheet: HTMLElement | null, enabled?: boolean, isDirty?: boolean,
 *   isSubmitting?: boolean, onClose: () => void }} options
 */
export function useSheetSwipeDismiss({ sheet, enabled = true, isDirty = false, isSubmitting = false, onClose }) {
  const latest = useRef({ isDirty, isSubmitting, onClose });
  useLayoutEffect(() => {
    latest.current = { isDirty, isSubmitting, onClose };
  });
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const confirmOpenRef = useRef(false);

  const openConfirm = useCallback(() => {
    confirmOpenRef.current = true;
    setIsConfirmOpen(true);
  }, []);

  const keepEditing = useCallback(() => {
    confirmOpenRef.current = false;
    setIsConfirmOpen(false);
    // Back to the sheet itself, as on open, so no keyboard pops up.
    sheet?.focus({ preventScroll: true });
  }, [sheet]);

  const discard = useCallback(() => {
    confirmOpenRef.current = false;
    setIsConfirmOpen(false);
    latest.current.onClose();
  }, []);

  useEffect(() => {
    if (!sheet || !enabled) {
      return undefined;
    }
    const swipe = createSheetSwipeController({
      isDirty: () => latest.current.isDirty,
      isSubmitting: () => latest.current.isSubmitting
    });
    let settleTimer = 0;
    let suppressClicksUntil = -Infinity;

    const clearMotion = () => {
      sheet.classList.remove("is-sheet-dragging");
      sheet.style.removeProperty("transform");
      sheet.style.removeProperty("transition");
    };
    const animateTo = (transform, durationMs, done) => {
      window.clearTimeout(settleTimer);
      sheet.classList.remove("is-sheet-dragging");
      if (prefersReducedMotion()) {
        done();
        return;
      }
      sheet.style.transition = `transform ${durationMs}ms ${EASE_OUT}`;
      sheet.style.transform = transform;
      // A timer rather than transitionend, which does not fire when the
      // sheet is already where it is going.
      settleTimer = window.setTimeout(done, durationMs + 20);
    };
    const springBack = () => animateTo("translateY(0px)", SETTLE_MS, clearMotion);
    const dismiss = () => animateTo("translateY(100%)", DISMISS_MS, () => {
      latest.current.onClose();
      // A close that was refused leaves the sheet where it was.
      window.requestAnimationFrame(() => {
        if (sheet.isConnected) {
          clearMotion();
        }
      });
    });
    const settle = (outcome) => {
      if (outcome === "dismiss") {
        dismiss();
      } else if (outcome === "confirm") {
        springBack();
        openConfirm();
      } else if (outcome === "spring-back") {
        springBack();
      }
    };

    const onTouchStart = (event) => {
      // A new touch is a new tap: only the click that ends a drag is eaten.
      suppressClicksUntil = -Infinity;
      if (event.touches.length > 1) {
        // A second finger (a pinch) ends the swipe.
        settle(swipe.cancel());
        return;
      }
      const touch = event.touches[0];
      if (!touch) {
        return;
      }
      swipe.start({ x: touch.clientX, y: touch.clientY, t: event.timeStamp }, {
        touchCount: event.touches.length,
        isConfirmOpen: confirmOpenRef.current,
        startsInTextField: startsInTextField(event.target, sheet),
        hasTextSelection: hasTextSelection(),
        ...scrollContextBetween(event.target, sheet),
        sheetHeight: sheet.getBoundingClientRect().height
      });
    };
    const onTouchMove = (event) => {
      const touch = event.touches[0];
      if (!touch) {
        return;
      }
      const wasDragging = swipe.isDragging;
      const result = swipe.move({ x: touch.clientX, y: touch.clientY, t: event.timeStamp });
      if (result.preventDefault) {
        if (!event.cancelable) {
          // The browser already took the gesture for scrolling.
          settle(swipe.cancel());
          return;
        }
        event.preventDefault();
      }
      if (result.offset === null) {
        return;
      }
      if (wasDragging && !swipe.isDragging) {
        // A save started mid-drag: let go.
        springBack();
        return;
      }
      window.clearTimeout(settleTimer);
      sheet.classList.add("is-sheet-dragging");
      sheet.style.transition = "none";
      sheet.style.transform = `translateY(${result.offset}px)`;
    };
    const onTouchEnd = (event) => {
      if (event.touches.length > 0) {
        return;
      }
      const touch = event.changedTouches[0];
      const wasDragging = swipe.isDragging;
      const outcome = touch ? swipe.end({ y: touch.clientY, t: event.timeStamp }) : swipe.cancel();
      if (wasDragging) {
        suppressClicksUntil = event.timeStamp + CLICK_AFTER_DRAG_MS;
      }
      settle(outcome);
    };
    const onTouchCancel = () => settle(swipe.cancel());
    const onClickCapture = (event) => {
      if (event.timeStamp < suppressClicksUntil) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    sheet.addEventListener("touchstart", onTouchStart, { passive: true });
    sheet.addEventListener("touchmove", onTouchMove, { passive: false });
    sheet.addEventListener("touchend", onTouchEnd);
    sheet.addEventListener("touchcancel", onTouchCancel);
    sheet.addEventListener("click", onClickCapture, true);
    return () => {
      window.clearTimeout(settleTimer);
      sheet.removeEventListener("touchstart", onTouchStart);
      sheet.removeEventListener("touchmove", onTouchMove);
      sheet.removeEventListener("touchend", onTouchEnd);
      sheet.removeEventListener("touchcancel", onTouchCancel);
      sheet.removeEventListener("click", onClickCapture, true);
      clearMotion();
    };
  }, [enabled, openConfirm, sheet]);

  return {
    isConfirmOpen,
    keepEditing,
    discard,
    // For the Radix Dialog.Content: while the question is up, Escape and a
    // tap outside answer "Keep editing" instead of closing the sheet.
    contentProps: {
      onEscapeKeyDown: (event) => {
        if (confirmOpenRef.current) {
          event.preventDefault();
          keepEditing();
        }
      },
      onPointerDownOutside: (event) => {
        if (confirmOpenRef.current) {
          event.preventDefault();
          keepEditing();
        }
      }
    }
  };
}

/**
 * The grab bar at the top of a phone sheet: a cue that the sheet swipes
 * down. It is drawn, not a control (hidden from screen readers and never a
 * tap target); the sheet's close button and Cancel are the other ways out.
 */
export function SheetDragHandle() {
  return (
    <div className="sheet-drag-handle" aria-hidden="true">
      <span className="sheet-drag-handle-bar" />
    </div>
  );
}

/**
 * "Discard changes?" at the bottom of the sheet, under the thumb: Discard
 * (destructive) closes the sheet and drops the draft; Keep editing (the
 * focused default) puts the sheet back as it was. Escape, or a tap on the
 * dimmed sheet above it, keeps editing too.
 * @param {{ open: boolean, onKeepEditing: () => void, onDiscard: () => void }} props
 */
export function SheetDiscardConfirm({ open, onKeepEditing, onDiscard }) {
  const titleId = useId();
  const keepRef = useRef(null);
  useEffect(() => {
    if (open) {
      keepRef.current?.focus({ preventScroll: true });
    }
  }, [open]);
  if (!open) {
    return null;
  }
  return (
    <>
      <div className="sheet-discard-scrim" aria-hidden="true" onClick={onKeepEditing} />
      <div className="sheet-discard-confirm" role="alertdialog" aria-modal="true" aria-labelledby={titleId}>
        <strong id={titleId} className="sheet-discard-title">{copy.discardTitle}</strong>
        <div className="sheet-discard-actions">
          <button type="button" className="lsd-quiet is-danger" onClick={onDiscard}>{copy.discard}</button>
          <button type="button" ref={keepRef} className="lsd-primary" onClick={onKeepEditing}>{copy.keepEditing}</button>
        </div>
      </div>
    </>
  );
}
