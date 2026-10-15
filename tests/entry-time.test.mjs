// The time of day an entry was made (src/lib/entry-time.ts): validation,
// the household clock (Asia/Singapore, UTC+8, no daylight saving), the
// default for a new entry, the "2:32 pm" reading and one day's order.
import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultEntryTime,
  entryTimeInAppTimeZone,
  ENTRY_TIME_INVALID,
  formatEntryTime,
  orderEntriesWithinDay,
  parseEntryTime,
  readEntryTime
} from "../src/lib/entry-time.ts";
import { formatCardDateTime } from "../src/client/copy/ask-copy.js";

test("parseEntryTime accepts a 24-hour HH:MM and treats empty as no time", () => {
  assert.equal(parseEntryTime("14:32"), "14:32");
  assert.equal(parseEntryTime(" 00:00 "), "00:00");
  assert.equal(parseEntryTime("23:59"), "23:59");
  assert.equal(parseEntryTime(""), null);
  assert.equal(parseEntryTime("   "), null);
  assert.equal(parseEntryTime(null), null);
  assert.equal(parseEntryTime(undefined), null);
});

test("parseEntryTime refuses anything that is not a real HH:MM", () => {
  for (const bad of ["24:00", "12:60", "9:05", "14:32:10", "2:32 pm", "noon", "1432", "14-32", 1432, true, {}]) {
    assert.throws(() => parseEntryTime(bad), { message: ENTRY_TIME_INVALID }, String(bad));
  }
});

test("readEntryTime never throws: a stored value that is not HH:MM is no time", () => {
  assert.equal(readEntryTime("07:05"), "07:05");
  assert.equal(readEntryTime("7:5"), undefined);
  assert.equal(readEntryTime(null), undefined);
  assert.equal(readEntryTime(""), undefined);
});

test("the household clock is Singapore time, including across the UTC midnight", () => {
  assert.equal(entryTimeInAppTimeZone(new Date("2026-10-14T06:32:00Z")), "14:32");
  // 17:05 UTC is 01:05 the next day in Singapore.
  assert.equal(entryTimeInAppTimeZone(new Date("2026-10-14T17:05:00Z")), "01:05");
  // Midnight shows 00:00, never 24:00.
  assert.equal(entryTimeInAppTimeZone(new Date("2026-10-14T16:00:30Z")), "00:00");
  assert.equal(entryTimeInAppTimeZone(new Date("not a date")), null);
});

test("a new entry gets the time now only when it is dated today in Singapore", () => {
  const now = new Date("2026-10-14T17:05:00Z"); // 15 Oct 01:05 in Singapore
  assert.equal(defaultEntryTime("2026-10-15", now), "01:05");
  // The UTC date of that instant is the 14th, which is yesterday for the household.
  assert.equal(defaultEntryTime("2026-10-14", now), null);
  assert.equal(defaultEntryTime("2026-10-16", now), null);
});

test("formatEntryTime reads the way en-SG dates do", () => {
  assert.equal(formatEntryTime("14:32"), "2:32 pm");
  assert.equal(formatEntryTime("09:05"), "9:05 am");
  assert.equal(formatEntryTime("00:00"), "12:00 am");
  assert.equal(formatEntryTime("12:00"), "12:00 pm");
  assert.equal(formatEntryTime("23:59"), "11:59 pm");
  assert.equal(formatEntryTime(null), "");
  assert.equal(formatEntryTime("garbage"), "");
});

test("the card date reads 'Today · 2:32 pm' with a time and is unchanged without one", () => {
  assert.equal(formatCardDateTime("2026-10-15", "2026-10-15", "14:32"), "Today · 2:32 pm");
  assert.equal(formatCardDateTime("2026-10-14", "2026-10-15", "09:05"), "Yesterday · 9:05 am");
  assert.equal(formatCardDateTime("2026-10-14", "2026-10-20", "09:05"), "Wed 14 Oct · 9:05 am");
  assert.equal(formatCardDateTime("2026-10-15", "2026-10-15", undefined), "Today");
  assert.equal(formatCardDateTime("2026-10-15", "2026-10-15", null), "Today");
  assert.equal(formatCardDateTime("2026-10-14", "2026-10-20", "bad"), "Wed 14 Oct");
});

test("one day's entries: latest time first, then the untimed ones in their own order", () => {
  const entries = [
    { id: "a" },
    { id: "b", time: "09:10" },
    { id: "c" },
    { id: "d", time: "18:45" },
    { id: "e", time: "09:10" },
    { id: "f", time: null }
  ];
  assert.deepEqual(orderEntriesWithinDay(entries).map((entry) => entry.id), ["d", "b", "e", "a", "c", "f"]);
  // Pure and stable: the input is untouched and a second pass changes nothing.
  assert.deepEqual(entries.map((entry) => entry.id), ["a", "b", "c", "d", "e", "f"]);
  assert.deepEqual(orderEntriesWithinDay(orderEntriesWithinDay(entries)).map((entry) => entry.id), ["d", "b", "e", "a", "c", "f"]);
  // No times at all: exactly today's order.
  const untimed = [{ id: "x" }, { id: "y" }, { id: "z" }];
  assert.deepEqual(orderEntriesWithinDay(untimed).map((entry) => entry.id), ["x", "y", "z"]);
});
