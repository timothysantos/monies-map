// The category list's order and search (design.md "Category list"): the best
// guess first, every other category alphabetically, the current one checked
// wherever it sits, and a search over names and everyday words. The category
// names are the demo seed's.
import assert from "node:assert/strict";
import test from "node:test";

import { categories } from "../src/domain/demo-data.ts";
import { buildCategoryList, flattenCategoryList, foldForSearch } from "../src/client/category-pick-model.js";

const options = categories.filter((category) => category.name !== "Transfer").map((category) => ({ value: category.name, label: category.name }));
const labels = (items) => items.map((item) => item.label);

test("no best guess: a plain alphabetical list with the current category checked", () => {
  const list = buildCategoryList({ options, value: "Groceries" });
  assert.equal(list.best, null);
  assert.deepEqual(labels(list.rest), [...labels(options)].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base", numeric: true })));
  assert.deepEqual(list.rest.filter((item) => item.isCurrent).map((item) => item.label), ["Groceries"]);
  assert.equal(list.rest.length, options.length);
});

test("the best guess is first and leaves the alphabetical rest; the current category stays checked wherever it is", () => {
  const list = buildCategoryList({ options, value: "Other", bestGuess: "Groceries" });
  assert.equal(list.best.label, "Groceries");
  assert.equal(list.best.isCurrent, false);
  assert.ok(!labels(list.rest).includes("Groceries"), "a category is listed once");
  assert.equal(list.rest.length, options.length - 1);
  assert.deepEqual(list.rest.filter((item) => item.isCurrent).map((item) => item.label), ["Other"]);
  assert.equal(flattenCategoryList(list)[0].label, "Groceries");
});

test("when the current category is the best guess it stays first, checked", () => {
  const list = buildCategoryList({ options, value: "Taxi", bestGuess: "Taxi" });
  assert.deepEqual([list.best.label, list.best.isCurrent], ["Taxi", true]);
  assert.equal(list.rest.some((item) => item.isCurrent), false);
});

test("Other, Transfer and a category the list does not have are never put first", () => {
  assert.equal(buildCategoryList({ options, bestGuess: "Other" }).best, null);
  assert.equal(buildCategoryList({ options, bestGuess: "Other - Income" }).best, null);
  assert.equal(buildCategoryList({ options, bestGuess: "Transfer" }).best, null);
  assert.equal(buildCategoryList({ options, bestGuess: "Mortgage" }).best, null);
  assert.equal(buildCategoryList({ options, bestGuess: "Mortgage" }).rest.length, options.length);
});

test("search matches names, case-insensitively, and the 'and' for '&'", () => {
  assert.deepEqual(labels(buildCategoryList({ options, query: "GROCER" }).rest), ["Groceries"]);
  assert.ok(labels(buildCategoryList({ options, query: "food and" }).rest).includes("Food & Drinks"));
  assert.ok(labels(buildCategoryList({ options, query: "food &" }).rest).includes("Food & Drinks"));
  assert.equal(foldForSearch("  Café  &  Bar "), "cafe and bar");
});

test("everyday words find the category: kopi and coffee reach Food & Drinks, mrt reaches Public Transport", () => {
  assert.equal(buildCategoryList({ options, query: "kopi" }).rest[0].label, "Food & Drinks");
  assert.deepEqual(labels(buildCategoryList({ options, query: "coffee" }).rest), ["Food & Drinks"]);
  assert.deepEqual(labels(buildCategoryList({ options, query: "mrt" }).rest), ["Public Transport"]);
  assert.deepEqual(labels(buildCategoryList({ options, query: "netflix" }).rest), ["Subscriptions MO", "Subscriptions YR"].filter((name) => name === "Subscriptions MO"));
});

test("a name match ranks above an everyday-word match, then alphabetical", () => {
  const result = labels(buildCategoryList({ options, query: "tax" }).rest);
  assert.equal(result[0], "Tax");
  assert.ok(result.includes("Taxi"));
  assert.ok(result.indexOf("Tax") < result.indexOf("Taxi"));
});

test("the best guess stays first only while it matches the search", () => {
  const matching = buildCategoryList({ options, bestGuess: "Food & Drinks", query: "coffee" });
  assert.equal(matching.best.label, "Food & Drinks");
  const other = buildCategoryList({ options, bestGuess: "Food & Drinks", query: "gro" });
  assert.equal(other.best, null);
  assert.deepEqual(labels(other.rest), ["Groceries"]);
});

test("nothing matching is an empty list, and pinned rows always stay", () => {
  const list = buildCategoryList({ options, query: "zzzz", pinned: [{ value: "", label: "All categories" }], value: "" });
  assert.equal(list.isEmpty, true);
  assert.deepEqual(list.pinned.map((item) => [item.label, item.isCurrent]), [["All categories", true]]);
  assert.deepEqual(labels(flattenCategoryList(list)), ["All categories"]);
});

test("sorting is locale-aware and numeric: accents fold, '2' comes before '10'", () => {
  const odd = ["Zebra", "Éclair", "eggs", "Item 10", "Item 2"].map((label) => ({ value: label, label }));
  assert.deepEqual(labels(buildCategoryList({ options: odd }).rest), ["Éclair", "eggs", "Item 2", "Item 10", "Zebra"]);
});

test("several checked values (a filter) are all marked", () => {
  const list = buildCategoryList({ options, value: ["Groceries", "Taxi"] });
  assert.deepEqual(list.rest.filter((item) => item.isCurrent).map((item) => item.label), ["Groceries", "Taxi"]);
});
