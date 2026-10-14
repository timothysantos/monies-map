import assert from "node:assert/strict";
import test from "node:test";

import { runTextJson } from "../src/domain/ai-provider.ts";
import { diagnoseClaudeRejection, runClaudeProviderDiagnostic } from "../src/domain/ai-provider-diagnosis.ts";

// Which layer refuses a Claude call: Cloudflare's gateway or Anthropic. The
// diagnosis is logged and returned by the owner diagnostic; neither may ever
// carry the gateway token, the API key or anything key-shaped.

const TOKEN = "gwtoken_ABCDEF1234567890abcdef1234567890ZZ";
const KEY = "sk-ant-api03-SECRETSECRETSECRET1234567890";
const ENV = {
  AI_ASSIST_ENABLED: "true",
  AI_GATEWAY_ACCOUNT_ID: "acct123",
  AI_GATEWAY_ID: "monies-map",
  AI_GATEWAY_TOKEN: TOKEN,
  AI_GATEWAY_BYOK_ALIAS: "monies-map-claude-api-key"
};

const GATEWAY_401 = JSON.stringify({ success: false, error: [{ code: 2009, message: `Unauthorized ${TOKEN}` }] });
const ANTHROPIC_401 = JSON.stringify({ type: "error", error: { type: "authentication_error", message: `invalid x-api-key ${KEY}` } });
const ANTHROPIC_CREDIT = JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } });

function fakeDb() {
  return {
    prepare() {
      const self = {
        bind() { return self; },
        async run() { return { meta: { changes: 1 } }; },
        async first() { return { used_units: 1 }; }
      };
      return self;
    }
  };
}

function stubFetch(status, body) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(body, { status });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test("diagnoses each rejection shape by layer", () => {
  assert.deepEqual(
    { source: diagnoseClaudeRejection(GATEWAY_401).source, message: diagnoseClaudeRejection(GATEWAY_401).message.startsWith("2009: Unauthorized") },
    { source: "gateway", message: true }
  );
  const a = diagnoseClaudeRejection(ANTHROPIC_401);
  assert.equal(a.source, "anthropic");
  assert.match(a.message, /^authentication_error: invalid x-api-key/);
  const c = diagnoseClaudeRejection(ANTHROPIC_CREDIT);
  assert.equal(c.source, "anthropic");
  assert.match(c.message, /credit balance/);
  assert.equal(diagnoseClaudeRejection("Missing cf-aig-authorization header").source, "gateway");
  assert.equal(diagnoseClaudeRejection("<html>teapot</html>").source, "unknown");
  assert.deepEqual(diagnoseClaudeRejection(null), { source: "unknown", message: "" });
});

test("the message is capped and scrubbed of keys, bearer values and long runs", () => {
  const raw = `Bearer abc.def-123 sk-live_abcdefghijk ${"a1".repeat(40)} ${TOKEN} ${"x".repeat(900)}`;
  const { message } = diagnoseClaudeRejection(raw, [TOKEN]);
  assert.ok(message.length <= 300);
  assert.doesNotMatch(message, /abc\.def|sk-live|a1a1a1|gwtoken_|xxxxxxxx/);
  assert.match(message, /\[redacted\]/);
});

test("a rejected Claude call logs the layer and message, never a secret", async () => {
  const stub = stubFetch(401, GATEWAY_401);
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(JSON.stringify(args));
  try {
    const result = await runTextJson(fakeDb(), { ...ENV, ANTHROPIC_API_KEY: KEY }, {
      capability: "entry-draft", prompt: "hi", schema: { type: "object" }, maxTokens: 10, parse: () => null, units: 1
    });
    assert.equal(result.available, false);
  } finally {
    console.warn = originalWarn;
    stub.restore();
  }
  const line = warnings.find((entry) => entry.includes("AI provider config rejected"));
  assert.ok(line, "the rejection is logged");
  assert.match(line, /"status":401/);
  assert.match(line, /"source":"gateway"/);
  assert.match(line, /Unauthorized/);
  for (const secret of [TOKEN, KEY, "Bearer"]) {
    assert.ok(!warnings.join("").includes(secret), `log must not contain ${secret}`);
  }
});

test("diagnostic: gateway 401, anthropic 401, anthropic 400 credit, success", async () => {
  const cases = [
    [401, GATEWAY_401, { ok: false, status: 401, source: "gateway" }],
    [401, ANTHROPIC_401, { ok: false, status: 401, source: "anthropic" }],
    [400, ANTHROPIC_CREDIT, { ok: false, status: 400, source: "anthropic" }],
    [200, JSON.stringify({ stop_reason: "max_tokens", content: [] }), { ok: true, status: 200, source: "none" }]
  ];
  for (const [status, body, expected] of cases) {
    const stub = stubFetch(status, body);
    try {
      const result = await runClaudeProviderDiagnostic(fakeDb(), { ...ENV, ANTHROPIC_API_KEY: KEY });
      assert.equal(result.ok, expected.ok);
      assert.equal(result.status, expected.status);
      assert.equal(result.source, expected.source);
      assert.equal(result.alias, "monies-map-claude-api-key");
      assert.equal(result.gatewayIdPresent, true);
      assert.equal(result.tokenPresent, true);
      const sent = JSON.parse(stub.calls[0].init.body);
      // The real request shape, to the gateway's Anthropic messages path.
      assert.equal(stub.calls[0].url, "https://gateway.ai.cloudflare.com/v1/acct123/monies-map/anthropic/v1/messages");
      assert.equal(sent.model, "claude-haiku-5-5");
      assert.ok(sent.max_tokens <= 1100);
      assert.equal(sent.output_config.effort, "low");
      assert.equal(sent.output_config.format.type, "json_schema");
      assert.equal(sent.messages[0].content.length, 1);
      assert.equal(result.model, "claude-haiku-5-5");
      assert.equal(result.path, "/v1/<account>/<gateway>/anthropic/v1/messages");
      assert.equal(stub.calls.length, 1);
      const serialised = JSON.stringify(result);
      assert.ok(!serialised.includes(TOKEN) && !serialised.includes(KEY), "response carries no secret");
    } finally {
      stub.restore();
    }
  }
});

test("diagnostic: not configured makes no request; spent allowance makes no request", async () => {
  const stub = stubFetch(200, "{}");
  try {
    const off = await runClaudeProviderDiagnostic(fakeDb(), { AI_ASSIST_ENABLED: "true" });
    assert.equal(off.ok, false);
    assert.equal(off.source, "none");
    assert.equal(off.tokenPresent, false);
    assert.equal(off.gatewayIdPresent, false);
    const spent = { prepare() { const s = { bind() { return s; }, async run() { return { meta: { changes: 0 } }; }, async first() { return { used_units: 100 }; } }; return s; } };
    const denied = await runClaudeProviderDiagnostic(spent, ENV);
    assert.equal(denied.ok, false);
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});
