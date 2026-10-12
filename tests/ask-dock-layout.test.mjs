// Desktop Ask (src/client/ask-dock-layout.js, design.md "Desktop Ask"):
// which way the Ask conversation opens beside the page at a given window
// width, and when the "/" key may move focus to the Ask field.
import assert from "node:assert/strict";
import test from "node:test";

import {
  ASK_DOCK_MIN_WIDTH,
  ASK_DOCK_WIDE_QUERY,
  askDockModeOnOpen,
  isAskShortcutKey,
  selectAskDockLayout
} from "../src/client/ask-dock-layout.js";
import { MOBILE_LAYOUT_MAX_WIDTH } from "../src/client/use-viewport.js";

test("the docked panel starts at 1,280 px and its media query says so", () => {
  assert.equal(ASK_DOCK_MIN_WIDTH, 1280);
  assert.equal(ASK_DOCK_WIDE_QUERY, "(min-width: 1280px)");
});

test("a phone has no Ask field or panel: Ask is its own tab there", () => {
  for (const width of [320, 390, 760]) {
    assert.deepEqual(selectAskDockLayout({ width, mode: "docked" }), { layout: "hidden", canExpand: false }, `${width} px`);
    assert.deepEqual(selectAskDockLayout({ width, mode: "popup" }), { layout: "hidden", canExpand: false }, `${width} px`);
  }
  assert.equal(MOBILE_LAYOUT_MAX_WIDTH + 1, 761);
});

test("between the phone layout and 1,280 px the conversation opens as a popup with no expand control", () => {
  for (const width of [761, 1024, 1100, 1279]) {
    assert.equal(askDockModeOnOpen(width), "popup", `${width} px opens a popup`);
    // A panel docked on a wider window becomes the popup when the window
    // narrows: there is no room to push the page.
    assert.deepEqual(selectAskDockLayout({ width, mode: "docked" }), { layout: "popup", canExpand: false }, `${width} px docked`);
    assert.deepEqual(selectAskDockLayout({ width, mode: "popup" }), { layout: "popup", canExpand: false }, `${width} px popup`);
  }
});

test("from 1,280 px the conversation opens docked beside the page", () => {
  for (const width of [1280, 1440, 1920]) {
    assert.equal(askDockModeOnOpen(width), "docked", `${width} px opens docked`);
    assert.deepEqual(selectAskDockLayout({ width, mode: "docked" }), { layout: "docked", canExpand: false }, `${width} px`);
  }
});

test("a popup kept open while the window widens stays a popup and offers the expand control", () => {
  // Opened at 1,024 px, then the window is made wider: nothing jumps on its
  // own; the expand control docks it.
  const opened = askDockModeOnOpen(1024);
  assert.equal(opened, "popup");
  assert.deepEqual(selectAskDockLayout({ width: 1440, mode: opened }), { layout: "popup", canExpand: true });
  assert.deepEqual(selectAskDockLayout({ width: 1279, mode: opened }), { layout: "popup", canExpand: false });
});

test("an unknown mode or width falls back to the safe choice", () => {
  assert.deepEqual(selectAskDockLayout({ width: 1440, mode: "sideways" }), { layout: "docked", canExpand: false });
  assert.deepEqual(selectAskDockLayout({ width: Number.NaN, mode: "docked" }), { layout: "hidden", canExpand: false });
  assert.equal(askDockModeOnOpen(Number.NaN), "popup");
});

function key(overrides = {}) {
  return {
    key: "/",
    defaultPrevented: false,
    isComposing: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    target: { tagName: "BODY", isContentEditable: false },
    ...overrides
  };
}

test('"/" moves focus to the Ask field from anywhere that is not a place to type', () => {
  assert.equal(isAskShortcutKey(key()), true);
  assert.equal(isAskShortcutKey(key({ target: { tagName: "BUTTON", isContentEditable: false } })), true);
  assert.equal(isAskShortcutKey(key({ target: { tagName: "A", isContentEditable: false } })), true);
  // A checkbox or radio is not a place to type.
  assert.equal(isAskShortcutKey(key({ target: { tagName: "INPUT", type: "checkbox", isContentEditable: false } })), true);
});

test('"/" types a slash in a field and never steals a shortcut', () => {
  assert.equal(isAskShortcutKey(key({ target: { tagName: "INPUT", type: "text", isContentEditable: false } })), false);
  assert.equal(isAskShortcutKey(key({ target: { tagName: "INPUT", type: "search", isContentEditable: false } })), false);
  assert.equal(isAskShortcutKey(key({ target: { tagName: "TEXTAREA", isContentEditable: false } })), false);
  assert.equal(isAskShortcutKey(key({ target: { tagName: "SELECT", isContentEditable: false } })), false);
  assert.equal(isAskShortcutKey(key({ target: { tagName: "DIV", isContentEditable: true } })), false);
  assert.equal(isAskShortcutKey(key({ key: "?" })), false);
  assert.equal(isAskShortcutKey(key({ metaKey: true })), false);
  assert.equal(isAskShortcutKey(key({ ctrlKey: true })), false);
  assert.equal(isAskShortcutKey(key({ altKey: true })), false);
  assert.equal(isAskShortcutKey(key({ defaultPrevented: true })), false);
  assert.equal(isAskShortcutKey(key({ isComposing: true })), false);
  // Inside an open dialog the page behind is not the place to ask.
  assert.equal(isAskShortcutKey(key({ target: { tagName: "BUTTON", isContentEditable: false, closest: (selector) => (selector.includes("dialog") ? {} : null) } })), false);
});

test("the two media query answers map to a width in the right band", async () => {
  const { askDockBandWidth } = await import("../src/client/ask-dock-layout.js");
  assert.equal(selectAskDockLayout({ width: askDockBandWidth({ phone: true, wide: false }), mode: "docked" }).layout, "hidden");
  assert.equal(selectAskDockLayout({ width: askDockBandWidth({ phone: false, wide: false }), mode: "docked" }).layout, "popup");
  assert.equal(selectAskDockLayout({ width: askDockBandWidth({ phone: false, wide: true }), mode: "docked" }).layout, "docked");
  assert.equal(askDockModeOnOpen(askDockBandWidth({ phone: false, wide: true })), "docked");
  assert.equal(askDockModeOnOpen(askDockBandWidth({ phone: false, wide: false })), "popup");
});
