// Where Ask's back link goes (src/client/ask-origin.js): the page the
// Entries + or the Splits receipt button opened Ask from, kept as its URL,
// scroll position and an open sheet's draft. With that page right behind
// Ask in the history, back is history.back (so the link and the phone's
// back gesture are one way); otherwise the page is opened again with the
// place it had, from this tab's sessionStorage, or, with nothing kept, the
// plain page for the same view and month.
import assert from "node:assert/strict";
import test from "node:test";

import {
  ASK_ORIGIN_STORAGE_KEY,
  forgetAskOrigin,
  planAskBack,
  readAskOrigin,
  recallAskOrigin,
  rememberAskOrigin
} from "../src/client/ask-origin.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
}

const ENTRIES_ORIGIN = {
  id: "o1",
  from: "entries",
  path: "/entries?view=household&month=2026-05&scope=direct_plus_shared&entry_type=expense",
  scrollY: 512,
  sheet: null
};
const SHEET_ORIGIN = {
  ...ENTRIES_ORIGIN,
  id: "o2",
  sheet: { kind: "edit", entry: { id: "entry-1", description: "Draft words", amountMinor: 1250, splits: [] } }
};
const SPLITS_ORIGIN = { id: "o3", from: "splits", path: "/splits?view=person-tim&month=2025-10&split_group=split-group-baby-river", scrollY: 300, sheet: null };
const FALLBACK = { pathname: "/entries", search: "?view=household&month=2026-05&scope=direct_plus_shared" };

test("an origin reads back only with its own shape: a page Ask can return to, a whole scroll and a known sheet", () => {
  assert.deepEqual(readAskOrigin(ENTRIES_ORIGIN), ENTRIES_ORIGIN);
  assert.deepEqual(readAskOrigin(SHEET_ORIGIN), SHEET_ORIGIN);
  assert.deepEqual(readAskOrigin({ ...ENTRIES_ORIGIN, scrollY: 12.6 }), { ...ENTRIES_ORIGIN, scrollY: 13 });
  // A sheet of another kind, or one without an entry id, is dropped; the
  // rest of the place still counts.
  assert.deepEqual(readAskOrigin({ ...ENTRIES_ORIGIN, sheet: { kind: "other" } }), ENTRIES_ORIGIN);
  assert.deepEqual(readAskOrigin({ ...ENTRIES_ORIGIN, sheet: { kind: "edit", entry: {} } }), ENTRIES_ORIGIN);
  assert.deepEqual(readAskOrigin({ ...ENTRIES_ORIGIN, sheet: { kind: "add", draft: { description: "x" } } }).sheet, { kind: "add", draft: { description: "x" } });

  // Rejected: another app's page, a page that is not the way in's, a path
  // that leaves the app, a missing id, a negative or odd scroll, nothing.
  assert.equal(readAskOrigin({ ...ENTRIES_ORIGIN, path: "/summary?view=household" }), null);
  assert.equal(readAskOrigin({ ...ENTRIES_ORIGIN, from: "splits" }), null);
  assert.equal(readAskOrigin({ ...ENTRIES_ORIGIN, path: "//evil.example/entries" }), null);
  assert.equal(readAskOrigin({ ...ENTRIES_ORIGIN, path: "https://evil.example/entries" }), null);
  assert.equal(readAskOrigin({ ...ENTRIES_ORIGIN, id: "" }), null);
  assert.equal(readAskOrigin({ ...ENTRIES_ORIGIN, from: "ask" }), null);
  assert.deepEqual(readAskOrigin({ ...ENTRIES_ORIGIN, scrollY: -4 }), { ...ENTRIES_ORIGIN, scrollY: 0 });
  assert.deepEqual(readAskOrigin({ ...ENTRIES_ORIGIN, scrollY: "lots" }), { ...ENTRIES_ORIGIN, scrollY: 0 });
  assert.equal(readAskOrigin(null), null);
  assert.equal(readAskOrigin("o1"), null);
});

test("with the origin right behind Ask in the history, back is history.back", () => {
  assert.deepEqual(
    planAskBack({ from: "entries", state: { askOrigin: ENTRIES_ORIGIN }, storage: memoryStorage(), fallback: FALLBACK }),
    { kind: "history" }
  );
  assert.deepEqual(
    planAskBack({ from: "splits", state: { askOrigin: SPLITS_ORIGIN }, storage: memoryStorage(), fallback: FALLBACK }),
    { kind: "history" }
  );
});

test("without it in the history, back opens the kept page with its place to restore", () => {
  const storage = memoryStorage();
  rememberAskOrigin(storage, SHEET_ORIGIN);
  rememberAskOrigin(storage, SPLITS_ORIGIN);
  // The Ask tab reopened the card: no state on this history entry.
  assert.deepEqual(planAskBack({ from: "entries", state: null, storage, fallback: FALLBACK }), {
    kind: "navigate",
    to: { pathname: "/entries", search: "?view=household&month=2026-05&scope=direct_plus_shared&entry_type=expense" },
    state: { askReturn: SHEET_ORIGIN }
  });
  // A state for another way in does not count as the history's origin.
  assert.equal(planAskBack({ from: "entries", state: { askOrigin: SPLITS_ORIGIN }, storage, fallback: FALLBACK }).kind, "navigate");
  assert.deepEqual(planAskBack({ from: "splits", state: {}, storage, fallback: FALLBACK }).state, { askReturn: SPLITS_ORIGIN });
});

test("with nothing kept, back opens the plain page for the same view and month", () => {
  assert.deepEqual(planAskBack({ from: "entries", state: null, storage: memoryStorage(), fallback: FALLBACK }), {
    kind: "navigate",
    to: FALLBACK,
    state: undefined
  });
  // Unreadable or old storage counts as nothing kept.
  const broken = memoryStorage({ [ASK_ORIGIN_STORAGE_KEY]: "{not json" });
  assert.equal(planAskBack({ from: "entries", state: null, storage: broken, fallback: FALLBACK }).to, FALLBACK);
  const older = memoryStorage({ [ASK_ORIGIN_STORAGE_KEY]: JSON.stringify({ v: 0, entries: ENTRIES_ORIGIN }) });
  assert.equal(recallAskOrigin(older, "entries"), null);
  // No storage at all (private mode) still plans a way back.
  assert.equal(planAskBack({ from: "entries", state: null, storage: null, fallback: FALLBACK }).to, FALLBACK);
});

test("the kept origin is one per way in, and is forgotten once its page has restored it", () => {
  const storage = memoryStorage();
  rememberAskOrigin(storage, ENTRIES_ORIGIN);
  rememberAskOrigin(storage, SPLITS_ORIGIN);
  rememberAskOrigin(storage, SHEET_ORIGIN);
  assert.deepEqual(recallAskOrigin(storage, "entries"), SHEET_ORIGIN);
  assert.deepEqual(recallAskOrigin(storage, "splits"), SPLITS_ORIGIN);
  assert.deepEqual(JSON.parse(storage.values.get(ASK_ORIGIN_STORAGE_KEY)), { v: 1, entries: SHEET_ORIGIN, splits: SPLITS_ORIGIN });

  // Another origin's id leaves it; its own id forgets it.
  forgetAskOrigin(storage, ENTRIES_ORIGIN);
  assert.deepEqual(recallAskOrigin(storage, "entries"), SHEET_ORIGIN);
  forgetAskOrigin(storage, SHEET_ORIGIN);
  assert.equal(recallAskOrigin(storage, "entries"), null);
  assert.deepEqual(recallAskOrigin(storage, "splits"), SPLITS_ORIGIN);
  forgetAskOrigin(storage, SPLITS_ORIGIN);
  assert.equal(storage.values.has(ASK_ORIGIN_STORAGE_KEY), false);

  // Invalid origins are never kept.
  rememberAskOrigin(storage, { ...ENTRIES_ORIGIN, path: "/settings" });
  assert.equal(storage.values.has(ASK_ORIGIN_STORAGE_KEY), false);
});

test("a storage that throws never breaks the way back", () => {
  const throwing = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
    removeItem() { throw new Error("blocked"); }
  };
  assert.doesNotThrow(() => rememberAskOrigin(throwing, ENTRIES_ORIGIN));
  assert.doesNotThrow(() => forgetAskOrigin(throwing, ENTRIES_ORIGIN));
  assert.equal(recallAskOrigin(throwing, "entries"), null);
  assert.deepEqual(planAskBack({ from: "entries", state: null, storage: throwing, fallback: FALLBACK }).to, FALLBACK);
});
