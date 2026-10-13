// Owner of the Ask conversation (design.md "Ask conversation store"): the
// thread, the entry card, where the card sits in the thread, the composer
// text and an open follow-up question, kept above the routes so leaving
// the Ask tab and coming back restores them. The Ask page reads and writes
// its conversation only through this store; a reader result or a save that
// lands after the page has gone still lands here.
//
// It ships with the Ask route; the shell's Ask tab reads only whether a
// conversation is in progress, which this store publishes to the tiny
// ask-conversation-presence.js on every change. The Ask page binds it
// (ask-panel.jsx useAskConversation); a module singleton, so it outlives
// the page.
//
// Mirror: sessionStorage only (this browser tab, gone when the tab closes),
// never localStorage and never the server. Versioned key, size-capped, and
// anything it cannot read is dropped. Only text, the card's fields,
// filters, money answers and plan drafts (the figures and words the server
// sent) are kept: photos (and any blob: or data: value), audio and status
// lines never are.
//
// One conversation per way in (chat, the Entries +, the Splits receipt
// button, a Shortcut link), at most three, the oldest finished one going
// first.

export const ASK_CONVERSATION_STORAGE_KEY = "monies.askConversation.v1";
const VERSION = 1;
const MAX_SLOTS = 3;
const MAX_THREAD_ITEMS = 60;
const MAX_TEXT = 1000;
const DEFAULT_MAX_STORED_CHARS = 60_000;
const STORED_KINDS = new Set(["me", "note", "answer", "money-answer", "money-check", "plan-draft", "insight-answer", "split-proposal", "settlement-draft"]);
// A plan draft caught mid-save or mid-undo comes back as it was before: a
// save that did land is then refused as stale, never written twice.
const SETTLED_PLAN_STATUS = { saving: "draft", undoing: "saved" };
// An add to Splits caught mid-save is a draft again (a second Save is
// refused: the entry is already on Splits). A settle-up payment caught
// mid-save may have landed and a second one would count twice, so it asks
// the person to check Splits instead.
const SETTLED_TURN_STATUS = {
  "split-proposal": { saving: "draft", undoing: "saved" },
  "settlement-draft": { saving: "unsure" }
};
const DROPPED_KEYS = new Set(["url", "image", "photo", "blob", "file", "audio", "clip", "dataUrl", "receiptImage", "thumbUrl"]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// A conversation still worth coming back to: something was said, a card is
// being filled, or words are typed. A saved card ends a new-entry visit; a
// Shortcut confirmation is never "in progress".
export function isConversationInProgress(conversation) {
  if (!conversation || conversation.intent?.savedEntryId) {
    return false;
  }
  const card = conversation.card;
  if (conversation.intent?.mode && conversation.intent.mode !== "chat" && card?.status === "saved") {
    return false;
  }
  return Boolean(
    conversation.composerText?.trim()
    || conversation.thread?.some((item) => item.kind === "me")
    || (card && card.status !== "saved" && (card.touched || card.origin))
  );
}

function isFinishedNewEntry(conversation) {
  return conversation.intent?.mode !== "chat" && !conversation.intent?.savedEntryId && conversation.card?.status === "saved";
}

// Keeps the thread items `keep` accepts; the card's slot (a count of the
// non-status items before it) moves back by the items dropped before it.
function filterThread(conversation, keep) {
  const thread = conversation.thread ?? [];
  let seen = 0;
  let cardSlot = 0;
  const next = [];
  for (const item of thread) {
    const settled = item.kind !== "status";
    const kept = keep(item);
    if (settled && kept && seen < (conversation.cardSlot ?? 0)) cardSlot += 1;
    if (settled) seen += 1;
    if (kept) next.push(item);
  }
  return { ...conversation, thread: next, cardSlot };
}

function clampText(value) {
  return typeof value === "string" ? value.slice(0, MAX_TEXT) : "";
}

// A deep copy with no photos or audio: known keys, and any blob: or data:
// string, are left out.
function withoutMedia(value) {
  return JSON.parse(JSON.stringify(value ?? null, (key, inner) => {
    if (DROPPED_KEYS.has(key)) return undefined;
    if (typeof inner === "string" && /^(blob|data):/i.test(inner)) return undefined;
    return inner;
  }));
}

function toStored(conversation) {
  const kept = filterThread(conversation, (item) => STORED_KINDS.has(item.kind));
  const thread = kept.thread
    .map((item) => (item.kind === "plan-draft" && SETTLED_PLAN_STATUS[item.status] ? { ...item, status: SETTLED_PLAN_STATUS[item.status] } : item))
    .map((item) => (SETTLED_TURN_STATUS[item.kind]?.[item.status] ? { ...item, status: SETTLED_TURN_STATUS[item.kind][item.status] } : item))
    .map((item) => (item.text === undefined ? item : { ...item, text: clampText(item.text) }));
  const overflow = Math.max(0, thread.length - MAX_THREAD_ITEMS);
  const card = isObject(conversation.card)
    ? { ...conversation.card, status: conversation.card.status === "saving" ? "draft" : conversation.card.status }
    : null;
  return withoutMedia({
    key: conversation.key,
    intent: conversation.intent,
    thread: thread.slice(overflow),
    card,
    cardSlot: Math.max(0, kept.cardSlot - overflow),
    composerText: clampText(conversation.composerText),
    pending: conversation.pending ?? null,
    ...(conversation.rulesNoted ? { rulesNoted: true } : {}),
    scrollFromBottom: Number.isFinite(conversation.scrollFromBottom) ? conversation.scrollFromBottom : 0
  });
}

function serialize(slots, maxChars) {
  const stored = slots.map(toStored);
  let text = JSON.stringify({ v: VERSION, slots: stored });
  // Over the cap: drop the oldest message of the largest conversation, then
  // whole conversations, oldest first.
  while (text.length > maxChars && stored.length) {
    const largest = stored.reduce((best, slot) => (slot.thread.length > best.thread.length ? slot : best), stored[0]);
    if (largest.thread.length) {
      const [dropped] = largest.thread.splice(0, 1);
      if (dropped && largest.cardSlot > 0) largest.cardSlot -= 1;
    } else {
      stored.shift();
    }
    text = JSON.stringify({ v: VERSION, slots: stored });
  }
  return text;
}

function readThreadItem(item) {
  if (!isObject(item) || typeof item.id !== "string" || !STORED_KINDS.has(item.kind)) return null;
  if (item.kind === "answer") return isObject(item.filter) ? item : null;
  // A money answer keeps the card the server sent (its figures and words);
  // the check before one keeps its candidate and the question to ask again.
  if (item.kind === "money-answer") return isObject(item.answer) && isObject(item.answer.lead) && isObject(item.wording) ? item : null;
  if (item.kind === "money-check") return isObject(item.candidate) && isObject(item.request) && typeof item.text === "string" ? item : null;
  // An insight answer keeps the card built from the insight's own facts and
  // any checked AI explanation.
  if (item.kind === "insight-answer") return isObject(item.answer) && typeof item.answer.fact === "string" && Array.isArray(item.answer.lines) && Array.isArray(item.answer.links) ? item : null;
  // A plan draft keeps the server's draft (its lines, totals and Save list)
  // and, once saved, the changes that undo it.
  if (item.kind === "plan-draft") {
    return isObject(item.draft) && Array.isArray(item.draft.apply) && isObject(item.draft.totals) && ["draft", "saved", "discarded"].includes(item.status) ? item : null;
  }
  // Turn drafts keep the server's checked proposal or payment.
  if (item.kind === "split-proposal") {
    return isObject(item.proposal) && Array.isArray(item.proposal.shares) && ["draft", "saved", "discarded"].includes(item.status) ? item : null;
  }
  if (item.kind === "settlement-draft") {
    return isObject(item.settlement) && ["draft", "saved", "discarded", "unsure"].includes(item.status) ? item : null;
  }
  return typeof item.text === "string" ? { ...item, text: clampText(item.text) } : null;
}

/** The stored conversations, or [] when the text cannot be read. */
export function parseStoredConversations(text) {
  try {
    const data = JSON.parse(text);
    if (!isObject(data) || data.v !== VERSION || !Array.isArray(data.slots)) return [];
    return data.slots
      .filter((slot) => isObject(slot) && typeof slot.key === "string" && isObject(slot.intent))
      .slice(-MAX_SLOTS)
      .map((slot) => {
        const thread = (Array.isArray(slot.thread) ? slot.thread : []).map(readThreadItem).filter(Boolean);
        const card = isObject(slot.card) && isObject(slot.card.fields) ? slot.card : null;
        return {
          key: slot.key,
          intent: slot.intent,
          thread,
          card,
          cardSlot: Math.min(thread.length, Math.max(0, Number(slot.cardSlot) || 0)),
          composerText: typeof slot.composerText === "string" ? slot.composerText : "",
          pending: isObject(slot.pending) ? slot.pending : null,
          ...(slot.rulesNoted === true ? { rulesNoted: true } : {}),
          scrollFromBottom: Number.isFinite(slot.scrollFromBottom) ? slot.scrollFromBottom : 0
        };
      });
  } catch {
    return [];
  }
}

import { askConversationPresence, NO_ASK_CONVERSATION } from "./ask-conversation-presence";

/** @typedef {import("./ask-conversation-presence").AskConversationPresence} AskConversationSnapshot */
const EMPTY_SNAPSHOT = NO_ASK_CONVERSATION;

export function createAskConversationStore({ storage = null, maxStoredChars = DEFAULT_MAX_STORED_CHARS, onSnapshot = undefined } = {}) {
  /** @type {any[]} oldest first */
  let slots = [];
  /** @type {AskConversationSnapshot} */
  let snapshot = EMPTY_SNAPSHOT;
  const listeners = new Set();

  try {
    const text = storage?.getItem(ASK_CONVERSATION_STORAGE_KEY);
    if (text) {
      slots = parseStoredConversations(text);
      if (!slots.length) storage.removeItem(ASK_CONVERSATION_STORAGE_KEY);
    }
  } catch {
    slots = [];
  }
  computeSnapshot();
  let published = snapshot;

  function persist() {
    try {
      if (slots.length) {
        storage?.setItem(ASK_CONVERSATION_STORAGE_KEY, serialize(slots, maxStoredChars));
      } else {
        storage?.removeItem(ASK_CONVERSATION_STORAGE_KEY);
      }
    } catch {
      // Private mode or a full store: the conversation still lives in memory.
    }
  }

  function computeSnapshot() {
    const active = slots.filter(isConversationInProgress);
    const latest = active.at(-1);
    const resumeIntent = latest && latest.intent.mode !== "chat"
      ? { mode: latest.intent.mode, from: latest.intent.from ?? "", splitGroupId: latest.intent.splitGroupId ?? "" }
      : null;
    const next = { inProgress: active.length > 0, resumeIntent };
    if (next.inProgress !== snapshot.inProgress || JSON.stringify(next.resumeIntent) !== JSON.stringify(snapshot.resumeIntent)) {
      snapshot = next.inProgress || next.resumeIntent ? next : EMPTY_SNAPSHOT;
    }
  }

  function notify() {
    if (onSnapshot && published !== snapshot) {
      published = snapshot;
      onSnapshot(snapshot);
    }
    for (const listener of [...listeners]) listener();
  }

  function commit({ deferNotify = false } = {}) {
    computeSnapshot();
    persist();
    if (deferNotify) {
      // begin() runs while the Ask page renders; the shell hears of it after.
      queueMicrotask(notify);
    } else {
      notify();
    }
  }

  function put(conversation) {
    slots = [...slots.filter((slot) => slot.key !== conversation.key), conversation];
    while (slots.length > MAX_SLOTS) {
      const finished = slots.findIndex((slot) => slot.key !== conversation.key && !isConversationInProgress(slot));
      slots.splice(finished >= 0 ? finished : 0, 1);
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,

    read(key) {
      return slots.find((slot) => slot.key === key) ?? null;
    },

    // The conversation for a way in: the one kept for it, or a new one from
    // `create` (also when the kept one is a finished new-entry card).
    begin(key, create) {
      const existing = slots.find((slot) => slot.key === key);
      if (existing && !isFinishedNewEntry(existing)) {
        return existing;
      }
      const conversation = { ...create(), key };
      put(conversation);
      commit({ deferNotify: true });
      return conversation;
    },

    // Changes a kept conversation; one that was cleared stays cleared.
    update(key, updater) {
      const current = slots.find((slot) => slot.key === key);
      if (!current) return null;
      const next = updater(current);
      if (!next || next === current) return current;
      const conversation = { ...next, key };
      put(conversation);
      commit();
      return conversation;
    },

    // The page is going: photos and status lines go with it, and where the
    // person had scrolled to is kept.
    leave(key, { scrollFromBottom = 0 } = {}) {
      return this.update(key, (current) => ({
        ...filterThread(current, (item) => item.kind !== "photo" && item.kind !== "status"),
        scrollFromBottom: Math.max(0, Math.round(scrollFromBottom))
      }));
    },

    clear(key) {
      if (!slots.some((slot) => slot.key === key)) return;
      slots = slots.filter((slot) => slot.key !== key);
      commit();
    }
  };
}

let defaultStore = null;

function readSessionStorage() {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** The tab's one Ask conversation store, made on first use. */
export function getAskConversationStore() {
  if (!defaultStore) {
    defaultStore = createAskConversationStore({ storage: readSessionStorage(), onSnapshot: askConversationPresence.publish });
    // What was read back from the tab corrects the shell's dot (after this
    // render: the store is first asked for while Ask renders).
    queueMicrotask(() => askConversationPresence.publish(defaultStore.getSnapshot()));
  }
  return defaultStore;
}
