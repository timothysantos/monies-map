// Plan Studio's slider maths and typed amounts (DOMAIN.md "Plan Studio").
// A row's slider has a step that grows with the amount ($5 on a $120 line,
// $50 on a salary), a fine mode for precision (one dollar), keys, and a typed
// amount for anything the track cannot say. All amounts are minor units.
import { planStudioCopy } from "./copy/plan-studio-copy";

const DOLLAR = 100;
export const FINE_STEP_MINOR = DOLLAR;
// Fine mode moves the value a tenth as far as the same drag would.
const FINE_RATIO = 0.1;
export const AMOUNT_MAX_MINOR = 1_000_000_000;

/** The step for a track that reaches `maxMinor`: $5, $10, $50, then $100. */
export function stepMinorFor(maxMinor) {
  if (maxMinor <= 200 * DOLLAR) return 5 * DOLLAR;
  if (maxMinor <= 1000 * DOLLAR) return 10 * DOLLAR;
  if (maxMinor <= 5000 * DOLLAR) return 50 * DOLLAR;
  return 100 * DOLLAR;
}

/**
 * How far a row's track reaches: twice the plan, or a quarter past what has
 * been spent, whichever is more, never under $200, rounded up to ten steps so
 * the track's end is a round number.
 */
export function sliderMaxMinor({ plannedMinor, actualMinor }) {
  const raw = Math.max(plannedMinor * 2, Math.ceil(actualMinor * 1.25), 200 * DOLLAR);
  const unit = stepMinorFor(raw) * 10;
  return Math.ceil(raw / unit) * unit;
}

/** The nearest step, kept on the track. */
export function snapToStep(valueMinor, stepMinor, maxMinor) {
  const snapped = Math.round(valueMinor / stepMinor) * stepMinor;
  return Math.min(maxMinor, Math.max(0, snapped));
}

/** Where a value sits on the track, 0 to 1. */
export function positionOf(valueMinor, maxMinor) {
  return maxMinor > 0 ? Math.min(1, Math.max(0, valueMinor / maxMinor)) : 0;
}

/**
 * The value a pointer at `x` means. Normally the track is absolute; in fine
 * mode (`fine` = where it began) the same travel moves a tenth as far from
 * that start and steps by one dollar.
 * @param {{ x: number, left: number, width: number, max: number, step: number, fine: null | { anchorX: number, anchorMinor: number } }} input
 */
export function dragValue({ x, left, width, max, step, fine }) {
  if (fine) {
    const moved = ((x - fine.anchorX) / width) * max * FINE_RATIO;
    return snapToStep(fine.anchorMinor + moved, FINE_STEP_MINOR, max);
  }
  const fraction = (x - left) / width;
  return snapToStep(fraction * max, step, max);
}

// One step from `value` in a direction, onto the grid: a typed $137.50 moves
// to the next step, not by a step from where it was.
function stepOnGrid(valueMinor, stepMinor, direction, count) {
  const onGrid = direction > 0
    ? (Math.floor(valueMinor / stepMinor) + 1) * stepMinor
    : (Math.ceil(valueMinor / stepMinor) - 1) * stepMinor;
  return onGrid + direction * (count - 1) * stepMinor;
}

/**
 * What a key does to a slider: arrows one step, Shift five steps, Alt one
 * dollar, Page keys ten steps, Home and End the ends. Null for other keys.
 * @param {{ key: string, value: number, step: number, max: number, shiftKey?: boolean, altKey?: boolean }} input
 */
export function keyboardTarget({ key, value, step, max, shiftKey = false, altKey = false }) {
  if (key === "Home") return 0;
  if (key === "End") return max;
  let direction = 0;
  let count = 1;
  let size = step;
  if (key === "ArrowRight" || key === "ArrowUp") direction = 1;
  else if (key === "ArrowLeft" || key === "ArrowDown") direction = -1;
  else if (key === "PageUp") [direction, count] = [1, 10];
  else if (key === "PageDown") [direction, count] = [-1, 10];
  else return null;
  if (altKey && !key.startsWith("Page")) size = FINE_STEP_MINOR;
  else if (shiftKey && !key.startsWith("Page")) count = 5;
  return Math.min(max, Math.max(0, stepOnGrid(value, size, direction, count)));
}

/**
 * A typed amount: dollars and cents, with an optional $ and thousands commas.
 * Anything else is refused with a reason the popover words.
 * @returns {{ ok: true, minor: number } | { ok: false, reason: "empty" | "not_a_number" | "too_many_decimals" | "too_big" }}
 */
export function parseAmountInput(text) {
  const trimmed = String(text ?? "").trim().replace(/^\$\s*/, "");
  if (!trimmed) return { ok: false, reason: "empty" };
  const match = /^(\d{1,3}(?:,\d{3})+|\d*)(?:\.(\d*))?$/.exec(trimmed);
  if (!match || (!match[1] && !match[2])) return { ok: false, reason: "not_a_number" };
  const decimals = match[2] ?? "";
  if (decimals.length > 2) return { ok: false, reason: "too_many_decimals" };
  const whole = Number((match[1] || "0").replace(/,/g, ""));
  const minor = whole * DOLLAR + Number(decimals.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor) || minor > AMOUNT_MAX_MINOR) return { ok: false, reason: "too_big" };
  return { ok: true, minor };
}

/** The quick chips: a few dollars more or less, never below zero. */
export function applyChip(currentMinor, deltaMinor) {
  return Math.max(0, currentMinor + deltaMinor);
}

/** What a screen reader hears for a slider: the amount, or that it is hidden. */
export function sliderValueText({ valueMinor, hidden, format }) {
  return hidden ? planStudioCopy.hidden : `${format(valueMinor)} ${planStudioCopy.planned}`;
}
