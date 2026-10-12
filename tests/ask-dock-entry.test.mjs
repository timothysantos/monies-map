// The part of the desktop Ask dock that stays in the first screen
// (src/client/ask-dock-entry.js): the panel left open in this tab, and what
// the person did before the dock's code arrived, kept until the dock takes it.
import assert from "node:assert/strict";
import test from "node:test";

import {
  ASK_DOCK_STORAGE_KEY,
  forgetAskDockOpen,
  onAskDockRequest,
  requestAskDock,
  storedAskDockMode,
  takeAskDockRequest
} from "../src/client/ask-dock-entry.js";

function withSession(initial, run) {
  const values = new Map(Object.entries(initial));
  const previous = globalThis.window;
  globalThis.window = {
    sessionStorage: {
      getItem: (key) => (values.has(key) ? values.get(key) : null),
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key)
    }
  };
  try {
    return run(values);
  } finally {
    globalThis.window = previous;
  }
}

test("a panel left open is restored with its mode; closed, empty or unreadable storage restores nothing", () => {
  const stored = (value) => ({ [ASK_DOCK_STORAGE_KEY]: typeof value === "string" ? value : JSON.stringify(value) });
  withSession(stored({ version: 1, open: true, mode: "popup" }), () => assert.equal(storedAskDockMode(), "popup"));
  withSession(stored({ version: 1, open: true, mode: "sideways" }), () => assert.equal(storedAskDockMode(), "docked"));
  withSession(stored({ version: 1, open: false, mode: "docked" }), () => assert.equal(storedAskDockMode(), null));
  withSession({}, () => assert.equal(storedAskDockMode(), null));
  withSession(stored("{not json"), () => assert.equal(storedAskDockMode(), null));
  assert.equal(storedAskDockMode(), null, "no window (server render)");
});

test("closing before the dock loads forgets the open panel", () => {
  withSession({ [ASK_DOCK_STORAGE_KEY]: JSON.stringify({ version: 1, open: true, mode: "docked" }) }, (values) => {
    forgetAskDockOpen();
    assert.equal(values.has(ASK_DOCK_STORAGE_KEY), false);
    assert.equal(storedAskDockMode(), null);
  });
});

test("what happens before the dock loads is kept, merged, and taken once", () => {
  assert.equal(takeAskDockRequest(), null);
  const file = { name: "receipt.png" };
  requestAskDock({ open: true });
  requestAskDock({ file });
  assert.deepEqual(takeAskDockRequest(), { open: true, file });
  assert.equal(takeAskDockRequest(), null, "taken once");
});

test("the launcher is woken by a request, and at once by one already waiting", () => {
  let wakes = 0;
  requestAskDock({ open: true });
  const stop = onAskDockRequest(() => { wakes += 1; });
  assert.equal(wakes, 1, "a waiting request wakes a late listener");
  requestAskDock({ options: { intent: { mode: "add" } } });
  assert.equal(wakes, 2);
  stop();
  requestAskDock({ open: true });
  assert.equal(wakes, 2, "a removed listener is not woken");
  assert.deepEqual(takeAskDockRequest(), { open: true, options: { intent: { mode: "add" } } });
});
