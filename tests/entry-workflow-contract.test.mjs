import assert from "node:assert/strict";
import test from "node:test";

import { entryBypassesFieldFilters } from "../src/client/entry-filter-pins.js";
import { buildComparableEntryState, mergeEntriesById } from "../src/client/entry-state.js";

test("E1 entries workflow keeps an optimistic row alive when a stale refresh omits it", () => {
  const currentEntries = [
    { id: "local-pending", isPendingDerived: true, description: "New draft" },
    { id: "server-1", isPendingDerived: false, description: "Coffee" }
  ];
  const serverEntries = [
    { id: "server-1", isPendingDerived: false, description: "Coffee refreshed" }
  ];

  const nextEntries = mergeEntriesById(currentEntries, serverEntries, null);

  assert.equal(nextEntries[0].id, "local-pending");
  assert.equal(nextEntries[0].description, "New draft");
  assert.equal(nextEntries[1].id, "server-1");
  assert.equal(nextEntries[1].description, "Coffee refreshed");
});

test("E7 entries workflow protects the actively edited row from stale server replacement", () => {
  const currentEntries = [
    { id: "editing", isPendingDerived: false, description: "Local edit", linkedTransfer: null, linkedSplitExpenseId: null },
    { id: "server-2", isPendingDerived: false, description: "Lunch" }
  ];
  const serverEntries = [
    { id: "editing", isPendingDerived: false, description: "Server overwrite", linkedTransfer: { transactionId: "x" }, linkedSplitExpenseId: "split-1" },
    { id: "server-2", isPendingDerived: false, description: "Lunch refreshed" }
  ];

  const nextEntries = mergeEntriesById(currentEntries, serverEntries, "editing");

  assert.equal(nextEntries[0].id, "editing");
  assert.equal(nextEntries[0].description, "Local edit");
  assert.equal(nextEntries[0].linkedTransfer.transactionId, "x");
  assert.equal(nextEntries[0].linkedSplitExpenseId, "split-1");
  assert.equal(nextEntries[0].isPendingDerived, false);
  assert.equal(nextEntries[1].description, "Lunch refreshed");
});

test("entries workflow keeps a saved pending row ahead of stale server payloads", () => {
  const currentEntries = [
    {
      id: "reclassified",
      date: "2026-05-24",
      description: "Reclassified row",
      accountId: "acct-1",
      accountName: "UOB One",
      categoryName: "Groceries",
      amountMinor: 3210,
      entryType: "expense",
      transferDirection: null,
      ownershipType: "direct",
      ownerName: "Tim",
      note: "",
      splits: [],
      isPendingDerived: true
    }
  ];
  const serverEntries = [
    {
      ...currentEntries[0],
      categoryName: "Other",
      isPendingDerived: false
    }
  ];

  const nextEntries = mergeEntriesById(currentEntries, serverEntries, null);

  assert.equal(nextEntries[0].categoryName, "Groceries");
  assert.equal(nextEntries[0].isPendingDerived, true);
});

test("X5a entries workflow keeps the active edit comparison stable across note-only changes", () => {
  const baseEntry = {
    id: "entry-1",
    date: "2026-04-24",
    description: "Coffee",
    accountId: "acct-1",
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 450,
    entryType: "expense",
    transferDirection: null,
    ownershipType: "direct",
    ownerName: "Tim",
    note: "before",
    splits: []
  };
  const noteOnlyUpdate = {
    ...baseEntry,
    note: "after"
  };

  assert.deepEqual(mergeEntriesById([baseEntry], [noteOnlyUpdate], "entry-1")[0].note, "before");
  assert.notDeepEqual(buildComparableEntryState(baseEntry), buildComparableEntryState(noteOnlyUpdate));
});

test("X7 entries workflow treats split-linked evidence as part of the entry comparison contract", () => {
  const before = {
    id: "shared-1",
    date: "2026-04-24",
    description: "Dinner",
    accountId: "acct-1",
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 5000,
    entryType: "expense",
    transferDirection: null,
    ownershipType: "shared",
    ownerName: null,
    totalAmountMinor: 10000,
    splits: [{ ratioBasisPoints: 5000 }]
  };
  const after = {
    ...before,
    totalAmountMinor: 12000,
    splits: [{ ratioBasisPoints: 6000 }]
  };

  assert.notDeepEqual(buildComparableEntryState(before), buildComparableEntryState(after));
});

test("entries filtering can pin the actively edited row until save", () => {
  assert.equal(entryBypassesFieldFilters("editing", ["editing"]), true);
  assert.equal(entryBypassesFieldFilters("other", ["editing"]), false);
  assert.equal(entryBypassesFieldFilters("editing", [null, "", "editing"]), true);
});
