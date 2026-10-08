// J and K move between the blockers of the file in review
// (src/client/import-blocker-keys.js): which key presses count, and which
// blocker each one lands on.
import assert from "node:assert/strict";
import test from "node:test";

import { pickAdjacentBlocker, readBlockerKey } from "../src/client/import-blocker-keys.js";

const page = { tagName: "BODY", isContentEditable: false };
const ready = { hasPreview: true, isOverlayOpen: false };
const press = (key, extra = {}) => ({ key, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, isComposing: false, target: page, ...extra });

test("J is next and K is previous on the page", () => {
  assert.equal(readBlockerKey(press("j"), ready), "next");
  assert.equal(readBlockerKey(press("k"), ready), "previous");
  // Caps Lock gives the capital letter without Shift.
  assert.equal(readBlockerKey(press("J"), ready), "next");
  assert.equal(readBlockerKey(press("x"), ready), null);
  assert.equal(readBlockerKey(press("Enter"), ready), null);
  // A focused button or row is not typing.
  assert.equal(readBlockerKey(press("j", { target: { tagName: "BUTTON", isContentEditable: false } }), ready), "next");
});

test("the keys are left alone while typing, with a modifier, under an overlay or without a preview", () => {
  for (const tagName of ["INPUT", "SELECT", "TEXTAREA"]) {
    assert.equal(readBlockerKey(press("j", { target: { tagName, isContentEditable: false } }), ready), null, tagName);
  }
  assert.equal(readBlockerKey(press("j", { target: { tagName: "DIV", isContentEditable: true } }), ready), null);
  for (const modifier of ["altKey", "ctrlKey", "metaKey", "shiftKey"]) {
    assert.equal(readBlockerKey(press("j", { [modifier]: true }), ready), null, modifier);
  }
  assert.equal(readBlockerKey(press("j", { isComposing: true }), ready), null);
  assert.equal(readBlockerKey(press("j"), { hasPreview: true, isOverlayOpen: true }), null);
  assert.equal(readBlockerKey(press("k"), { hasPreview: false, isOverlayOpen: false }), null);
  assert.equal(readBlockerKey(press("j", { defaultPrevented: true }), ready), null);
  // No target at all (a synthetic event) still counts as the page.
  assert.equal(readBlockerKey(press("j", { target: null }), ready), "next");
});

const blockers = [
  { id: "account-mapping", order: 20 },
  { id: "statement-card:one", order: 60 },
  { id: "statement-card:ladys", order: 60.01 },
  { id: "rows-to-check", order: 70 }
];

test("J walks forward in blocker order and wraps; K walks back and wraps", () => {
  assert.equal(pickAdjacentBlocker(blockers, null, "next")?.id, "account-mapping");
  assert.equal(pickAdjacentBlocker(blockers, null, "previous")?.id, "rows-to-check");
  assert.equal(pickAdjacentBlocker(blockers, 20, "next")?.id, "statement-card:one");
  assert.equal(pickAdjacentBlocker(blockers, 60, "next")?.id, "statement-card:ladys");
  assert.equal(pickAdjacentBlocker(blockers, 70, "next")?.id, "account-mapping");
  assert.equal(pickAdjacentBlocker(blockers, 60.01, "previous")?.id, "statement-card:one");
  assert.equal(pickAdjacentBlocker(blockers, 20, "previous")?.id, "rows-to-check");
});

test("after the blocker last jumped to is fixed, the keys carry on from where it was", () => {
  // The account was mapped, so its blocker is gone: J goes to the first
  // card, K wraps to the last blocker.
  const left = blockers.slice(1);
  assert.equal(pickAdjacentBlocker(left, 20, "next")?.id, "statement-card:one");
  assert.equal(pickAdjacentBlocker(left, 20, "previous")?.id, "rows-to-check");
  // Nothing left: nothing to jump to.
  assert.equal(pickAdjacentBlocker([], 20, "next"), undefined);
  assert.equal(pickAdjacentBlocker([], null, "previous"), undefined);
});
