// The choices a person makes on a reminder, written to this device
// (reminders-device-state.js): Later until a day, hide this one for good,
// undo either, and what Ask has shown. Pure over the state they are given
// except for the final write; each returns nothing and the store notifies.
// Entries not touched for 90 days are dropped on every write, so the entry
// stays small and an old choice cannot hide a reminder forever.

import { reminderDeviceState } from "./reminders-device-state";

export const REMINDER_STATE_MAX_AGE_DAYS = 90;

/** A day as YYYY-MM-DD, `days` after another. */
export function shiftIsoDate(isoDate, days) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** @param {Record<string, import("./reminders-device-state").ReminderItem>} items */
export function pruneReminderItems(items, today) {
  const oldest = shiftIsoDate(today, -REMINDER_STATE_MAX_AGE_DAYS);
  return Object.fromEntries(Object.entries(items).filter(([, item]) => typeof item?.at === "string" && item.at >= oldest));
}

function update(key, today, change) {
  const state = reminderDeviceState.getSnapshot();
  const items = pruneReminderItems(state.items, today);
  const current = items[key] ?? { at: today };
  reminderDeviceState.write({ v: 1, items: { ...items, [key]: { ...change(current), at: today } } });
}

/** Later: hidden until `until`, then new to the dot again. */
export function laterUntil(key, until, today) {
  update(key, today, ({ skip: _skip, ...item }) => ({ ...item, until, seen: false }));
}

/** "Not for this …", "Paid from another account", "Got it": hidden for good. */
export function hideReminder(key, today) {
  update(key, today, (item) => ({ ...item, skip: true }));
}

/** Undo the last choice: shown again as if never hidden. */
export function showReminderAgain(key, today) {
  update(key, today, ({ until: _until, skip: _skip, ...item }) => ({ ...item, seen: false }));
}

/** Ask showed these reminders: the dot stays quiet about them. */
export function markRemindersSeen(keys, today) {
  const state = reminderDeviceState.getSnapshot();
  if (keys.every((key) => state.items[key]?.seen)) return;
  const items = pruneReminderItems(state.items, today);
  const next = { ...items };
  for (const key of keys) next[key] = { ...(items[key] ?? {}), seen: true, at: today };
  reminderDeviceState.write({ v: 1, items: next });
}

/** A month's checklist was shown with something still to do. */
export function markChecklistOpen(key, today) {
  if (reminderDeviceState.getSnapshot().items[key]?.open) return;
  update(key, today, (item) => ({ ...item, open: true }));
}

/** Its one "all in" line was shown; nothing more about that month. */
export function markChecklistDoneShown(key, today) {
  if (reminderDeviceState.getSnapshot().items[key]?.doneShown) return;
  update(key, today, (item) => ({ ...item, doneShown: true }));
}
