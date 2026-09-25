import assert from "node:assert/strict";
import test from "node:test";

import { entryBypassesFieldFilters } from "../src/client/entry-filter-pins.js";
import { normalizeEntryShape } from "../src/client/entry-helpers.js";
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

test("entries workflow does not restore a deleted row from a stale server payload", () => {
  const deletedEntry = {
    id: "deleted-entry",
    isPendingDerived: true,
    description: "Deleted locally"
  };
  const visibleEntries = [
    { id: "server-1", isPendingDerived: false, description: "Coffee" }
  ];

  const nextEntries = mergeEntriesById(
    [deletedEntry, ...visibleEntries],
    [deletedEntry, ...visibleEntries],
    null,
    new Set([deletedEntry.id])
  );

  assert.deepEqual(nextEntries, visibleEntries);
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

test("entries workflow lets explicit refresh accept the server row and clear a pending badge", () => {
  const currentEntries = [
    {
      id: "reclassified",
      date: "2026-06-10",
      description: "Shopee",
      accountId: "acct-1",
      accountName: "UOB One",
      categoryName: "Shopping",
      amountMinor: 2135,
      entryType: "expense",
      transferDirection: null,
      ownershipType: "shared",
      ownerName: null,
      note: "ridwind, cooling patch",
      totalAmountMinor: 2135,
      splits: [{ ratioBasisPoints: 10000 }],
      isPendingDerived: true
    }
  ];
  const serverEntries = [
    {
      ...currentEntries[0],
      categoryName: "Other",
      splits: [{ ratioBasisPoints: 5000 }],
      isPendingDerived: false
    }
  ];

  const nextEntries = mergeEntriesById(currentEntries, serverEntries, null, new Set(), {
    preferServerEntries: true
  });

  assert.equal(nextEntries[0].categoryName, "Other");
  assert.equal(nextEntries[0].splits[0].ratioBasisPoints, 5000);
  assert.equal(nextEntries[0].isPendingDerived, false);
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

test("split-linked direct entry edits preserve the full ledger amount", () => {
  const previous = {
    id: "linked-direct",
    date: "2026-06-22",
    description: "Movie",
    accountId: "acct-1",
    accountName: "UOB One",
    categoryName: "Other",
    amountMinor: 1100,
    totalAmountMinor: 2200,
    entryType: "expense",
    transferDirection: null,
    ownershipType: "direct",
    ownerName: "Tim",
    linkedSplitExpenseId: "split-expense-1",
    linkedSplitShares: [
      { personId: "person-tim", personName: "Tim", ratioBasisPoints: 5000, amountMinor: 1100 },
      { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 5000, amountMinor: 1100 }
    ],
    splits: [{ personId: "person-tim", personName: "Tim", ratioBasisPoints: 10000, amountMinor: 2200 }]
  };

  const normalized = normalizeEntryShape({ ...previous, categoryName: "Entertainment" }, [
    { id: "person-tim", name: "Tim" },
    { id: "person-joyce", name: "Joyce" }
  ], previous);

  assert.equal(normalized.amountMinor, 1100);
  assert.equal(normalized.totalAmountMinor, 2200);
  // The viewer ratio comes from the linked shares, not a 100% direct owner.
  assert.equal(normalized.viewerSplitRatioBasisPoints, undefined);
  assert.deepEqual(normalized.linkedSplitShares, previous.linkedSplitShares);
});

const linkedPeople = [
  { id: "person-tim", name: "Tim" },
  { id: "person-joyce", name: "Joyce" }
];

// A Tim-view row of a $60.00 split-linked expense split 25/75.
function linkedPersonViewEntry() {
  return {
    id: "linked-amount",
    date: "2026-05-22",
    description: "Groceries",
    accountId: "acct-1",
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 1500,
    totalAmountMinor: 6000,
    viewerSplitRatioBasisPoints: 2500,
    entryType: "expense",
    transferDirection: null,
    ownershipType: "direct",
    ownerName: "Tim",
    linkedSplitExpenseId: "split-expense-1",
    linkedSplitShares: [
      { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 7500, amountMinor: 4500 },
      { personId: "person-tim", personName: "Tim", ratioBasisPoints: 2500, amountMinor: 1500 }
    ],
    splits: [{ personId: "person-tim", personName: "Tim", ratioBasisPoints: 10000, amountMinor: 6000 }]
  };
}

test("a split-linked entry's new total moves its linked shares by the stored ratio", () => {
  const previous = linkedPersonViewEntry();

  const normalized = normalizeEntryShape({ ...previous, amountMinor: 8050, amountInput: "80.50", totalAmountMinor: 8050 }, linkedPeople, previous);

  assert.equal(normalized.totalAmountMinor, 8050);
  assert.equal(normalized.viewerSplitRatioBasisPoints, undefined);
  // Same floor/remainder as the server: Tim (first person) keeps the floor.
  assert.deepEqual(normalized.linkedSplitShares, [
    { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 7500, amountMinor: 6038 },
    { personId: "person-tim", personName: "Tim", ratioBasisPoints: 2500, amountMinor: 2012 }
  ]);
});

test("a person-view total that equals the viewer's old share is still saved as the new total", () => {
  const previous = linkedPersonViewEntry();

  const normalized = normalizeEntryShape({ ...previous, amountMinor: 1500, amountInput: "15", totalAmountMinor: 1500 }, linkedPeople, previous);

  assert.equal(normalized.totalAmountMinor, 1500);
  assert.deepEqual(normalized.linkedSplitShares.map((share) => share.amountMinor), [1125, 375]);
});

test("a person-view edit of a linked entry keeps the total in the amount field, so tabbing through it changes nothing", () => {
  const previous = linkedPersonViewEntry();

  const renamed = normalizeEntryShape({ ...previous, description: "Groceries run" }, linkedPeople, previous);

  // The field shows the $60.00 total, never Tim's $15.00 share.
  assert.equal(renamed.amountInput, "60");
  assert.equal(renamed.totalAmountMinor, 6000);

  // A blur on the untouched field re-sends the total it shows.
  const blurred = normalizeEntryShape({ ...renamed, amountMinor: 6000, amountInput: "60", totalAmountMinor: 6000 }, linkedPeople, renamed);
  assert.equal(blurred.totalAmountMinor, 6000);
  assert.deepEqual(blurred.linkedSplitShares, previous.linkedSplitShares);

  // While typing, the typed text is kept as is.
  const typing = normalizeEntryShape({ ...renamed, amountMinor: 800, amountInput: "8", totalAmountMinor: 800 }, linkedPeople, renamed);
  assert.equal(typing.amountInput, "8");
});

test("a saved split-linked amount edit gives way to the server row with the new share", () => {
  const previous = linkedPersonViewEntry();
  const saved = {
    ...normalizeEntryShape({ ...previous, amountMinor: 8050, amountInput: "80.50", totalAmountMinor: 8050 }, linkedPeople, previous),
    isPendingDerived: true
  };
  const serverRow = {
    ...previous,
    amountMinor: 2012,
    totalAmountMinor: 8050,
    linkedSplitShares: [
      { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 7500, amountMinor: 6038 },
      { personId: "person-tim", personName: "Tim", ratioBasisPoints: 2500, amountMinor: 2012 }
    ]
  };

  const [merged] = mergeEntriesById([saved], [serverRow], null);

  assert.equal(merged.isPendingDerived, false);
  assert.equal(merged.amountMinor, 2012);
  assert.equal(merged.viewerSplitRatioBasisPoints, 2500);

  // A server row still on the old amount is stale, so the pending row stays.
  const [kept] = mergeEntriesById([saved], [previous], null);
  assert.equal(kept, saved);
});

test("entries filtering can pin the actively edited row until save", () => {
  assert.equal(entryBypassesFieldFilters("editing", ["editing"]), true);
  assert.equal(entryBypassesFieldFilters("other", ["editing"]), false);
  assert.equal(entryBypassesFieldFilters("editing", [null, "", "editing"]), true);
});

test("E-render a merge that changes nothing keeps each entry object, so memoized rows skip it", () => {
  const splits = [{ personName: "Tim", ratioBasisPoints: 10000, amountMinor: 1200 }];
  const serverEntries = [
    { id: "unchanged", description: "Coffee", amountMinor: 1200, note: "", splits },
    { id: "changed", description: "Lunch", amountMinor: 900, note: "server note", splits }
  ];
  // The page merges once on mount, so rows already carry isPendingDerived.
  const firstMerge = mergeEntriesById(mergeEntriesById([], serverEntries, null), serverEntries, null);
  const current = firstMerge.map((entry) => (entry.id === "changed" ? { ...entry, note: "local edit" } : entry));

  const nextEntries = mergeEntriesById(current, serverEntries, null);

  assert.equal(nextEntries[0], current[0]);
  // Negative: a field the server disagrees on still produces a new object with the server value.
  assert.notEqual(nextEntries[1], current[1]);
  assert.equal(nextEntries[1].note, "server note");
  assert.equal(nextEntries[1].isPendingDerived, false);

  // A pending row always settles into a new, non-pending object.
  const pending = [{ ...current[0], isPendingDerived: true }];
  const settled = mergeEntriesById(pending, [serverEntries[0]], null);
  assert.notEqual(settled[0], pending[0]);
  assert.equal(settled[0].isPendingDerived, false);
});
