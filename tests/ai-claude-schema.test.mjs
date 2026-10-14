import assert from "node:assert/strict";
import test from "node:test";

import { prepareClaudeSchema } from "../src/domain/ai-claude-schema.ts";
import { ASK_TURN_SCHEMA, parseAskTurnAction } from "../src/domain/ask-turn.ts";

// Anthropic refuses a schema with more than 24 optional properties or 16
// union types ("Schemas contains too many optional parameters (87)"), which
// returned a 400 for every Ask turn. The wire schema is flattened and the
// answer is restored to the nullable shape the parser reads.

function count(node, tally = { optional: 0, unions: 0 }) {
  if (Array.isArray(node)) { node.forEach((item) => count(item, tally)); return tally; }
  if (!node || typeof node !== "object") return tally;
  if (node.properties) {
    const required = new Set(node.required ?? []);
    tally.optional += Object.keys(node.properties).filter((key) => !required.has(key)).length;
  }
  if (Array.isArray(node.anyOf) || Array.isArray(node.type)) tally.unions += 1;
  Object.values(node).forEach((value) => count(value, tally));
  return tally;
}

test("the Ask turn schema is over Claude's limits, and its wire form is within them", () => {
  const before = count(ASK_TURN_SCHEMA);
  assert.ok(before.optional > 24 && before.unions > 16, JSON.stringify(before));
  const { schema } = prepareClaudeSchema(ASK_TURN_SCHEMA);
  assert.deepEqual(count(schema), { optional: 0, unions: 0 });
  assert.deepEqual(schema.properties.blocked.enum.at(-1), "");
  assert.equal(schema.properties.entry.properties.amount.type, "string");
});

test("a small schema is sent unchanged", () => {
  const small = { type: "object", required: ["total"], properties: { total: { type: "string" }, note: { type: ["string", "null"] } } };
  const prepared = prepareClaudeSchema(small);
  assert.equal(prepared.schema, small);
  assert.deepEqual(prepared.restore({ total: "1", note: "" }), { total: "1", note: "" });
});

test("restore returns empty values as null and empty objects as null", () => {
  const { restore } = prepareClaudeSchema(ASK_TURN_SCHEMA);
  const restored = restore({
    action: "entry",
    entry: { type: "expense", description: "Lunch", amount: "12.50", date: "", wallet: "", to_wallet: "", category: "", owner: "", note: "" },
    split: { payer: "", group: "", shares: [] },
    settlement: { from: "", to: "", amount: "", group: "", date: "" },
    plan: { month: "", copy_from: "", ops: [] },
    question: { topic: "spending", month: "", other_month: "", from_month: "", to_month: "", person: "" },
    search: { words: "", categories: [], wallets: [], person: "", month: "", type: "", min_amount: "", max_amount: "" },
    note: "",
    blocked: "",
    recategorise: { category: "", words: "", month: "", from_category: "", rule: false }
  });
  assert.deepEqual(restored.entry, { type: "expense", description: "Lunch", amount: "12.50", date: null, wallet: null, to_wallet: null, category: null, owner: null, note: null });
  assert.equal(restored.split, null);
  assert.equal(restored.settlement, null);
  assert.equal(restored.plan, null);
  assert.equal(restored.search, null);
  assert.equal(restored.recategorise, null);
  assert.equal(restored.note, null);
  assert.equal(restored.blocked, null);
  assert.equal(restored.action, "entry");
});

test("restore keeps real content and nulls a share's unused fields", () => {
  const { restore } = prepareClaudeSchema(ASK_TURN_SCHEMA);
  const restored = restore({
    action: "split",
    split: { payer: "Tim", group: "", shares: [{ person: "Joyce", percent: 0, amount: "", all: true }] },
    blocked: "no_delete"
  });
  assert.deepEqual(restored.split, { payer: "Tim", group: null, shares: [{ person: "Joyce", percent: null, amount: null, all: true }] });
  assert.equal(restored.blocked, "no_delete");
});

test("a negative: the unflattened answer shape still parses as before", () => {
  const { restore } = prepareClaudeSchema(ASK_TURN_SCHEMA);
  assert.equal(restore(null), null);
  assert.equal(parseAskTurnAction === undefined, false);
});

test("provider call: Claude gets the flat schema, the parser gets the nullable answer", async () => {
  const { runTextJson } = await import("../src/domain/ai-provider.ts");
  const db = { prepare() { const s = { bind() { return s; }, async run() { return { meta: { changes: 1 } }; }, async first() { return { used_units: 1 }; } }; return s; } };
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const answer = { action: "entry", entry: { type: "expense", description: "Lunch", amount: "12.50", date: "", wallet: "", to_wallet: "", category: "", owner: "", note: "" }, note: "", blocked: "" };
    return new Response(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(answer) }], usage: {} }), { status: 200 });
  };
  let seen = null;
  try {
    const result = await runTextJson(db, { AI_ASSIST_ENABLED: "true", AI_GATEWAY_ACCOUNT_ID: "a", AI_GATEWAY_ID: "g", AI_GATEWAY_TOKEN: "t" }, {
      capability: "ask_turn", prompt: "lunch 12.50", schema: ASK_TURN_SCHEMA, maxTokens: 400, units: 1,
      parse: (value) => { seen = value; return value; }
    });
    assert.equal(result.provider, "claude");
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(calls[0].url, "https://gateway.ai.cloudflare.com/v1/a/g/anthropic/v1/messages");
  assert.deepEqual(count(calls[0].body.output_config.format.schema), { optional: 0, unions: 0 });
  assert.equal(seen.entry.date, null);
  assert.equal(seen.note, null);
  assert.equal(seen.blocked, null);
  assert.equal(seen.entry.amount, "12.50");
});
