import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.ts";

// The four text features that moved from runAiJson (Llama 3.2 3B) onto the
// provider layer (runTextJson): Monthly Note draft, statement-mismatch
// explanation, category-rule suggestions and the statement text fallback.
// Each one, through the real Worker fetch with a fake D1, a stub Workers AI
// binding and a mocked AI Gateway:
// - Claude answers first when configured, with that feature's JSON schema,
//   prompt and token cap, and Workers AI is not called;
// - a failing Claude falls back to Workers AI Gemma with the same request;
// - with both down, the deterministic result comes back as before;
// - an answer that fails the feature's validator is still refused, from
//   either provider, with the old "unusable suggestion" reason;
// - one request reserves the daily allowance once, with the same units;
// - AI off, unconfigured or over its allowance never calls a provider.

const GEMMA = "@cf/google/gemma-4-26b-a4b-it";
const GATEWAY = {
  AI_ASSIST_ENABLED: "true",
  AI_GATEWAY_ACCOUNT_ID: "acct123",
  AI_GATEWAY_ID: "monies-map",
  AI_GATEWAY_TOKEN: "cf-gateway-token"
};
const GATEWAY_URL = "https://gateway.ai.cloudflare.com/v1/acct123/monies-map/anthropic/v1/messages";
const CLAUDE_THINKING_HEADROOM_TOKENS = 1024;
const UNAVAILABLE = "AI is temporarily unavailable.";
const UNUSABLE = "AI returned an unusable suggestion.";

const PREVIEW = {
  statementReconciliations: [{
    status: "mismatch",
    accountName: "UOB One",
    checkpointMonth: "2026-08",
    deltaMinor: -4_280,
    reconciliationBreakdown: {
      suspectedCauses: ["a card payment recorded twice"],
      periodExistingLedgerRowCount: 3,
      skippedStatementRowCount: 1,
      matchedStatementRowCount: 4
    }
  }]
};
const COMPUTED_EXPLANATION = "UOB One is out by $42.80 for August 2026. Start with the 3 ledger rows already inside the statement period, then compare the 5 imported statement rows; the likely cause is a card payment recorded twice.";
// An empty month on the fake D1, as buildDeterministicMonthlyNarrative words it.
const COMPUTED_NARRATIVE = "August 2026 recorded $0.00 of spending and $0.00 of income. No spending category was the largest spending category at $0.00; the largest recorded expense was No expense recorded at $0.00.";
const CATEGORY_EXAMPLES = [
  { description: "GRAB RIDE 1", category_name: "Transport" },
  { description: "GRAB RIDE 2", category_name: "Transport" },
  { description: "COLD STORAGE CLEMENTI", category_name: "Groceries" },
  { description: "COLD STORAGE BUGIS", category_name: "Groceries" }
];
const STATEMENT_TEXT = "Account Number: 1234567\n02 May COLD STORAGE 12.50\nCARD 5000000000006349";

const TEMPLATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["template"],
  properties: { template: { type: "string" } }
};

// One row per feature: its request, a valid and an invalid model answer, and
// what the route answers with AI and without it.
const FEATURES = [
  {
    name: "monthly narrative",
    path: "/api/ai-assist/monthly-narrative",
    body: { month: "2026-08" },
    units: 1,
    maxTokens: 180,
    schema: TEMPLATE_SCHEMA,
    valid: { template: "{{monthName}} spending was {{spend}}." },
    invalid: { template: "{{monthName}} spending rose 34%." },
    aiPayload: { ok: true, available: true, narrative: "August 2026 spending was $0.00.", source: "ai", remaining: 11 },
    fallbackPayload: (reason) => ({ ok: true, available: false, narrative: COMPUTED_NARRATIVE, source: "deterministic", reason, remaining: 11 })
  },
  {
    name: "import explanation",
    path: "/api/ai-assist/import-explanation",
    body: { preview: PREVIEW },
    units: 1,
    maxTokens: 140,
    schema: TEMPLATE_SCHEMA,
    valid: { template: "{{accountName}} is out by {{difference}} for {{statementMonth}}; check {{cause}} first." },
    invalid: { template: "{{accountName}} is out by 34%." },
    aiPayload: {
      ok: true,
      available: true,
      explanations: [{ accountName: "UOB One", message: "UOB One is out by $42.80 for August 2026; check a card payment recorded twice first.", source: "ai" }]
    },
    fallbackPayload: () => ({
      ok: true,
      available: false,
      explanations: [{ accountName: "UOB One", message: COMPUTED_EXPLANATION, source: "deterministic" }]
    })
  },
  {
    name: "category rule suggestions",
    path: "/api/ai-assist/category-rule-suggestions",
    body: {},
    units: 2,
    maxTokens: 300,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["proposals"],
      properties: {
        proposals: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["pattern", "categoryName", "indexes"],
            properties: {
              pattern: { type: "string" },
              categoryName: { type: "string", enum: ["Transport", "Groceries"] },
              indexes: { type: "array", items: { type: "integer" } }
            }
          }
        }
      }
    },
    valid: { proposals: [{ pattern: "GRAB", categoryName: "Transport", indexes: [0, 1] }] },
    // Not a list of proposals at all, so the validator refuses the answer.
    invalid: { proposals: "GRAB" },
    aiPayload: { ok: true, available: true, proposed: 1, remaining: 11 },
    fallbackPayload: (reason) => ({ ok: true, available: false, proposed: 0, reason, remaining: 11 })
  },
  {
    name: "statement text fallback",
    path: "/api/ai-assist/statement-text-fallback",
    body: { fileName: "May statement.pdf", text: STATEMENT_TEXT },
    units: 8,
    maxTokens: 700,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["rows"],
      properties: {
        rows: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["date", "description", "amount"],
            properties: {
              date: { type: "string" },
              description: { type: "string" },
              amount: { type: "string" }
            }
          }
        }
      }
    },
    valid: { rows: [{ date: "2026-05-02", description: "COLD STORAGE", amount: "-12.50" }] },
    // A row without an ISO date is dropped, leaving no usable row.
    invalid: { rows: [{ date: "02/05/2026", description: "COLD STORAGE", amount: "-12.50" }] },
    aiPayload: {
      ok: true,
      available: true,
      parserKey: "ai_text_fallback_statement",
      sourceLabel: "May statement.pdf (AI review rows)",
      rows: [{
        date: "2026-05-02",
        description: "COLD STORAGE",
        expense: "12.50",
        income: "",
        note: "AI-extracted from local statement text; review before commit.",
        commitStatus: "needs_review"
      }],
      checkpoints: [],
      warnings: ["AI fallback used locally extracted text only. Review every row before committing; no statement balance was extracted."],
      remaining: 11
    },
    fallbackPayload: (reason) => ({ ok: true, available: false, reason })
  }
];

// Every statement succeeds. `quotaChanges` is what the daily-usage upsert
// reports (0 = allowance used up). The category examples and the Transport
// category exist, so one GRAB proposal can be verified and recorded.
function createFakeDb({ quotaChanges = 1, usedUnits = 1 } = {}) {
  const bound = [];
  const statement = (text) => {
    let args = [];
    const record = () => { bound.push({ text, args }); };
    const self = {
      bind(...values) { args = values; return self; },
      async run() {
        record();
        return { success: true, meta: { changes: /ai_assist_daily_usage/.test(text) ? quotaChanges : 1 } };
      },
      async all() {
        record();
        return { results: /categories.name NOT IN/.test(text) ? CATEGORY_EXAMPLES : [] };
      },
      async first() {
        record();
        if (/ai_assist_daily_usage/.test(text)) {
          return { used_units: usedUnits };
        }
        if (/SELECT id FROM categories/.test(text)) {
          return args[1] === "Transport" ? { id: "cat-transport" } : null;
        }
        return null;
      },
      async raw() { record(); return []; }
    };
    return self;
  };
  return {
    bound,
    allowanceReservations: () => bound.filter((call) => /INSERT INTO ai_assist_daily_usage/.test(call.text)),
    prepare: (text) => statement(text),
    async batch(statements) { return statements.map(() => ({ results: [] })); },
    async exec() { return {}; }
  };
}

function stubWorkersAi(response) {
  const calls = [];
  return {
    calls,
    async run(model, input) {
      calls.push({ model, input });
      return typeof response === "function" ? response(model, input) : response;
    }
  };
}

const gemmaAnswer = (json) => ({ choices: [{ message: { role: "assistant", content: JSON.stringify(json) } }] });

function claudeAnswer(json) {
  return new Response(JSON.stringify({
    id: "msg_test",
    type: "message",
    role: "assistant",
    stop_reason: "end_turn",
    usage: { input_tokens: 300, output_tokens: 60 },
    content: [{ type: "thinking", thinking: "", signature: "sig" }, { type: "text", text: JSON.stringify(json) }]
  }), { status: 200, headers: { "content-type": "application/json" } });
}

// Replaces globalThis.fetch for one test and records each gateway call.
function mockGateway(t, handler) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url: String(url), headers: init?.headers ?? {}, body: init?.body ? JSON.parse(init.body) : null });
    return handler(url, init);
  });
  return calls;
}

async function post(env, path, body) {
  const response = await worker.fetch(new Request(`http://127.0.0.1${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  }), env);
  assert.equal(response.status, 200);
  return response.json();
}

function assertOneReservation(db, feature) {
  const reservations = db.allowanceReservations();
  assert.equal(reservations.length, 1, `${feature.name}: one allowance reservation`);
  assert.equal(reservations[0].args[2], feature.units, `${feature.name}: allowance units`);
}

for (const feature of FEATURES) {
  test(`${feature.name}: Claude answers first with the feature's schema, prompt and token cap`, async (t) => {
    const calls = mockGateway(t, () => claudeAnswer(feature.valid));
    const ai = stubWorkersAi(() => { throw new Error("Workers AI must not be called"); });
    const db = createFakeDb();

    const payload = await post({ ...GATEWAY, DB: db, AI: ai }, feature.path, feature.body);

    assert.deepEqual(payload, feature.aiPayload);
    assert.equal(ai.calls.length, 0);
    assert.equal(calls.length, 1);
    const [call] = calls;
    assert.equal(call.url, GATEWAY_URL);
    // Prompts never stay in the gateway.
    assert.equal(call.headers["cf-aig-collect-log"], "false");
    assert.equal(call.headers["cf-aig-skip-cache"], "true");
    assert.equal(call.body.model, "claude-haiku-5-5");
    // The feature's answer cap, plus the provider's fixed thinking headroom.
    assert.equal(call.body.max_tokens, feature.maxTokens + CLAUDE_THINKING_HEADROOM_TOKENS);
    assert.deepEqual(call.body.output_config, { effort: "low", format: { type: "json_schema", schema: feature.schema } });
    assertOneReservation(db, feature);
    // A Claude 2xx is recorded in the aggregate provider status.
    assert.ok(db.bound.some((entry) => /ai_provider_status/.test(entry.text)));
  });

  test(`${feature.name}: a failing Claude falls back to Workers AI Gemma with the same request`, async (t) => {
    const calls = mockGateway(t, () => new Response(JSON.stringify({ type: "error", error: { type: "rate_limit_error" } }), { status: 429 }));
    const ai = stubWorkersAi(gemmaAnswer(feature.valid));
    const db = createFakeDb();

    const payload = await post({ ...GATEWAY, DB: db, AI: ai }, feature.path, feature.body);

    assert.deepEqual(payload, feature.aiPayload);
    assert.equal(calls.length, 1);
    assert.equal(ai.calls.length, 1);
    assert.equal(ai.calls[0].model, GEMMA);
    assert.equal(ai.calls[0].input.max_completion_tokens, feature.maxTokens);
    assert.deepEqual(ai.calls[0].input.response_format, { type: "json_schema", json_schema: { name: "result", schema: feature.schema, strict: true } });
    // Gemma is asked exactly what Claude was asked.
    assert.equal(ai.calls[0].input.messages[1].content, calls[0].body.messages[0].content.at(-1).text);
    assertOneReservation(db, feature);
  });

  test(`${feature.name}: with Claude and Workers AI both down the deterministic result comes back`, async (t) => {
    mockGateway(t, () => new Response("{}", { status: 503 }));
    const ai = stubWorkersAi(() => { throw new Error("capacity"); });
    const db = createFakeDb();

    const payload = await post({ ...GATEWAY, DB: db, AI: ai }, feature.path, feature.body);

    assert.deepEqual(payload, feature.fallbackPayload(UNAVAILABLE));
    assert.equal(ai.calls.length, 1);
    assertOneReservation(db, feature);
  });

  test(`${feature.name}: an answer that fails validation is refused from either provider`, async (t) => {
    const calls = mockGateway(t, () => claudeAnswer(feature.invalid));
    const ai = stubWorkersAi(gemmaAnswer(feature.invalid));
    const db = createFakeDb();

    const payload = await post({ ...GATEWAY, DB: db, AI: ai }, feature.path, feature.body);

    assert.deepEqual(payload, feature.fallbackPayload(UNUSABLE));
    assert.equal(calls.length, 1);
    assert.equal(ai.calls.length, 1);
    assertOneReservation(db, feature);
    assert.equal(db.bound.some((entry) => /INSERT INTO category_match_rule_suggestions/.test(entry.text)), false);
  });

  test(`${feature.name}: without Claude, Workers AI answers directly and an unusable answer keeps its old reason`, async (t) => {
    const calls = mockGateway(t, () => { throw new Error("the gateway must not be called"); });
    const valid = await post({ DB: createFakeDb(), AI: stubWorkersAi(gemmaAnswer(feature.valid)), AI_ASSIST_ENABLED: "true" }, feature.path, feature.body);
    assert.deepEqual(valid, feature.aiPayload);

    const malformed = await post({ DB: createFakeDb(), AI: stubWorkersAi({ response: "not json {" }), AI_ASSIST_ENABLED: "true" }, feature.path, feature.body);
    assert.deepEqual(malformed, feature.fallbackPayload(UNUSABLE));
    assert.equal(calls.length, 0);
  });

  test(`${feature.name}: AI off, unconfigured or over its allowance calls no provider`, async (t) => {
    const calls = mockGateway(t, () => { throw new Error("the gateway must not be called"); });
    const ai = stubWorkersAi(() => { throw new Error("Workers AI must not be called"); });

    const off = createFakeDb();
    const offPayload = await post({ ...GATEWAY, AI_ASSIST_ENABLED: "false", DB: off, AI: ai }, feature.path, feature.body);
    assert.deepEqual(offPayload, withoutRemaining(feature.fallbackPayload("AI assistance is turned off.")));
    assert.equal(off.allowanceReservations().length, 0);

    const unconfigured = createFakeDb();
    const unconfiguredPayload = await post({ AI_ASSIST_ENABLED: "true", DB: unconfigured }, feature.path, feature.body);
    assert.deepEqual(unconfiguredPayload, withoutRemaining(feature.fallbackPayload("AI assistance is not configured for this environment.")));
    assert.equal(unconfigured.allowanceReservations().length, 0);

    const spent = await post({ ...GATEWAY, DB: createFakeDb({ quotaChanges: 0 }), AI: ai }, feature.path, feature.body);
    assert.deepEqual(spent, withRemaining(feature.fallbackPayload("Today's optional AI allowance has been used. The normal workflow is still available."), 0));

    assert.equal(calls.length, 0);
    assert.equal(ai.calls.length, 0);
  });
}

test("statement text fallback: account numbers are redacted before the text reaches Claude", async (t) => {
  const calls = mockGateway(t, () => claudeAnswer({ rows: [] }));
  await post({ ...GATEWAY, DB: createFakeDb() }, "/api/ai-assist/statement-text-fallback", { fileName: "s.pdf", text: STATEMENT_TEXT });
  const sent = JSON.stringify(calls[0].body);
  assert.doesNotMatch(sent, /1234567|5000000000006349/);
  assert.match(sent, /COLD STORAGE 12\.50/);
});

test("import explanation: each mismatched statement is its own request with its own allowance unit", async (t) => {
  const twoStatements = {
    statementReconciliations: [
      PREVIEW.statementReconciliations[0],
      { ...PREVIEW.statementReconciliations[0], accountName: "Citi Rewards" }
    ]
  };
  const calls = mockGateway(t, () => claudeAnswer({ template: "Check {{accountName}} for {{statementMonth}}." }));
  const db = createFakeDb();
  const payload = await post({ ...GATEWAY, DB: db }, "/api/ai-assist/import-explanation", { preview: twoStatements });
  assert.deepEqual(payload.explanations.map((item) => [item.message, item.source]), [
    ["Check UOB One for August 2026.", "ai"],
    ["Check Citi Rewards for August 2026.", "ai"]
  ]);
  assert.equal(calls.length, 2);
  assert.deepEqual(db.allowanceReservations().map((call) => call.args[2]), [1, 1]);
});

test("category rule suggestions: proposals that fail the evidence check are recorded as nothing", async (t) => {
  mockGateway(t, () => claudeAnswer({ proposals: [{ pattern: "COLD", categoryName: "Transport", indexes: [1, 2] }] }));
  const db = createFakeDb();
  const payload = await post({ ...GATEWAY, DB: db }, "/api/ai-assist/category-rule-suggestions", {});
  assert.deepEqual(payload, { ok: true, available: true, proposed: 0, remaining: 11 });
  assert.equal(db.bound.some((entry) => /INSERT INTO category_match_rule_suggestions/.test(entry.text)), false);
});

// The allowance and the off/unconfigured checks answer before any reserve,
// so those payloads carry no `remaining`, as before the move.
function withoutRemaining(payload) {
  const { remaining: _remaining, ...rest } = payload;
  return rest;
}

function withRemaining(payload, remaining) {
  return "remaining" in payload ? { ...payload, remaining } : payload;
}
