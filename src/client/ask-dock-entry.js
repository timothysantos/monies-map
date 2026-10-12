// What the first screen keeps of the desktop Ask dock (design.md "Desktop
// Ask"): whether this tab's panel was left open, the "/" shortcut test, and
// the hand-off from the field to the dock's code. The rest of the dock (its
// store, layout rules and the panel that holds the conversation) loads with
// the Ask page's code on the first use, so none of it sits in the first
// screen's budget.

export const ASK_DOCK_STORAGE_KEY = "monies.askDock.v1";

/** The panel left open in this tab (sessionStorage), so it is restored: its mode, or null. */
export function storedAskDockMode() {
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(ASK_DOCK_STORAGE_KEY) ?? "null");
    return stored?.open === true ? (stored.mode === "popup" ? "popup" : "docked") : null;
  } catch {
    return null;
  }
}

/** Closed before the dock's code arrived: nothing is left to restore. */
export function forgetAskDockOpen() {
  try {
    window.sessionStorage.removeItem(ASK_DOCK_STORAGE_KEY);
  } catch {
    // Private mode: nothing was stored.
  }
}

// What the person did before the dock's code arrived, kept until the dock
// mounts and takes it: { open, file, options }. `open` is any way in (focus,
// click, typing, a photo); `options` an openAskDock() call from the + or
// receipt button. The words typed are read from the launcher's field itself.
let pending = /** @type {{ open?: boolean, file?: File | null, options?: object } | null} */ (null);
// Set by the dock once it is mounted: later openAskDock() calls go straight to it.
export const askDockHandle = { open: /** @type {((options: object) => void) | null} */ (null) };
let wake = /** @type {(() => void) | null} */ (null);

/** @param {{ open?: boolean, file?: File | null, options?: object }} patch */
export function requestAskDock(patch) {
  pending = { ...pending, ...patch };
  wake?.();
}

export function takeAskDockRequest() {
  const request = pending;
  pending = null;
  return request;
}

/** The shell listens for the first request; one already waiting wakes it at once. */
export function onAskDockRequest(listener) {
  wake = listener;
  if (pending) listener();
  return () => {
    if (wake === listener) wake = null;
  };
}

const TYPING_INPUT_TYPES = new Set(["", "text", "search", "email", "number", "password", "tel", "url", "date", "month", "time", "datetime-local", "week"]);

// "/" moves focus to the Ask field, unless the person is typing somewhere,
// used a modifier, or something else already handled the key. Inside an
// open dialog the page behind is not the place to ask.
export function isAskShortcutKey(event) {
  if (!event || event.key !== "/" || event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) {
    return false;
  }
  const target = event.target;
  if (!target) {
    return true;
  }
  if (target.isContentEditable) {
    return false;
  }
  const tag = String(target.tagName ?? "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") {
    return false;
  }
  if (tag === "INPUT" && TYPING_INPUT_TYPES.has(String(target.type ?? "").toLowerCase())) {
    return false;
  }
  return !target.closest?.('[role="dialog"], [aria-modal="true"]');
}
