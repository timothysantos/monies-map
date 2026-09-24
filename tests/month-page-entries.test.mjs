import assert from "node:assert/strict";
import test from "node:test";

import { adjustEntriesForView, buildMonthPage } from "../src/domain/app-shell.ts";
import { buildPlanLinkCandidates } from "../src/client/month-helpers.js";

// H14: the Month page used to send the month's entries twice
// (`monthPage.entries` and `householdMonthEntries`). These tests pin why the
// second copy was redundant: the page's list always holds every household
// entry, in order, only adjusted for the person view, and plan-link
// candidates built from it alone equal those built from the old merged list.

const split = (personId, personName, amountMinor, ratioBasisPoints) => ({ personId, personName, amountMinor, ratioBasisPoints });

const HOUSEHOLD_ENTRIES = [
  {
    id: "e-tim-direct", date: "2026-05-02", description: "Cold Storage groceries", accountName: "UOB One", categoryName: "Groceries",
    entryType: "expense", ownershipType: "direct", ownerName: "Tim", amountMinor: 4_210, offsetsCategory: false,
    splits: [split("person-tim", "Tim", 4_210, 10_000)]
  },
  {
    id: "e-joyce-direct", date: "2026-05-03", description: "Grab ride", accountName: "Citi Rewards", categoryName: "Public Transport",
    entryType: "expense", ownershipType: "direct", ownerName: "Joyce", amountMinor: 1_850, offsetsCategory: false,
    splits: [split("person-joyce", "Joyce", 1_850, 10_000)]
  },
  {
    id: "e-shared", date: "2026-05-04", description: "Utilities Vivify", accountName: "Household Float", categoryName: "Bills",
    entryType: "expense", ownershipType: "shared", amountMinor: 9_001, offsetsCategory: false,
    splits: [split("person-tim", "Tim", 4_501, 5_000), split("person-joyce", "Joyce", 4_500, 5_000)]
  },
  {
    id: "e-split-linked", date: "2026-05-05", description: "Dinner split", accountName: "UOB One", categoryName: "Food & Drinks",
    entryType: "expense", ownershipType: "direct", ownerName: "Tim", amountMinor: 6_000, offsetsCategory: false,
    linkedSplitExpenseId: "split-1",
    linkedSplitShares: [split("person-tim", "Tim", 2_000, 3_333), split("person-joyce", "Joyce", 4_000, 6_667)],
    splits: [split("person-tim", "Tim", 6_000, 10_000)]
  },
  {
    id: "e-income", date: "2026-05-06", description: "Salary", accountName: "UOB One", categoryName: "Salary",
    entryType: "income", ownershipType: "direct", ownerName: "Tim", amountMinor: 500_000, offsetsCategory: false,
    splits: [split("person-tim", "Tim", 500_000, 10_000)]
  }
];

// The pre-H14 candidate input: the household list merged with the page's
// list by id, the page's copy winning, in first-seen order.
function mergedHouseholdAndPage(householdEntries, monthEntries) {
  const byId = new Map();
  for (const entry of [...householdEntries, ...monthEntries]) {
    byId.set(entry.id, entry);
  }
  return [...byId.values()];
}

const VIEWS = [
  ["household", "direct_plus_shared"],
  ["person-tim", "direct"],
  ["person-tim", "shared"],
  ["person-tim", "direct_plus_shared"],
  ["person-joyce", "direct_plus_shared"]
];

function monthPageFor(viewId, scope) {
  const adjusted = adjustEntriesForView(HOUSEHOLD_ENTRIES, viewId);
  return buildMonthPage(viewId, scope, [], adjusted, [], [], "2026-05", null);
}

test("the Month page lists every household entry in order for every person and scope, adjusted for the view", () => {
  for (const [viewId, scope] of VIEWS) {
    const page = monthPageFor(viewId, scope);
    assert.deepEqual(page.entries.map((entry) => entry.id), HOUSEHOLD_ENTRIES.map((entry) => entry.id), `${viewId} ${scope}`);
  }
  // The person view keeps its own share of a split-linked entry.
  const tim = monthPageFor("person-tim", "direct_plus_shared");
  assert.equal(tim.entries.find((entry) => entry.id === "e-split-linked").amountMinor, 2_000);
  assert.equal(tim.entries.find((entry) => entry.id === "e-split-linked").totalAmountMinor, 6_000);
});

test("plan-link candidates from the page's entries alone equal candidates built with the household copy too", () => {
  const rows = [
    { id: "row-bills", label: "Utilities", categoryName: "Bills", accountName: "Household Float", plannedMinor: 9_000, linkedEntryIds: [] },
    { id: "row-food", label: "Dinner", categoryName: "Food & Drinks", accountName: "UOB One", plannedMinor: 2_000, linkedEntryIds: ["e-split-linked"] },
    { id: "row-hinted", label: "Transport", categoryName: "Public Transport", plannedMinor: 1_850, linkedEntryIds: [], planMatchHints: [{ descriptionPattern: "GRAB" }] }
  ];
  for (const [viewId, scope] of VIEWS) {
    const monthEntries = monthPageFor(viewId, scope).entries;
    for (const row of rows) {
      const withHousehold = buildPlanLinkCandidates({ row, monthEntries: mergedHouseholdAndPage(HOUSEHOLD_ENTRIES, monthEntries), monthKey: "2026-05" });
      const pageOnly = buildPlanLinkCandidates({ row, monthEntries, monthKey: "2026-05" });
      assert.deepEqual(pageOnly, withHousehold, `${viewId} ${scope} ${row.id}`);
      assert.ok(pageOnly.length > 0, `${viewId} ${scope} ${row.id} has candidates`);
    }
  }
  // Candidates carry the viewer's share, not the household amount.
  const timCandidates = buildPlanLinkCandidates({ row: rows[1], monthEntries: monthPageFor("person-tim", "direct_plus_shared").entries, monthKey: "2026-05" });
  assert.equal(timCandidates.find((entry) => entry.id === "e-split-linked").amountMinor, 2_000);
});
