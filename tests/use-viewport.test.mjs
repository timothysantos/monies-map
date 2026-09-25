import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import {
  MOBILE_LAYOUT_QUERY,
  MONTH_SHEET_LAYOUT_QUERY,
  getMediaQueryStore,
  isMobileLayout,
  isMonthSheetLayout,
  useIsMobileLayout
} from "../src/client/use-viewport.js";

// A window whose media queries are set by hand. Each list records its
// listeners so a test can prove subscribe and cleanup, not just the value.
function installFakeWindow({ matching = [], legacyListeners = false } = {}) {
  const matchingQueries = new Set(matching);
  const lists = new Map();
  const matchMediaCalls = [];

  function createList(query) {
    const listeners = new Set();
    const list = {
      media: query,
      get matches() {
        return matchingQueries.has(query);
      },
      listenerCount: () => listeners.size
    };
    const add = (type, listener) => listeners.add(listener);
    const remove = (type, listener) => listeners.delete(listener);
    if (legacyListeners) {
      list.addListener = (listener) => add("change", listener);
      list.removeListener = (listener) => remove("change", listener);
    } else {
      list.addEventListener = add;
      list.removeEventListener = remove;
    }
    list.dispatch = () => {
      for (const listener of [...listeners]) {
        listener({ matches: list.matches, media: query });
      }
    };
    return list;
  }

  const fakeWindow = {
    matchMedia(query) {
      matchMediaCalls.push(query);
      // A real browser hands back a new list per call; the store must share one.
      const list = createList(query);
      const known = lists.get(query) ?? [];
      lists.set(query, [...known, list]);
      return list;
    }
  };

  globalThis.window = fakeWindow;
  return {
    matchMediaCalls,
    listsFor: (query) => lists.get(query) ?? [],
    setMatches(query, matches) {
      if (matches) {
        matchingQueries.add(query);
      } else {
        matchingQueries.delete(query);
      }
      for (const list of lists.get(query) ?? []) {
        list.dispatch();
      }
    }
  };
}

test.afterEach(() => {
  delete globalThis.window;
});

test("breakpoint queries keep the phone width and the wider Month sheet width distinct", () => {
  assert.equal(MOBILE_LAYOUT_QUERY, "(max-width: 760px)");
  assert.equal(MONTH_SHEET_LAYOUT_QUERY, "(max-width: 760px), (max-width: 1024px) and (orientation: portrait)");
  assert.notEqual(MONTH_SHEET_LAYOUT_QUERY, MOBILE_LAYOUT_QUERY);
});

test("the phone layout query is the stylesheet's mobile breakpoint", () => {
  const styles = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
  const mobileBlocks = styles.match(new RegExp(`@media ${MOBILE_LAYOUT_QUERY.replace(/[()]/g, "\\$&")}\\s*\\{`, "g")) ?? [];
  assert.ok(mobileBlocks.length >= 3, `expected the 760px phone blocks in styles.css, found ${mobileBlocks.length}`);
});

test("without a window every read reports the desktop layout and nothing throws", () => {
  assert.equal(typeof globalThis.window, "undefined");
  assert.equal(isMobileLayout(), false);
  assert.equal(isMonthSheetLayout(), false);

  const store = getMediaQueryStore(MOBILE_LAYOUT_QUERY);
  let calls = 0;
  const unsubscribe = store.subscribe(() => {
    calls += 1;
  });
  assert.equal(store.getSnapshot(), false);
  assert.equal(store.getServerSnapshot(), false);
  assert.doesNotThrow(unsubscribe);
  assert.equal(calls, 0);
});

test("a window without matchMedia is treated like no window", () => {
  globalThis.window = {};
  assert.equal(isMobileLayout(), false);
  assert.equal(getMediaQueryStore(MOBILE_LAYOUT_QUERY).getSnapshot(), false);
  assert.doesNotThrow(getMediaQueryStore(MOBILE_LAYOUT_QUERY).subscribe(() => {}));
});

test("the plain reads ask matchMedia on every call so handlers see the current viewport", () => {
  const fake = installFakeWindow({ matching: [MOBILE_LAYOUT_QUERY] });

  assert.equal(isMobileLayout(), true);
  assert.equal(isMonthSheetLayout(), false);
  fake.setMatches(MOBILE_LAYOUT_QUERY, false);
  fake.setMatches(MONTH_SHEET_LAYOUT_QUERY, true);
  assert.equal(isMobileLayout(), false);
  assert.equal(isMonthSheetLayout(), true);

  assert.deepEqual(fake.matchMediaCalls, [
    MOBILE_LAYOUT_QUERY,
    MONTH_SHEET_LAYOUT_QUERY,
    MOBILE_LAYOUT_QUERY,
    MONTH_SHEET_LAYOUT_QUERY
  ]);
});

test("a subscriber hears a breakpoint change and stops hearing it after cleanup", () => {
  const fake = installFakeWindow();
  const store = getMediaQueryStore(MOBILE_LAYOUT_QUERY);
  const seen = [];

  const unsubscribe = store.subscribe(() => seen.push(store.getSnapshot()));
  assert.equal(store.getSnapshot(), false);

  fake.setMatches(MOBILE_LAYOUT_QUERY, true);
  assert.deepEqual(seen, [true]);
  assert.equal(store.getSnapshot(), true);

  fake.setMatches(MOBILE_LAYOUT_QUERY, false);
  assert.deepEqual(seen, [true, false]);

  unsubscribe();
  const [list] = fake.listsFor(MOBILE_LAYOUT_QUERY);
  assert.equal(list.listenerCount(), 0);
  fake.setMatches(MOBILE_LAYOUT_QUERY, true);
  assert.deepEqual(seen, [true, false], "no callback after cleanup");
});

test("every subscriber and snapshot for one query shares a single media list", () => {
  const fake = installFakeWindow();
  const store = getMediaQueryStore(MONTH_SHEET_LAYOUT_QUERY);
  assert.equal(getMediaQueryStore(MONTH_SHEET_LAYOUT_QUERY), store, "one store per query");

  const first = [];
  const second = [];
  const stopFirst = store.subscribe(() => first.push("change"));
  const stopSecond = store.subscribe(() => second.push("change"));
  for (let index = 0; index < 20; index += 1) {
    store.getSnapshot();
  }

  assert.deepEqual(fake.matchMediaCalls, [MONTH_SHEET_LAYOUT_QUERY]);
  const [list] = fake.listsFor(MONTH_SHEET_LAYOUT_QUERY);
  assert.equal(list.listenerCount(), 2);

  fake.setMatches(MONTH_SHEET_LAYOUT_QUERY, true);
  assert.deepEqual(first, ["change"]);
  assert.deepEqual(second, ["change"]);

  stopFirst();
  assert.equal(list.listenerCount(), 1);
  stopSecond();
  assert.equal(list.listenerCount(), 0);
});

test("browsers with only the legacy listener API still get change events and cleanup", () => {
  const fake = installFakeWindow({ legacyListeners: true });
  const store = getMediaQueryStore(MOBILE_LAYOUT_QUERY);
  let calls = 0;

  const unsubscribe = store.subscribe(() => {
    calls += 1;
  });
  fake.setMatches(MOBILE_LAYOUT_QUERY, true);
  assert.equal(calls, 1);

  unsubscribe();
  assert.equal(fake.listsFor(MOBILE_LAYOUT_QUERY)[0].listenerCount(), 0);
  fake.setMatches(MOBILE_LAYOUT_QUERY, false);
  assert.equal(calls, 1);
});

test("a replaced window gets its own media list instead of a stale one", () => {
  installFakeWindow({ matching: [MOBILE_LAYOUT_QUERY] });
  const store = getMediaQueryStore(MOBILE_LAYOUT_QUERY);
  assert.equal(store.getSnapshot(), true);

  installFakeWindow();
  assert.equal(store.getSnapshot(), false);
});

function LayoutProbe() {
  return createElement("span", null, useIsMobileLayout() ? "mobile" : "desktop");
}

test("the hook renders the desktop layout on the server and with no window", () => {
  assert.equal(renderToString(createElement(LayoutProbe)), "<span>desktop</span>");

  // Server rendering always uses the server snapshot, even if a window exists.
  installFakeWindow({ matching: [MOBILE_LAYOUT_QUERY] });
  assert.equal(renderToString(createElement(LayoutProbe)), "<span>desktop</span>");
});
