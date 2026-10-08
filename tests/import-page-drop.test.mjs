import assert from "node:assert/strict";
import test from "node:test";

import { getPageDropAction, PAGE_DROP_EXCLUDED_SELECTOR } from "../src/client/import-page-drop.js";

// A stand-in for an element: `closest` answers whether it sits inside one of
// the excluded areas.
function target(insideExcluded) {
  return {
    closest: (selector) => {
      assert.equal(selector, PAGE_DROP_EXCLUDED_SELECTOR);
      return insideExcluded ? {} : null;
    }
  };
}

test("a file dragged over the page is accepted", () => {
  assert.equal(getPageDropAction({ types: ["Files"] }, target(false)), "accept");
});

test("a file dragged over the preview rows or a dialog is refused, not accepted", () => {
  assert.equal(getPageDropAction({ types: ["Files"] }, target(true)), "refuse");
});

test("dragging text or an element is left to the page", () => {
  assert.equal(getPageDropAction({ types: ["text/plain"] }, target(false)), "ignore");
  assert.equal(getPageDropAction({ types: [] }, target(false)), "ignore");
  assert.equal(getPageDropAction(null, target(false)), "ignore");
});

test("a target without closest (the document itself) still accepts a file", () => {
  assert.equal(getPageDropAction({ types: ["Files"] }, null), "accept");
  assert.equal(getPageDropAction({ types: ["Files"] }, {}), "accept");
});

test("the excluded areas are the preview, dialogs and popovers", () => {
  for (const part of ["[data-page-drop=\"off\"]", "[role=\"dialog\"]", "dialog", "[data-radix-popper-content-wrapper]"]) {
    assert.ok(PAGE_DROP_EXCLUDED_SELECTOR.includes(part), part);
  }
});
