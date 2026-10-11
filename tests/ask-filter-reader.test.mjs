// The Ask page's filter reader (src/client/ask-filter-reader.js): a typed
// request read into an Entries filter from the reference data the page
// already has. Ambiguity becomes a follow-up question with chips, never a
// guess; an entry sentence or a question it cannot read is left alone.
import assert from "node:assert/strict";
import test from "node:test";

import { isQueryForm, readFilterRequest } from "../src/client/ask-filter-reader.js";

const categories = [
  "Income", "Transfer", "Savings", "Investments", "Salary", "Extra Income", "Other - Income", "Subscriptions MO",
  "Subscriptions YR", "Food & Drinks", "Shopping", "Family & Personal", "Baby & Kids", "Home", "Church", "Tax",
  "Groceries", "Travel", "Loans", "Sports & Hobbies", "Bills", "Education", "Insurance", "Fees", "Beauty",
  "Entertainment", "Healthcare", "Gifts", "Other", "Public Transport", "Taxi", "Freelance Income", "Pet Care"
].map((name) => ({ name }));

const accounts = [
  { id: "acct-ocbc-360", name: "OCBC 360 Account", institution: "OCBC", kind: "bank", isActive: true },
  { id: "acct-uob-one", name: "UOB One Account", institution: "UOB", kind: "bank", isActive: true },
  { id: "acct-posb-joint", name: "POSB Joint Account", institution: "DBS", kind: "bank", isActive: true },
  { id: "acct-citi-cash-back", name: "Citi Cash Back Card", institution: "Citibank", kind: "credit_card", isActive: true },
  { id: "acct-citi-rewards", name: "Citi Rewards Card", institution: "Citibank", kind: "credit_card", isActive: true },
  { id: "acct-uob-prvi", name: "UOB PRVI Miles Card", institution: "UOB", kind: "credit_card", isActive: true },
  { id: "acct-ocbc-365", name: "OCBC 365 Card", institution: "OCBC", kind: "credit_card", isActive: true },
  { id: "acct-old", name: "Old Grab Wallet", institution: "Grab", kind: "wallet", isActive: false }
];

const people = [{ id: "person-ethan", name: "Ethan" }, { id: "person-serene", name: "Serene" }];

const context = {
  today: "2026-10-11",
  month: "2026-10",
  viewId: "person-ethan",
  scope: "direct_plus_shared",
  people,
  accounts,
  categories
};

function filter(overrides = {}) {
  return {
    month: "2026-10",
    viewId: "person-ethan",
    scope: "direct_plus_shared",
    search: "",
    categories: [],
    wallets: [],
    type: "",
    minAmountMinor: null,
    maxAmountMinor: null,
    ...overrides
  };
}

const scenarios = [
  ["grab rides in september", filter({ month: "2026-09", search: "grab" })],
  ["serene's shared groceries last month", filter({ month: "2026-09", viewId: "person-serene", scope: "shared", categories: ["Groceries"] })],
  ["Serene’s shared groceries last month", filter({ month: "2026-09", viewId: "person-serene", scope: "shared", categories: ["Groceries"] })],
  ["income in aug", filter({ month: "2026-08", type: "income" })],
  ["transfers to POSB", filter({ type: "transfer", wallets: ["acct-posb-joint"] })],
  ["food over $50 this month", filter({ categories: ["Food & Drinks"], minAmountMinor: 5000 })],
  ["show my citi cash back card spending", filter({ wallets: ["acct-citi-cash-back"], type: "expense" })],
  ["How much on public transport?", filter({ categories: ["Public Transport"] })],
  ["public transport Sep 2026", filter({ month: "2026-09", categories: ["Public Transport"] })],
  ["taxi in 2026-07", filter({ month: "2026-07", categories: ["Taxi"] })],
  ["what did I spend in december", filter({ month: "2025-12", type: "expense" })],
  ["uob one account in may 2026", filter({ month: "2026-05", wallets: ["acct-uob-one"] })],
  ["food between $20 and $50", filter({ categories: ["Food & Drinks"], minAmountMinor: 2000, maxAmountMinor: 5000 })],
  ["groceries under 30", filter({ categories: ["Groceries"], maxAmountMinor: 3000 })],
  ["what did I spend yesterday?", filter({ type: "expense", search: "2026-10-10" })],
  ["pet care", filter({ categories: ["Pet Care"] })],
  ["other income in september", filter({ month: "2026-09", categories: ["Other - Income"] })],
  ["household groceries", filter({ viewId: "household", categories: ["Groceries"] })],
  ["my direct shopping", filter({ scope: "direct", categories: ["Shopping"] })],
  ["find koufu", filter({ search: "koufu" })],
  ["savings last month", filter({ month: "2026-09", categories: ["Savings"] })]
];

for (const [text, expected] of scenarios) {
  test(`reads "${text}" into an Entries filter`, () => {
    const result = readFilterRequest(text, context);
    assert.equal(result.kind, "filter", JSON.stringify(result));
    assert.deepEqual(result.filter, expected);
  });
}

test("a scope word keeps the month and view the page is looking at", () => {
  const result = readFilterRequest("shared groceries", { ...context, month: "2026-08", viewId: "person-serene" });
  assert.deepEqual(result, { kind: "filter", filter: filter({ month: "2026-08", viewId: "person-serene", scope: "shared", categories: ["Groceries"] }) });
});

test("without a scope word the person's own view keeps the page's scope, another person's starts at Direct + Shared", () => {
  assert.equal(readFilterRequest("groceries", { ...context, scope: "shared" }).filter.scope, "shared");
  assert.equal(readFilterRequest("serene's groceries", { ...context, scope: "shared" }).filter.scope, "direct_plus_shared");
});

test("a wallet name that fits two wallets asks which, with an All of them chip", () => {
  const result = readFilterRequest("show my citi card spending", context);
  assert.equal(result.kind, "question");
  assert.deepEqual(result.filter, filter({ type: "expense" }));
  assert.equal(result.questions.length, 1);
  assert.equal(result.questions[0].field, "wallet");
  assert.deepEqual(result.questions[0].options.map((option) => option.label), ["Citi Cash Back Card", "Citi Rewards Card", "All of them"]);
  assert.deepEqual(result.questions[0].options[2].patch, { wallets: ["acct-citi-cash-back", "acct-citi-rewards"] });
});

test("an inactive wallet is never offered", () => {
  const result = readFilterRequest("grab in september", context);
  assert.deepEqual(result, { kind: "filter", filter: filter({ month: "2026-09", search: "grab" }) });
});

test("two months ask which one: Entries shows one month at a time", () => {
  const result = readFilterRequest("income in aug and sep", context);
  assert.equal(result.kind, "question");
  assert.deepEqual(result.filter, filter({ type: "income" }));
  assert.equal(result.questions[0].field, "month");
  assert.deepEqual(result.questions[0].options.map((option) => [option.label, option.patch]), [
    ["Aug 2026", { month: "2026-08" }],
    ["Sep 2026", { month: "2026-09" }]
  ]);
});

test("a word that fits two categories asks which, and every open question waits its turn", () => {
  const result = readFilterRequest("uob subscriptions", context);
  assert.equal(result.kind, "question");
  assert.deepEqual(result.questions.map((question) => question.field), ["wallet", "category"]);
  assert.deepEqual(result.questions[1].options.map((option) => option.label), ["Subscriptions MO", "Subscriptions YR", "All of them"]);
});

test("an unknown category named as a category is never guessed", () => {
  assert.deepEqual(readFilterRequest("show the crypto category", context), { kind: "unknown", reason: "category", word: "crypto" });
  const near = readFilterRequest("groceriez category", context);
  assert.equal(near.kind, "question");
  assert.equal(near.questions[0].field, "category");
  assert.equal(near.questions[0].reason, "unknown");
  assert.equal(near.questions[0].word, "groceriez");
  assert.deepEqual(near.questions[0].options.map((option) => option.label), ["Groceries"]);
});

test("two people ask whose entries", () => {
  const result = readFilterRequest("ethan and serene's groceries", context);
  assert.equal(result.kind, "question");
  assert.equal(result.questions[0].field, "person");
  assert.deepEqual(result.questions[0].options.map((option) => [option.label, option.patch]), [
    ["Ethan", { viewId: "person-ethan", scope: "direct_plus_shared" }],
    ["Serene", { viewId: "person-serene", scope: "direct_plus_shared" }],
    ["Household", { viewId: "household", scope: "direct_plus_shared" }]
  ]);
});

test("a scope on the household view asks whose: the household has no scope", () => {
  const result = readFilterRequest("shared groceries", { ...context, viewId: "household" });
  assert.equal(result.kind, "question");
  assert.equal(result.questions[0].field, "person");
  assert.deepEqual(result.questions[0].options.map((option) => [option.label, option.patch]), [
    ["Ethan · Shared", { viewId: "person-ethan", scope: "shared" }],
    ["Serene · Shared", { viewId: "person-serene", scope: "shared" }]
  ]);
});

test("view and scope requests become a view change for a chip, never a silent switch", () => {
  assert.deepEqual(readFilterRequest("switch to Serene", context), { kind: "view", viewId: "person-serene", scope: "direct_plus_shared" });
  assert.deepEqual(readFilterRequest("household view", context), { kind: "view", viewId: "household", scope: "direct_plus_shared" });
  assert.deepEqual(readFilterRequest("shared only", context), { kind: "view", viewId: "person-ethan", scope: "shared" });
  assert.deepEqual(readFilterRequest("show serene's direct", context), { kind: "view", viewId: "person-serene", scope: "direct" });
  const household = readFilterRequest("shared only", { ...context, viewId: "household" });
  assert.equal(household.kind, "question");
  assert.equal(household.questions[0].field, "person");
});

test("entry sentences are left to the entry reader", () => {
  for (const text of ["Koufu lunch $12.50, citi", "grab $15 yesterday", "lunch yesterday", "Salary 5000", "koufu lunch citi", "Paid 30 for taxi"]) {
    assert.deepEqual(readFilterRequest(text, context), { kind: "none" }, text);
  }
});

test("questions it cannot read are left for the not-answered note", () => {
  for (const text of ["Am I on track?", "why?", "How are we doing", "", "   "]) {
    assert.deepEqual(readFilterRequest(text, context), { kind: "none" }, text);
  }
});

test("while a card is being filled, a plain sentence is a change to it, not a search", () => {
  const open = { cardOpen: true };
  for (const text of ["groceries", "Citi cash back", "make it food", "transfers", "split with Serene", "make it shared", "household"]) {
    assert.deepEqual(readFilterRequest(text, context, open), { kind: "none" }, text);
  }
  assert.deepEqual(readFilterRequest("serene's shared groceries last month", context, open), {
    kind: "filter",
    filter: filter({ month: "2026-09", viewId: "person-serene", scope: "shared", categories: ["Groceries"] })
  });
  assert.equal(readFilterRequest("how much on bills?", context, open).kind, "filter");
  assert.equal(readFilterRequest("food over $50", context, open).kind, "filter");
});

test("isQueryForm tells a question or a search command from an entry sentence", () => {
  assert.equal(isQueryForm("show my citi card spending"), true);
  assert.equal(isQueryForm("How much on food?"), true);
  assert.equal(isQueryForm("transfers to POSB?"), true);
  assert.equal(isQueryForm("Koufu lunch $12.50"), false);
  assert.equal(isQueryForm("grab rides in september"), false);
});
