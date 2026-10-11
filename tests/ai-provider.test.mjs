import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_WORKERS_AI_FALLBACK_MODEL,
  resolveClaudeGateway,
  runTextJson,
  runVisionJson
} from "../src/domain/ai-provider.ts";

// The provider layer: Claude Haiku through Cloudflare AI Gateway when the
// owner has configured it, Workers AI (Gemma) otherwise or when Claude is
// unavailable, rate-limited, over the gateway's spend cap, slow or
// malformed. It never throws to a caller and it reserves the shared daily
// allowance once per request, before any inference.

const IMAGE = { mediaType: "image/jpeg", base64: "/9j/AAAA" };
const SCHEMA = { type: "object", additionalProperties: false, required: ["total"], properties: { total: { type: "string" } } };
const parseTotal = (value) => (value && typeof value.total === "string" ? value : null);

function createFakeDb({ quotaChanges = 1, usedUnits = 2, statusWrite } = {}) {
  const statements = [];
  return {
    statements,
    prepare(sql) {
      const self = {
        args: [],
        bind(...values) { self.args = values; return self; },
        async run() {
          statements.push({ sql, args: self.args });
          if (statusWrite && /ai_provider_status/.test(sql)) {
            return statusWrite();
          }
          return { meta: { changes: quotaChanges } };
        },
        async first() { statements.push({ sql, args: self.args }); return { used_units: usedUnits }; }
      };
      return self;
    }
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

function claudeResponse(json, { stopReason = "end_turn", usage = { input_tokens: 1_000, output_tokens: 400 } } = {}) {
  return new Response(JSON.stringify({
    id: "msg_test",
    type: "message",
    role: "assistant",
    stop_reason: stopReason,
    usage,
    content: [{ type: "thinking", thinking: "", signature: "sig" }, { type: "text", text: typeof json === "string" ? json : JSON.stringify(json) }]
  }), { status: 200, headers: { "content-type": "application/json" } });
}

// Replaces globalThis.fetch for one test and records every call.
function mockFetch(t, handler) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url: String(url), init, body: init?.body ? JSON.parse(init.body) : null });
    return handler(url, init);
  });
  return calls;
}

const GATEWAY_BYOK = {
  AI_ASSIST_ENABLED: "true",
  AI_GATEWAY_ACCOUNT_ID: "acct123",
  AI_GATEWAY_ID: "monies-map",
  AI_GATEWAY_TOKEN: "cf-gateway-token"
};

function visionInput(extra = {}) {
  return { capability: "receipt_read", images: [IMAGE], prompt: "Read it.", schema: SCHEMA, maxTokens: 400, parse: parseTotal, ...extra };
}

test("with no Anthropic config, Workers AI is used directly and the gateway is never called", async (t) => {
  const calls = mockFetch(t, () => { throw new Error("gateway must not be called"); });
  const ai = stubWorkersAi({ choices: [{ message: { role: "assistant", content: "{\"total\":\"12.50\"}" } }] });
  const db = createFakeDb();
  const warnings = t.mock.method(console, "warn", () => {});

  const result = await runVisionJson(db, { AI_ASSIST_ENABLED: "true", AI: ai }, visionInput());

  assert.deepEqual(result, { available: true, value: { total: "12.50" }, remaining: 10, provider: "workers-ai" });
  assert.equal(calls.length, 0);
  assert.equal(warnings.mock.callCount(), 0);
  assert.equal(ai.calls.length, 1);
  assert.equal(ai.calls[0].model, DEFAULT_WORKERS_AI_FALLBACK_MODEL);
  assert.equal(DEFAULT_WORKERS_AI_FALLBACK_MODEL, "@cf/google/gemma-4-26b-a4b-it");
  // Gemma 4 takes OpenAI-style image parts and a named JSON schema.
  const { messages, response_format: format, max_completion_tokens: maxTokens, chat_template_kwargs: kwargs } = ai.calls[0].input;
  assert.equal(messages[0].role, "system");
  assert.deepEqual(messages[1].content, [
    { type: "text", text: "Read it." },
    { type: "image_url", image_url: { url: "data:image/jpeg;base64,/9j/AAAA" } }
  ]);
  assert.deepEqual(format, { type: "json_schema", json_schema: { name: "result", schema: SCHEMA, strict: true } });
  assert.equal(maxTokens, 400);
  assert.deepEqual(kwargs, { enable_thinking: false });
});

test("a gateway URL without a key or gateway token is not a Claude config", () => {
  assert.equal(resolveClaudeGateway({ AI_GATEWAY_ACCOUNT_ID: "acct", AI_GATEWAY_ID: "gw" }), null);
  assert.equal(resolveClaudeGateway({ AI_GATEWAY_TOKEN: "token" }), null);
  assert.equal(resolveClaudeGateway({ AI_GATEWAY_URL: "http://gateway.test/v1/a/b", ANTHROPIC_API_KEY: "key" }), null);
  assert.deepEqual(resolveClaudeGateway({ AI_GATEWAY_URL: "https://gateway.ai.cloudflare.com/v1/acct/gw/anthropic/", ANTHROPIC_API_KEY: "key" }), {
    url: "https://gateway.ai.cloudflare.com/v1/acct/gw/anthropic/v1/messages",
    model: DEFAULT_CLAUDE_MODEL,
    headers: { "x-api-key": "key" }
  });
  assert.equal(DEFAULT_CLAUDE_MODEL, "claude-haiku-5-5");
});

test("a configured gateway sends the image to Claude Haiku with logging and caching off and no stored key in the Worker", async (t) => {
  const calls = mockFetch(t, () => claudeResponse({ total: "23.45" }));
  const ai = stubWorkersAi(() => { throw new Error("fallback must not run"); });
  const db = createFakeDb();

  const result = await runVisionJson(db, { ...GATEWAY_BYOK, AI: ai }, visionInput());

  assert.deepEqual(result, { available: true, value: { total: "23.45" }, remaining: 10, provider: "claude" });
  assert.equal(ai.calls.length, 0);
  assert.equal(calls.length, 1);
  const [{ url, init, body }] = calls;
  assert.equal(url, "https://gateway.ai.cloudflare.com/v1/acct123/monies-map/anthropic/v1/messages");
  assert.equal(init.method, "POST");
  assert.deepEqual(init.headers, {
    "content-type": "application/json",
    "anthropic-version": "2023-06-01",
    "cf-aig-collect-log": "false",
    "cf-aig-skip-cache": "true",
    "cf-aig-request-timeout": "15000",
    "cf-aig-authorization": "Bearer cf-gateway-token"
  });
  assert.equal(body.model, "claude-haiku-5-5");
  assert.equal("temperature" in body, false);
  assert.deepEqual(body.output_config, { effort: "low", format: { type: "json_schema", schema: SCHEMA } });
  assert.deepEqual(body.messages, [{
    role: "user",
    content: [
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "/9j/AAAA" } },
      { type: "text", text: "Read it." }
    ]
  }]);
  assert.match(body.system, /untrusted/);
  // The allowance is reserved once, before inference, at the vision unit cost.
  const reservations = db.statements.filter((statement) => /INSERT INTO ai_assist_daily_usage/.test(statement.sql));
  assert.equal(reservations.length, 1);
  assert.equal(reservations[0].args[2], 2);
});

test("a gateway-stored key under a named alias is selected with cf-aig-byok-alias", async (t) => {
  const calls = mockFetch(t, () => claudeResponse({ total: "1.00" }));
  const result = await runVisionJson(createFakeDb(), {
    ...GATEWAY_BYOK,
    AI_GATEWAY_BYOK_ALIAS: "monies-map-claude-api-key"
  }, visionInput());
  assert.equal(result.provider, "claude");
  assert.equal(calls[0].init.headers["cf-aig-byok-alias"], "monies-map-claude-api-key");
  assert.equal(calls[0].init.headers["cf-aig-authorization"], "Bearer cf-gateway-token");
});

test("no alias header is sent when the gateway key uses the default alias", async (t) => {
  const calls = mockFetch(t, () => claudeResponse({ total: "1.00" }));
  await runVisionJson(createFakeDb(), { ...GATEWAY_BYOK, AI_GATEWAY_BYOK_ALIAS: "  " }, visionInput());
  assert.equal("cf-aig-byok-alias" in calls[0].init.headers, false);
});

test("a Worker-secret Anthropic key from any account is sent as x-api-key", async (t) => {
  const calls = mockFetch(t, () => claudeResponse({ total: "1.00" }));
  const result = await runVisionJson(createFakeDb(), {
    AI_ASSIST_ENABLED: "true",
    AI_GATEWAY_URL: "https://gateway.ai.cloudflare.com/v1/other-acct/other-gw",
    ANTHROPIC_API_KEY: "sk-ant-any-account",
    AI_CLAUDE_MODEL: "claude-haiku-5-5"
  }, visionInput());
  assert.equal(result.provider, "claude");
  assert.equal(calls[0].url, "https://gateway.ai.cloudflare.com/v1/other-acct/other-gw/anthropic/v1/messages");
  assert.equal(calls[0].init.headers["x-api-key"], "sk-ant-any-account");
  assert.equal("cf-aig-authorization" in calls[0].init.headers, false);
});

for (const [label, respond] of [
  ["a 429 rate limit or spend cap", () => new Response("{\"error\":\"over budget\"}", { status: 429 })],
  ["a 529 overload", () => new Response("{}", { status: 529 })],
  ["a 500 error", () => new Response("{}", { status: 500 })],
  ["a network failure", () => { throw new TypeError("network down"); }],
  ["malformed JSON text", () => claudeResponse("{not json")],
  ["JSON the caller's parser rejects", () => claudeResponse({ unexpected: true })],
  ["a refusal", () => claudeResponse({ total: "1.00" }, { stopReason: "refusal" })],
  ["a cut-off response", () => claudeResponse("{\"total\":\"1", { stopReason: "max_tokens" })]
]) {
  test(`${label} from Claude falls back to Workers AI without a second allowance charge`, async (t) => {
    mockFetch(t, respond);
    const ai = stubWorkersAi({ response: "{\"total\":\"9.90\"}" });
    const db = createFakeDb();
    const result = await runVisionJson(db, { ...GATEWAY_BYOK, AI: ai }, visionInput());
    assert.deepEqual(result, { available: true, value: { total: "9.90" }, remaining: 10, provider: "workers-ai" });
    assert.equal(ai.calls.length, 1);
    assert.equal(db.statements.filter((statement) => /INSERT INTO ai_assist_daily_usage/.test(statement.sql)).length, 1);
  });
}

test("a caller parser that throws on Claude's answer counts as a rejection and falls back", async (t) => {
  mockFetch(t, () => claudeResponse({ total: "1.00" }));
  const ai = stubWorkersAi({ response: "{\"total\":\"2.00\"}" });
  let calls = 0;
  const result = await runVisionJson(createFakeDb(), { ...GATEWAY_BYOK, AI: ai }, visionInput({
    parse: (value) => {
      calls += 1;
      if (calls === 1) {
        throw new Error("parser bug");
      }
      return value;
    }
  }));
  assert.deepEqual(result.value, { total: "2.00" });
  assert.equal(result.provider, "workers-ai");
});

test("a Claude call slower than the timeout is aborted and Workers AI answers", async (t) => {
  mockFetch(t, (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  }));
  const ai = stubWorkersAi({ response: { total: "4.00" } });
  const started = Date.now();
  const result = await runVisionJson(createFakeDb(), { ...GATEWAY_BYOK, AI: ai }, visionInput({ timeoutMs: 30 }));
  assert.equal(result.provider, "workers-ai");
  assert.deepEqual(result.value, { total: "4.00" });
  assert.ok(Date.now() - started < 2000);
});

test("when Claude and Workers AI are both down the caller gets an ordinary unavailable result", async (t) => {
  mockFetch(t, () => new Response("{}", { status: 503 }));
  const ai = stubWorkersAi(() => { throw new Error("capacity"); });
  const result = await runVisionJson(createFakeDb(), { ...GATEWAY_BYOK, AI: ai }, visionInput());
  assert.deepEqual(result, { available: false, reason: "AI is temporarily unavailable.", remaining: 10 });
});

test("a slow Workers AI fallback is abandoned instead of holding the request", async () => {
  const ai = stubWorkersAi(() => new Promise(() => {}));
  const result = await runVisionJson(createFakeDb(), { AI_ASSIST_ENABLED: "true", AI: ai }, visionInput({ timeoutMs: 30 }));
  assert.equal(result.available, false);
  assert.match(result.reason, /temporarily unavailable/);
});

test("Claude configured without a Workers AI binding still degrades to unavailable", async (t) => {
  mockFetch(t, () => new Response("{}", { status: 429 }));
  const result = await runVisionJson(createFakeDb(), GATEWAY_BYOK, visionInput());
  assert.equal(result.available, false);
});

test("a gateway misconfiguration warns with the status code only, never the request", async (t) => {
  mockFetch(t, () => new Response("{\"error\":\"bad key\"}", { status: 401 }));
  const warnings = t.mock.method(console, "warn", () => {});
  const ai = stubWorkersAi({ response: "{\"total\":\"2.00\"}" });
  const result = await runVisionJson(createFakeDb(), { ...GATEWAY_BYOK, AI: ai }, visionInput());
  assert.equal(result.provider, "workers-ai");
  assert.equal(warnings.mock.callCount(), 1);
  assert.deepEqual(warnings.mock.calls[0].arguments, ["AI provider config rejected", { provider: "claude", status: 401 }]);
});

test("turned off, unconfigured or over the allowance: no inference and no gateway call", async (t) => {
  const calls = mockFetch(t, () => claudeResponse({ total: "1.00" }));
  const ai = stubWorkersAi({ response: "{\"total\":\"1.00\"}" });

  const off = await runVisionJson(null, { ...GATEWAY_BYOK, AI_ASSIST_ENABLED: "false", AI: ai }, visionInput());
  assert.deepEqual(off, { available: false, reason: "AI assistance is turned off." });

  const unconfigured = await runVisionJson(null, { AI_ASSIST_ENABLED: "true" }, visionInput());
  assert.deepEqual(unconfigured, { available: false, reason: "AI assistance is not configured for this environment." });

  const spent = await runVisionJson(createFakeDb({ quotaChanges: 0 }), { ...GATEWAY_BYOK, AI: ai }, visionInput());
  assert.equal(spent.available, false);
  assert.match(spent.reason, /allowance has been used/);

  assert.equal(calls.length, 0);
  assert.equal(ai.calls.length, 0);
});

test("the vision unit cost is configurable and clamped", async (t) => {
  mockFetch(t, () => claudeResponse({ total: "1.00" }));
  for (const [setting, expected] of [["5", 5], ["0", 1], ["99", 10], ["nope", 2]]) {
    const db = createFakeDb();
    await runVisionJson(db, { ...GATEWAY_BYOK, AI_ASSIST_VISION_UNITS: setting }, visionInput());
    assert.equal(db.statements[0].args[2], expected, `units ${setting}`);
  }
});

test("bad image input is refused before the allowance is touched", async () => {
  const db = createFakeDb();
  const ai = stubWorkersAi({ response: "{}" });
  for (const images of [[], [{ mediaType: "image/gif", base64: "R0lG" }], [{ mediaType: "image/png", base64: "" }], Array(5).fill(IMAGE)]) {
    const result = await runVisionJson(db, { AI_ASSIST_ENABLED: "true", AI: ai }, visionInput({ images }));
    assert.equal(result.available, false);
  }
  assert.equal(db.statements.length, 0);
  assert.equal(ai.calls.length, 0);
});

test("text JSON uses the same Claude-then-Workers-AI path with the caller's unit cost", async (t) => {
  const calls = mockFetch(t, () => new Response("{}", { status: 429 }));
  const ai = stubWorkersAi({ response: "{\"total\":\"3.00\"}" });
  const db = createFakeDb();
  const result = await runTextJson(db, { ...GATEWAY_BYOK, AI: ai }, {
    capability: "receipt_read", units: 1, prompt: "Hello", schema: SCHEMA, maxTokens: 100, parse: parseTotal
  });
  assert.deepEqual(result, { available: true, value: { total: "3.00" }, remaining: 10, provider: "workers-ai" });
  assert.deepEqual(calls[0].body.messages, [{ role: "user", content: [{ type: "text", text: "Hello" }] }]);
  assert.deepEqual(ai.calls[0].input.messages[1], { role: "user", content: "Hello" });
  assert.equal(db.statements[0].args[2], 1);
});

test("a non-Gemma fallback model gets the older Workers AI JSON mode shape", async () => {
  const ai = stubWorkersAi({ response: "{\"total\":\"3.00\"}" });
  await runVisionJson(createFakeDb(), {
    AI_ASSIST_ENABLED: "true",
    AI: ai,
    AI_FALLBACK_MODEL: "@cf/meta/llama-4-scout-17b-16e-instruct"
  }, visionInput());
  assert.equal(ai.calls[0].model, "@cf/meta/llama-4-scout-17b-16e-instruct");
  assert.deepEqual(ai.calls[0].input.response_format, { type: "json_schema", json_schema: SCHEMA });
  assert.equal(ai.calls[0].input.max_tokens, 400);
  assert.equal("chat_template_kwargs" in ai.calls[0].input, false);
});

// ------------------------------------------- Claude credit status recording

const CREDIT_TOO_LOW = {
  type: "error",
  error: {
    type: "invalid_request_error",
    message: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."
  }
};
const statusWrites = (db) => db.statements.filter((statement) => /ai_provider_status/.test(statement.sql));

test("a Claude success records its time and the estimated cost of its usage, and clears a stale failure", async (t) => {
  mockFetch(t, () => claudeResponse({ total: "5.00" }, { usage: { input_tokens: 2_000, output_tokens: 600 } }));
  const db = createFakeDb();
  const result = await runVisionJson(db, GATEWAY_BYOK, visionInput());
  assert.equal(result.provider, "claude");
  const [write, ...rest] = statusWrites(db);
  assert.equal(rest.length, 0);
  assert.match(write.sql, /INSERT INTO ai_provider_status/);
  assert.match(write.sql, /last_failure_category = CASE/);
  assert.match(write.args[0], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  // 2,000 x 0.10 + 600 x 0.50 micro-USD at the default prices.
  assert.equal(write.args[1], 500);
});

test("Claude answers the caller rejects still count as a success, because the credit was spent", async (t) => {
  mockFetch(t, () => claudeResponse({ unexpected: true }));
  const db = createFakeDb();
  const ai = stubWorkersAi({ response: "{\"total\":\"9.90\"}" });
  const result = await runVisionJson(db, { ...GATEWAY_BYOK, AI: ai }, visionInput());
  assert.equal(result.provider, "workers-ai");
  assert.equal(statusWrites(db).length, 1);
  assert.equal(statusWrites(db)[0].args[1], 300);
});

for (const [label, respond, category] of [
  ["Anthropic's credit-balance 400", () => new Response(JSON.stringify(CREDIT_TOO_LOW), { status: 400 }), "credit_exhausted"],
  ["the gateway's spend-limit 429", () => new Response("{\"success\":false,\"error\":[{\"code\":2003,\"message\":\"Spend limit exceeded\"}]}", { status: 429 }), "spend_capped"],
  ["a rejected gateway token", () => new Response("{}", { status: 401 }), "auth"],
  ["an overload", () => new Response("{}", { status: 529 }), "other"],
  ["a network failure", () => { throw new TypeError("network down"); }, "other"]
]) {
  test(`${label} is recorded as ${category} and Workers AI still answers`, async (t) => {
    mockFetch(t, respond);
    t.mock.method(console, "warn", () => {});
    const db = createFakeDb();
    const ai = stubWorkersAi({ response: "{\"total\":\"9.90\"}" });
    const result = await runVisionJson(db, { ...GATEWAY_BYOK, AI: ai }, visionInput());
    assert.deepEqual(result, { available: true, value: { total: "9.90" }, remaining: 10, provider: "workers-ai" });
    const writes = statusWrites(db);
    assert.equal(writes.length, 1);
    assert.match(writes[0].sql, /INSERT INTO ai_provider_status \(provider, last_failure_category, last_failure_at\)/);
    assert.equal(writes[0].args[0], category);
  });
}

test("a Claude call that times out is recorded as other", async (t) => {
  mockFetch(t, (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  }));
  const db = createFakeDb();
  await runVisionJson(db, { ...GATEWAY_BYOK, AI: stubWorkersAi({ response: { total: "4.00" } }) }, visionInput({ timeoutMs: 30 }));
  assert.equal(statusWrites(db)[0].args[0], "other");
});

test("with Claude not configured nothing is recorded about it", async (t) => {
  mockFetch(t, () => { throw new Error("gateway must not be called"); });
  const db = createFakeDb();
  const result = await runVisionJson(db, { AI_ASSIST_ENABLED: "true", AI: stubWorkersAi({ response: "{\"total\":\"1.00\"}" }) }, visionInput());
  assert.equal(result.provider, "workers-ai");
  assert.equal(statusWrites(db).length, 0);
});

for (const [label, statusWrite] of [
  ["throws", () => { throw new Error("no such table: ai_provider_status"); }],
  ["rejects", () => Promise.reject(new Error("D1 overloaded"))],
  ["hangs", () => new Promise(() => {})]
]) {
  test(`a status write that ${label} never breaks or holds the AI answer`, async (t) => {
    mockFetch(t, () => claudeResponse({ total: "7.00" }));
    const errors = t.mock.method(console, "error", () => {});
    const db = createFakeDb({ statusWrite });
    const started = Date.now();
    const result = await runVisionJson(db, GATEWAY_BYOK, visionInput());
    assert.deepEqual(result, { available: true, value: { total: "7.00" }, remaining: 10, provider: "claude" });
    assert.ok(Date.now() - started < 2_000);
    assert.equal(errors.mock.callCount(), 0);

    mockFetch(t, () => new Response(JSON.stringify(CREDIT_TOO_LOW), { status: 400 }));
    t.mock.method(console, "warn", () => {});
    const fallback = await runVisionJson(createFakeDb({ statusWrite }), { ...GATEWAY_BYOK, AI: stubWorkersAi({ response: "{\"total\":\"2.00\"}" }) }, visionInput());
    assert.equal(fallback.provider, "workers-ai");
  });
}

test("only the allowance counter and the status row are written, with no prompt, image or answer in them", async (t) => {
  const secretPrompt = "Read the receipt for Lumen Grocer card 4111";
  const secretAnswer = "88.88";
  for (const respond of [
    () => claudeResponse({ total: secretAnswer }),
    () => new Response(JSON.stringify(CREDIT_TOO_LOW), { status: 400 })
  ]) {
    mockFetch(t, respond);
    t.mock.method(console, "warn", () => {});
    const db = createFakeDb();
    await runVisionJson(db, { ...GATEWAY_BYOK, AI: stubWorkersAi({ response: "{\"total\":\"88.88\"}" }) }, visionInput({ prompt: secretPrompt }));
    assert.ok(db.statements.length >= 2);
    for (const statement of db.statements) {
      assert.match(statement.sql, /ai_assist_daily_usage|ai_provider_status/);
      const args = JSON.stringify(statement.args);
      for (const secret of [secretPrompt, secretAnswer, IMAGE.base64, "credit balance"]) {
        assert.equal(args.includes(secret), false, `${secret} in ${statement.sql}`);
      }
    }
  }
});
