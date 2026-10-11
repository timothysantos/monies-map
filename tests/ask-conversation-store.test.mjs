// The Ask conversation store (src/client/ask-conversation-store.js): the
// thread, the entry card, the composer text and the open question live
// above the routes, so leaving Ask and coming back (or reloading the tab)
// restores them. Mirrored to sessionStorage only, versioned, size-capped,
// never with photos or audio, and dropped when it cannot be read.
import assert from "node:assert/strict";
import test from "node:test";

import {
  ASK_CONVERSATION_STORAGE_KEY,
  createAskConversationStore,
  isConversationInProgress,
  parseStoredConversations
} from "../src/client/ask-conversation-store.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
}

const CHAT = { mode: "chat", from: "", savedEntryId: "", splitGroupId: "" };
const ADD = { mode: "add", from: "entries", savedEntryId: "", splitGroupId: "" };
const CHAT_KEY = "chat|||";
const ADD_KEY = "add|entries||";

function draftCard(fields = {}) {
  return {
    status: "draft",
    variant: "expense",
    fields: { date: "2026-10-11", description: "Koufu", amountInput: "12.50", amountMinor: 1250, accountId: "acct-1", note: "", ...fields },
    filled: { description: "sentence" },
    origin: "sentence",
    touched: true,
    share: { on: false, splitGroupId: "" },
    questions: [],
    saveError: "",
    saved: null
  };
}

function emptyConversation(intent) {
  return { intent, thread: [], card: null, cardSlot: 0, composerText: "", pending: null, scrollFromBottom: 0 };
}

test("a conversation comes back after leaving and after a reload, as it was", () => {
  const storage = memoryStorage();
  const store = createAskConversationStore({ storage });
  store.begin(CHAT_KEY, () => emptyConversation(CHAT));
  store.update(CHAT_KEY, (conversation) => ({
    ...conversation,
    thread: [
      { id: "ask-a-1", kind: "me", text: "grab rides in september" },
      { id: "ask-a-2", kind: "answer", filter: { month: "2026-09", viewId: "person-ethan", scope: "direct_plus_shared", search: "grab", categories: [], wallets: [], type: "", minAmountMinor: null, maxAmountMinor: null } },
      { id: "ask-a-3", kind: "me", text: "Koufu lunch 12.50" }
    ],
    card: draftCard(),
    cardSlot: 3,
    composerText: "and a kopi",
    pending: { kind: "question", filter: { month: "2026-09" }, questions: [{ field: "wallet", options: [] }] }
  }));
  store.leave(CHAT_KEY, { scrollFromBottom: 24 });

  // Leaving: the same store hands it back.
  const back = store.begin(CHAT_KEY, () => emptyConversation(CHAT));
  assert.equal(back.composerText, "and a kopi");
  assert.equal(back.cardSlot, 3);
  assert.equal(back.scrollFromBottom, 24);
  assert.deepEqual(back.thread.map((item) => item.kind), ["me", "answer", "me"]);

  // A reload: a new store over the same sessionStorage.
  const reloaded = createAskConversationStore({ storage }).begin(CHAT_KEY, () => emptyConversation(CHAT));
  assert.deepEqual(reloaded.thread, back.thread);
  assert.deepEqual(reloaded.card, draftCard());
  assert.equal(reloaded.composerText, "and a kopi");
  assert.equal(reloaded.cardSlot, 3);
  assert.equal(reloaded.scrollFromBottom, 24);
  assert.deepEqual(reloaded.pending, back.pending);
});

test("photos, audio and status lines never reach sessionStorage", () => {
  const storage = memoryStorage();
  const store = createAskConversationStore({ storage });
  store.begin(CHAT_KEY, () => emptyConversation(CHAT));
  store.update(CHAT_KEY, (conversation) => ({
    ...conversation,
    thread: [
      { id: "ask-b-1", kind: "me", text: "Sent a receipt photo" },
      { id: "ask-b-2", kind: "photo", url: "blob:http://localhost/receipt" },
      { id: "ask-b-3", kind: "status", text: "Reading your receipt…" },
      { id: "ask-b-4", kind: "note", text: "Read on this device.", image: "data:image/jpeg;base64,AAAA" }
    ],
    card: { ...draftCard(), receiptImage: "data:image/png;base64,BBBB", audio: { clip: "blob:x" }, fields: { ...draftCard().fields, thumbUrl: "blob:http://localhost/thumb" } },
    cardSlot: 4
  }));
  const stored = storage.getItem(ASK_CONVERSATION_STORAGE_KEY);
  assert.ok(stored);
  assert.doesNotMatch(stored, /blob:|data:|"kind":"photo"|"kind":"status"|receiptImage|"audio"|thumbUrl|"image"/);
  const [slot] = JSON.parse(stored).slots;
  assert.deepEqual(slot.thread.map((item) => item.kind), ["me", "note"]);
  // The card sits after the two items that were kept.
  assert.equal(slot.cardSlot, 2);
  // In memory the photo stays while the page shows it; leaving drops it.
  assert.equal(store.read(CHAT_KEY).thread.length, 4);
  store.leave(CHAT_KEY, { scrollFromBottom: 0 });
  assert.deepEqual(store.read(CHAT_KEY).thread.map((item) => item.kind), ["me", "note"]);
  assert.equal(store.read(CHAT_KEY).cardSlot, 2);
});

test("a card that was saving comes back as a draft after a reload", () => {
  const storage = memoryStorage();
  const store = createAskConversationStore({ storage });
  store.begin(ADD_KEY, () => emptyConversation(ADD));
  store.update(ADD_KEY, (conversation) => ({ ...conversation, card: { ...draftCard(), status: "saving" } }));
  const reloaded = createAskConversationStore({ storage }).read(ADD_KEY);
  assert.equal(reloaded.card.status, "draft");
});

test("unreadable sessionStorage is ignored and cleared, never thrown", () => {
  for (const bad of ["{not json", "null", "[]", JSON.stringify({ v: 999, slots: [] }), JSON.stringify({ v: 1, slots: "nope" })]) {
    const storage = memoryStorage({ [ASK_CONVERSATION_STORAGE_KEY]: bad });
    const store = createAskConversationStore({ storage });
    assert.equal(store.read(CHAT_KEY), null, bad);
    assert.equal(storage.getItem(ASK_CONVERSATION_STORAGE_KEY), null, bad);
    assert.deepEqual(store.getSnapshot(), { inProgress: false, resumeIntent: null });
  }
  // A readable store with broken parts keeps only what is sound.
  const parsed = parseStoredConversations(JSON.stringify({
    v: 1,
    slots: [
      { key: CHAT_KEY, intent: CHAT, thread: [{ id: "x", kind: "me", text: "hi" }, null, { kind: "me" }, { id: "y", kind: "weird", text: "?" }], card: "not a card", cardSlot: 99, composerText: 5 },
      { key: 42 },
      "junk"
    ]
  }));
  assert.equal(parsed.length, 1);
  assert.deepEqual(parsed[0].thread, [{ id: "x", kind: "me", text: "hi" }]);
  assert.equal(parsed[0].card, null);
  assert.equal(parsed[0].cardSlot, 1);
  assert.equal(parsed[0].composerText, "");
});

test("a storage that refuses writes (private mode, full) leaves the store working in memory", () => {
  const storage = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("QuotaExceededError"); }, removeItem: () => { throw new Error("SecurityError"); } };
  const store = createAskConversationStore({ storage });
  store.begin(CHAT_KEY, () => emptyConversation(CHAT));
  store.update(CHAT_KEY, (conversation) => ({ ...conversation, composerText: "still here" }));
  assert.equal(store.read(CHAT_KEY).composerText, "still here");
});

test("the stored copy stays under its size cap, dropping the oldest messages first", () => {
  const storage = memoryStorage();
  const store = createAskConversationStore({ storage, maxStoredChars: 6000 });
  store.begin(CHAT_KEY, () => emptyConversation(CHAT));
  const thread = Array.from({ length: 40 }, (_, index) => ({ id: `ask-c-${index}`, kind: "me", text: `${index} ${"x".repeat(400)}` }));
  store.update(CHAT_KEY, (conversation) => ({ ...conversation, thread, card: draftCard(), cardSlot: 40 }));
  const stored = storage.getItem(ASK_CONVERSATION_STORAGE_KEY);
  assert.ok(stored.length <= 6000, String(stored.length));
  const [slot] = JSON.parse(stored).slots;
  assert.ok(slot.thread.length > 0 && slot.thread.length < 40);
  assert.equal(slot.thread.at(-1).id, "ask-c-39");
  assert.equal(slot.cardSlot, slot.thread.length);
  assert.deepEqual(slot.card, draftCard());
  // Very long text is cut before it is stored.
  store.update(CHAT_KEY, (conversation) => ({ ...conversation, thread: [{ id: "long", kind: "me", text: "y".repeat(5000) }], cardSlot: 1 }));
  assert.ok(JSON.parse(storage.getItem(ASK_CONVERSATION_STORAGE_KEY)).slots[0].thread[0].text.length <= 1000);
});

test("in progress: a message, a card being filled or typed words; a saved new-entry card is finished", () => {
  assert.equal(isConversationInProgress(emptyConversation(CHAT)), false);
  assert.equal(isConversationInProgress({ ...emptyConversation(CHAT), composerText: "  " }), false);
  assert.equal(isConversationInProgress({ ...emptyConversation(CHAT), composerText: "grab" }), true);
  assert.equal(isConversationInProgress({ ...emptyConversation(CHAT), thread: [{ id: "1", kind: "me", text: "hi" }] }), true);
  assert.equal(isConversationInProgress({ ...emptyConversation(ADD), card: { ...draftCard(), touched: false, origin: null } }), false);
  assert.equal(isConversationInProgress({ ...emptyConversation(ADD), card: draftCard() }), true);
  assert.equal(isConversationInProgress({ ...emptyConversation(ADD), thread: [{ id: "1", kind: "me", text: "x" }], card: { ...draftCard(), status: "saved" } }), false);
  assert.equal(isConversationInProgress({ ...emptyConversation({ ...CHAT, from: "shortcut", savedEntryId: "e1" }), thread: [{ id: "1", kind: "note", text: "Saved" }] }), false);
});

test("the snapshot says whether a conversation is in progress and which way in resumes it", () => {
  const store = createAskConversationStore({ storage: memoryStorage() });
  let notified = 0;
  store.subscribe(() => { notified += 1; });
  assert.deepEqual(store.getSnapshot(), { inProgress: false, resumeIntent: null });
  store.begin(CHAT_KEY, () => emptyConversation(CHAT));
  const idle = store.getSnapshot();
  store.update(CHAT_KEY, (conversation) => ({ ...conversation, thread: [{ id: "1", kind: "me", text: "income in aug" }] }));
  assert.deepEqual(store.getSnapshot(), { inProgress: true, resumeIntent: null });
  assert.notEqual(store.getSnapshot(), idle);
  // An unchanged state keeps the same snapshot object.
  const same = store.getSnapshot();
  store.update(CHAT_KEY, (conversation) => ({ ...conversation, scrollFromBottom: 10 }));
  assert.equal(store.getSnapshot(), same);
  store.begin(ADD_KEY, () => emptyConversation(ADD));
  store.update(ADD_KEY, (conversation) => ({ ...conversation, card: draftCard() }));
  assert.deepEqual(store.getSnapshot(), { inProgress: true, resumeIntent: { mode: "add", from: "entries", splitGroupId: "" } });
  assert.ok(notified >= 3);
});

test("a saved new-entry card is not restored: the next + starts a new card; chat keeps its saved cards", () => {
  const store = createAskConversationStore({ storage: memoryStorage() });
  store.begin(ADD_KEY, () => emptyConversation(ADD));
  store.update(ADD_KEY, (conversation) => ({ ...conversation, card: { ...draftCard(), status: "saved", saved: { entryId: "e1" } } }));
  assert.equal(store.begin(ADD_KEY, () => emptyConversation(ADD)).card, null);

  store.begin(CHAT_KEY, () => emptyConversation(CHAT));
  store.update(CHAT_KEY, (conversation) => ({ ...conversation, thread: [{ id: "1", kind: "me", text: "x" }], card: { ...draftCard(), status: "saved" }, cardSlot: 1 }));
  assert.equal(store.begin(CHAT_KEY, () => emptyConversation(CHAT)).card.status, "saved");
});

test("New chat clears that conversation from memory and sessionStorage", () => {
  const storage = memoryStorage();
  const store = createAskConversationStore({ storage });
  store.begin(CHAT_KEY, () => emptyConversation(CHAT));
  store.update(CHAT_KEY, (conversation) => ({ ...conversation, thread: [{ id: "1", kind: "me", text: "x" }] }));
  store.clear(CHAT_KEY);
  assert.equal(store.read(CHAT_KEY), null);
  assert.equal(createAskConversationStore({ storage }).read(CHAT_KEY), null);
  assert.deepEqual(store.getSnapshot(), { inProgress: false, resumeIntent: null });
  // An update after the clear (a late reader result) does not bring it back.
  store.update(CHAT_KEY, (conversation) => ({ ...conversation, composerText: "late" }));
  assert.equal(store.read(CHAT_KEY), null);
});

test("at most three ways in are kept, and one in progress outlives finished ones", () => {
  const store = createAskConversationStore({ storage: memoryStorage() });
  store.begin(CHAT_KEY, () => emptyConversation(CHAT));
  store.update(CHAT_KEY, (conversation) => ({ ...conversation, thread: [{ id: "1", kind: "me", text: "keep me" }] }));
  for (const key of ["add|ask||", "expense|ask||", "expense|splits||g1", "add|entries||"]) {
    const [mode, from, , splitGroupId] = key.split("|");
    store.begin(key, () => emptyConversation({ mode, from, savedEntryId: "", splitGroupId }));
  }
  assert.ok(store.read(CHAT_KEY));
  assert.equal(store.read("add|entries||").intent.mode, "add");
  assert.equal(store.read("add|ask||"), null);
});

test("every change that moves the snapshot is published once, for the shell's Ask tab", () => {
  const published = [];
  const store = createAskConversationStore({ storage: memoryStorage(), onSnapshot: (snapshot) => published.push(snapshot) });
  store.begin(CHAT_KEY, () => emptyConversation(CHAT));
  store.update(CHAT_KEY, (conversation) => ({ ...conversation, composerText: "g" }));
  store.update(CHAT_KEY, (conversation) => ({ ...conversation, composerText: "gr" }));
  store.update(CHAT_KEY, (conversation) => ({ ...conversation, composerText: "" }));
  assert.deepEqual(published, [{ inProgress: true, resumeIntent: null }, { inProgress: false, resumeIntent: null }]);
});

test("a reloaded tab knows at once that a conversation is in progress", () => {
  const storage = memoryStorage();
  const store = createAskConversationStore({ storage });
  store.begin(ADD_KEY, () => emptyConversation(ADD));
  store.update(ADD_KEY, (conversation) => ({ ...conversation, card: draftCard() }));
  assert.deepEqual(createAskConversationStore({ storage }).getSnapshot(), { inProgress: true, resumeIntent: { mode: "add", from: "entries", splitGroupId: "" } });
});
