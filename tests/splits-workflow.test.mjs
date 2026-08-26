import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLinkedSplitRefreshOptions,
  buildSplitArchiveRefreshPlan,
  createSplitRefreshGuard
} from "../src/client/splits-workflow.js";
import {
  filterSplitActivityForSearch,
  filterSplitMatchesForSearch,
  getSplitSearchSuggestions,
  splitActivityMatchesSearch,
  splitMatchMatchesSearch
} from "../src/client/split-search.js";
import { splitAmountMinorWithRoundedRemainder } from "../src/domain/split-allocation.ts";

test("odd-cent split allocation keeps a deterministic remainder share", () => {
  assert.deepEqual(splitAmountMinorWithRoundedRemainder(4065, 5000), {
    firstAmount: 2032,
    secondAmount: 2033
  });
});

test("linked split refreshes stay narrow until a ledger transaction exists", () => {
  assert.deepEqual(buildLinkedSplitRefreshOptions(null), {
    broadcast: true,
    invalidateEntries: false,
    invalidateMonth: false,
    invalidateSummary: false
  });

  assert.deepEqual(buildLinkedSplitRefreshOptions("txn-123"), {
    broadcast: true,
    invalidateEntries: true,
    invalidateMonth: true,
    invalidateSummary: true
  });
});

test("archive refresh plan keeps the exception explicit and named", () => {
  assert.deepEqual(buildSplitArchiveRefreshPlan(), {
    refreshShell: true,
    reason: "archive content still rides the main splits page payload"
  });
});

test("split refresh guards only clear the latest in-flight refresh", () => {
  const guard = createSplitRefreshGuard();

  const first = guard.next();
  const second = guard.next();

  assert.equal(guard.isCurrent(first), false);
  assert.equal(guard.isCurrent(second), true);
});

test("split activity search covers descriptions, people, notes, and amounts", () => {
  const expense = buildSplitExpense({
    id: "split-expense-1",
    description: "Din Tai Fung",
    paidByPersonName: "Joyce",
    note: "birthday dinner",
    totalAmountMinor: 8880
  });
  const settlement = buildSplitSettlement({
    id: "split-settlement-1",
    fromPersonName: "Tim",
    toPersonName: "Joyce",
    amountMinor: 4440,
    note: "payback"
  });

  assert.equal(splitActivityMatchesSearch(expense, "din 88.80"), true);
  assert.equal(splitActivityMatchesSearch(expense, "joyce birthday"), true);
  assert.equal(splitActivityMatchesSearch(settlement, "tim payback"), true);
  assert.equal(splitActivityMatchesSearch(expense, "grab"), false);
});

test("split search filters activity and matches with the same query", () => {
  const activity = [
    buildSplitExpense({ id: "split-expense-1", description: "FairPrice groceries", groupId: "split-group-home", totalAmountMinor: 3210 }),
    buildSplitExpense({ id: "split-expense-2", description: "Cinema tickets", groupId: "split-group-home", totalAmountMinor: 2800 })
  ];
  const matches = [
    buildSplitMatch({ id: "match-1", groupId: "split-group-home", splitDescription: "Cinema tickets", transactionDescription: "SHAW THEATRES" }),
    buildSplitMatch({ id: "match-2", groupId: "split-group-home", splitDescription: "Taxi", transactionDescription: "GRAB" })
  ];

  assert.deepEqual(filterSplitActivityForSearch(activity, "cinema").map((item) => item.id), ["split-expense-2"]);
  assert.deepEqual(filterSplitMatchesForSearch(matches, "cinema").map((match) => match.id), ["match-1"]);
});

test("split search suggestions are deduplicated from activity and matches", () => {
  const suggestions = getSplitSearchSuggestions(
    [
      buildSplitExpense({ id: "split-expense-1", description: "FairPrice groceries" }),
      buildSplitExpense({ id: "split-expense-2", description: "fairprice groceries" })
    ],
    [buildSplitMatch({ id: "match-1", splitDescription: "FairPrice groceries", transactionDescription: "NTUC FairPrice" })],
    "fair",
    4
  );

  assert.deepEqual(suggestions, ["FairPrice groceries", "NTUC FairPrice"]);
  assert.equal(splitMatchMatchesSearch(buildSplitMatch({ transactionDescription: "NTUC FairPrice", amountMinor: 3210 }), "ntuc 32.10"), true);
});

function buildSplitExpense(patch = {}) {
  return {
    kind: "expense",
    id: patch.id ?? "split-expense",
    groupId: patch.groupId ?? "split-group-home",
    groupName: "Home",
    date: patch.date ?? "2026-08-14",
    description: patch.description ?? "Groceries",
    categoryName: patch.categoryName ?? "Groceries",
    paidByPersonName: patch.paidByPersonName ?? "Tim",
    totalAmountMinor: patch.totalAmountMinor ?? 1000,
    note: patch.note ?? "",
    matched: false,
    viewerDirectionLabel: "",
    shares: patch.shares ?? []
  };
}

function buildSplitSettlement(patch = {}) {
  return {
    kind: "settlement",
    id: patch.id ?? "split-settlement",
    groupId: patch.groupId ?? "split-group-home",
    groupName: "Home",
    date: patch.date ?? "2026-08-14",
    fromPersonName: patch.fromPersonName ?? "Joyce",
    toPersonName: patch.toPersonName ?? "Tim",
    amountMinor: patch.amountMinor ?? 1000,
    totalAmountMinor: patch.amountMinor ?? 1000,
    note: patch.note ?? "",
    matched: false,
    viewerDirectionLabel: ""
  };
}

function buildSplitMatch(patch = {}) {
  return {
    id: patch.id ?? "match-1",
    kind: patch.kind ?? "expense",
    groupId: patch.groupId ?? "split-group-home",
    groupName: "Home",
    splitRecordId: "split-expense-1",
    splitDate: "2026-08-14",
    splitDescription: patch.splitDescription ?? "Groceries",
    splitAmountMinor: patch.splitAmountMinor ?? 3210,
    transactionId: "entry-1",
    transactionDate: "2026-08-14",
    transactionDescription: patch.transactionDescription ?? "NTUC",
    amountMinor: patch.amountMinor ?? 3210,
    amountDeltaMinor: patch.amountDeltaMinor ?? 0,
    dateDeltaDays: 0,
    confidenceLabel: "High",
    reviewLabel: "Imported transaction could match this split expense"
  };
}
