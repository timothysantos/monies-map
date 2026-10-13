// The desktop Ask dock's state (src/client/ask-dock-state.js): whether the
// conversation is open beside the page, docked or as a popup, and which
// way in it shows. Kept for the browser tab's session (open and closed are
// remembered across route changes and a reload); the words typed into the
// field before Ask loads and a dropped photo are handed over once, in
// memory, and never stored.
import assert from "node:assert/strict";
import test from "node:test";

import { ASK_DOCK_STORAGE_KEY, CHAT_INTENT, createAskDockStore } from "../src/client/ask-dock-state.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
}

const ADD = { mode: "add", from: "ask", savedEntryId: "", splitGroupId: "" };

test("closed by default, in chat", () => {
  const store = createAskDockStore({ storage: memoryStorage() });
  const snapshot = store.getSnapshot();
  assert.equal(snapshot.open, false);
  assert.equal(snapshot.mode, "docked");
  assert.deepEqual(snapshot.intent, CHAT_INTENT);
  assert.equal(snapshot.draftText, "");
  assert.equal(snapshot.ready, false);
});

test("opening remembers open, the mode and the way in for this tab's session", () => {
  const storage = memoryStorage();
  const store = createAskDockStore({ storage });
  store.open({ mode: "popup", intent: ADD });
  assert.equal(store.getSnapshot().open, true);
  assert.equal(store.getSnapshot().mode, "popup");
  assert.deepEqual(store.getSnapshot().intent, ADD);
  assert.deepEqual(JSON.parse(storage.values.get(ASK_DOCK_STORAGE_KEY)), { version: 1, open: true, mode: "popup", intent: ADD });

  // A reload in the same tab reads it back.
  const reloaded = createAskDockStore({ storage });
  assert.equal(reloaded.getSnapshot().open, true);
  assert.equal(reloaded.getSnapshot().mode, "popup");
  assert.deepEqual(reloaded.getSnapshot().intent, ADD);

  store.close();
  assert.equal(store.getSnapshot().open, false);
  assert.equal(JSON.parse(storage.values.get(ASK_DOCK_STORAGE_KEY)).open, false);
  assert.equal(createAskDockStore({ storage }).getSnapshot().open, false);
});

test("the expand control docks the popup", () => {
  const store = createAskDockStore({ storage: memoryStorage() });
  store.open({ mode: "popup" });
  store.expand();
  assert.equal(store.getSnapshot().mode, "docked");
  assert.equal(store.getSnapshot().open, true);
});

test("words typed and a photo dropped before Ask loads are handed over once and never stored", () => {
  const storage = memoryStorage();
  const store = createAskDockStore({ storage });
  const photo = { name: "receipt.jpg", type: "image/jpeg" };
  store.setDraftText("grab rides in sep");
  store.open({ mode: "docked", file: photo });
  assert.equal(store.getSnapshot().draftText, "grab rides in sep");
  const stored = storage.values.get(ASK_DOCK_STORAGE_KEY);
  assert.equal(stored.includes("grab"), false);
  assert.equal(stored.includes("receipt"), false);

  assert.deepEqual(store.takeHandoff(), { text: "grab rides in sep", file: photo, insight: null, question: "" });
  assert.equal(store.getSnapshot().draftText, "");
  // Taken once: a second read (React StrictMode runs effects twice) is empty.
  assert.deepEqual(store.takeHandoff(), { text: "", file: null, insight: null, question: "" });
});

test("an insight question from Ask about this is handed over once, in memory, and Close drops it", () => {
  const storage = memoryStorage();
  const store = createAskDockStore({ storage });
  const insight = { key: "statement-gap:acct-ocbc", kind: "quick_fix", fact: "Serene's OCBC 365 statement differs by $42.80." };
  store.open({ mode: "docked", intent: { mode: "chat" }, insight });
  assert.equal(storage.values.get(ASK_DOCK_STORAGE_KEY).includes("OCBC"), false);
  assert.deepEqual(store.takeHandoff(), { text: "", file: null, insight, question: "" });
  assert.deepEqual(store.takeHandoff(), { text: "", file: null, insight: null, question: "" });
  store.open({ mode: "docked", insight });
  store.close();
  assert.equal(store.takeHandoff().insight, null);
});

test("a person's open asks for the composer's focus once; a restored panel does not take it", () => {
  const storage = memoryStorage();
  const store = createAskDockStore({ storage });
  store.open({ mode: "docked", focus: true });
  assert.equal(store.takeFocusRequest(), true);
  assert.equal(store.takeFocusRequest(), false);

  const reloaded = createAskDockStore({ storage });
  assert.equal(reloaded.getSnapshot().open, true);
  assert.equal(reloaded.takeFocusRequest(), false);

  reloaded.requestFocus();
  assert.equal(reloaded.takeFocusRequest(), true);
});

test("closing by hand gives focus back to the field once", () => {
  const store = createAskDockStore({ storage: memoryStorage() });
  store.open({ mode: "docked" });
  store.close({ returnFocus: true });
  assert.equal(store.takeReturnFocus(), true);
  assert.equal(store.takeReturnFocus(), false);
  store.open({ mode: "docked" });
  store.close();
  assert.equal(store.takeReturnFocus(), false);
});

test("ready follows the conversation mounting and is never stored", () => {
  const storage = memoryStorage();
  const store = createAskDockStore({ storage });
  store.open({ mode: "docked" });
  store.setReady(true);
  assert.equal(store.getSnapshot().ready, true);
  assert.equal(createAskDockStore({ storage }).getSnapshot().ready, false);
  store.close();
  assert.equal(store.getSnapshot().ready, false);
});

test("a new way in replaces the intent; anything unreadable falls back to closed chat", () => {
  const storage = memoryStorage();
  const store = createAskDockStore({ storage });
  store.open({ mode: "docked" });
  store.setIntent(ADD);
  assert.deepEqual(store.getSnapshot().intent, ADD);
  store.setIntent({ mode: "nonsense" });
  assert.deepEqual(store.getSnapshot().intent, CHAT_INTENT);

  for (const bad of ["{", "null", JSON.stringify({ version: 9, open: true }), JSON.stringify({ version: 1, open: "yes", mode: 4 })]) {
    const broken = memoryStorage({ [ASK_DOCK_STORAGE_KEY]: bad });
    const snapshot = createAskDockStore({ storage: broken }).getSnapshot();
    assert.equal(snapshot.open, false, bad);
    assert.equal(snapshot.mode, "docked", bad);
    assert.deepEqual(snapshot.intent, CHAT_INTENT, bad);
  }
});

test("listeners hear every change and stop after unsubscribing", () => {
  const store = createAskDockStore({ storage: memoryStorage() });
  let calls = 0;
  const unsubscribe = store.subscribe(() => { calls += 1; });
  store.open({ mode: "docked" });
  store.setDraftText("a");
  store.close();
  assert.equal(calls, 3);
  unsubscribe();
  store.open({ mode: "docked" });
  assert.equal(calls, 3);
});

test("works without storage (private mode)", () => {
  const throwing = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() {} };
  const store = createAskDockStore({ storage: throwing });
  store.open({ mode: "popup" });
  assert.equal(store.getSnapshot().open, true);
  assert.equal(createAskDockStore({ storage: null }).getSnapshot().open, false);
});

test("a person's open marks the dock opened by hand; a restored one is not", () => {
  const storage = memoryStorage();
  const store = createAskDockStore({ storage });
  assert.equal(store.getSnapshot().openedByHand, false);
  store.open({ mode: "docked", intent: { mode: "add", from: "entries" } });
  assert.equal(store.getSnapshot().openedByHand, true);
  assert.deepEqual(store.getSnapshot().intent, { mode: "add", from: "entries", savedEntryId: "", splitGroupId: "" });
  assert.equal(createAskDockStore({ storage }).getSnapshot().openedByHand, false);
});

test("each open that names a way in is a new visit; reopening from the field is not", () => {
  const store = createAskDockStore({ storage: memoryStorage() });
  const start = store.getSnapshot().visit;
  store.open({ mode: "docked", intent: { mode: "add", from: "entries" } });
  store.open({ mode: "docked", intent: { mode: "add", from: "entries" } });
  assert.equal(store.getSnapshot().visit, start + 2);
  store.open({ mode: "docked" });
  assert.equal(store.getSnapshot().visit, start + 2);
  store.setIntent({ mode: "chat" });
  assert.equal(store.getSnapshot().visit, start + 3);
});

test("a lead's Ask about this question is handed over once, in memory, and Close drops it", () => {
  const storage = memoryStorage();
  const store = createAskDockStore({ storage });
  const question = "How much did I invest in May 2026?";
  assert.equal(store.hasQuestionHandoff(), false);
  store.open({ mode: "docked", intent: { mode: "chat" }, question });
  assert.equal(storage.values.get(ASK_DOCK_STORAGE_KEY).includes("invest"), false);
  assert.equal(store.hasQuestionHandoff(), true);
  assert.deepEqual(store.takeHandoff(), { text: "", file: null, insight: null, question });
  assert.equal(store.hasQuestionHandoff(), false);
  assert.equal(store.takeHandoff().question, "");
  // Negative: an open without a question hands none over, and Close drops a waiting one.
  store.open({ mode: "docked", intent: { mode: "chat" } });
  assert.equal(store.takeHandoff().question, "");
  store.open({ mode: "docked", question });
  store.close();
  assert.equal(store.takeHandoff().question, "");
});
