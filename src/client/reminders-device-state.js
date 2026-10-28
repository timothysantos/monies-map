// What this device remembers about reminders (docs/flows/reminders-flow.md):
// which ones it hid until a day or for good, which ones it has already shown
// in Ask, and which month checklists it showed open. localStorage only, one
// versioned entry, never the server and never another person's device. Every
// read and write is in try/catch: with storage blocked (a private window) it
// keeps the answer for this page's life and every reminder shows.
//
// This is the only reminder code on the first screen (the Ask tab's dot reads
// it), so it stays tiny: the actions that change it ship with the Ask route
// (reminders-actions.js).

export const REMINDERS_STORAGE_KEY = "monies.reminders.v1";

/** @typedef {{ until?: string, skip?: boolean, seen?: boolean, open?: boolean, doneShown?: boolean, at: string }} ReminderItem */
/** @typedef {{ v: 1, items: Record<string, ReminderItem> }} ReminderState */
/** @type {ReminderState} */
export const EMPTY_REMINDER_STATE = Object.freeze({ v: 1, items: Object.freeze({}) });

function storage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readStored() {
  try {
    const value = JSON.parse(storage()?.getItem(REMINDERS_STORAGE_KEY) ?? "null");
    return value?.v === 1 && value.items && typeof value.items === "object" ? value : EMPTY_REMINDER_STATE;
  } catch {
    return EMPTY_REMINDER_STATE;
  }
}

let snapshot = /** @type {ReminderState | null} */ (null);
const listeners = new Set();
const notify = () => listeners.forEach((listener) => listener());
// Another tab of this browser changed it.
const onStorage = (event) => {
  if (event.key === REMINDERS_STORAGE_KEY) {
    snapshot = null;
    notify();
  }
};

export const reminderDeviceState = {
  subscribe(listener) {
    if (!listeners.size && typeof window !== "undefined") window.addEventListener("storage", onStorage);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (!listeners.size && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
    };
  },
  getSnapshot() {
    snapshot ??= readStored();
    return snapshot;
  },
  /** @param {ReminderState} next */
  write(next) {
    snapshot = next;
    try {
      storage()?.setItem(REMINDERS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Blocked or full: the choice still holds for this page's life.
    }
    notify();
  },
  /** Forget what was read (tests, and a storage that changed under us). */
  reset() {
    snapshot = null;
    notify();
  }
};

/** Hidden: hidden for good, or until a day that has not come yet. */
export function isReminderHidden(item, today) {
  return Boolean(item && (item.skip || (item.until && item.until > today)));
}

/**
 * The reminders this device has not shown yet and may show now (the Ask
 * tab's dot). A checklist that is all done counts only when this device
 * showed it open and has not yet shown its one "all in" line.
 * @param {Array<{ key: string, kind: string, allDone?: boolean }>} reminders
 * @param {ReminderState} state
 * @param {string} today
 */
export function unseenReminders(reminders, state, today) {
  return reminders.filter((reminder) => {
    const item = state.items[reminder.key];
    if (isReminderHidden(item, today)) return false;
    if (reminder.kind === "month_close" && reminder.allDone) return Boolean(item?.open && !item.doneShown);
    return !item?.seen;
  });
}
