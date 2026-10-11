// Whether an Ask conversation is in progress, for the shell's Ask tab (its
// dot, and which way in the tab reopens). The conversation itself is owned
// by ask-conversation-store.js, which ships with the Ask route and
// publishes here on every change; this part is all the first screen loads.
// Kept in sessionStorage beside the conversation, so a reload shows the dot
// without loading Ask.

const PRESENCE_KEY = "monies.askConversation.v1.presence";

/** @typedef {{ inProgress: boolean, resumeIntent: null | { mode: string, from: string, splitGroupId: string } }} AskConversationPresence */
/** @type {AskConversationPresence} */
export const NO_ASK_CONVERSATION = Object.freeze({ inProgress: false, resumeIntent: null });

function storage() {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function readStored() {
  try {
    const value = JSON.parse(storage()?.getItem(PRESENCE_KEY) ?? "null");
    return value?.inProgress === true
      ? { inProgress: true, resumeIntent: value.resumeIntent && typeof value.resumeIntent.mode === "string" ? value.resumeIntent : null }
      : NO_ASK_CONVERSATION;
  } catch {
    return NO_ASK_CONVERSATION;
  }
}

let snapshot = /** @type {AskConversationPresence | null} */ (null);
const listeners = new Set();

export const askConversationPresence = {
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot() {
    snapshot ??= readStored();
    return snapshot;
  },
  /** @param {AskConversationPresence} next */
  publish(next) {
    snapshot = next;
    try {
      if (next.inProgress) storage()?.setItem(PRESENCE_KEY, JSON.stringify(next));
      else storage()?.removeItem(PRESENCE_KEY);
    } catch {
      // Private mode: the dot still shows for this page's life.
    }
    for (const listener of [...listeners]) listener();
  }
};
