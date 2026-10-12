// Swipe down to dismiss a phone bottom sheet (design.md, "Mobile Sheet").
// Pure: it reads finger positions and times and says what the sheet should
// do. The hook in sheet-swipe.jsx feeds it touch events and moves the sheet.
//
// The rules:
// - A drag starts only where the caller allows it: from the grab bar and
//   header, or from the sheet's body while it is scrolled to its top. Never
//   while a save is in flight, from a text field or an active text
//   selection, from content scrolled away from its top (that drag scrolls
//   the content), or from a scrollable list or chip row inside the body
//   (its touches are always its own).
// - Until the finger has moved SLOP_PX the gesture is undecided. Sideways
//   or upward movement hands it back to the browser (a chip row scrolls, the
//   content scrolls); holding still first is a long press (text selection)
//   and does the same.
// - A downward drag follows the finger. Released past the threshold, or
//   flicked down quickly, the sheet closes straight away when its draft is
//   unchanged; with changes it springs back and asks "Discard changes?".
//   Anything less springs back.

export const SHEET_SWIPE = Object.freeze({
  // Movement before the gesture picks an axis.
  slopPx: 10,
  // A drag this far down (a share of the sheet's height, within the bounds)
  // dismisses on release.
  dismissShare: 0.3,
  minDismissPx: 80,
  maxDismissPx: 160,
  // A flick: at least this fast downward at release (px per ms), and at
  // least flickMinPx down, so a twitch is not a dismissal.
  flickVelocity: 0.6,
  flickMinPx: 24,
  // Only the last stretch of movement counts towards the release speed.
  velocityWindowMs: 100,
  // Held this long before moving: a long press, left to the browser.
  longPressMs: 500
});

/** The drag distance that dismisses a sheet of this height on release. */
export function sheetDismissThreshold(sheetHeight) {
  const height = Number.isFinite(sheetHeight) && sheetHeight > 0 ? sheetHeight : 0;
  return Math.min(SHEET_SWIPE.maxDismissPx, Math.max(SHEET_SWIPE.minDismissPx, height * SHEET_SWIPE.dismissShare));
}

/**
 * Whether a touch may start a drag. `scrollTops` are the vertical scroll
 * offsets of every element between the touch and the sheet (the sheet
 * included): any of them scrolled away from the top means the drag belongs
 * to that content.
 * `startsInNestedScroller` is a touch inside a scrollable element other than
 * the sheet's body (a long list, a sideways chip row).
 * @param {{ isSubmitting?: boolean, isConfirmOpen?: boolean, startsInTextField?: boolean,
 *   startsInNestedScroller?: boolean, hasTextSelection?: boolean, scrollTops?: number[],
 *   touchCount?: number }} context
 */
export function canStartSheetDrag({
  isSubmitting = false,
  isConfirmOpen = false,
  startsInTextField = false,
  startsInNestedScroller = false,
  hasTextSelection = false,
  scrollTops = [],
  touchCount = 1
}) {
  if (isSubmitting || isConfirmOpen || startsInTextField || startsInNestedScroller || hasTextSelection || touchCount !== 1) {
    return false;
  }
  return scrollTops.every((top) => !(top > 0));
}

/**
 * What a release does: "dismiss" (close now), "confirm" (spring back and
 * ask), or "spring-back".
 * @param {{ offset: number, velocity: number, sheetHeight: number, isDirty: boolean, isSubmitting?: boolean }} release
 */
export function resolveSheetRelease({ offset, velocity, sheetHeight, isDirty, isSubmitting = false }) {
  if (isSubmitting) {
    return "spring-back";
  }
  const pastThreshold = offset >= sheetDismissThreshold(sheetHeight);
  const flicked = velocity >= SHEET_SWIPE.flickVelocity && offset >= SHEET_SWIPE.flickMinPx;
  if (!pastThreshold && !flicked) {
    return "spring-back";
  }
  return isDirty ? "confirm" : "dismiss";
}

/**
 * One sheet's gesture state. `isDirty` and `isSubmitting` are read when
 * they matter, so the caller passes functions over its latest values.
 * - start(point, context): a finger went down. Returns whether the gesture
 *   is being tracked.
 * - move(point): returns { preventDefault, offset }. preventDefault asks the
 *   caller to stop the browser's own scrolling for this move (only for a
 *   clearly downward move, so a sideways chip scroll is never blocked);
 *   offset is how far to move the sheet, or null while it stays put.
 * - end(point): returns "none" | "spring-back" | "dismiss" | "confirm".
 * - cancel(): the browser took the gesture. Returns "none" or "spring-back".
 * @param {{ isDirty: () => boolean, isSubmitting: () => boolean }} options
 */
export function createSheetSwipeController({ isDirty, isSubmitting }) {
  /** @type {"idle" | "pending" | "dragging"} */
  let phase = "idle";
  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let sheetHeight = 0;
  let offset = 0;
  /** @type {{ y: number, t: number }[]} */
  let samples = [];

  const reset = () => {
    phase = "idle";
    offset = 0;
    samples = [];
  };

  const record = (y, t) => {
    samples.push({ y, t });
    // Keep the last stretch only, plus one older sample to measure from.
    while (samples.length > 2 && t - samples[1].t > SHEET_SWIPE.velocityWindowMs) {
      samples.shift();
    }
  };

  // The speed of the last movement: zero when the finger rested before
  // letting go, so only a real flick counts.
  const releaseVelocity = (y, t) => {
    if (y !== samples[samples.length - 1]?.y) {
      record(y, t);
    }
    const last = samples[samples.length - 1];
    if (!last || t - last.t > SHEET_SWIPE.velocityWindowMs) {
      return 0;
    }
    const from = samples.find((sample) => sample !== last && last.t - sample.t <= SHEET_SWIPE.velocityWindowMs)
      ?? samples[samples.length - 2];
    if (!from || last.t <= from.t) {
      return 0;
    }
    return (last.y - from.y) / (last.t - from.t);
  };

  return {
    start({ x, y, t }, context) {
      reset();
      if (!canStartSheetDrag({ ...context, isSubmitting: isSubmitting() })) {
        return false;
      }
      phase = "pending";
      startX = x;
      startY = y;
      startTime = t;
      sheetHeight = context.sheetHeight ?? 0;
      record(y, t);
      return true;
    },

    move({ x, y, t }) {
      if (phase === "idle") {
        return { preventDefault: false, offset: null };
      }
      if (isSubmitting()) {
        // A save started mid-gesture: let go of the sheet.
        const wasDragging = phase === "dragging";
        reset();
        return { preventDefault: false, offset: wasDragging ? 0 : null };
      }
      const dx = x - startX;
      const dy = y - startY;
      if (phase === "pending") {
        if (Math.hypot(dx, dy) < SHEET_SWIPE.slopPx) {
          // Undecided. Hold the browser back only from a clearly downward
          // start, which at the top of the content would only rubber-band.
          return { preventDefault: dy > 0 && dy >= 2 * Math.abs(dx), offset: null };
        }
        if (t - startTime > SHEET_SWIPE.longPressMs || dy <= 0 || Math.abs(dx) >= Math.abs(dy)) {
          reset();
          return { preventDefault: false, offset: null };
        }
        phase = "dragging";
      }
      offset = Math.max(0, dy);
      record(y, t);
      return { preventDefault: true, offset };
    },

    end({ y, t }) {
      if (phase !== "dragging") {
        reset();
        return "none";
      }
      const finalOffset = Math.max(0, y - startY);
      const velocity = releaseVelocity(y, t);
      const outcome = resolveSheetRelease({
        offset: finalOffset,
        velocity,
        sheetHeight,
        isDirty: isDirty(),
        isSubmitting: isSubmitting()
      });
      reset();
      return outcome;
    },

    cancel() {
      const wasDragging = phase === "dragging";
      reset();
      return wasDragging ? "spring-back" : "none";
    },

    get isDragging() {
      return phase === "dragging";
    }
  };
}
