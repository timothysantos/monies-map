// The mobile sheets' page scroll lock (src/client/page-scroll-lock.js) is
// counted: nested sheets that close together, in any order, give the page
// its own styles back. Owner report 2026-10-20: Use match closed Transfer
// details and Edit entry in one commit, the outer sheet's cleanup ran first,
// and the inner one put back `overflow: hidden` for good.
// The browser proof is tests/e2e/scroll-lock-release.spec.js.
import assert from "node:assert/strict";
import test from "node:test";

import { lockPageKeyboardScroll } from "../src/client/page-scroll-lock.js";

function fakePage({ overflow = "", scrollbarGutter = "", classicScrollbar = false } = {}) {
  const root = { style: { overflow, scrollbarGutter }, clientWidth: classicScrollbar ? 1425 : 1440 };
  return { root, win: { innerWidth: 1440 } };
}

test("nested locks released outer first restore the page's own overflow", () => {
  const { root, win } = fakePage();
  const releaseOuter = lockPageKeyboardScroll(root, win);
  const releaseInner = lockPageKeyboardScroll(root, win);
  assert.equal(root.style.overflow, "hidden");
  // React's order when both sheets unmount together: the outer one first.
  releaseOuter();
  assert.equal(root.style.overflow, "hidden", "the inner sheet is still open");
  releaseInner();
  assert.deepEqual(root.style, { overflow: "", scrollbarGutter: "" });
});

test("nested locks released inner first restore the page's own overflow", () => {
  const { root, win } = fakePage({ overflow: "auto", classicScrollbar: true });
  const releaseOuter = lockPageKeyboardScroll(root, win);
  assert.deepEqual(root.style, { overflow: "hidden", scrollbarGutter: "stable" });
  const releaseInner = lockPageKeyboardScroll(root, win);
  releaseInner();
  assert.deepEqual(root.style, { overflow: "hidden", scrollbarGutter: "stable" });
  releaseOuter();
  assert.deepEqual(root.style, { overflow: "auto", scrollbarGutter: "" });
});

test("a release called twice does not release another sheet's lock", () => {
  const { root, win } = fakePage();
  const releaseFirst = lockPageKeyboardScroll(root, win);
  const releaseSecond = lockPageKeyboardScroll(root, win);
  releaseFirst();
  releaseFirst();
  assert.equal(root.style.overflow, "hidden", "the second sheet still holds the lock");
  releaseSecond();
  assert.equal(root.style.overflow, "");
});

test("a lock taken again after every sheet closed saves the page's styles afresh", () => {
  const { root, win } = fakePage();
  lockPageKeyboardScroll(root, win)();
  root.style.overflow = "clip";
  const release = lockPageKeyboardScroll(root, win);
  assert.equal(root.style.overflow, "hidden");
  release();
  assert.equal(root.style.overflow, "clip");
});
