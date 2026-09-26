import assert from "node:assert/strict";
import test from "node:test";

import { buildSplitsPanelModel } from "../src/client/splits-selectors.js";

// A JPY trip: Tim paid ¥12,000 for a hotel (Tim 25%, Joyce 75%), Joyce paid
// ¥4,000 for a dinner she keeps entirely, and Joyce settled ¥9,000 with Tim.
// Amounts are stored in hundredths, as the Splits page DTO sends them.
const tokyo = { id: "split-group-tokyo", name: "Tokyo trip", currency: "JPY", balanceMinor: 0, isDefault: false };
const share = (personId, personName, ratioBasisPoints, amountMinor) => ({ personId, personName, ratioBasisPoints, amountMinor });
const activity = [
  {
    id: "hotel",
    kind: "expense",
    groupId: tokyo.id,
    isArchived: false,
    date: "2026-05-12",
    description: "Shinjuku hotel",
    categoryName: "Travel",
    paidByPersonName: "Tim",
    totalAmountMinor: 1_200_000,
    currency: "JPY",
    shares: [share("person-tim", "Tim", 2500, 300_000), share("person-joyce", "Joyce", 7500, 900_000)]
  },
  {
    id: "dinner",
    kind: "expense",
    groupId: tokyo.id,
    isArchived: false,
    date: "2026-05-13",
    description: "Omakase dinner",
    categoryName: "Food & Drinks",
    paidByPersonName: "Joyce",
    totalAmountMinor: 400_000,
    currency: "JPY",
    shares: [share("person-tim", "Tim", 0, 0), share("person-joyce", "Joyce", 10000, 400_000)]
  },
  {
    id: "settle",
    kind: "settlement",
    groupId: tokyo.id,
    isArchived: false,
    date: "2026-05-14",
    description: "Settle up",
    fromPersonName: "Joyce",
    toPersonName: "Tim",
    totalAmountMinor: 900_000,
    currency: "JPY"
  },
  {
    id: "other-group",
    kind: "expense",
    groupId: "split-group-none",
    isArchived: false,
    date: "2026-05-15",
    description: "Groceries",
    categoryName: "Groceries",
    paidByPersonName: "Tim",
    totalAmountMinor: 5_000,
    currency: "SGD",
    shares: [share("person-tim", "Tim", 5000, 2_500), share("person-joyce", "Joyce", 5000, 2_500)]
  }
];

function insightRecordsFor(viewId) {
  return buildSplitsPanelModel({
    view: { id: viewId, splitsPage: { groups: [tokyo], activity, matches: [], donutChart: [] } },
    categories: [],
    selectedGroupId: tokyo.id,
    dismissedMatchIds: []
  }).insightRecords;
}

test("a person's split check-in records are that person's share of each group expense", () => {
  assert.deepEqual(insightRecordsFor("person-tim"), [
    { amountMinor: 300_000, entryType: "expense", categoryName: "Travel", description: "Shinjuku hotel", date: "2026-05-12" },
    { amountMinor: 900_000, entryType: "transfer", categoryName: "Split expense", description: "Settle up", date: "2026-05-14" }
  ]);
  assert.deepEqual(insightRecordsFor("person-joyce").map(({ description, amountMinor }) => [description, amountMinor]), [
    ["Shinjuku hotel", 900_000],
    ["Omakase dinner", 400_000],
    ["Settle up", 900_000]
  ]);
});

test("a person's check-in leaves out an expense they have no share in", () => {
  const records = insightRecordsFor("person-tim");
  assert.equal(records.some((record) => record.description === "Omakase dinner"), false);
  assert.equal(records.some((record) => record.description === "Groceries"), false);
});

test("the household split check-in records are the group's totals", () => {
  assert.deepEqual(insightRecordsFor("household").map(({ description, amountMinor, entryType }) => [description, amountMinor, entryType]), [
    ["Shinjuku hotel", 1_200_000, "expense"],
    ["Omakase dinner", 400_000, "expense"],
    ["Settle up", 900_000, "transfer"]
  ]);
});
