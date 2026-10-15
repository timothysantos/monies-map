// The client side of an entry's time: the save payload, the day's order, the
// row's "2:32 pm" and the edit card's dirty check.
import assert from "node:assert/strict";
import test from "node:test";

import { buildPersistedEntryPayload } from "../src/client/entry-create-request.js";
import { groupEntriesByDate } from "../src/client/entry-helpers.js";
import { buildEntryRowDisplay } from "../src/client/entry-row-display.js";
import { buildComparableEntryState } from "../src/client/entry-state.js";

const entry = (id, date, time) => ({
  id, date, description: id, accountName: "UOB One", categoryName: "Groceries", entryType: "expense",
  ownershipType: "direct", ownerName: "Tim", amountMinor: 500, ...(time === undefined ? {} : { time })
});

test("the save payload leaves the time out unless the entry has the field, and an empty field clears it", () => {
  const base = entry("a", "2026-10-15");
  assert.equal("time" in JSON.parse(JSON.stringify(buildPersistedEntryPayload(base))), false, "omitted: the server keeps or defaults it");
  assert.equal(buildPersistedEntryPayload(entry("a", "2026-10-15", "14:32")).time, "14:32");
  assert.equal(buildPersistedEntryPayload(entry("a", "2026-10-15", "")).time, null);
});

test("a day lists its timed entries latest first, then the rest, and days stay newest first", () => {
  const groups = groupEntriesByDate([
    entry("old-day", "2026-10-13", "23:00"),
    entry("no-time-1", "2026-10-14"),
    entry("morning", "2026-10-14", "08:30"),
    entry("no-time-2", "2026-10-14"),
    entry("evening", "2026-10-14", "19:45")
  ]);
  assert.deepEqual(groups.map((group) => group.date), ["2026-10-14", "2026-10-13"]);
  assert.deepEqual(groups[0].entries.map((item) => item.id), ["evening", "morning", "no-time-1", "no-time-2"]);
  // The day's net does not depend on the order.
  assert.equal(groups[0].netMinor, -2000);
});

test("the row names the time only when the entry has one", () => {
  assert.equal(buildEntryRowDisplay(entry("a", "2026-10-15", "14:32"), "household").timeLabel, "2:32 pm");
  assert.equal(buildEntryRowDisplay(entry("a", "2026-10-15"), "household").timeLabel, "");
  assert.equal(buildEntryRowDisplay(entry("a", "2026-10-15", "nonsense"), "household").timeLabel, "");
});

test("changing or clearing the time counts as an edit, an untouched one does not", () => {
  const before = buildComparableEntryState(entry("a", "2026-10-15", "14:32"));
  assert.notDeepEqual(buildComparableEntryState(entry("a", "2026-10-15", "09:00")), before);
  assert.notDeepEqual(buildComparableEntryState(entry("a", "2026-10-15", "")), before);
  assert.deepEqual(buildComparableEntryState(entry("a", "2026-10-15", "14:32")), before);
  assert.deepEqual(buildComparableEntryState(entry("a", "2026-10-15")), buildComparableEntryState(entry("a", "2026-10-15", "")));
});
