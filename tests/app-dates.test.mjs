import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { addDaysToIsoDate, APP_TIME_ZONE, isoDateInAppTimeZone, todayInAppTimeZone } from "../src/client/app-dates.js";
import { buildEntryDraft } from "../src/client/entry-helpers.js";
import { buildQuickExpenseDraftPatch } from "../src/client/quick-entry-url.js";

// 01:30 on 1 October in Singapore is still 30 September in UTC. Anything that
// takes "today" from toISOString() lands on the wrong day and month here.
const EARLY_SINGAPORE_MORNING = Date.parse("2026-09-30T17:30:00Z");
const LATE_SINGAPORE_EVENING = Date.parse("2026-09-30T15:59:59Z");

function atInstant(t, instant) {
  t.mock.timers.enable({ apis: ["Date"], now: instant });
}

test("the app calendar is Singapore time", () => {
  assert.equal(APP_TIME_ZONE, "Asia/Singapore");
});

test("today follows the Singapore calendar, not UTC", (t) => {
  assert.equal(isoDateInAppTimeZone(new Date(EARLY_SINGAPORE_MORNING)), "2026-10-01");
  assert.equal(isoDateInAppTimeZone(new Date(LATE_SINGAPORE_EVENING)), "2026-09-30");
  assert.equal(isoDateInAppTimeZone(new Date("2026-12-31T16:00:00Z")), "2027-01-01");

  atInstant(t, EARLY_SINGAPORE_MORNING);
  assert.equal(todayInAppTimeZone(), "2026-10-01");
});

test("an invalid instant has no calendar date", () => {
  assert.equal(isoDateInAppTimeZone(new Date(Number.NaN)), "");
});

test("adding days is calendar arithmetic across month, year and leap day", () => {
  assert.equal(addDaysToIsoDate("2026-09-29", 3), "2026-10-02");
  assert.equal(addDaysToIsoDate("2026-12-30", 3), "2027-01-02");
  assert.equal(addDaysToIsoDate("2028-02-28", 1), "2028-02-29");
  assert.equal(addDaysToIsoDate("2026-03-01", -1), "2026-02-28");
  assert.equal(addDaysToIsoDate("not-a-date", 3), "");
});

test("a quick entry with no date defaults to the Singapore day", (t) => {
  atInstant(t, EARLY_SINGAPORE_MORNING);
  const { draft } = buildQuickExpenseDraftPatch({
    searchParams: new URLSearchParams("amount=4.50&merchant=Kopi"),
    accountOptions: [{ id: "acct-card", value: "acct-card", label: "UOB One - Tim", accountName: "UOB One", ownerLabel: "Tim" }],
    categoryOptions: ["Other"],
    ownerOptions: ["Tim", "Shared"]
  });
  assert.equal(draft.date, "2026-10-01");
});

test("a quick entry date with a time keeps its Singapore day", (t) => {
  atInstant(t, EARLY_SINGAPORE_MORNING);
  const build = (date) => buildQuickExpenseDraftPatch({
    searchParams: new URLSearchParams({ amount: "4.50", merchant: "Kopi", date }),
    accountOptions: [],
    categoryOptions: ["Other"],
    ownerOptions: ["Tim"]
  }).draft.date;
  assert.equal(build("2026-10-01T01:30:00+08:00"), "2026-10-01");
  assert.equal(build("2026-09-28"), "2026-09-28", "a plain date is kept as written");
  assert.equal(build("garbage"), "2026-10-01", "an unreadable date falls back to today");
});

test("a new ledger entry with no month open defaults to the Singapore day", (t) => {
  atInstant(t, EARLY_SINGAPORE_MORNING);
  const accounts = [{ id: "acct-card", name: "UOB One", isActive: true }];
  const noMonth = buildEntryDraft({ id: "household", monthPage: {} }, accounts, [{ name: "Other" }], [{ id: "tim", name: "Tim" }]);
  assert.equal(noMonth.date, "2026-10-01");
  const withMonth = buildEntryDraft({ id: "household", monthPage: { month: "2026-08" } }, accounts, [{ name: "Other" }], [{ id: "tim", name: "Tim" }]);
  assert.equal(withMonth.date, "2026-08-01", "an open month still sets the default date");
});

// Splits drafts load the full client service (pdf.js), so their Singapore
// default is proven in tests/e2e/app-dates.spec.js. This guard keeps new code
// from computing "today" from UTC again anywhere in the client.
test("client code never takes today's date from UTC", () => {
  const offenders = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (/\.(jsx?|tsx?)$/.test(entry.name)) {
        readFileSync(file, "utf8").split("\n").forEach((line, index) => {
          if (/new Date\(\)\.toISOString\(\)\.(slice|split|substring)/.test(line)) offenders.push(`${file}:${index + 1}`);
        });
      }
    }
  };
  visit("src/client");
  assert.deepEqual(offenders, [], "use todayInAppTimeZone() from src/client/app-dates.js");
});
