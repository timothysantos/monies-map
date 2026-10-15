import { useEffect, useRef, useState } from "react";

import { planStudioCopy } from "./copy/plan-studio-copy";
import { dragValue, keyboardTarget, positionOf } from "./plan-studio-slider";
import { usePrefersReducedMotion } from "./plan-studio-motion";

const copy = planStudioCopy.row;
// A press that stays put this long on a touch screen turns into fine control.
const LONG_PRESS_MS = 380;
// Travel under this many pixels is a tap, not a drag.
const DRAG_SLOP_PX = 6;
// Keys pressed within this window are one Undo step.
const KEY_BURST_MS = 700;
const THUMB_GRAB_PX = 22;

/**
 * A row's slider (design.md "Plan Studio"): a 44px-tall track with a thumb,
 * written as a slider (role, value, keys) so it works by keyboard and screen
 * reader. Drag for the step that fits the amount; hold Shift or Alt while
 * dragging, or press and hold on a touch screen, to move a tenth as far with
 * one-dollar steps; arrows, Shift+arrows, Alt+arrows, Page keys and Home/End
 * move it by key. The plan fill, what was spent, the saved plan and the pace
 * are drawn on the track; hidden money keeps only the plan fill.
 *
 * @param {{
 *   label: string, valueMinor: number, savedMinor: number, actualMinor: number, paceMinor: number | null,
 *   maxMinor: number, stepMinor: number, disabled?: boolean, valueText: string,
 *   spendLike: boolean, hidden: boolean, describedBy?: string,
 *   onChange: (minor: number) => void, onGestureStart: () => void, onGestureEnd: () => void
 * }} props
 */
export function StudioSlider({
  label, valueMinor, savedMinor, actualMinor, paceMinor, maxMinor, stepMinor, disabled = false, valueText,
  spendLike, hidden, describedBy, onChange, onGestureStart, onGestureEnd
}) {
  const innerRef = useRef(null);
  const latest = useRef(/** @type {any} */ ({}));
  latest.current = { valueMinor, maxMinor, stepMinor, onChange, onGestureStart, onGestureEnd, disabled };
  const drag = useRef(null);
  const keys = useRef({ active: false, timer: 0 });
  const reduced = usePrefersReducedMotion();
  const [fine, setFine] = useState(false);

  useEffect(() => () => {
    window.clearTimeout(drag.current?.timer);
    window.clearTimeout(keys.current.timer);
  }, []);

  function geometry() {
    const rect = innerRef.current.getBoundingClientRect();
    return { left: rect.left, width: Math.max(rect.width, 1) };
  }

  function emit(next) {
    if (next !== latest.current.valueMinor) latest.current.onChange(next);
  }

  function enterFine(state, x) {
    state.fine = { anchorX: x, anchorMinor: latest.current.valueMinor };
    setFine(true);
    if (!reduced && state.pointerType !== "mouse") navigator.vibrate?.(8);
  }

  function leaveFine(state) {
    state.fine = null;
    setFine(false);
  }

  function valueAt(state, x) {
    const { left, width } = geometry();
    const { maxMinor: max, stepMinor: step } = latest.current;
    return dragValue({ x: x + (state.fine ? 0 : state.offset), left, width, max, step, fine: state.fine });
  }

  function endDrag() {
    const state = drag.current;
    if (!state) return;
    window.clearTimeout(state.timer);
    drag.current = null;
    setFine(false);
    latest.current.onGestureEnd();
  }

  function onPointerDown(event) {
    if (latest.current.disabled || (event.pointerType === "mouse" && event.button !== 0)) return;
    const { left, width } = geometry();
    const thumbX = left + positionOf(latest.current.valueMinor, latest.current.maxMinor) * width;
    const onThumb = Math.abs(event.clientX - thumbX) <= THUMB_GRAB_PX;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
    const state = { pointerType: event.pointerType, offset: onThumb ? thumbX - event.clientX : 0, fine: null, startX: event.clientX, lastX: event.clientX, moved: false, onThumb, timer: 0 };
    drag.current = state;
    latest.current.onGestureStart();
    if (event.shiftKey || event.altKey) enterFine(state, event.clientX);
    else if (event.pointerType !== "mouse") {
      state.timer = window.setTimeout(() => {
        if (drag.current === state && !state.moved) enterFine(state, state.lastX);
      }, LONG_PRESS_MS);
    }
    // A mouse press on the track jumps there; a touch waits for a drag or a
    // tap so scrolling the page past a row never changes it.
    if (event.pointerType === "mouse" && !state.fine) emit(valueAt(state, event.clientX));
  }

  function onPointerMove(event) {
    const state = drag.current;
    if (!state) return;
    state.lastX = event.clientX;
    if (!state.moved && Math.abs(event.clientX - state.startX) > DRAG_SLOP_PX) {
      state.moved = true;
      window.clearTimeout(state.timer);
    }
    const wantsFine = event.shiftKey || event.altKey;
    if (wantsFine && !state.fine) enterFine(state, event.clientX);
    else if (!wantsFine && state.fine && event.pointerType === "mouse") leaveFine(state);
    if (event.pointerType === "mouse" || state.moved || state.fine) emit(valueAt(state, event.clientX));
  }

  function onPointerUp(event) {
    const state = drag.current;
    if (!state) return;
    // A touch tap (no travel, no long press) jumps to where it landed.
    if (state.pointerType !== "mouse" && !state.moved && !state.fine && !state.onThumb) emit(valueAt(state, event.clientX));
    endDrag();
  }

  function onKeyDown(event) {
    if (latest.current.disabled) return;
    const { valueMinor: value, maxMinor: max, stepMinor: step } = latest.current;
    const target = keyboardTarget({ key: event.key, value, step, max, shiftKey: event.shiftKey, altKey: event.altKey });
    if (target === null) return;
    event.preventDefault();
    if (!keys.current.active) {
      keys.current.active = true;
      latest.current.onGestureStart();
    }
    emit(target);
    window.clearTimeout(keys.current.timer);
    keys.current.timer = window.setTimeout(endKeys, KEY_BURST_MS);
  }

  function endKeys() {
    window.clearTimeout(keys.current.timer);
    if (keys.current.active) {
      keys.current.active = false;
      latest.current.onGestureEnd();
    }
  }

  const percent = (minor) => `${positionOf(minor, maxMinor) * 100}%`;
  const planned = Math.min(valueMinor, maxMinor);
  const inner = Math.min(actualMinor, planned);
  const overMinor = Math.max(0, Math.min(actualMinor, maxMinor) - planned);
  return (
    <div
      className={`ps-track${disabled ? " is-disabled" : ""}${fine ? " is-fine" : ""}`}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={maxMinor / 100}
      aria-valuenow={valueMinor / 100}
      aria-valuetext={valueText}
      aria-disabled={disabled || undefined}
      aria-orientation="horizontal"
      aria-describedby={describedBy}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onKeyDown={onKeyDown}
      onBlur={endKeys}
      data-ps-slider
    >
      <div className="ps-track-inner" ref={innerRef}>
        <div className="ps-track-base">
          <div className="ps-track-plan" style={{ width: percent(planned) }} />
          {hidden ? null : (
            <>
              <div className={`ps-track-actual${spendLike ? "" : " is-good"}`} style={{ width: percent(inner) }} />
              <div className={`ps-track-over${spendLike ? "" : " is-good"}`} style={{ left: percent(planned), width: percent(overMinor) }} />
            </>
          )}
        </div>
        {savedMinor !== valueMinor ? <div className="ps-track-saved" style={{ left: percent(savedMinor) }} aria-hidden="true" /> : null}
        {!hidden && paceMinor !== null ? <div className="ps-track-pace" style={{ left: percent(paceMinor) }} aria-hidden="true" /> : null}
        <div className="ps-thumb" style={{ left: percent(valueMinor) }} aria-hidden="true">
          {fine ? <span className="ps-thumb-fine">{copy.fine}</span> : null}
        </div>
      </div>
    </div>
  );
}
