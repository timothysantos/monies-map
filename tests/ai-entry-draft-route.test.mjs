import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.ts";
import { handleAiAssistRoute } from "../src/server/ai-assistance-routes.ts";
import { todayInAppTimeZone } from "../src/lib/app-calendar.ts";

// POST /api/ai-assist/entry-draft: the deterministic entry draft always comes
// back, whatever AI does. AI is asked only when the sentence left the amount
// or the description missing, and its answer is merged only after it passes
// the same validation as any input. Nothing is written but the shared daily
// allowance counter, and only when AI is actually asked.

const ACCOUNT_ROWS = [
  ["acct-ocbc-360", "OCBC", "person-ethan", "Ethan", "OCBC 360 Account", "bank", 0],
  ["acct-posb-joint", "DBS", null, null, "POSB Joint Account", "bank", 1],
  ["acct-citi-cash-back", "Citibank", "person-ethan", "Ethan", "Citi Cash Back Card", "credit_card", 0],
  ["acct-ocbc-365", "OCBC", "person-serene", "Serene", "OCBC 365 Card", "credit_card", 0]
].map(([id, institution, ownerId, ownerName, name, kind, isJoint]) => ({
  id,
  institution_id: `inst-${institution.toLowerCase()}`,
  institution_name: institution,
  owner_person_id: ownerId,
  owner_name: ownerName,
  account_name: name,
  account_kind: kind,
  currency: "SGD",
  opening_balance_minor: 0,
  is_joint: isJoint,
  is_active: 1
}));

const PRIORITY = ["acct-citi-cash-back", "acct-ocbc-365", "acct-posb-joint", "acct-ocbc-360"];

function referenceRows(text) {
  if (/FROM accounts/.test(text)) {
    return ACCOUNT_ROWS;
  }
  if (/FROM app_settings/.test(text)) {
    return [{ value_json: JSON.stringify({ apiKey: "never-sent", defaultAccountPriorityIds: PRIORITY }) }];
  }
  if (/FROM category_match_rules/.test(text)) {
    return [
      { id: "rule-koufu", pattern: "KOUFU", category_id: "cat-food", category_name: "Food & Drinks", priority: 45, is_active: 1, note: null },
      { id: "rule-grab", pattern: "GRAB", category_id: "cat-taxi", category_name: "Taxi", priority: 35, is_active: 1, note: null }
    ];
  }
  if (/FROM people/.test(text)) {
    return [{ id: "person-ethan", display_name: "Ethan" }, { id: "person-serene", display_name: "Serene" }];
  }
  if (/FROM categories/.test(text)) {
    return ["Food & Drinks", "Taxi", "Other", "Other - Income", "Transfer"].map((name) => ({ name }));
  }
  return undefined;
}

// Every statement succeeds. `quotaChanges` is what the daily-usage upsert
// reports (0 = allowance used up); `usedUnits` is read back afterwards.
function createFakeDb({ quotaChanges = 1, usedUnits = 1 } = {}) {
  const bound = [];
  const batches = [];
  const statement = (text) => {
    let args = [];
    const record = () => bound.push({ text, args });
    const self = {
      bind(...values) { args = values; return self; },
      async run() {
        record();
        return { success: true, meta: { changes: /ai_assist_daily_usage/.test(text) ? quotaChanges : 1 } };
      },
      async all() { record(); return { results: referenceRows(text) ?? [] }; },
      async first() {
        record();
        return /ai_assist_daily_usage/.test(text) ? { used_units: usedUnits } : referenceRows(text)?.[0] ?? null;
      },
      async raw() { record(); return []; }
    };
    return self;
  };
  return {
    bound,
    batches,
    prepare: (text) => statement(text),
    async batch(statements) { batches.push(statements); return statements.map(() => ({ results: [] })); },
    async exec() { return {}; }
  };
}

function stubAi(response) {
  const calls = [];
  return {
    calls,
    async run(model, input) {
      calls.push({ model, input });
      if (response instanceof Error) {
        throw response;
      }
      return response;
    }
  };
}

async function draftRoute(env, body) {
  const path = "/api/ai-assist/entry-draft";
  const request = new Request(`http://127.0.0.1${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
  const response = await handleAiAssistRoute(request, new URL(request.url), env);
  return { status: response.status, payload: await response.json() };
}

// Writes other than the shared AI allowance counter. Creating the settings
// table if it is missing is schema, not data, and the Shortcut does it too.
function dataWrites(db) {
  return db.bound.filter((call) => /^\s*(?:INSERT|UPDATE|DELETE|REPLACE)/i.test(call.text) && !/ai_assist_daily_usage/.test(call.text));
}

function allowanceCalls(db) {
  return db.bound.filter((call) => /ai_assist_daily_usage/.test(call.text));
}

const s = (value) => ({ value, source: "sentence" });
const d = (value) => ({ value, source: "default" });
const r = (value) => ({ value, source: "rule" });

test("a complete sentence comes back as a ready draft without asking AI, even when AI is on", async () => {
  const db = createFakeDb();
  const ai = stubAi({ response: "{}" });
  const { status, payload } = await draftRoute({ DB: db, AI: ai, AI_ASSIST_ENABLED: "true" }, { text: "Koufu lunch $12.50 yesterday, Citi" });
  const today = todayInAppTimeZone();
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

  assert.equal(status, 200);
  assert.deepEqual(payload.ai, { requested: false, available: false });
  assert.deepEqual(payload.draft.createBody, {
    date: yesterday,
    description: "Koufu lunch",
    accountId: "acct-citi-cash-back",
    accountName: "Citi Cash Back Card",
    categoryName: "Food & Drinks",
    amountMinor: 1250,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Ethan"
  });
  assert.equal(ai.calls.length, 0);
  assert.deepEqual(allowanceCalls(db), [], "no allowance unit is spent when AI is not needed");
  assert.deepEqual(dataWrites(db), []);
  assert.deepEqual(db.batches, []);
});

test("a very long sentence is truncated and says so", async () => {
  const { payload } = await draftRoute({ DB: createFakeDb() }, { text: `grab 14.20 ${"and more ".repeat(60)}` });
  assert.deepEqual(payload.draft.flags, ["truncated"]);
  assert.deepEqual(payload.draft.fields.amountMinor, s(1420));
});

test("the open person view is the viewer for 'mine'", async () => {
  const { payload } = await draftRoute({ DB: createFakeDb() }, { text: "Haircut $25 mine", viewId: "person-serene" });
  assert.deepEqual(payload.draft.fields.ownerName, s("Serene"));
  assert.deepEqual(payload.draft.fields.description, s("Haircut"));
});

const MISSING_AMOUNT_DRAFT_FIELDS = (today) => ({
  date: d(today),
  description: s("Lunch at Koufu"),
  accountId: d("acct-citi-cash-back"),
  accountName: d("Citi Cash Back Card"),
  categoryName: r("Food & Drinks"),
  entryType: d("expense"),
  ownershipType: d("direct"),
  ownerName: d("Ethan")
});

test("AI off, binding missing, failing, malformed, inventing or over its allowance: the deterministic draft still comes back", async () => {
  const today = todayInAppTimeZone();
  const scenarios = [
    { name: "turned off", env: {}, reason: "AI assistance is turned off.", aiCalls: 0, allowance: false },
    { name: "binding missing", env: { AI_ASSIST_ENABLED: "true" }, reason: "AI assistance is not configured for this environment.", aiCalls: 0, allowance: false },
    { name: "throws", env: { AI_ASSIST_ENABLED: "true", AI: stubAi(new Error("capacity")) }, reason: "AI is temporarily unavailable.", aiCalls: 1, allowance: true },
    { name: "malformed", env: { AI_ASSIST_ENABLED: "true", AI: stubAi({ response: "not json {" }) }, reason: "AI returned an unusable suggestion.", aiCalls: 1, allowance: true },
    { name: "wrong shape", env: { AI_ASSIST_ENABLED: "true", AI: stubAi({ response: JSON.stringify(["12.50"]) }) }, reason: "AI returned an unusable suggestion.", aiCalls: 1, allowance: true },
    {
      name: "invents an amount and words",
      env: { AI_ASSIST_ENABLED: "true", AI: stubAi({ response: JSON.stringify({ amount: "45.00", description: "Starbucks latte" }) }) },
      reason: "AI returned an unusable suggestion.",
      aiCalls: 1,
      allowance: true
    },
    {
      name: "over the daily allowance",
      env: { AI_ASSIST_ENABLED: "true", AI: stubAi({ response: JSON.stringify({ amount: "12.50" }) }) },
      db: { quotaChanges: 0 },
      reason: "Today's optional AI allowance has been used. The normal workflow is still available.",
      aiCalls: 0,
      allowance: true
    }
  ];

  for (const scenario of scenarios) {
    const db = createFakeDb(scenario.db);
    const { status, payload } = await draftRoute({ DB: db, ...scenario.env }, { text: "Lunch at Koufu" });
    assert.equal(status, 200, scenario.name);
    assert.equal(payload.ok, true, scenario.name);
    assert.equal(payload.ai.requested, true, scenario.name);
    assert.equal(payload.ai.available, false, scenario.name);
    assert.equal(payload.ai.reason, scenario.reason, scenario.name);
    assert.deepEqual(payload.draft.fields, MISSING_AMOUNT_DRAFT_FIELDS(today), scenario.name);
    assert.deepEqual(payload.draft.missing, ["amountMinor"], scenario.name);
    assert.deepEqual(payload.draft.questions, [{ field: "amountMinor", reason: "missing", options: [] }], scenario.name);
    assert.equal(payload.draft.createBody, undefined, scenario.name);
    assert.equal(scenario.env.AI?.calls.length ?? 0, scenario.aiCalls, scenario.name);
    assert.equal(allowanceCalls(db).length > 0, scenario.allowance, scenario.name);
    assert.deepEqual(dataWrites(db), [], scenario.name);
    assert.deepEqual(db.batches, [], scenario.name);
  }
});

test("a valid AI answer fills only the missing amount, marked ai, from a bounded, redacted sentence", async () => {
  const db = createFakeDb({ usedUnits: 1 });
  const ai = stubAi({ response: JSON.stringify({ amount: "12.50", description: "Totally different shop" }) });
  const { payload } = await draftRoute(
    { DB: db, AI: ai, AI_ASSIST_ENABLED: "true", AI_ASSIST_DAILY_LIMIT: "12" },
    { text: "Koufu lunch twelve fifty card 4111111111111111" }
  );

  assert.deepEqual(payload.ai, { requested: true, available: true, remaining: 11 });
  assert.deepEqual(payload.draft.fields.amountMinor, { value: 1250, source: "ai" });
  // The sentence's own description wins over the model's, without the
  // number words AI read as the amount.
  assert.equal(payload.draft.fields.description.source, "sentence");
  assert.match(payload.draft.fields.description.value, /^Koufu lunch card/);
  assert.doesNotMatch(payload.draft.fields.description.value, /twelve|fifty/);
  assert.deepEqual(payload.draft.fields.categoryName, r("Food & Drinks"));
  assert.equal(payload.draft.createBody.amountMinor, 1250);

  assert.equal(ai.calls.length, 1);
  assert.equal(ai.calls[0].model, "@cf/google/gemma-4-26b-a4b-it");
  assert.equal(ai.calls[0].input.max_completion_tokens, 80);
  assert.equal(ai.calls[0].input.response_format.json_schema.schema.required.join(), "amount,description");
  const prompt = ai.calls[0].input.messages[1].content;
  assert.match(prompt, /Koufu lunch twelve fifty/);
  assert.doesNotMatch(prompt, /4111111111111111/, "card-like numbers are redacted");
  // Only the sentence leaves the Worker: no accounts, people, rules or key.
  assert.doesNotMatch(prompt, /Citi Cash Back|OCBC|POSB|Ethan|Serene|never-sent/);
  assert.match(ai.calls[0].input.messages[0].content, /untrusted/i);

  const allowance = allowanceCalls(db).filter((call) => /INSERT/.test(call.text));
  assert.equal(allowance.length, 1);
  assert.equal(allowance[0].args[2], 1, "one allowance unit");
  assert.deepEqual(dataWrites(db), []);
  assert.deepEqual(db.batches, []);
});

test("AI is never asked to settle two amounts the sentence gave", async () => {
  const db = createFakeDb();
  const ai = stubAi({ response: JSON.stringify({ amount: "12" }) });
  const { payload } = await draftRoute({ DB: db, AI: ai, AI_ASSIST_ENABLED: "true" }, { text: "Lunch $12 or $15" });
  assert.deepEqual(payload.ai, { requested: false, available: false });
  assert.deepEqual(payload.draft.flags, ["conflicting_amounts"]);
  assert.equal(ai.calls.length, 0);
  assert.deepEqual(allowanceCalls(db), []);
});

test("empty or unreadable requests are refused before any statement runs", async () => {
  for (const body of [{}, { text: "   " }, { text: 42 }, "not json"]) {
    const db = createFakeDb();
    const { status, payload } = await draftRoute({ DB: db, AI: stubAi({}), AI_ASSIST_ENABLED: "true" }, body);
    assert.equal(status, 400, JSON.stringify(body));
    assert.deepEqual(payload, { ok: false, error: "Missing entry draft text" });
    assert.deepEqual(db.bound, []);
  }
});

test("the Worker serves the route and the shortcut-only gateway hides it", async () => {
  const request = (env) => worker.fetch(new Request("http://127.0.0.1/api/ai-assist/entry-draft", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "grab 14.20" })
  }), env);

  const served = await request({ DB: createFakeDb() });
  assert.equal(served.status, 200);
  const payload = await served.json();
  assert.deepEqual(payload.draft.fields.amountMinor, s(1420));
  assert.deepEqual(payload.draft.fields.categoryName, r("Taxi"));

  const db = createFakeDb();
  const hidden = await request({ DB: db, SHORTCUT_API_ONLY: "true", AI: stubAi({}), AI_ASSIST_ENABLED: "true" });
  assert.equal(hidden.status, 404);
  assert.deepEqual(db.bound, []);
});

test("a GET on the entry draft route is not handled by it", async () => {
  const db = createFakeDb();
  const path = "/api/ai-assist/entry-draft";
  const response = await handleAiAssistRoute(new Request(`http://127.0.0.1${path}`), new URL(`http://127.0.0.1${path}`), { DB: db });
  assert.equal(response, null);
  assert.deepEqual(db.bound, []);
});
