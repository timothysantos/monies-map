// The Ask page's side of the AI filter fallback (docs/flows/ask-flow.md
// "Search and filter"): the adapter that reads POST /api/ai-assist/filter
// (ask-filter-request.js) against the real Worker, and the check it makes
// again on this device: a reading is kept only if every value is a person,
// wallet, category or month the page itself knows, whatever the server
// sent. A failure of any kind is a calm "no reading", so the page keeps
// its existing note.
import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.ts";
import { readAskFilterResponse, requestAskFilter, shouldAskFilterAi } from "../src/client/ask-filter-request.js";
import { readFilterRequest } from "../src/client/ask-filter-reader.js";
import { createSeededTemplate, openSeededDatabase } from "./support/d1-workspace.mjs";

const context = {
  today: "2026-10-12",
  month: "2026-10",
  viewId: "person-ethan",
  scope: "direct_plus_shared",
  people: [{ id: "person-ethan", name: "Ethan" }, { id: "person-serene", name: "Serene" }],
  accounts: [
    { id: "acct-ocbc", name: "OCBC 360 Account", institution: "OCBC", isActive: true },
    { id: "acct-citi", name: "Citi Cash Back Card", institution: "Citibank", isActive: true },
    { id: "acct-old", name: "Old Debit Card", institution: "Old Bank", isActive: false }
  ],
  categories: [{ name: "Food & Drinks" }, { name: "Groceries" }, { name: "Transport" }]
};

const filter = (patch = {}) => ({
  month: "2026-09", viewId: "person-serene", scope: "shared", search: "koufu", categories: ["Groceries"], wallets: ["acct-citi"], type: "expense", minAmountMinor: 1250, maxAmountMinor: null, ...patch
});
const body = (reading) => ({ ok: true, supported: true, reading, ai: { requested: true, available: true } });

test("a reading made only of values the page knows is kept as is", () => {
  const reading = { kind: "filter", filter: filter() };
  assert.deepEqual(readAskFilterResponse(body(reading), context), reading);
  const question = {
    kind: "question",
    filter: filter({ categories: [] }),
    questions: [{ field: "category", reason: "unknown", word: "Grocery Runs", options: [{ key: "Groceries", label: "Groceries", patch: { categories: ["Groceries"] } }] }]
  };
  assert.deepEqual(readAskFilterResponse(body(question), context), question);
  assert.deepEqual(readAskFilterResponse(body({ kind: "unknown", reason: "category", word: "Crypto" }), context), { kind: "unknown", reason: "category", word: "Crypto" });
});

test("not supported, failed or malformed bodies are no reading", () => {
  assert.equal(readAskFilterResponse({ ok: true, supported: false, ai: { requested: false, available: false } }, context), null);
  assert.equal(readAskFilterResponse({ ok: false }, context), null);
  assert.equal(readAskFilterResponse(null, context), null);
  assert.equal(readAskFilterResponse("filter", context), null);
  assert.equal(readAskFilterResponse({ ok: true, supported: true }, context), null);
  assert.equal(readAskFilterResponse(body({ kind: "view", viewId: "person-serene" }), context), null);
});

test("a value the page does not know rejects the whole reading, even from a trusted route", () => {
  for (const bad of [
    filter({ viewId: "person-evil" }),
    filter({ categories: ["Cryptocurrency"] }),
    filter({ wallets: ["acct-unknown"] }),
    // Inactive wallets are not on the page's list.
    filter({ wallets: ["acct-old"] }),
    filter({ month: "September" }),
    filter({ month: "2026-13" }),
    filter({ scope: "everyone" }),
    filter({ type: "refund" }),
    filter({ search: 12 }),
    filter({ search: "x".repeat(81) }),
    filter({ minAmountMinor: -1 }),
    filter({ minAmountMinor: 12.5 }),
    filter({ maxAmountMinor: "50" }),
    filter({ minAmountMinor: 9000, maxAmountMinor: 100 }),
    filter({ categories: "Groceries" })
  ]) {
    assert.equal(readAskFilterResponse(body({ kind: "filter", filter: bad }), context), null, JSON.stringify(bad));
  }
  // The household has one scope.
  assert.equal(readAskFilterResponse(body({ kind: "filter", filter: filter({ viewId: "household", scope: "shared" }) }), context), null);
  assert.deepEqual(readAskFilterResponse(body({ kind: "filter", filter: filter({ viewId: "household", scope: "direct_plus_shared" }) }), context).filter.viewId, "household");
});

test("a chip may only patch the filter with values the page knows, and a question needs a chip", () => {
  const question = (questions) => body({ kind: "question", filter: filter({ categories: [] }), questions });
  const option = (patch) => ({ key: "k", label: "L", patch });
  const ask = (field, options, extra = {}) => ({ field, options, ...extra });
  assert.equal(readAskFilterResponse(question([ask("category", [option({ categories: ["Cryptocurrency"] })])]), context), null);
  assert.equal(readAskFilterResponse(question([ask("wallet", [option({ wallets: ["acct-evil"] })])]), context), null);
  assert.equal(readAskFilterResponse(question([ask("person", [option({ viewId: "person-evil", scope: "direct" })])]), context), null);
  assert.equal(readAskFilterResponse(question([ask("category", [option({ search: "drop everything" })])]), context), null);
  assert.equal(readAskFilterResponse(question([ask("category", [])]), context), null);
  assert.equal(readAskFilterResponse(question([]), context), null);
  assert.equal(readAskFilterResponse(question([ask("elsewhere", [option({ categories: ["Groceries"] })])]), context), null);
  assert.ok(readAskFilterResponse(question([ask("person", [option({ viewId: "household", scope: "direct_plus_shared" })])]), context));
});

test("AI is asked only for a request the rules read nothing from and that reads like a search", () => {
  // The rules reader's own "none" results.
  const none = (text) => readFilterRequest(text, context).kind === "none";
  assert.ok(none("what did we blow on takeaway lately?"));
  assert.equal(shouldAskFilterAi("what did we blow on takeaway lately?", { cardOpen: false }), true);
  assert.equal(shouldAskFilterAi("find hawker lunches?", { cardOpen: false }), true);
  // A year or a month key is not an amount.
  assert.equal(shouldAskFilterAi("what did we blow on takeaway in 2026-09?", { cardOpen: false }), true);
  // Not while an entry card is being filled.
  assert.equal(shouldAskFilterAi("show me the hawker lunches", { cardOpen: true }), false);
  // A sentence that reads as a new entry is the entry reader's, never AI's.
  for (const text of ["Koufu lunch $12.50", "see you at koufu $12.50", "how much was my $50 lunch with Serene?", "groceries", "split with Serene", "", "   ", "x".repeat(301)]) {
    assert.equal(shouldAskFilterAi(text, { cardOpen: false }), false, text);
  }
});

let showcase;
test.before(async () => {
  showcase = await createSeededTemplate({ vars: { DEMO_DATASET: "showcase", DEMO_SEED_MONTH: "2026-05" } });
});
test.after(async () => {
  await showcase?.dispose();
});

function workersAi(reading) {
  return { async run() { return { choices: [{ message: { role: "assistant", content: JSON.stringify(reading) } }] }; } };
}

const proposal = (patch = {}) => ({ readable: true, month: null, person: null, scope: null, search: null, categories: [], wallets: [], type: null, minAmount: null, maxAmount: null, ...patch });

test("requestAskFilter reads the real route's validated filter; every failure is a calm no reading", async (t) => {
  const { db } = await openSeededDatabase(t, showcase);
  const real = {
    people: [{ id: "person-ethan", name: "Ethan" }, { id: "person-serene", name: "Serene" }],
    accounts: [],
    categories: [{ name: "Food & Drinks" }, { name: "Groceries" }]
  };
  const via = (env) => (url, init) => worker.fetch(new Request(new URL(url, "http://127.0.0.1"), init), { DB: db, ...showcase.config.vars, ...env });
  const on = via({ AI_ASSIST_ENABLED: "true", AI: workersAi(proposal({ month: "2026-04", person: "Serene", categories: ["Groceries"], minAmount: 20 })) });
  const result = await requestAskFilter({ text: "show what serene spent on food shopping in april over 20", viewId: "person-ethan", scope: "direct_plus_shared", month: "2026-05", context: real, fetchImpl: on });
  assert.deepEqual(result, {
    ok: true,
    reading: {
      kind: "filter",
      filter: { month: "2026-04", viewId: "person-serene", scope: "direct_plus_shared", search: "", categories: ["Groceries"], wallets: [], type: "", minAmountMinor: 2000, maxAmountMinor: null }
    }
  });

  // AI off on the server: no reading, not a failure.
  const off = await requestAskFilter({ text: "show what serene spent on food shopping", viewId: "person-ethan", scope: "direct_plus_shared", month: "2026-05", context: real, fetchImpl: via({}) });
  assert.deepEqual(off, { ok: true, reading: null });
  // The route's own invented category never gets past the page either.
  const invented = await requestAskFilter({ text: "show crypto things", viewId: "person-ethan", scope: "direct_plus_shared", month: "2026-05", context: real, fetchImpl: via({ AI_ASSIST_ENABLED: "true", AI: workersAi(proposal({ categories: ["Cryptocurrency"] })) }) });
  assert.deepEqual(invented, { ok: true, reading: { kind: "unknown", reason: "category", word: "Cryptocurrency" } });

  assert.deepEqual(await requestAskFilter({ text: "show it", viewId: "household", context: real, fetchImpl: async () => { throw new TypeError("offline"); } }), { ok: false, reason: "network" });
  assert.deepEqual(await requestAskFilter({ text: "show it", viewId: "household", context: real, fetchImpl: async () => new Response("oops", { status: 500 }) }), { ok: false, reason: "failed" });
  assert.deepEqual(await requestAskFilter({ text: "show it", viewId: "household", context: real, fetchImpl: async () => new Response("{}", { status: 404 }) }), { ok: false, reason: "unavailable" });
  assert.deepEqual(await requestAskFilter({ text: "show it", viewId: "household", context: real, fetchImpl: async () => new Response("not json", { status: 200 }) }), { ok: true, reading: null });
  await assert.rejects(
    requestAskFilter({ text: "show it", viewId: "household", context: real, fetchImpl: async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); } }),
    { name: "AbortError" }
  );
});
