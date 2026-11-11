import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

import { messages } from "../src/client/copy/en-SG.js";

// The 2026-11-11 black screen: the page stayed empty (no spinner, no error)
// when the app could not start. Two ways were reproduced in Chromium and
// WebKit: the browser refusing localStorage while the app starts, and an old
// page whose script a deploy had removed. The boot guard in index.html (a
// plain inline script, since nothing in React runs) reloads once for a script
// that failed to load and otherwise leaves a card with a Reload button.

const ROOT = path.resolve(import.meta.dirname, "..");
const HTML = readFileSync(path.join(ROOT, "index.html"), "utf8");
const GUARD = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]).find((code) => code.includes("RELOAD_KEY"));

function runGuard({ storageBlocked = false, stamp = null, mounted = false } = {}) {
  const timers = [];
  const listeners = {};
  const store = new Map(stamp === null ? [] : [["monies-map:boot-reload", String(stamp)]]);
  const calls = { reloads: 0 };
  const children = [];
  const root = {
    get firstChild() { return children[0] ?? null; },
    appendChild: (child) => children.push(child),
    querySelector: (selector) => (selector === "[data-boot-card]" ? children.find((child) => child.attrs?.["data-boot-card"] !== undefined) ?? null : null)
  };
  if (mounted) children.push({ attrs: {} });
  const element = (tag) => ({
    tag,
    attrs: {},
    style: {},
    children: [],
    setAttribute(name, value) { this.attrs[name] = value; },
    appendChild(child) { this.children.push(child); }
  });
  const context = {
    Number,
    Date,
    setTimeout: (fn, ms) => timers.push({ fn, ms }),
    sessionStorage: {
      getItem: (key) => { if (storageBlocked) throw new Error("blocked"); return store.get(key) ?? null; },
      setItem: (key, value) => { if (storageBlocked) throw new Error("blocked"); store.set(key, value); },
      removeItem: (key) => { if (storageBlocked) throw new Error("blocked"); store.delete(key); }
    },
    location: { reload: () => { calls.reloads += 1; } },
    document: { getElementById: () => root, createElement: element },
    window: { addEventListener: (type, listener) => { listeners[type] = listener; } }
  };
  vm.runInNewContext(GUARD, context);
  const texts = () => {
    const card = children.find((child) => child.attrs?.["data-boot-card"] !== undefined);
    return card ? card.children.map((child) => child.textContent) : null;
  };
  return {
    calls,
    store,
    texts,
    timers,
    // Fires every timer registered so far at or below `ms`.
    advance(ms) { for (const timer of timers.filter((t) => t.ms <= ms)) timer.fn(); },
    fire(type, event) { listeners[type](event); }
  };
}

const scriptFailure = { target: { tagName: "SCRIPT" } };
const pageError = { target: {} };

test("the guard exists in the head, before the page body and the app's module script", () => {
  assert.ok(GUARD, "index.html has a boot guard");
  assert.ok(HTML.indexOf("RELOAD_KEY") < HTML.indexOf("</head>"));
  assert.ok(HTML.indexOf("RELOAD_KEY") < HTML.indexOf('type="module"'));
});

test("a script that fails to load reloads the page once", () => {
  const guard = runGuard();
  guard.fire("error", scriptFailure);
  guard.advance(0);
  assert.equal(guard.calls.reloads, 1);
  assert.equal(guard.texts(), null, "no card while the reload is on its way");
  assert.ok(Number(guard.store.get("monies-map:boot-reload")) > 0, "the loop guard is stamped");
});

test("a second failure inside a minute shows the card with a Reload button instead of reloading again", () => {
  const guard = runGuard({ stamp: Date.now() - 5000 });
  guard.fire("error", scriptFailure);
  guard.advance(0);
  assert.equal(guard.calls.reloads, 0);
  assert.deepEqual(guard.texts(), [
    messages.common.codeLoadCrashTitle,
    messages.common.appCrashDetail,
    messages.common.screenCrashReload
  ]);
});

test("a failure long after the last reload may reload again", () => {
  const guard = runGuard({ stamp: Date.now() - 10 * 60 * 1000 });
  guard.fire("error", scriptFailure);
  guard.advance(0);
  assert.equal(guard.calls.reloads, 1);
});

test("storage that refuses writes means no loop guard, so no automatic reload, only the card", () => {
  const guard = runGuard({ storageBlocked: true });
  guard.fire("error", scriptFailure);
  guard.advance(0);
  assert.equal(guard.calls.reloads, 0);
  assert.equal(guard.texts()?.[2], messages.common.screenCrashReload);
});

test("an error that leaves the page empty shows the plain card after a moment, without reloading", () => {
  const guard = runGuard();
  guard.fire("error", pageError);
  guard.advance(3000);
  assert.equal(guard.calls.reloads, 0);
  assert.deepEqual(guard.texts(), [
    messages.common.appCrashTitle,
    messages.common.appCrashDetail,
    messages.common.screenCrashReload
  ]);
});

test("nothing is drawn over a page the app has mounted, whatever errors later", () => {
  const guard = runGuard({ mounted: true });
  guard.fire("error", pageError);
  guard.fire("error", scriptFailure);
  guard.advance(15000);
  assert.equal(guard.calls.reloads, 0);
  assert.equal(guard.texts(), null);
});

test("a start that never draws anything gets the card after 15 seconds", () => {
  const guard = runGuard();
  guard.advance(14999);
  assert.equal(guard.texts(), null);
  guard.advance(15000);
  assert.ok(guard.texts());
});

test("a start that held for 5 seconds clears the loop guard, a card does not", () => {
  const good = runGuard({ stamp: Date.now(), mounted: true });
  good.advance(5000);
  assert.equal(good.store.has("monies-map:boot-reload"), false);

  const failed = runGuard({ stamp: Date.now() });
  failed.fire("error", scriptFailure);
  failed.advance(15000);
  assert.ok(failed.store.has("monies-map:boot-reload"), "a failed start keeps the stamp so it cannot loop");
});

test("the card's words are the app's own crash copy", () => {
  for (const words of [messages.common.codeLoadCrashTitle, messages.common.appCrashTitle, messages.common.appCrashDetail, messages.common.screenCrashReload]) {
    assert.ok(GUARD.includes(words), `index.html carries: ${words}`);
  }
});

// Boot-path storage: the browser can refuse the `localStorage` property itself
// (Safari with all cookies blocked) or refuse writes (full). Reading it as a
// default parameter, at import time or in an app-wide provider, kept the page
// empty.
function withBlockedStorage(run) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() { throw new DOMException("The operation is insecure.", "SecurityError"); }
  });
  return Promise.resolve().then(run).finally(() => {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete globalThis.localStorage;
  });
}

test("the modules the first screen loads import and read their choice with storage blocked", async () => {
  await withBlockedStorage(async () => {
    const stamp = `?blocked=${Date.now()}`;
    const leadView = await import(`../src/client/lead-view.js${stamp}`);
    assert.equal(leadView.readLeadView(), null);
    const presets = await import(`../src/client/colour-presets.js${stamp}`);
    assert.equal(presets.readStoredPresetId(), presets.DEFAULT_PRESET_ID);
    const { createPreferenceStore } = await import(`../src/client/viewer-preference-store.js${stamp}`);
    const store = createPreferenceStore({ field: "planMode", storageKey: "k", path: "/x", isValid: () => true, send: async () => {} });
    assert.ok(store);
    const { createDonutModeStore } = await import(`../src/client/splits-donut-mode.js${stamp}`);
    assert.ok(createDonutModeStore());
  });
});

test("device storage reads the window's storage when there is a window, null when it is blocked", async () => {
  const { deviceStorage } = await import("../src/client/device-storage.js");
  const store = { getItem: () => "true" };
  try {
    globalThis.window = { localStorage: store };
    assert.equal(deviceStorage(), store);
    globalThis.window = { get localStorage() { throw new DOMException("The operation is insecure.", "SecurityError"); } };
    assert.equal(deviceStorage(), null);
    globalThis.window = {};
    assert.equal(deviceStorage(), null);
  } finally {
    delete globalThis.window;
  }
  assert.equal(deviceStorage(), null);
});

test("no client module reads localStorage as a default parameter or in the app-wide privacy provider without a guard", () => {
  const clientDir = path.join(ROOT, "src/client");
  const offenders = [];
  for (const name of readdirSync(clientDir).filter((file) => /\.(js|jsx)$/.test(file))) {
    const source = readFileSync(path.join(clientDir, name), "utf8");
    if (/=\s*globalThis\.(local|session)Storage/.test(source)) offenders.push(`${name}: default parameter reads storage`);
  }
  const privacy = readFileSync(path.join(clientDir, "money-privacy.jsx"), "utf8");
  if (/window\.localStorage/.test(privacy)) offenders.push("money-privacy.jsx: reads window.localStorage directly");
  assert.deepEqual(offenders, []);
});
