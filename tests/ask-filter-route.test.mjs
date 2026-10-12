// POST /api/ai-assist/filter through the real Worker and a real local D1
// seeded with the showcase household (Ethan and Serene). It is the optional
// AI reading of a filter request the rules reader could not read
// (AGENTS.md "Optional AI Assistance"): the model proposes an Entries filter
// from names only, the app validates every value against the household's own
// categories, wallets and people, and AI off, out of allowance, failing,
// slow or malformed is simply { supported: false } so the page keeps its
// existing note. Nothing is stored but the shared allowance counter.
import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.ts";
import { assertSameDatabase, createSeededTemplate, dumpDatabase, openSeededDatabase, rows } from "./support/d1-workspace.mjs";

let showcase;
test.before(async () => {
  showcase = await createSeededTemplate({ vars: { DEMO_DATASET: "showcase", DEMO_SEED_MONTH: "2026-05" } });
});
test.after(async () => {
  await showcase?.dispose();
});

function stubAi(reply) {
  const calls = [];
  return {
    calls,
    async run(model, input) {
      calls.push({ model, input });
      const value = typeof reply === "function" ? reply(input) : reply;
      if (value instanceof Error) throw value;
      return { choices: [{ message: { role: "assistant", content: typeof value === "string" ? value : JSON.stringify(value) } }] };
    }
  };
}

const proposal = (patch = {}) => ({
  readable: true, month: null, person: null, scope: null, search: null, categories: [], wallets: [], type: null, minAmount: null, maxAmount: null, ...patch
});

async function askFilter(db, ai, body, vars = {}, method = "POST") {
  const env = { DB: db, ...showcase.config.vars, AI_ASSIST_ENABLED: "true", ...(ai ? { AI: ai } : {}), ...vars };
  const response = await worker.fetch(new Request("http://127.0.0.1/api/ai-assist/filter", {
    method,
    headers: { "content-type": "application/json" },
    ...(method === "POST" ? { body: JSON.stringify({ viewId: "person-ethan", month: "2026-05", scope: "direct_plus_shared", ...body }) } : {})
  }), env);
  return { status: response.status, payload: await response.json() };
}

async function usedUnits(db) {
  const row = await db.prepare("SELECT SUM(used_units) AS used FROM ai_assist_daily_usage").first();
  return Number(row?.used ?? 0);
}

const REQUEST = "what did serene pay for lunch at the hawker centre last month on the citi card, over 12 bucks?";

test("a valid proposal becomes a validated filter with ids; one unit; only the allowance counter changes", async (t) => {
  const { db } = await openSeededDatabase(t, showcase);
  const [citi] = await rows(db, "SELECT id FROM accounts WHERE account_name = ?", "Citi Cash Back Card");
  const ai = stubAi(proposal({ month: "2026-04", person: "Serene", search: "hawker", categories: ["food & drinks"], wallets: ["Citi Cash Back Card"], type: "expense", minAmount: 12 }));
  const before = await dumpDatabase(db);
  const { status, payload } = await askFilter(db, ai, { text: REQUEST });
  assert.equal(status, 200);
  assert.deepEqual(payload, {
    ok: true,
    supported: true,
    reading: {
      kind: "filter",
      filter: {
        month: "2026-04",
        viewId: "person-serene",
        scope: "direct_plus_shared",
        search: "hawker",
        categories: ["Food & Drinks"],
        wallets: [citi.id],
        type: "expense",
        minAmountMinor: 1200,
        maxAmountMinor: null
      }
    },
    ai: { requested: true, available: true, remaining: payload.ai.remaining }
  });
  assert.ok(Number.isInteger(payload.ai.remaining));

  assert.equal(ai.calls.length, 1);
  const prompt = ai.calls[0].input.messages.at(-1).content;
  assert.match(prompt, /<request>what did serene pay for lunch/);
  // Names only: no ids and no figures from the household's ledger.
  assert.ok(prompt.includes('"Citi Cash Back Card"') && prompt.includes('"Food & Drinks"') && prompt.includes('"Serene"'));
  assert.doesNotMatch(prompt, /acct-|person-|cat-|txn-|entry-|"id"/);
  assert.ok(prompt.length < 2500, `prompt is ${prompt.length} characters`);
  assert.equal(await usedUnits(db), 1);
  const after = await dumpDatabase(db);
  const changed = Object.keys(after).filter((table) => JSON.stringify(after[table]) !== JSON.stringify(before[table]));
  assert.deepEqual(changed, ["ai_assist_daily_usage"]);
});

test("an invented category is rejected and never reaches the filter", async (t) => {
  const { db } = await openSeededDatabase(t, showcase);
  const unknown = await askFilter(db, stubAi(proposal({ categories: ["Cryptocurrency"] })), { text: REQUEST });
  assert.deepEqual(unknown.payload.reading, { kind: "unknown", reason: "category", word: "Cryptocurrency" });

  const near = await askFilter(db, stubAi(proposal({ categories: ["Grocery Runs"], search: "weekly" })), { text: REQUEST });
  assert.equal(near.payload.reading.kind, "question");
  assert.deepEqual(near.payload.reading.filter.categories, []);
  assert.equal(near.payload.reading.questions[0].field, "category");
  assert.ok(near.payload.reading.questions[0].options.some((option) => option.key === "Groceries"));
  assert.ok(near.payload.reading.questions[0].options.every((option) => ["Groceries", "Food & Drinks", "Other"].includes(option.key) || /groc/i.test(option.key)));
});

test("ids, an unknown wallet and an unknown person never become a filter value", async (t) => {
  const { db } = await openSeededDatabase(t, showcase);
  const [citi] = await rows(db, "SELECT id FROM accounts WHERE account_name = ?", "Citi Cash Back Card");
  // A wallet id is not a wallet name: at most a chip the person can pick.
  const byId = await askFilter(db, stubAi(proposal({ wallets: [citi.id], type: "expense" })), { text: REQUEST });
  assert.deepEqual(byId.payload.reading?.filter?.wallets ?? [], []);
  assert.notEqual(byId.payload.reading?.kind, "filter");
  // An unknown wallet with no near name.
  const unknownWallet = await askFilter(db, stubAi(proposal({ wallets: ["Monzo"], type: "expense" })), { text: REQUEST });
  assert.equal(unknownWallet.payload.supported, false);
  // An unknown person asks who.
  const person = await askFilter(db, stubAi(proposal({ person: "Marcus", categories: ["Groceries"] })), { text: REQUEST });
  assert.equal(person.payload.reading.kind, "question");
  assert.equal(person.payload.reading.filter.viewId, "person-ethan");
  assert.deepEqual(person.payload.reading.questions[0].options.map((option) => option.key), ["person-ethan", "person-serene", "household"]);
});

test("extra fields in the reply are ignored and the wallet and view always come back as the app's own ids", async (t) => {
  const { db } = await openSeededDatabase(t, showcase);
  const ai = stubAi({ ...proposal({ categories: ["Groceries"], person: "household" }), viewId: "person-evil", sql: "DROP TABLE entries", filter: { month: "1999-01" } });
  const { payload } = await askFilter(db, ai, { text: REQUEST });
  assert.equal(payload.reading.kind, "filter");
  assert.deepEqual(payload.reading.filter, {
    month: "2026-05", viewId: "household", scope: "direct_plus_shared", search: "", categories: ["Groceries"], wallets: [], type: "", minAmountMinor: null, maxAmountMinor: null
  });
});

test("AI off or not configured: not supported, no model call, no unit, nothing written", async (t) => {
  const { db, api } = await openSeededDatabase(t, showcase);
  const before = await dumpDatabase(db);
  const off = await api("/api/ai-assist/filter", { text: REQUEST, viewId: "person-ethan", month: "2026-05" });
  assert.equal(off.status, 200);
  assert.deepEqual(off.payload, { ok: true, supported: false, ai: { requested: false, available: false, reason: "AI assistance is turned off." } });
  const ai = stubAi(proposal({ categories: ["Groceries"] }));
  const disabled = await askFilter(db, ai, { text: REQUEST }, { AI_ASSIST_ENABLED: "false" });
  assert.equal(disabled.payload.supported, false);
  assert.equal(ai.calls.length, 0);
  const unconfigured = await askFilter(db, null, { text: REQUEST });
  assert.deepEqual(unconfigured.payload, { ok: true, supported: false, ai: { requested: false, available: false, reason: "AI assistance is not configured for this environment." } });
  assertSameDatabase(await dumpDatabase(db), before);
});

test("a failing, slow, malformed or not-a-search reply is not supported, never an error screen", async (t) => {
  const { db } = await openSeededDatabase(t, showcase);
  for (const reply of [
    new Error("model down"),
    "not json at all",
    { filter: { categories: ["Groceries"] } },
    "[]",
    proposal({ readable: false, categories: ["Groceries"] }),
    proposal({ month: "2026-13", categories: ["Groceries"] }),
    proposal({ type: "refund", categories: ["Groceries"] }),
    proposal({ minAmount: 500, maxAmount: 5, categories: ["Groceries"] }),
    proposal()
  ]) {
    const { status, payload } = await askFilter(db, stubAi(reply), { text: REQUEST });
    assert.equal(status, 200, String(reply));
    assert.equal(payload.supported, false, JSON.stringify(reply));
    assert.equal(payload.reading, undefined);
    assert.equal(payload.ai.requested, true);
    assert.equal(payload.ai.available, false);
  }
});

test("out of allowance: not supported, and the model is not called again", async (t) => {
  const { db } = await openSeededDatabase(t, showcase);
  const ai = stubAi(proposal({ categories: ["Groceries"] }));
  // The smallest daily limit is 4 units.
  for (let index = 0; index < 4; index += 1) {
    const used = await askFilter(db, ai, { text: REQUEST }, { AI_ASSIST_DAILY_LIMIT: "4" });
    assert.equal(used.payload.supported, true);
  }
  const calls = ai.calls.length;
  const over = await askFilter(db, ai, { text: REQUEST }, { AI_ASSIST_DAILY_LIMIT: "4" });
  assert.equal(over.payload.supported, false);
  assert.equal(over.payload.ai.available, false);
  assert.equal(over.payload.ai.remaining, 0);
  assert.equal(ai.calls.length, calls);
});

test("a money question the answer reader already reads never reaches this route's AI", async (t) => {
  const { db } = await openSeededDatabase(t, showcase);
  const ai = stubAi(proposal({ categories: ["Groceries"] }));
  const { payload } = await askFilter(db, ai, { text: "why was March so expensive?" });
  assert.deepEqual(payload, { ok: true, supported: false, ai: { requested: false, available: false } });
  assert.equal(ai.calls.length, 0);
  assert.equal(await usedUnits(db), 0);
});

test("a bad request is refused before anything is read", async (t) => {
  const { db } = await openSeededDatabase(t, showcase);
  const ai = stubAi(proposal({ categories: ["Groceries"] }));
  assert.equal((await askFilter(db, ai, { text: "" })).status, 400);
  assert.equal((await askFilter(db, ai, { text: "x".repeat(301) })).status, 400);
  assert.equal((await askFilter(db, ai, {}, {}, "GET")).status, 405);
  assert.equal(ai.calls.length, 0);
});

test("Claude goes first when configured, asked for one unit with this schema, and its answer is validated like any other", async (t) => {
  const { db } = await openSeededDatabase(t, showcase);
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({
      id: "msg_test",
      type: "message",
      role: "assistant",
      stop_reason: "end_turn",
      usage: { input_tokens: 300, output_tokens: 60 },
      content: [{ type: "text", text: JSON.stringify(proposal({ categories: ["Cryptocurrency"] })) }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const ai = stubAi(proposal({ categories: ["Groceries"] }));
  const { payload } = await askFilter(db, ai, { text: REQUEST }, {
    AI_GATEWAY_ACCOUNT_ID: "acct123",
    AI_GATEWAY_ID: "monies-map",
    AI_GATEWAY_TOKEN: "cf-gateway-token"
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /gateway\.ai\.cloudflare\.com/);
  assert.match(JSON.stringify(calls[0].body), /Read it into a filter for the Entries list/);
  assert.equal(ai.calls.length, 0);
  assert.equal(await usedUnits(db), 1);
  // Claude's invented category is rejected, not passed on.
  assert.deepEqual(payload.reading, { kind: "unknown", reason: "category", word: "Cryptocurrency" });
  assert.equal(payload.ai.available, true);
});
