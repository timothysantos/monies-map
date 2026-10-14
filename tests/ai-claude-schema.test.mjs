import assert from "node:assert/strict";
import test from "node:test";

import { canConstrainClaudeAnswer, measureClaudeSchema } from "../src/domain/ai-claude-schema.ts";
import { runTextJson } from "../src/domain/ai-provider.ts";
import { ASK_TURN_SCHEMA } from "../src/domain/ask-turn.ts";

// Anthropic refuses a grammar-constrained schema with more than 24 optional
// properties or 16 union types, or one whose grammar is too large (400 for
// every Ask turn: "too many optional parameters (87)", then "compiled grammar
// is too large"). Such a schema is described in the prompt instead.

const FAKE_DB = { prepare() { const s = { bind() { return s; }, async run() { return { meta: { changes: 1 } }; }, async first() { return { used_units: 1 }; } }; return s; } };
const ENV = { AI_ASSIST_ENABLED: "true", AI_GATEWAY_ACCOUNT_ID: "a", AI_GATEWAY_ID: "g", AI_GATEWAY_TOKEN: "t" };

async function callWith(schema, answerText) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: answerText }], usage: {} }), { status: 200 });
  };
  try {
    let seen = null;
    const result = await runTextJson(FAKE_DB, ENV, {
      capability: "ask_turn", prompt: "lunch 12.50", schema, maxTokens: 400, units: 1,
      parse: (value) => { seen = value; return value; }
    });
    return { calls, result, seen };
  } finally {
    globalThis.fetch = original;
  }
}

test("the Ask turn schema is over Claude's limits; a small schema is not", () => {
  const ask = measureClaudeSchema(ASK_TURN_SCHEMA);
  assert.ok(ask.optional > 24 && ask.unions > 16, JSON.stringify(ask));
  assert.equal(canConstrainClaudeAnswer(ASK_TURN_SCHEMA), false);
  const small = { type: "object", required: ["total"], properties: { total: { type: "string" }, note: { type: ["string", "null"] } } };
  assert.equal(canConstrainClaudeAnswer(small), true);
});

test("an oversized schema is not sent as a grammar: it is described in the prompt", async () => {
  const { calls, result, seen } = await callWith(ASK_TURN_SCHEMA, JSON.stringify({ action: "entry", entry: { description: "Lunch", amount: "12.50" } }));
  assert.equal(result.provider, "claude");
  assert.equal(seen.entry.amount, "12.50");
  assert.equal(calls[0].url, "https://gateway.ai.cloudflare.com/v1/a/g/anthropic/v1/messages");
  assert.equal(calls[0].body.output_config.format, undefined);
  assert.equal(calls[0].body.output_config.effort, "low");
  const text = calls[0].body.messages[0].content[0].text;
  assert.match(text, /^lunch 12\.50/);
  assert.match(text, /must match this JSON Schema/);
  assert.ok(text.includes('"clarify"'), "the schema is in the prompt");
});

test("a small schema stays grammar-constrained and its prompt is untouched", async () => {
  const small = { type: "object", additionalProperties: false, required: ["total"], properties: { total: { type: "string" } } };
  const { calls } = await callWith(small, JSON.stringify({ total: "1.00" }));
  assert.equal(calls[0].body.output_config.format.type, "json_schema");
  assert.equal(calls[0].body.messages[0].content[0].text, "lunch 12.50");
});

test("negative: prose or a fenced non-answer from an unconstrained call is not accepted as JSON", async () => {
  const { result } = await callWith(ASK_TURN_SCHEMA, "Sure, I can help with that.");
  assert.equal(result.available, false);
});
