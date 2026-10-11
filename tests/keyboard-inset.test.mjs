// A bottom sheet's Save bar and focused field stay above the phone keyboard:
// iPhone Safari keeps the layout viewport when the keyboard opens and only
// shrinks the visual viewport, so a sheet fixed to the bottom would sit
// under the keyboard. The sheet lifts itself by the keyboard's height.
import assert from "node:assert/strict";
import test from "node:test";

import { keyboardInsetFor } from "../src/client/use-keyboard-inset.js";

test("the inset is the part of the layout viewport the keyboard covers", () => {
  // iPhone 13: 664 px tall, a 336 px keyboard.
  assert.equal(keyboardInsetFor({ layoutHeight: 664, viewportHeight: 328, viewportOffsetTop: 0, scale: 1 }), 336);
  // Safari scrolled the visual viewport down to the focused field.
  assert.equal(keyboardInsetFor({ layoutHeight: 664, viewportHeight: 328, viewportOffsetTop: 40, scale: 1 }), 296);
  assert.equal(keyboardInsetFor({ layoutHeight: 664, viewportHeight: 327.6, viewportOffsetTop: 0, scale: 1 }), 336);
});

test("no keyboard, a toolbar wobble or a pinch zoom never lifts the sheet", () => {
  assert.equal(keyboardInsetFor({ layoutHeight: 664, viewportHeight: 664, viewportOffsetTop: 0, scale: 1 }), 0);
  // The toolbar collapsing or a rounding difference is not a keyboard.
  assert.equal(keyboardInsetFor({ layoutHeight: 664, viewportHeight: 620, viewportOffsetTop: 0, scale: 1 }), 0);
  // Zoomed in, the visual viewport is small for another reason.
  assert.equal(keyboardInsetFor({ layoutHeight: 664, viewportHeight: 300, viewportOffsetTop: 120, scale: 2 }), 0);
  // A visual viewport taller than the layout (overscroll) is not negative.
  assert.equal(keyboardInsetFor({ layoutHeight: 664, viewportHeight: 700, viewportOffsetTop: 0, scale: 1 }), 0);
});
