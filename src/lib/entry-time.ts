// The time of day an entry was made, kept beside its calendar date.
//
// A transaction's date is a plain YYYY-MM-DD day (app-calendar.ts). Its time is
// the household's LOCAL clock time as "HH:MM" (24 hours, Asia/Singapore),
// stored as written so showing it needs no conversion. It exists only for
// entries a person or the Apple Pay Shortcut made on the day itself: a bank
// file carries no time and an entry typed for an earlier day has no honest one,
// so the time stays empty (null) there. It is a label for telling one day's
// purchases apart and never an input to matching, month totals or dedupe.
import { APP_TIME_ZONE, isoDateInAppTimeZone } from "./app-calendar";

const ENTRY_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const ENTRY_TIME_INVALID = "Time must be hours and minutes like 14:32.";

// "14:32" for a valid time, null for none (empty, undefined or null). Throws
// on anything else so a bad value is refused instead of stored.
export function parseEntryTime(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(ENTRY_TIME_INVALID);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (!ENTRY_TIME_PATTERN.test(trimmed)) {
    throw new Error(ENTRY_TIME_INVALID);
  }
  return trimmed;
}

// The reading side never throws: a stored value that is not "HH:MM" is no time.
export function readEntryTime(value: unknown): string | undefined {
  try {
    return parseEntryTime(value) ?? undefined;
  } catch {
    return undefined;
  }
}

const clockFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

// The household's clock time at an instant, as "HH:MM".
export function entryTimeInAppTimeZone(instant: Date): string | null {
  if (Number.isNaN(instant.getTime())) {
    return null;
  }
  const parts = Object.fromEntries(clockFormatter.formatToParts(instant).map((part) => [part.type, part.value]));
  return `${parts.hour}:${parts.minute}`;
}

// The time a new entry gets when its caller names none: now, but only when the
// entry is dated today in the household's calendar (a backdated entry was not
// made at this clock time).
export function defaultEntryTime(entryDate: string, now: Date = new Date()): string | null {
  return entryDate === isoDateInAppTimeZone(now) ? entryTimeInAppTimeZone(now) : null;
}

// "2:32 pm", the way the app's en-SG dates read.
export function formatEntryTime(time: string | null | undefined): string {
  const valid = readEntryTime(time);
  if (!valid) {
    return "";
  }
  const [hours, minutes] = valid.split(":").map(Number);
  const suffix = hours >= 12 ? "pm" : "am";
  return `${hours % 12 === 0 ? 12 : hours % 12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

// The order of one day's entries: those with a time first, the latest time on
// top (ties keep the incoming order), then those without a time in the order
// they came in. A stable, total order, so a list never reshuffles.
export function orderEntriesWithinDay<T extends { time?: string | null }>(entries: readonly T[]): T[] {
  const indexed = entries.map((entry, index) => ({ entry, index, time: readEntryTime(entry.time) ?? "" }));
  indexed.sort((left, right) => {
    if (left.time && right.time) {
      return right.time.localeCompare(left.time) || left.index - right.index;
    }
    if (left.time || right.time) {
      return left.time ? -1 : 1;
    }
    return left.index - right.index;
  });
  return indexed.map((item) => item.entry);
}
