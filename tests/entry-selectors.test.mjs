import assert from "node:assert/strict";
import test from "node:test";

import {
  categoryMatchesEntryFilter,
  countActiveEntryFilters,
  normalizeEntryFilterValues
} from "../src/client/entry-filter-values.js";
import {
  entryMatchesSearch,
  getEntrySearchSuggestions,
} from "../src/client/entry-search.js";

test("entry selectors support multiple selected categories", () => {
  const categories = normalizeEntryFilterValues(["Food & Drinks", "Taxi", "Taxi", ""]);

  assert.deepEqual(categories, ["Food & Drinks", "Taxi"]);
  assert.equal(categoryMatchesEntryFilter("Food & Drinks", categories), true);
  assert.equal(categoryMatchesEntryFilter("Shopping", categories), false);
});

test("entry filter count treats multi-category selection as one active filter group", () => {
  assert.equal(countActiveEntryFilters({
    categories: ["Food & Drinks", "Taxi"],
    wallets: ["account-uob-one"],
    entryIds: [],
    type: "",
    search: ""
  }), 2);

  assert.equal(countActiveEntryFilters({
    categories: ["Food & Drinks"],
    wallets: [],
    entryIds: [],
    type: "",
    search: "fairprice"
  }), 2);
});

test("entry search matches visible finance fields with all query tokens", () => {
  const entries = [
    buildEntry({ id: "entry-1", description: "NTUC FairPrice Finest", note: "weekly shop", accountName: "UOB One", categoryName: "Groceries", amountMinor: -4280 }),
    buildEntry({ id: "entry-2", description: "Grab ride", note: "airport", accountName: "OCBC 360", categoryName: "Transport", amountMinor: -1890 }),
    buildEntry({ id: "entry-3", description: "Payroll", note: "August salary", accountName: "UOB One", categoryName: "Salary", amountMinor: 500000, entryType: "income" })
  ];

  assert.equal(entryMatchesSearch(entries[0], "fairprice 42.80"), true);
  assert.equal(entryMatchesSearch(entries[1], "fairprice 42.80"), false);
  assert.deepEqual(entries.filter((entry) => entry.entryType === "expense" && entryMatchesSearch(entry, "uob")).map((entry) => entry.id), ["entry-1"]);
});

test("entry search suggestions are deduplicated from loaded rows", () => {
  const entries = [
    buildEntry({ id: "entry-1", description: "NTUC FairPrice Finest", accountName: "UOB One" }),
    buildEntry({ id: "entry-2", description: "ntuc fairprice finest", accountName: "UOB One" }),
    buildEntry({ id: "entry-3", description: "Grab", accountName: "OCBC 360" })
  ];

  assert.deepEqual(getEntrySearchSuggestions(entries, "fair", 4), ["NTUC FairPrice Finest"]);
});

function buildEntry(patch) {
  return {
    id: patch.id,
    date: "2026-08-12",
    description: patch.description,
    note: patch.note ?? "",
    accountId: patch.accountId ?? "account-uob-one",
    accountName: patch.accountName ?? "UOB One",
    categoryName: patch.categoryName ?? "Other",
    ownerName: patch.ownerName ?? "Tim",
    entryType: patch.entryType ?? "expense",
    amountMinor: patch.amountMinor ?? -1000,
    totalAmountMinor: Math.abs(patch.amountMinor ?? -1000),
    visibleAmountMinor: Math.abs(patch.amountMinor ?? -1000),
    splits: patch.splits ?? []
  };
}
