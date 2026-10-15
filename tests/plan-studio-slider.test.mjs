// Plan Studio's slider maths and typed amounts (DOMAIN.md "Plan Studio"): a
// step that grows with the amount, a fine mode for precision, the keys, and
// the amount a person types into the popover. All amounts are minor units.
import assert from "node:assert/strict";
import test from "node:test";

import {
  FINE_STEP_MINOR,
  applyChip,
  dragValue,
  keyboardTarget,
  parseAmountInput,
  positionOf,
  sliderMaxMinor,
  sliderValueText,
  snapToStep,
  stepMinorFor
} from "../src/client/plan-studio-slider.js";

const d = (dollars) => Math.round(dollars * 100);

test("the step grows with the amount: $5 on small rows, $10, $50, then $100", () => {
  assert.equal(stepMinorFor(d(100)), d(5));
  assert.equal(stepMinorFor(d(200)), d(5));
  assert.equal(stepMinorFor(d(201)), d(10));
  assert.equal(stepMinorFor(d(1000)), d(10));
  assert.equal(stepMinorFor(d(1001)), d(50));
  assert.equal(stepMinorFor(d(5000)), d(50));
  assert.equal(stepMinorFor(d(5001)), d(100));
  assert.equal(FINE_STEP_MINOR, d(1), "fine control is one dollar");
});

test("the slider reaches twice the plan, or 25% past what was spent, and never less than $200", () => {
  assert.equal(sliderMaxMinor({ plannedMinor: d(120), actualMinor: d(98) }), d(300));
  assert.equal(sliderMaxMinor({ plannedMinor: d(5400), actualMinor: d(5400) }), d(11000));
  assert.equal(sliderMaxMinor({ plannedMinor: d(10), actualMinor: 0 }), d(200));
  // Spending far past the plan still fits on the track.
  assert.ok(sliderMaxMinor({ plannedMinor: d(100), actualMinor: d(900) }) >= d(1125));
  // A plan typed past the old maximum moves the maximum with it.
  assert.ok(sliderMaxMinor({ plannedMinor: d(20_000), actualMinor: 0 }) >= d(40_000));
});

test("a value snaps to the step and stays on the track", () => {
  assert.equal(snapToStep(d(137), d(10), d(1000)), d(140));
  assert.equal(snapToStep(d(134.99), d(10), d(1000)), d(130));
  assert.equal(snapToStep(-d(40), d(10), d(1000)), 0);
  assert.equal(snapToStep(d(5000), d(10), d(1000)), d(1000));
  assert.equal(snapToStep(d(137.4), FINE_STEP_MINOR, d(1000)), d(137));
});

test("dragging maps the pointer to a stepped value; the same pixels in fine mode move a tenth as far", () => {
  const track = { max: d(1000), step: d(10), width: 400, left: 0 };
  assert.equal(dragValue({ ...track, x: 200, fine: null }), d(500));
  assert.equal(dragValue({ ...track, x: 0, fine: null }), 0);
  assert.equal(dragValue({ ...track, x: 999, fine: null }), d(1000));
  // Fine mode is relative to where the finger or cursor was when it began.
  const fine = { anchorX: 200, anchorMinor: d(500) };
  assert.equal(dragValue({ ...track, x: 240, fine }), d(510), "40px is $100 normally, $10 in fine mode");
  assert.equal(dragValue({ ...track, x: 204, fine }), d(501), "fine mode steps by one dollar");
  assert.equal(dragValue({ ...track, x: 201, fine }), d(500), "less than a dollar of travel stays put");
  assert.equal(dragValue({ ...track, x: 160, fine }), d(490));
  assert.equal(dragValue({ ...track, x: -9999, fine }), 0, "fine mode still stops at the ends");
});

test("keys: arrows one step, Shift five steps, Alt one dollar, Page keys ten steps, Home and End the ends", () => {
  const base = { value: d(500), step: d(10), max: d(1000) };
  assert.equal(keyboardTarget({ ...base, key: "ArrowRight" }), d(510));
  assert.equal(keyboardTarget({ ...base, key: "ArrowUp" }), d(510));
  assert.equal(keyboardTarget({ ...base, key: "ArrowLeft" }), d(490));
  assert.equal(keyboardTarget({ ...base, key: "ArrowDown" }), d(490));
  assert.equal(keyboardTarget({ ...base, key: "ArrowRight", shiftKey: true }), d(550));
  assert.equal(keyboardTarget({ ...base, key: "ArrowLeft", shiftKey: true }), d(450));
  assert.equal(keyboardTarget({ ...base, key: "ArrowRight", altKey: true }), d(501));
  assert.equal(keyboardTarget({ ...base, key: "PageUp" }), d(600));
  assert.equal(keyboardTarget({ ...base, key: "PageDown" }), d(400));
  assert.equal(keyboardTarget({ ...base, key: "Home" }), 0);
  assert.equal(keyboardTarget({ ...base, key: "End" }), d(1000));
  assert.equal(keyboardTarget({ ...base, value: d(995), key: "ArrowRight" }), d(1000), "stops at the end");
  assert.equal(keyboardTarget({ ...base, value: d(3), key: "ArrowLeft" }), 0, "stops at zero");
  assert.equal(keyboardTarget({ ...base, key: "a" }), null, "other keys are left alone");
  // A typed amount that is not on the step (137.50) steps onto the next step in the key's direction.
  assert.equal(keyboardTarget({ ...base, value: d(137.5), key: "ArrowRight" }), d(140));
  assert.equal(keyboardTarget({ ...base, value: d(137.5), key: "ArrowLeft" }), d(130));
});

test("the thumb sits where the value is on the track", () => {
  assert.equal(positionOf(d(250), d(1000)), 0.25);
  assert.equal(positionOf(d(2000), d(1000)), 1);
  assert.equal(positionOf(5, 0), 0);
});

test("a typed amount is dollars and cents; anything else is refused with a reason", () => {
  assert.deepEqual(parseAmountInput("137"), { ok: true, minor: d(137) });
  assert.deepEqual(parseAmountInput(" $1,137.50 "), { ok: true, minor: 113_750 });
  assert.deepEqual(parseAmountInput("0"), { ok: true, minor: 0 });
  assert.deepEqual(parseAmountInput("12.5"), { ok: true, minor: 1250 });
  assert.deepEqual(parseAmountInput(".5"), { ok: true, minor: 50 });
  for (const [text, reason] of [
    ["", "empty"],
    ["abc", "not_a_number"],
    ["12abc", "not_a_number"],
    ["-5", "not_a_number"],
    ["1e3", "not_a_number"],
    ["12.345", "too_many_decimals"],
    ["1,2,3", "not_a_number"],
    ["99999999", "too_big"]
  ]) {
    assert.deepEqual(parseAmountInput(text), { ok: false, reason }, text);
  }
});

test("the quick chips add or take away $5, $10 or $50 and never go below zero", () => {
  assert.equal(applyChip(d(137), d(10)), d(147));
  assert.equal(applyChip(d(137), -d(50)), d(87));
  assert.equal(applyChip(d(30), -d(50)), 0);
});

test("with money hidden, a screen reader hears that the amount is hidden, not the amount", () => {
  assert.equal(sliderValueText({ valueMinor: d(500), hidden: true, format: () => "$500" }), "Amount hidden");
  assert.equal(sliderValueText({ valueMinor: d(500), hidden: false, format: (minor) => `$${minor / 100}` }), "$500 planned");
});
