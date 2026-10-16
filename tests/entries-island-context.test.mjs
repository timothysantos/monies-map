// The phone island's contextual line for Entries: what the filters say in
// plain words, how many entries they leave, and which filters count as
// applied (a default list has none, so the island looks as it always did).
import assert from "node:assert/strict";
import test from "node:test";

const { buildEntriesIslandContext, ISLAND_SEARCH_MAX } = await import("../src/client/entries-island-context.js");

const none = { entryIds: [], wallets: [], categories: [], type: "", search: "", minAmountMinor: null, maxAmountMinor: null, investmentMovesIn: false, figure: "" };
const build = (filters, extra = {}) => buildEntriesIslandContext({ entryFilters: { ...none, ...filters }, entryCount: 12, ...extra });

test("a default list has no contextual line", () => {
  assert.equal(build({}), null);
  assert.equal(build({ search: "   " }), null);
  assert.equal(build({ categories: [], wallets: [] }), null);
});

test("one category reads as its name and the entry count", () => {
  const context = build({ categories: ["Food & Drinks"] });
  assert.equal(context.text, "Food & Drinks · 12 entries");
  assert.equal(context.announce, "Filtered by Food & Drinks, 12 entries");
  assert.equal(context.filterCount, 1);
});

test("several categories read as the first name and how many more", () => {
  assert.equal(build({ categories: ["Food & Drinks", "Taxi"] }).text, "Food & Drinks +1 · 12 entries");
  assert.equal(build({ categories: ["A", "B", "C"] }).text, "A +2 · 12 entries");
});

test("search says Searching and quotes the words when it is the only filter", () => {
  assert.equal(build({ search: "coffee" }, { entryCount: 4 }).text, "Searching “coffee” · 4 entries");
});

test("two filters are listed together; three or more are only counted", () => {
  assert.equal(build({ categories: ["Taxi"], type: "expense" }).text, "Taxi, Spending · 12 entries");
  assert.equal(build({ categories: ["Taxi"], search: "grab" }).text, "Taxi, “grab” · 12 entries");
  const three = build({ categories: ["Taxi"], type: "expense", search: "grab" });
  assert.equal(three.text, "3 filters · 12 entries");
  assert.equal(three.announce, "Filtered by 3 filters, 12 entries");
  assert.equal(three.filterCount, 3);
});

test("singular, plural and empty counts", () => {
  assert.equal(build({ type: "income" }, { entryCount: 1 }).text, "Income · 1 entry");
  assert.equal(build({ type: "income" }, { entryCount: 0 }).text, "Income · No entries");
});

test("accounts use the account's name, not its id", () => {
  const wallets = [{ value: "acc-1", label: "UOB One" }, { value: "acc-2", label: "OCBC 365" }];
  assert.equal(build({ wallets: ["acc-1"] }, { wallets }).text, "UOB One · 12 entries");
  assert.equal(build({ wallets: ["acc-1", "acc-2"] }, { wallets }).text, "UOB One +1 · 12 entries");
  assert.equal(build({ wallets: ["gone"] }, { wallets }).text, "gone · 12 entries");
});

test("long search words are cut with an ellipsis; spaces collapse; quotes go; markup stays literal text", () => {
  assert.equal(ISLAND_SEARCH_MAX, 21);
  assert.equal(
    build({ search: "a very long search phrase about coffee beans and more" }).text,
    "Searching “a very long search p…” · 12 entries"
  );
  assert.equal(build({ search: "  hot \n  “coffee”  " }).text, "Searching “hot coffee” · 12 entries");
  assert.equal(build({ search: "<b>x</b>" }).text, "Searching “<b>x</b>” · 12 entries");
});

test("amount, picked entries, figure and a period count as filters but never show an amount", () => {
  assert.equal(build({ minAmountMinor: 5000 }).text, "Amount range · 12 entries");
  assert.equal(build({ entryIds: ["e1", "e2"] }).text, "Picked entries · 12 entries");
  assert.equal(build({ figure: "invested" }).text, "Invested · 12 entries");
  assert.equal(build({}, { hasPeriod: true }).text, "Several months · 12 entries");
  assert.doesNotMatch(build({ minAmountMinor: 5000, maxAmountMinor: 9000 }).text, /\$|\d{3}/);
});

test("a long category name is cut with an ellipsis", () => {
  const text = build({ categories: ["Household Appliances and Furniture Purchases"] }).text;
  assert.match(text, /^Household Appliances an…( ·|$)/);
});
