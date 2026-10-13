// The desktop Ask dock (design.md "Desktop Ask"): whether the Ask
// conversation is open beside the page, docked or as a popup, and which way
// in it shows. The conversation itself stays in the Ask conversation store
// (ask-conversation-store.js), shared with the phone's Ask page; this is
// only the dock around it, so it loads with the dock panel, not in the first screen.
//
// Kept for this browser tab's session (sessionStorage `monies.askDock.v1`):
// open or closed, the mode and the way in, so the panel stays open across
// route changes and a reload. The words typed into the field before Ask
// has loaded and a photo dropped on it are handed to the conversation once,
// in memory, and never stored.

import { ASK_DOCK_STORAGE_KEY } from "./ask-dock-entry";

export { ASK_DOCK_STORAGE_KEY };
const VERSION = 1;

/** @typedef {{ mode: string, from: string, savedEntryId: string, splitGroupId: string }} AskIntent */
export const CHAT_INTENT = { mode: "chat", from: "", savedEntryId: "", splitGroupId: "" };

// The dock's ways in: the chat, or a new entry (from the chat's chips, or the
// one in progress the field reopens). A Shortcut link opens /ask itself.
/** @returns {AskIntent} */
function readIntent(value) {
  return ["chat", "add", "expense"].includes(value?.mode)
    ? {
        mode: value.mode,
        from: ["entries", "splits", "ask"].includes(value.from) ? value.from : "",
        savedEntryId: "",
        splitGroupId: typeof value.splitGroupId === "string" ? value.splitGroupId : ""
      }
    : CHAT_INTENT;
}

function readMode(value) {
  return value === "popup" ? "popup" : "docked";
}

function readStored(storage) {
  try {
    const value = JSON.parse(storage?.getItem(ASK_DOCK_STORAGE_KEY) ?? "null");
    if (!value || value.version !== VERSION || typeof value.open !== "boolean") {
      return null;
    }
    return { open: value.open, mode: readMode(value.mode), intent: readIntent(value.intent) };
  } catch {
    return null;
  }
}

/** @param {{ storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null }} [options] */
export function createAskDockStore({ storage = null } = {}) {
  const stored = readStored(storage);
  let snapshot = {
    open: stored?.open ?? false,
    mode: stored?.mode ?? "docked",
    intent: stored?.intent ?? CHAT_INTENT,
    // Memory only: the field's words until the conversation takes them,
    // and whether the conversation has mounted (the field hides then).
    draftText: "",
    ready: false,
    // A person opened it in this page's life (its code then loads at once),
    // as opposed to a panel restored open after a reload.
    openedByHand: false,
    // Counts the opens that name a way in (the + and receipt buttons), so
    // each one is a new visit: a saved new entry then gives way to a new card.
    visit: 0
  };
  let handoffFile = null;
  // An insight question from "Ask about this" (memory only, taken once).
  let handoffInsight = null;
  let focusPending = false;
  let returnFocusPending = false;
  const listeners = new Set();

  const persist = () => {
    try {
      storage?.setItem(ASK_DOCK_STORAGE_KEY, JSON.stringify({ version: VERSION, open: snapshot.open, mode: snapshot.mode, intent: snapshot.intent }));
    } catch {
      // Private mode: the dock still works for this page's life.
    }
  };
  const set = (patch, { save = false } = {}) => {
    snapshot = { ...snapshot, ...patch };
    if (save) persist();
    for (const listener of [...listeners]) listener();
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return snapshot;
    },
    /** A person opened Ask (the field, "/", a dropped photo, "Ask about this"). */
    open({ mode = "docked", intent = undefined, focus = true, file = null, insight = null } = {}) {
      focusPending = focus || focusPending;
      returnFocusPending = false;
      if (file) handoffFile = file;
      if (insight) handoffInsight = insight;
      set({
        open: true,
        openedByHand: true,
        mode: readMode(mode),
        intent: intent === undefined ? snapshot.intent : readIntent(intent),
        visit: intent === undefined ? snapshot.visit : snapshot.visit + 1
      }, { save: true });
    },
    expand() {
      set({ mode: "docked" }, { save: true });
    },
    setIntent(intent) {
      set({ intent: readIntent(intent), visit: snapshot.visit + 1 }, { save: true });
    },
    close({ returnFocus = false } = {}) {
      focusPending = false;
      returnFocusPending = returnFocus;
      handoffFile = null;
      handoffInsight = null;
      set({ open: false, ready: false }, { save: true });
    },
    setDraftText(text) {
      set({ draftText: String(text ?? "") });
    },
    setReady(ready) {
      if (snapshot.ready !== Boolean(ready)) set({ ready: Boolean(ready) });
    },
    /** The field's words, a dropped photo and an insight question, once. */
    takeHandoff() {
      const handoff = { text: snapshot.draftText, file: handoffFile, insight: handoffInsight };
      handoffFile = null;
      handoffInsight = null;
      if (snapshot.draftText) set({ draftText: "" });
      return handoff;
    },
    requestFocus() {
      focusPending = true;
      set({});
    },
    takeFocusRequest() {
      const pending = focusPending;
      focusPending = false;
      return pending;
    },
    takeReturnFocus() {
      const pending = returnFocusPending;
      returnFocusPending = false;
      return pending;
    }
  };
}

function sessionStore() {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

let shared = /** @type {ReturnType<typeof createAskDockStore> | null} */ (null);

// One dock per browser tab, outliving every route.
export function getAskDockStore() {
  shared ??= createAskDockStore({ storage: sessionStore() });
  return shared;
}
