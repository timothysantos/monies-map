import assert from "node:assert/strict";
import test from "node:test";

import { buildSplitsPage } from "../src/domain/splits-projection.ts";
import { partitionActivityBySettlement, summariseOpenPeriod } from "../src/domain/split-open-period.ts";
import {
  archiveTriggerSummary,
  buildSplitActivitySections,
  settledSectionArchiveSummary,
  settledSectionHeading
} from "../src/client/splits-settled-sections.js";

// The Splits activity list shows only the open records; what a settlement
// checkpoint covers sits in one collapsed section per checkpoint at the end.
// The shape mirrors the real household: one matched checkpoint dated 27 Aug
// covers most of the group's older expenses (and some of another group's),
// a few newer expenses are still open.

const people = { "person-tim": "Tim", "person-joyce": "Joyce" };
const groupId = "split-group-okaeri";
const otherGroupId = "split-group-home";

function expense(id, date, totalAmountMinor, overrides = {}) {
  const half = totalAmountMinor / 2;
  return {
    id,
    groupId,
    groupName: "Okaeri",
    date,
    description: `Expense ${id}`,
    categoryName: "Food & Drinks",
    payerPersonId: "person-joyce",
    payerPersonName: "Joyce",
    totalAmountMinor,
    currency: "SGD",
    paymentMethod: "cash",
    paymentStatus: "recorded",
    shares: [
      { personId: "person-tim", personName: "Tim", ratioBasisPoints: 5000, amountMinor: half },
      { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 5000, amountMinor: half }
    ],
    ...overrides
  };
}

function settlement(id, date, amountMinor, overrides = {}) {
  return {
    id,
    groupId,
    groupName: "Okaeri",
    date,
    fromPersonId: "person-tim",
    fromPersonName: "Tim",
    toPersonId: "person-joyce",
    toPersonName: "Joyce",
    amountMinor,
    currency: "SGD",
    note: "",
    ...overrides
  };
}

function checkpoint(id, status, includedRecordIds, settlementDate = "2026-08-27", overrides = {}) {
  return {
    id,
    fromPersonId: "person-tim",
    fromPersonName: "Tim",
    toPersonId: "person-joyce",
    toPersonName: "Joyce",
    amountMinor: 708_217,
    currency: "SGD",
    settlementDate,
    status,
    matchedAmountMinor: 0,
    matchedTransfers: [],
    includedRecordCount: includedRecordIds.length,
    includedRecordIds,
    ...overrides
  };
}

const older = [
  expense("e-old-1", "2026-04-02", 100_000),
  expense("e-old-2", "2026-06-24", 105_185, { description: "Okaeri deposit" }),
  expense("e-old-3", "2026-08-20", 20_000)
];
const newer = [
  expense("e-new-1", "2026-08-30", 10_000),
  expense("e-new-2", "2026-10-13", 20_000, { description: "Okaeri dinner" })
];
// Another group's expense in the same checkpoint (a checkpoint spans groups).
const elsewhere = expense("e-home-1", "2026-07-01", 50_000, { groupId: otherGroupId, groupName: "Home" });
const OLDER_IDS = older.map((item) => item.id);

function pageWith(expenses, checkpoints, settlements = [], viewId = "person-tim") {
  return buildSplitsPage(
    viewId,
    [
      { id: groupId, name: "Okaeri", sortOrder: 1, currency: "SGD", expenseSource: "mixed" },
      { id: otherGroupId, name: "Home", sortOrder: 2, currency: "SGD", expenseSource: "mixed" }
    ],
    expenses,
    settlements,
    [],
    [],
    "2026-10",
    people,
    checkpoints
  );
}

// What buildSplitsPanelModel does for the open group: not archived, searched.
function sectionsFor(page, searchQuery = "") {
  return buildSplitActivitySections({
    activity: page.activity.filter((item) => item.groupId === groupId),
    checkpoints: page.settlementCheckpoints,
    searchQuery
  });
}

function ids(items) {
  return items.map((item) => item.id).sort();
}

test("one matched checkpoint: the list holds only the open records, the covered ones are one section", () => {
  const page = pageWith([...older, ...newer, elsewhere], [checkpoint("cp-1", "matched", [...OLDER_IDS, elsewhere.id])]);
  const { groupedOpenActivity, settledSections } = sectionsFor(page);

  assert.deepEqual(ids(groupedOpenActivity.flatMap((group) => group.items)), ["e-new-1", "e-new-2"]);
  assert.equal(settledSections.length, 1);
  const [section] = settledSections;
  assert.equal(section.checkpointId, "cp-1");
  assert.equal(section.settlementDate, "2026-08-27");
  assert.equal(section.isPaid, true);
  // Only this group's covered records: the Home expense stays in its own group.
  assert.deepEqual(ids(section.items), OLDER_IDS);
  assert.equal(section.entryCount, 3);
  assert.equal(section.spendMinor, 225_185);
  assert.equal(section.currency, "SGD");
  // The rows inside are grouped by date like the open list, newest first.
  assert.deepEqual(section.groups.map((group) => group.date), ["2026-08-20", "2026-06-24", "2026-04-02"]);

  // The open list and the chip read the same set: nothing settled is in it.
  const open = summariseOpenPeriod(page.activity.filter((item) => item.groupId === groupId));
  assert.deepEqual(ids(open.openExpenses), ["e-new-1", "e-new-2"]);
});

test("partially matched, internally offset and open checkpoints cover their records too", () => {
  for (const status of ["partially_matched", "internally_offset", "open"]) {
    const page = pageWith([...older, ...newer], [checkpoint("cp-1", status, OLDER_IDS)]);
    const { groupedOpenActivity, settledSections } = sectionsFor(page);
    assert.equal(groupedOpenActivity.flatMap((group) => group.items).length, 2, status);
    assert.equal(settledSections.length, 1, status);
    assert.equal(settledSections[0].entryCount, 3, status);
  }
});

test("a simplified settlement still waiting for its payment is not called settled up", () => {
  for (const status of ["open", "partially_matched"]) {
    const page = pageWith([...older, ...newer], [checkpoint("cp-1", status, OLDER_IDS)]);
    assert.equal(sectionsFor(page).settledSections[0].isPaid, false, status);
  }
  // Marked paid (or matched, or offset) is settled up.
  const paid = pageWith([...older, ...newer], [checkpoint("cp-1", "open", OLDER_IDS, "2026-08-27", { settledAt: "2026-08-28 10:00:00" })]);
  assert.equal(sectionsFor(paid).settledSections[0].isPaid, true);
  const offset = pageWith([...older, ...newer], [checkpoint("cp-1", "internally_offset", OLDER_IDS)]);
  assert.equal(sectionsFor(offset).settledSections[0].isPaid, true);
});

test("a reopened or voided checkpoint puts its records back in the open list, with no section", () => {
  for (const status of ["reopened", "voided"]) {
    const page = pageWith([...older, ...newer], [checkpoint("cp-1", status, OLDER_IDS)]);
    const { groupedOpenActivity, settledSections } = sectionsFor(page);
    assert.equal(settledSections.length, 0, status);
    assert.deepEqual(ids(groupedOpenActivity.flatMap((group) => group.items)), [...OLDER_IDS, "e-new-1", "e-new-2"].sort(), status);
  }
});

test("two checkpoints are two sections, newest first, each with its own count and total", () => {
  const page = pageWith([...older, ...newer], [
    checkpoint("cp-old", "matched", ["e-old-1", "e-old-2"], "2026-07-01"),
    checkpoint("cp-new", "matched", ["e-old-3", "e-new-1"], "2026-09-02")
  ]);
  const { groupedOpenActivity, settledSections } = sectionsFor(page);
  assert.deepEqual(ids(groupedOpenActivity.flatMap((group) => group.items)), ["e-new-2"]);
  assert.deepEqual(settledSections.map((section) => section.checkpointId), ["cp-new", "cp-old"]);
  assert.deepEqual(settledSections.map((section) => [section.entryCount, section.spendMinor]), [[2, 30_000], [2, 205_185]]);
});

test("a settle-up in a checkpoint counts as an entry but not as spend", () => {
  const page = pageWith([...older, ...newer], [checkpoint("cp-1", "matched", [...OLDER_IDS, "s-1"])], [settlement("s-1", "2026-08-21", 5_000)]);
  const [section] = sectionsFor(page).settledSections;
  assert.equal(section.entryCount, 4);
  assert.equal(section.spendMinor, 225_185);
});

test("a closed batch's records are in neither part: they live in the archive", () => {
  const batched = { id: "b-1", groupId, settlementStatus: "settled", kind: "expense", totalAmountMinor: 900, date: "2026-03-01" };
  const open = { id: "o-1", groupId, settlementStatus: "open", kind: "expense", totalAmountMinor: 100, date: "2026-10-01" };
  const covered = { id: "c-1", groupId, settlementStatus: "settled", settlementCheckpointId: "cp-1", kind: "expense", totalAmountMinor: 300, date: "2026-08-01" };
  const { open: openItems, sections } = partitionActivityBySettlement([batched, open, covered], [checkpoint("cp-1", "matched", ["c-1"])]);
  assert.deepEqual(ids(openItems), ["o-1"]);
  assert.deepEqual(sections.map((section) => ids(section.items)), [["c-1"]]);
});

test("a search narrows both parts; a settled match stays findable in its section", () => {
  const page = pageWith([...older, ...newer], [checkpoint("cp-1", "matched", OLDER_IDS)]);

  const settledOnly = sectionsFor(page, "deposit");
  assert.equal(settledOnly.groupedOpenActivity.length, 0);
  assert.equal(settledOnly.settledSections.length, 1);
  assert.deepEqual(ids(settledOnly.settledSections[0].items), ["e-old-2"]);
  // The heading describes what the search shows.
  assert.equal(settledOnly.settledSections[0].entryCount, 1);
  assert.equal(settledOnly.settledSections[0].spendMinor, 105_185);

  const both = sectionsFor(page, "okaeri");
  assert.ok(both.groupedOpenActivity.flatMap((group) => group.items).length > 0);
  assert.equal(both.settledSections.length, 1);

  // Negative: nothing matches, so no section is left to show.
  const none = sectionsFor(page, "no such thing at all");
  assert.equal(none.groupedOpenActivity.length, 0);
  assert.equal(none.settledSections.length, 0);
});

test("the heading says when, how many and how much, and hides the amount with money", () => {
  const page = pageWith([...older, ...newer], [checkpoint("cp-1", "matched", OLDER_IDS)]);
  const [section] = sectionsFor(page).settledSections;
  assert.equal(settledSectionHeading(section, { today: "2026-10-20", areTotalsVisible: true }), "Settled up on 27 Aug · 3 entries · $2,251.85");
  // Another year names the year, so it is never read as this year.
  assert.equal(settledSectionHeading(section, { today: "2027-01-05", areTotalsVisible: true }), "Settled up on 27 Aug 2026 · 3 entries · $2,251.85");
  const hidden = settledSectionHeading(section, { today: "2026-10-20", areTotalsVisible: false });
  assert.equal(hidden, "Settled up on 27 Aug · 3 entries · ••••");
  assert.doesNotMatch(hidden, /\$|2,251/);

  const waiting = sectionsFor(pageWith([...older, ...newer], [checkpoint("cp-1", "open", OLDER_IDS, "2026-05-20")])).settledSections[0];
  assert.equal(settledSectionHeading(waiting, { today: "2026-10-20", areTotalsVisible: true }), "Simplified on 20 May · 3 entries · $2,251.85");

  const one = sectionsFor(pageWith([...older, ...newer], [checkpoint("cp-1", "matched", ["e-old-1"])])).settledSections[0];
  assert.equal(settledSectionHeading(one, { today: "2026-10-20", areTotalsVisible: true }), "Settled up on 27 Aug · 1 entry · $1,000.00");

  // A foreign-currency group adds its own currency, never converted.
  const yen = sectionsFor(pageWith([expense("y-1", "2026-09-01", 1_200_000, { currency: "JPY" })], [checkpoint("cp-y", "matched", ["y-1"])])).settledSections[0];
  assert.equal(yen.currency, "JPY");
  assert.match(settledSectionHeading(yen, { today: "2026-10-20", areTotalsVisible: true }), /JP¥|¥/);
});

test("the archive lists each settlement beside the settled batches", () => {
  const page = pageWith([...older, ...newer], [checkpoint("cp-1", "matched", OLDER_IDS)]);
  const { settledSections } = sectionsFor(page);
  const summary = settledSectionArchiveSummary(settledSections[0], page.settlementCheckpoints, { viewId: "person-tim", areTotalsVisible: true });
  assert.equal(summary.title, "Settled up");
  assert.equal(summary.subtitle, "You paid Joyce $7,082.17 for every group");
  assert.equal(summary.meta, "3 entries");
  const household = settledSectionArchiveSummary(settledSections[0], page.settlementCheckpoints, { viewId: "household", areTotalsVisible: true });
  assert.equal(household.subtitle, "Tim paid Joyce $7,082.17 for every group");
  const joyce = settledSectionArchiveSummary(settledSections[0], page.settlementCheckpoints, { viewId: "person-joyce", areTotalsVisible: true });
  assert.equal(joyce.subtitle, "Tim paid you $7,082.17 for every group");
  const hidden = settledSectionArchiveSummary(settledSections[0], page.settlementCheckpoints, { viewId: "household", areTotalsVisible: false });
  assert.doesNotMatch(hidden.subtitle, /\$/);

  const waiting = sectionsFor(pageWith([...older, ...newer], [checkpoint("cp-1", "open", OLDER_IDS)]));
  const waitingSummary = settledSectionArchiveSummary(waiting.settledSections[0], [checkpoint("cp-1", "open", OLDER_IDS)], { viewId: "household", areTotalsVisible: true });
  assert.equal(waitingSummary.title, "Simplified, not paid yet");
  assert.equal(waitingSummary.subtitle, "Tim pays Joyce $7,082.17 for every group");
  const offset = settledSectionArchiveSummary(waiting.settledSections[0], [checkpoint("cp-1", "internally_offset", OLDER_IDS, "2026-08-27", { amountMinor: 0, fromPersonId: undefined, toPersonId: undefined })], { viewId: "household", areTotalsVisible: true });
  assert.equal(offset.subtitle, "Nothing to pay: the groups evened out");

  assert.equal(archiveTriggerSummary(0, 0), "No settled batches yet");
  assert.equal(archiveTriggerSummary(2, 0), "2 settled batches");
  assert.equal(archiveTriggerSummary(0, 1), "1 earlier settle-up");
  assert.equal(archiveTriggerSummary(1, 2), "1 settled batch · 2 earlier settle-ups");
});
