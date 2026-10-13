// A bottom sheet's Save bar and focused field stay above the phone keyboard:
// iPhone Safari keeps the layout viewport when the keyboard opens and only
// shrinks the visual viewport, so a sheet fixed to the bottom would sit
// under the keyboard. The sheet lifts itself by the keyboard's height.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { attachKeyboardInset, keyboardInsetFor } from "../src/client/use-keyboard-inset.js";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

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

// A stand-in window: a visual viewport whose size the test sets, frames run
// when the test says, and an element that records its style and contents.
function fakeWindow({ innerHeight = 664 } = {}) {
  const listeners = new Map();
  const frames = [];
  const viewport = {
    height: innerHeight,
    offsetTop: 0,
    scale: 1,
    addEventListener: (type, listener) => listeners.set(type, [...(listeners.get(type) ?? []), listener]),
    removeEventListener: (type, listener) => listeners.set(type, (listeners.get(type) ?? []).filter((item) => item !== listener))
  };
  const win = {
    innerHeight,
    visualViewport: viewport,
    document: { activeElement: null },
    requestAnimationFrame: (callback) => frames.push(callback),
    cancelAnimationFrame: () => {},
    HTMLElement: class {}
  };
  return {
    win,
    viewport,
    listenerCount: () => [...listeners.values()].reduce((sum, list) => sum + list.length, 0),
    fire: (type) => (listeners.get(type) ?? []).forEach((listener) => listener()),
    runFrames: () => frames.splice(0).forEach((callback) => callback())
  };
}

function fakeElement(win) {
  const style = new Map();
  const children = new Set();
  return {
    children,
    style: {
      setProperty: (name, value) => style.set(name, value),
      removeProperty: (name) => style.delete(name),
      get: (name) => style.get(name)
    },
    contains: (node) => children.has(node),
    focusable() {
      const field = Object.assign(new win.HTMLElement(), { scrolls: [], scrollIntoView(options) { this.scrolls.push(options); } });
      children.add(field);
      return field;
    }
  };
}

test("an attached sheet follows the keyboard: lifted while it shows, the focused field scrolled into view", () => {
  const { win, viewport, fire, runFrames, listenerCount } = fakeWindow();
  const sheet = fakeElement(win);
  const field = sheet.focusable();
  win.document.activeElement = field;

  const detach = attachKeyboardInset(sheet, win);
  assert.equal(sheet.style.get("--keyboard-inset"), "0px");
  assert.equal(listenerCount(), 2);

  // The keyboard opens: the visual viewport shrinks by 336 px.
  viewport.height = 328;
  fire("resize");
  assert.equal(sheet.style.get("--keyboard-inset"), "0px", "waits for the next frame");
  runFrames();
  assert.equal(sheet.style.get("--keyboard-inset"), "336px");
  assert.deepEqual(field.scrolls, [{ block: "nearest" }]);

  // Safari scrolls the visual viewport: the inset follows, one frame per burst.
  viewport.offsetTop = 40;
  fire("scroll");
  fire("scroll");
  runFrames();
  assert.equal(sheet.style.get("--keyboard-inset"), "296px");

  // The keyboard closes.
  viewport.height = 664;
  viewport.offsetTop = 0;
  fire("resize");
  runFrames();
  assert.equal(sheet.style.get("--keyboard-inset"), "0px");

  detach();
  assert.equal(sheet.style.get("--keyboard-inset"), undefined);
  assert.equal(listenerCount(), 0);
});

test("a focused field outside the sheet, a pinch zoom or no visual viewport never moves anything", () => {
  const { win, viewport, fire, runFrames } = fakeWindow();
  const sheet = fakeElement(win);
  const outside = Object.assign(new win.HTMLElement(), { scrolls: [], scrollIntoView(options) { this.scrolls.push(options); } });
  win.document.activeElement = outside;
  attachKeyboardInset(sheet, win);
  viewport.height = 328;
  fire("resize");
  runFrames();
  assert.equal(sheet.style.get("--keyboard-inset"), "336px");
  assert.deepEqual(outside.scrolls, []);

  viewport.scale = 2;
  fire("resize");
  runFrames();
  assert.equal(sheet.style.get("--keyboard-inset"), "0px");

  const bare = fakeElement(win);
  const detach = attachKeyboardInset(bare, { ...win, visualViewport: null });
  assert.equal(bare.style.get("--keyboard-inset"), undefined);
  detach();
  assert.doesNotThrow(() => attachKeyboardInset(null, win)());
});

// Every bottom sheet with a BottomActions bar lifts above the keyboard:
// it is an EntryMobileSheet (which attaches the inset) or attaches it
// itself. The browser tests cannot open an iPhone keyboard, so this pins
// the wiring and the CSS that uses the inset.
test("every bottom sheet with a bottom bar lifts itself above the keyboard", () => {
  const clientDir = path.join(root, "src/client");
  const files = readdirSync(clientDir, { recursive: true }).map(String).filter((name) => /\.jsx?$/.test(name));
  const withBar = files.filter((name) => /<BottomActions\b/.test(read(`src/client/${name}`)));
  // The wide-screen inline editors (entries, split expenses) and the open
  // simplified settlement on the page are not sheets and have no keyboard.
  // The picker sheet and the shared states (cards and banners with one
  // primary action) have no field to type in, so no keyboard to lift above.
  // Ask's plan draft and turn draft cards sit in the conversation, not in a sheet.
  const notSheets = new Set(["ask-plan-draft-card.jsx", "ask-turn-cards.jsx", "entries-list.jsx", "splits-activity.jsx", "splits-checkpoint-panel.jsx", "picker-sheet.jsx", "ui-states.jsx"]);
  assert.deepEqual(withBar.sort(), ["ask-plan-draft-card.jsx", "ask-turn-cards.jsx", "entries-list.jsx", "entries-panel.jsx", "import-batch-bar.jsx", "import-preview-row-list.jsx", "mobile-context-sheet.jsx", "month-plan-sheet.jsx", "picker-sheet.jsx", "sheet-dialog.jsx", "splits-activity.jsx", "splits-archive-dialog.jsx", "splits-checkpoint-panel.jsx", "splits-dialogs.jsx", "splits-groups-sheet.jsx", "splits-history-dialog.jsx", "ui-states.jsx"]);
  for (const name of withBar.filter((file) => !notSheets.has(file))) {
    const source = read(`src/client/${name}`);
    const lifted = /useKeyboardInset\(/.test(source) || /<EntryMobileSheet\b/.test(source);
    assert.ok(lifted, `${name} renders a bottom bar in a sheet that does not follow the keyboard`);
  }
  assert.match(read("src/client/entry-mobile-sheet.jsx"), /useKeyboardInset\(sheet\)/);
  assert.match(read("src/client/splits-dialogs.jsx"), /useKeyboardInset\(isMobileLayout \? content : null\)/);

  const styles = read("public/styles.css");
  for (const selector of [".entry-composer.entry-mobile-sheet {", ".note-dialog-content.split-dialog-content {"]) {
    const rule = styles.slice(styles.indexOf(selector), styles.indexOf("}", styles.indexOf(selector)));
    assert.match(rule, /bottom: var\(--keyboard-inset, 0px\)/, selector);
    assert.match(rule, /max-height: calc\([^;]*- var\(--keyboard-inset, 0px\)\)/, selector);
  }
});
