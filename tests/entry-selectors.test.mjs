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
import { projectEntriesForView } from "../src/client/entry-row-projection.js";

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

test("row projections keep their identity across filter changes and change only for an edited entry", () => {
  const entry = (id, amountMinor, splits) => ({
    id,
    date: "2026-05-03",
    description: `Row ${id}`,
    amountMinor,
    entryType: "expense",
    ownershipType: splits ? "shared" : "direct",
    splits: splits ?? [{ personId: "person-tim", personName: "Tim", ratioBasisPoints: 10000, amountMinor }]
  });
  const shared = [
    { personId: "person-tim", personName: "Tim", ratioBasisPoints: 2500, amountMinor: 250 },
    { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 7500, amountMinor: 750 }
  ];
  const entries = [entry("a", 1200), entry("b", 1000, shared), entry("c", 500)];

  const all = projectEntriesForView(entries, "household");
  const subset = projectEntriesForView([entries[0], entries[2]], "household");
  assert.equal(subset.rowEntries[0], all.rowEntries[0]);
  assert.equal(subset.rowEntries[1], all.rowEntries[2]);
  assert.equal(subset.aggregateEntries[0], all.aggregateEntries[0]);
  assert.deepEqual(all.rowEntries.map((row) => row.amountMinor), [1200, 1000, 500]);

  // A person view is a separate projection with that person's share.
  const tim = projectEntriesForView(entries, "person-tim");
  assert.notEqual(tim.rowEntries[1], all.rowEntries[1]);
  assert.equal(tim.rowEntries[1].amountMinor, 250);
  assert.equal(tim.rowEntries[1].grossAmountMinor, 1000);

  // Negative: an edited entry is a new object, so it gets a new projection.
  const edited = [entries[0], { ...entries[1], description: "Row b edited" }, entries[2]];
  const afterEdit = projectEntriesForView(edited, "household");
  assert.equal(afterEdit.rowEntries[0], all.rowEntries[0]);
  assert.notEqual(afterEdit.rowEntries[1], all.rowEntries[1]);
  assert.equal(afterEdit.rowEntries[1].description, "Row b edited");
});
