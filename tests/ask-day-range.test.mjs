// Days as a person says them (src/domain/ask-day-range.ts; DOMAIN.md "Day
// Range"): the server and the rules reader turn "last week", "since monday"
// or "between 3 and 10 nov" into a first and last day. Weeks start Monday.
import assert from "node:assert/strict";
import test from "node:test";

import { findDayRangeIn, formatDayRange, readDayRange } from "../src/domain/ask-day-range.ts";

// Wednesday 18 November 2026.
const TODAY = "2026-11-18";

test("week words: weeks start Monday; last week is the Monday to Sunday before this one", () => {
  assert.deepEqual(readDayRange("last week", TODAY), { from: "2026-11-09", to: "2026-11-15" });
  assert.deepEqual(readDayRange("previous week", TODAY), { from: "2026-11-09", to: "2026-11-15" });
  assert.deepEqual(readDayRange("this week", TODAY), { from: "2026-11-16", to: "2026-11-18" });
  // On a Monday, this week is today alone and last week the full week before.
  assert.deepEqual(readDayRange("this week", "2026-11-16"), { from: "2026-11-16", to: "2026-11-16" });
  assert.deepEqual(readDayRange("last week", "2026-11-16"), { from: "2026-11-09", to: "2026-11-15" });
  // On a Sunday, this week runs Monday to that Sunday.
  assert.deepEqual(readDayRange("this week", "2026-11-22"), { from: "2026-11-16", to: "2026-11-22" });
});

test("weekends: this weekend once it has started, else the one just gone", () => {
  assert.deepEqual(readDayRange("this weekend", TODAY), { from: "2026-11-14", to: "2026-11-15" });
  assert.deepEqual(readDayRange("last weekend", TODAY), { from: "2026-11-14", to: "2026-11-15" });
  assert.deepEqual(readDayRange("this weekend", "2026-11-21"), { from: "2026-11-21", to: "2026-11-21" });
  assert.deepEqual(readDayRange("this weekend", "2026-11-22"), { from: "2026-11-21", to: "2026-11-22" });
  assert.deepEqual(readDayRange("last weekend", "2026-11-22"), { from: "2026-11-14", to: "2026-11-15" });
});

test("single days, since, and the past N days", () => {
  assert.deepEqual(readDayRange("yesterday", TODAY), { from: "2026-11-17", to: "2026-11-17" });
  assert.deepEqual(readDayRange("today", TODAY), { from: TODAY, to: TODAY });
  assert.deepEqual(readDayRange("since monday", TODAY), { from: "2026-11-16", to: TODAY });
  assert.deepEqual(readDayRange("since 1 nov", TODAY), { from: "2026-11-01", to: TODAY });
  assert.deepEqual(readDayRange("past 7 days", TODAY), { from: "2026-11-12", to: TODAY });
  assert.deepEqual(readDayRange("last seven days", TODAY), { from: "2026-11-12", to: TODAY });
});

test("spans as said: between, from-to and dashes, one month or two", () => {
  const nov = { from: "2026-11-03", to: "2026-11-10" };
  assert.deepEqual(readDayRange("between 3 and 10 nov", TODAY), nov);
  assert.deepEqual(readDayRange("between 3 nov and 10 nov", TODAY), nov);
  assert.deepEqual(readDayRange("from 3 to 10 november", TODAY), nov);
  assert.deepEqual(readDayRange("3 to 10 nov", TODAY), nov);
  assert.deepEqual(readDayRange("3-10 nov", TODAY), nov);
  assert.deepEqual(readDayRange("nov 3 to nov 10", TODAY), nov);
  // Across a month boundary.
  assert.deepEqual(readDayRange("28 oct to 3 nov", TODAY), { from: "2026-10-28", to: "2026-11-03" });
});

test("year boundaries: last week in early January, and a December-to-January span", () => {
  // Monday 4 January 2027: last week is 28 Dec 2026 to 3 Jan 2027.
  assert.deepEqual(readDayRange("last week", "2027-01-04"), { from: "2026-12-28", to: "2027-01-03" });
  // Friday 1 January 2027: this week began in December.
  assert.deepEqual(readDayRange("this week", "2027-01-01"), { from: "2026-12-28", to: "2027-01-01" });
  assert.deepEqual(readDayRange("28 dec to 3 jan", "2027-01-10"), { from: "2026-12-28", to: "2027-01-03" });
  // A span later in the year than today is last year's.
  assert.deepEqual(readDayRange("3 to 10 dec", TODAY), { from: "2025-12-03", to: "2025-12-10" });
  // Leap day.
  assert.deepEqual(readDayRange("28 feb to 1 mar 2028", "2028-03-05"), { from: "2028-02-28", to: "2028-03-01" });
});

test("negative: unreadable, backwards, impossible or too long ranges read as nothing", () => {
  for (const words of ["", "sometime", "a while back", "between 10 and 3 nov", "31 to 32 nov", "30 feb to 2 mar", "next week maybe", "lastweek"]) {
    assert.equal(readDayRange(words, TODAY), null, words);
  }
  assert.equal(readDayRange("between 1 jan 2020 and 1 jan 2026", TODAY), null, "longer than two years");
  assert.equal(readDayRange("last week", "not a day"), null);
});

test("a whole message: the run of days it names and the words that named it", () => {
  assert.deepEqual(findDayRangeIn("what did I spend last week?", TODAY), { from: "2026-11-09", to: "2026-11-15", phrase: "last week" });
  assert.deepEqual(findDayRangeIn("Food between 3 and 10 Nov", TODAY), { from: "2026-11-03", to: "2026-11-10", phrase: "between 3 and 10 nov" });
  assert.deepEqual(findDayRangeIn("grab since monday", TODAY), { from: "2026-11-16", to: TODAY, phrase: "since monday" });
  assert.equal(findDayRangeIn("food last month", TODAY), null);
  assert.equal(findDayRangeIn("koufu 12.50", TODAY), null);
});

test("labels: one month, two months, one day, another year", () => {
  assert.equal(formatDayRange({ from: "2026-11-09", to: "2026-11-15" }, TODAY), "9 to 15 Nov");
  assert.equal(formatDayRange({ from: "2026-10-27", to: "2026-11-02" }, TODAY), "27 Oct to 2 Nov");
  assert.equal(formatDayRange({ from: "2026-11-17", to: "2026-11-17" }, TODAY), "17 Nov");
  assert.equal(formatDayRange({ from: "2026-12-28", to: "2027-01-03" }, "2027-01-04"), "28 Dec 2026 to 3 Jan 2027");
  assert.equal(formatDayRange({ from: "2025-12-03", to: "2025-12-10" }, TODAY), "3 to 10 Dec 2025");
});
