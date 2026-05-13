import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEntryMutationRefreshPlan,
  hasLedgerAffectingEntryChange
} from "../src/client/entry-refresh-plan.js";

test("ledger-affecting entry changes detect amount and category edits", () => {
  const before = {
    date: "2026-04-24",
    description: "Coffee",
    accountId: "acct-1",
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 450,
    entryType: "expense",
    transferDirection: undefined,
    ownershipType: "direct",
    ownerName: "Tim",
    splits: []
  };
  const after = {
    ...before,
    amountMinor: 550,
    categoryName: "Food"
  };

  assert.equal(hasLedgerAffectingEntryChange(after, before), true);
});

test("ledger-affecting entry changes detect date edits", () => {
  const before = {
    date: "2026-04-24",
    description: "Coffee",
    accountId: "acct-1",
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 450,
    entryType: "expense",
    transferDirection: undefined,
    ownershipType: "direct",
    ownerName: "Tim",
    splits: []
  };
  const after = {
    ...before,
    date: "2026-04-25"
  };

  assert.equal(hasLedgerAffectingEntryChange(after, before), true);
});

test("ledger-affecting entry changes ignore note-only edits", () => {
  const before = {
    date: "2026-04-24",
    description: "Coffee",
    accountId: "acct-1",
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 450,
    entryType: "expense",
    transferDirection: undefined,
    ownershipType: "direct",
    ownerName: "Tim",
    note: "before",
    splits: []
  };
  const after = {
    ...before,
    note: "after"
  };

  assert.equal(hasLedgerAffectingEntryChange(after, before), false);
});

test("X5a entries invalidation matrix keeps quick-entry create and ledger edits on the month and summary paths", () => {
  const refreshPlan = buildEntryMutationRefreshPlan({
    kind: "quick-entry-create"
  });

  assert.deepEqual(refreshPlan, {
    invalidateEntries: true,
    invalidateMonth: true,
    invalidateSummary: true,
    invalidateSplits: false
  });
});

test("E3 entries invalidation matrix keeps note-only edits entry-local", () => {
  const before = {
    date: "2026-04-24",
    description: "Coffee",
    accountId: "acct-1",
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 450,
    entryType: "expense",
    transferDirection: undefined,
    ownershipType: "direct",
    ownerName: "Tim",
    note: "before",
    splits: []
  };
  const after = {
    ...before,
    note: "after"
  };

  assert.deepEqual(buildEntryMutationRefreshPlan({
    kind: "note-only-edit",
    nextEntry: after,
    previousEntry: before
  }), {
    invalidateEntries: true,
    invalidateMonth: false,
    invalidateSummary: false,
    invalidateSplits: false
  });
});

test("X6 entries invalidation matrix keeps add-to-splits on entries, splits, month, and summary paths", () => {
  assert.deepEqual(buildEntryMutationRefreshPlan({
    kind: "add-to-splits"
  }), {
    invalidateEntries: true,
    invalidateMonth: true,
    invalidateSummary: true,
    invalidateSplits: true
  });

  assert.deepEqual(buildEntryMutationRefreshPlan({
    kind: "transfer-link"
  }), {
    invalidateEntries: true,
    invalidateMonth: true,
    invalidateSummary: true,
    invalidateSplits: false
  });

  assert.deepEqual(buildEntryMutationRefreshPlan({
    kind: "transfer-settle"
  }), {
    invalidateEntries: true,
    invalidateMonth: true,
    invalidateSummary: true,
    invalidateSplits: false
  });

  assert.deepEqual(buildEntryMutationRefreshPlan({
    kind: "entry-delete"
  }), {
    invalidateEntries: true,
    invalidateMonth: true,
    invalidateSummary: true,
    invalidateSplits: false
  });
});

test("E4 and E7 entries invalidation matrix leaves filter-only and mobile-sheet changes server-local", () => {
  assert.deepEqual(buildEntryMutationRefreshPlan({
    kind: "filter-only"
  }), {
    invalidateEntries: false,
    invalidateMonth: false,
    invalidateSummary: false,
    invalidateSplits: false
  });

  assert.deepEqual(buildEntryMutationRefreshPlan({
    kind: "mobile-sheet"
  }), {
    invalidateEntries: false,
    invalidateMonth: false,
    invalidateSummary: false,
    invalidateSplits: false
  });
});
