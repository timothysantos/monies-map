// Ask's conversation scroll (design.md "Ask conversation scroll"): news goes
// to the bottom, but the top of the card or answer to read is never cut.
import assert from "node:assert/strict";
import test from "node:test";

import { threadScrollTarget } from "../src/client/ask-thread-scroll.js";

test("a card taller than the room left keeps its top just under the header", () => {
  // A 600 px card that starts at 900 px in a conversation 1,560 px long,
  // shown 560 px tall: pinning the bottom would start the view at 1,000 px,
  // 100 px below the card's name and amount.
  assert.equal(threadScrollTarget({ scrollHeight: 1560, clientHeight: 560, focusTop: 900 }), 892);
});

test("a short item still sits on the chip row at the bottom", () => {
  assert.equal(threadScrollTarget({ scrollHeight: 1560, clientHeight: 560, focusTop: 1300 }), 1000);
});

test("with nothing to keep in view the conversation goes to its end", () => {
  assert.equal(threadScrollTarget({ scrollHeight: 1560, clientHeight: 560 }), 1000);
  assert.equal(threadScrollTarget({ scrollHeight: 1560, clientHeight: 560, focusTop: Number.NaN }), 1000);
});

test("never scrolls above the start or below the end", () => {
  assert.equal(threadScrollTarget({ scrollHeight: 400, clientHeight: 560, focusTop: 3 }), 0);
  assert.equal(threadScrollTarget({ scrollHeight: 1560, clientHeight: 560, focusTop: 4 }), 0);
});
