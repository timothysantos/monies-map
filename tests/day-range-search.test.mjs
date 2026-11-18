// Days in search (Ask audit B25; DOMAIN.md "Day Range"): "what did I spend
// last week" reads into a run of days with AI (the turn route's search, the
// model passing the words as said) and without it (the rules reader), the
// Entries URL carries it (entry_day_from, entry_day_to) in place of the
// month, and Entries lists exactly those days.
import assert from "node:assert/strict";
import test from "node:test";

import { parseAskTurnAction, validateAskTurnAction } from "../src/domain/ask-turn.ts";
import { readFilterRequest, applyFilterOption } from "../src/client/ask-filter-reader.js";
import {
  applyEntriesDayRange,
  buildEntriesFilterSearch,
  clearEntriesDayRange,
  hasAskFilterChip,
  readEntriesDayRange,
  readEntriesFilterParams,
  readEntriesRangeStart
} from "../src/client/entry-filter-params.js";
import { getFilteredEntries } from "../src/client/entry-filtering.js";
import { countActiveEntryFilters } from "../src/client/entry-filter-values.js";
import { describeFilterParts } from "../src/client/copy/entry-filter-copy.js";

// Wednesday 18 November 2026.
const TODAY = "2026-11-18";
const people = [{ id: "person-tim", name: "Tim" }, { id: "person-joyce", name: "Joyce" }];

function turnContext(text, overrides = {}) {
  return {
    today: TODAY,
    month: "2026-11",
    viewId: "person-tim",
    scope: "direct_plus_shared",
    page: "ask",
    people,
    entry: {
      today: TODAY,
      accounts: [{ id: "acct-uob", institutionId: "inst", name: "UOB One", institution: "UOB", kind: "bank", ownerLabel: "Tim", ownerPersonId: "person-tim", currency: "SGD", isJoint: false, isActive: true }],
      people,
      categoryNames: ["Food & Drinks", "Groceries", "Transport", "Other"],
      categoryMatchRules: [],
      defaultAccountPriorityIds: ["acct-uob"],
      viewerName: "Tim"
    },
    groups: [],
    planLines: [],
    focus: null,
    history: [],
    text,
    ...overrides
  };
}

const search = (fields, text) => validateAskTurnAction(parseAskTurnAction({ action: "search_entries", search: fields }), turnContext(text));

test("AI on: the model passes the words, the server works out the days and says them in the reply", () => {
  const reply = search({ days: "last week", type: "expense" }, "what did I spend last week");
  assert.deepEqual(reply, {
    kind: "search",
    filter: {
      month: "2026-11", viewId: "person-tim", scope: "direct_plus_shared", search: "", categories: [], wallets: [], type: "expense",
      minAmountMinor: null, maxAmountMinor: null, dayFrom: "2026-11-09", dayTo: "2026-11-15"
    },
    assumptions: [{ text: "Last week: 9 to 15 Nov", chips: [] }]
  });
  // The person's own words win over a date the model worked out wrongly.
  const wrong = search({ days: "2026-11-01 to 2026-11-07" }, "food last week");
  assert.equal(wrong.filter.dayFrom, "2026-11-09");
  // The model put the words in the month (or left them out): the person's
  // own "last week" is still a run of days, never a month question.
  for (const fields of [{ month: "last week" }, {}]) {
    const misplaced = search(fields, "what did I spend last week");
    assert.equal(misplaced.kind, "search", JSON.stringify(fields));
    assert.deepEqual([misplaced.filter.dayFrom, misplaced.filter.dayTo], ["2026-11-09", "2026-11-15"]);
  }
  // Words the message does not hold: read from what the model passed on.
  const passed = search({ days: "between 3 and 10 nov", categories: ["Groceries"] }, "groceries betwen the 3rd and 10th of nov");
  assert.deepEqual([passed.filter.dayFrom, passed.filter.dayTo, passed.filter.month], ["2026-11-03", "2026-11-10", "2026-11"]);
  assert.equal(passed.assumptions[0].text, "Between 3 and 10 nov: 3 to 10 Nov");
  // Across a month: the month is the last day's.
  const across = search({ days: "since 28 oct" }, "spending since 28 oct");
  assert.deepEqual([across.filter.dayFrom, across.filter.dayTo, across.filter.month], ["2026-10-28", TODAY, "2026-11"]);
});

test("AI on, negative: days that cannot be read ask back with chips, and are a repairable date error", () => {
  const reply = search({ days: "the other week-ish" }, "what did i spend the other week-ish");
  assert.equal(reply.kind, "clarify");
  assert.equal(reply.question, "Which days do you mean?");
  assert.deepEqual(reply.options, ["This week", "Last week", "Last 7 days"]);
  assert.deepEqual(reply.error, { code: "date_invalid", field: "search.days" });
  // No days at all: the month reading is as before.
  const month = search({ month: "october" }, "food in october");
  assert.equal(month.filter.month, "2026-10");
  assert.equal(month.filter.dayFrom, undefined);
});

const readerContext = { today: TODAY, month: "2026-11", viewId: "person-tim", scope: "direct_plus_shared", people, accounts: [], categories: [{ name: "Food & Drinks" }, { name: "Groceries" }] };

test("AI off: the rules read the same phrases into the same days", () => {
  for (const [text, from, to] of [
    ["what did I spend last week", "2026-11-09", "2026-11-15"],
    ["spending this weekend", "2026-11-14", "2026-11-15"],
    ["groceries since monday", "2026-11-16", TODAY],
    ["food between 3 and 10 nov", "2026-11-03", "2026-11-10"],
    ["what did i spend past 7 days", "2026-11-12", TODAY]
  ]) {
    const reading = readFilterRequest(text, readerContext);
    assert.equal(reading.kind, "filter", text);
    assert.deepEqual([reading.filter.dayFrom, reading.filter.dayTo, reading.filter.month], [from, to, to.slice(0, 7)], text);
  }
  // The day words are used up: they never become search words.
  assert.equal(readFilterRequest("what did I spend last week", readerContext).filter.search, "");
  assert.deepEqual(readFilterRequest("groceries last week", readerContext).filter.categories, ["Groceries"]);
});

test("AI off, negative: days the rules cannot read are asked, with the usual runs of days as chips", () => {
  const reading = readFilterRequest("what did I spend between the 3rd and whenever", readerContext);
  assert.equal(reading.kind, "question");
  const days = reading.questions.find((question) => question.field === "days");
  assert.deepEqual(days.options.map((option) => option.label), ["This week", "Last week", "Last 7 days"]);
  const chosen = applyFilterOption(reading.filter, days.options[1]);
  assert.deepEqual([chosen.dayFrom, chosen.dayTo, chosen.month], ["2026-11-09", "2026-11-15", "2026-11"]);
  // An entry sentence is still an entry: no days read into it.
  assert.equal(readFilterRequest("kopi 2.40 last week", readerContext).kind, "none");
});

test("the Entries URL: days in place of the month, read back the same, and dropped by another month", () => {
  const params = buildEntriesFilterSearch({ month: "2026-10", viewId: "person-tim", scope: "direct_plus_shared", search: "", categories: ["Groceries"], wallets: [], type: "", minAmountMinor: null, maxAmountMinor: null, dayFrom: "2026-10-27", dayTo: "2026-11-02" });
  assert.equal(params.get("month"), "2026-11");
  assert.equal(params.get("entry_day_from"), "2026-10-27");
  assert.equal(params.get("entry_day_to"), "2026-11-02");
  assert.equal(params.get("entry_from"), null);
  assert.equal(readEntriesRangeStart(params, "2026-11"), "2026-10");
  const { entryFilters } = readEntriesFilterParams(params);
  assert.deepEqual([entryFilters.dayFrom, entryFilters.dayTo], ["2026-10-27", "2026-11-02"]);
  assert.equal(countActiveEntryFilters(entryFilters), 2);
  assert.ok(hasAskFilterChip(params));
  // Another month picked in the header: the days no longer apply.
  const moved = new URLSearchParams(params);
  moved.set("month", "2026-09");
  assert.equal(readEntriesDayRange(moved, "2026-09"), null);
  assert.equal(readEntriesFilterParams(moved).entryFilters.dayFrom, "");
  // Negative: backwards, impossible, or longer than two years.
  for (const [from, to] of [["2026-11-10", "2026-11-03"], ["2026-02-30", "2026-03-02"], ["2024-01-01", "2026-11-02"], ["nope", "2026-11-02"]]) {
    assert.equal(readEntriesDayRange(new URLSearchParams({ entry_day_from: from, entry_day_to: to }), "2026-11"), null, `${from}..${to}`);
  }
});

test("From and To: one end sets a one-day range, the other moves with it, clearing either clears both", () => {
  const start = new URLSearchParams("view=person-tim&month=2026-11&entry_from=2026-09&entry_to=2026-11&entry_trip=trip-1");
  const one = applyEntriesDayRange(start, { from: "2026-11-03" });
  assert.deepEqual([one.get("entry_day_from"), one.get("entry_day_to"), one.get("month")], ["2026-11-03", "2026-11-03", "2026-11"]);
  assert.equal(one.get("entry_from"), null, "a period of months is replaced");
  assert.equal(one.get("entry_trip"), null, "a trip view is replaced");
  const two = applyEntriesDayRange(one, { to: "2026-11-10" });
  assert.deepEqual([two.get("entry_day_from"), two.get("entry_day_to")], ["2026-11-03", "2026-11-10"]);
  const earlier = applyEntriesDayRange(two, { to: "2026-10-30" });
  assert.deepEqual([earlier.get("entry_day_from"), earlier.get("entry_day_to"), earlier.get("month")], ["2026-10-30", "2026-10-30", "2026-10"]);
  const cleared = applyEntriesDayRange(two, { from: "" });
  assert.equal(cleared.get("entry_day_from"), null);
  assert.equal(cleared.get("entry_day_to"), null);
  assert.equal(clearEntriesDayRange(two).get("entry_day_to"), null);
});

test("the list keeps only the days in the range, both ends included; the chips name the days", () => {
  const entry = (id, date) => ({ id, date, entryType: "expense", amountMinor: 1_000, categoryName: "Groceries", accountId: "acct-uob", ownershipType: "direct", ownerName: "Tim", ownerPersonId: "person-tim" });
  const entries = [entry("a", "2026-11-08"), entry("b", "2026-11-09"), entry("c", "2026-11-12"), entry("d", "2026-11-15"), entry("e", "2026-11-16")];
  const shown = getFilteredEntries({ entries, entryFilters: { dayFrom: "2026-11-09", dayTo: "2026-11-15" }, selectedScope: "direct_plus_shared", viewId: "household" });
  assert.deepEqual(shown.map((item) => item.id), ["b", "c", "d"]);
  assert.deepEqual(describeFilterParts({ month: "2026-11", viewId: "person-tim", scope: "direct_plus_shared", dayFrom: "2026-11-09", dayTo: "2026-11-15" }, { people, withContext: true }).map((part) => part.label), ["9 to 15 Nov", "Tim"]);
});
