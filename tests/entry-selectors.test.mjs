import assert from "node:assert/strict";
import test from "node:test";

import {
  categoryMatchesEntryFilter,
  countActiveEntryFilters,
  normalizeEntryFilterValues
} from "../src/client/entry-filter-values.js";

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
    type: ""
  }), 2);
});
