// Where Ask's back link goes on a phone (docs/flows/ask-flow.md "Back to
// where you were"). The Entries + and the Splits receipt button open Ask as
// a new history entry; first they keep the page's place on its own history
// entry (`state.askReturn`) and hand it to Ask (`state.askOrigin`): the URL
// (month, view, scope, filters, the split group), the window's scroll and
// an open sheet with its draft (the page adds that through
// ASK_ORIGIN_EVENT, use-ask-origin.js). Going back, by the header's link,
// the chip row's "‹ Entries" or the phone's back gesture, lands on that
// entry, and the page puts its place back once.
//
// Pure apart from the storage it is given. The shell's + handler (App.jsx)
// builds the origin inline so this module stays out of the first screen;
// it ships with the Ask, Entries and Splits routes.
//
// Kept for this browser tab's session (sessionStorage `monies.askOrigin.v1`,
// one origin per way in, versioned): when Ask's history entry has lost the
// origin (the Ask tab reopened a card, Ask changed its own URL), back opens
// the kept page with its place instead. Never localStorage, never the
// server.

export const ASK_ORIGIN_EVENT = "monies:ask-origin";
export const ASK_ORIGIN_STORAGE_KEY = "monies.askOrigin.v1";
const VERSION = 1;
const PAGE_PATHS = { entries: "/entries", splits: "/splits" };
const SHEET_KINDS = new Set(["edit", "add"]);

/**
 * @typedef {{ kind: "edit", entry: { id: string } & Record<string, unknown> } | { kind: "add", draft: Record<string, unknown> }} AskOriginSheet
 * @typedef {{ id: string, from: "entries" | "splits", path: string, scrollY: number, sheet: AskOriginSheet | null }} AskOrigin
 */

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** @returns {AskOriginSheet | null} */
function readSheet(value) {
  if (!isObject(value) || !SHEET_KINDS.has(value.kind)) {
    return null;
  }
  if (value.kind === "edit") {
    return isObject(value.entry) && typeof value.entry.id === "string" && value.entry.id
      ? { kind: "edit", entry: value.entry }
      : null;
  }
  return isObject(value.draft) ? { kind: "add", draft: value.draft } : null;
}

// An origin as kept on a history entry or in storage, checked: the page
// must be the way in's own (/entries for the +, /splits for the receipt
// button), so a kept path can never lead outside the app.
/** @returns {AskOrigin | null} */
export function readAskOrigin(value) {
  if (!isObject(value) || typeof value.id !== "string" || !value.id) {
    return null;
  }
  const base = PAGE_PATHS[value.from];
  const path = typeof value.path === "string" ? value.path : "";
  if (!base || !(path === base || path.startsWith(`${base}?`))) {
    return null;
  }
  const scrollY = Number(value.scrollY);
  return {
    id: value.id,
    from: value.from,
    path,
    scrollY: Number.isFinite(scrollY) && scrollY > 0 ? Math.round(scrollY) : 0,
    sheet: readSheet(value.sheet)
  };
}

function readStored(storage) {
  try {
    const value = JSON.parse(storage?.getItem(ASK_ORIGIN_STORAGE_KEY) ?? "null");
    return isObject(value) && value.v === VERSION ? value : null;
  } catch {
    return null;
  }
}

function writeStored(storage, slots) {
  try {
    if (Object.keys(slots).length) {
      storage?.setItem(ASK_ORIGIN_STORAGE_KEY, JSON.stringify({ v: VERSION, ...slots }));
    } else {
      storage?.removeItem(ASK_ORIGIN_STORAGE_KEY);
    }
  } catch {
    // Private mode or a full storage: the history entry still has it.
  }
}

function storedSlots(storage) {
  const stored = readStored(storage);
  const slots = {};
  for (const from of Object.keys(PAGE_PATHS)) {
    const origin = readAskOrigin(stored?.[from]);
    if (origin) slots[from] = origin;
  }
  return slots;
}

/** @param {Pick<Storage, "getItem" | "setItem" | "removeItem"> | null} storage */
export function rememberAskOrigin(storage, value) {
  const origin = readAskOrigin(value);
  if (origin) {
    writeStored(storage, { ...storedSlots(storage), [origin.from]: origin });
  }
}

/** @returns {AskOrigin | null} */
export function recallAskOrigin(storage, from) {
  return storedSlots(storage)[from] ?? null;
}

// The page put this place back: a later back from a reopened card goes to
// the page as it is then, not to this place again.
export function forgetAskOrigin(storage, origin) {
  const slots = storedSlots(storage);
  if (origin?.from && slots[origin.from]?.id === origin.id) {
    delete slots[origin.from];
    writeStored(storage, slots);
  }
}

function splitPath(path) {
  const index = path.indexOf("?");
  return index === -1 ? { pathname: path, search: "" } : { pathname: path.slice(0, index), search: path.slice(index) };
}

// How Ask goes back for its way in (`from`):
// - Ask's own history entry has the origin: history.back, the same as the
//   phone's back gesture;
// - else the kept origin: open its page with the place to put back;
// - else `fallback`, the plain page for the same view and month.
/** @returns {{ kind: "history" } | { kind: "navigate", to: { pathname: string, search: string }, state: { askReturn: AskOrigin } | undefined }} */
export function planAskBack({ from, state, storage, fallback }) {
  const current = readAskOrigin(isObject(state) ? state.askOrigin : null);
  if (current && current.from === from) {
    return { kind: "history" };
  }
  const kept = recallAskOrigin(storage, from);
  if (kept) {
    return { kind: "navigate", to: splitPath(kept.path), state: { askReturn: kept } };
  }
  return { kind: "navigate", to: fallback, state: undefined };
}
