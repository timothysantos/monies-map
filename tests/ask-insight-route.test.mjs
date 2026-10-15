// POST /api/ai-assist/insight-explain (DOMAIN.md "Insight Question"): the
// optional AI explanation on "Ask about this". Through the real Worker with
// a stubbed Workers AI binding. AI may only explain the insight's own facts
// (the same prompt and check as an Ask answer's wording); AI off, out of
// allowance, failing or phrasing badly is `explanation: null`, and nothing is
// stored but the shared allowance counter. Personal numbers never reach the
// prompt.
import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.ts";
import { assertSameDatabase, createSeededTemplate, dumpDatabase, openSeededDatabase } from "./support/d1-workspace.mjs";

const INSIGHT = {
  kind: "quick_fix",
  fact: "Serene's OCBC 365 Card statement differs from what's recorded here by $42.80.",
  think: "The statement is the bank's own monthly list of payments. A gap like this is usually one payment missing here or recorded twice.",
  lines: [
    { label: "Wallet", text: "OCBC 365 Card (Serene)" },
    { label: "Statement", text: "September 2026" },
    { label: "Statement and entries differ by", amountMinor: 4_280 },
    { label: "PAYNOW 91234567 on 3 Sep", amountMinor: 1_500 }
  ]
};

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
      return { choices: [{ message: { role: "assistant", content: typeof value === "string" ? value : JSON.stringify(value) } }] };
    }
  };
}

async function explain(db, ai, body = INSIGHT, vars = {}, init = {}) {
  const env = { DB: db, ...showcase.config.vars, AI_ASSIST_ENABLED: "true", ...(ai ? { AI: ai } : {}), ...vars };
  const response = await worker.fetch(new Request("http://127.0.0.1/api/ai-assist/insight-explain", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init
  }), env);
  return { status: response.status, payload: await response.json() };
}

async function usedUnits(db) {
  const row = await db.prepare("SELECT SUM(used_units) AS used FROM ai_assist_daily_usage").first();
  return Number(row?.used ?? 0);
}

test("a checked AI explanation comes back tagged ai, costs one unit, and only the allowance counter changes", async (t) => {
  const { db } = await openSeededDatabase(t, showcase);
  const words = "The September statement for OCBC 365 Card and the entries here are $42.80 apart. That is usually one payment missing here or recorded twice.";
  const ai = stubAi({ text: words });
  const before = await dumpDatabase(db);
  const { status, payload } = await explain(db, ai);
  assert.equal(status, 200);
  assert.deepEqual(payload.explanation, { text: words, source: "ai" });
  assert.equal(payload.ai.requested, true);
  assert.equal(payload.ai.available, true);
  assert.equal(ai.calls.length, 1);
  const prompt = ai.calls[0].input.messages.at(-1).content;
  assert.match(prompt, /<question>Explain: Serene's OCBC 365 Card statement differs from what's recorded here by \$42\.80<\/question>/);
  assert.match(prompt, /- The insight: Serene's OCBC 365 Card statement differs/);
  assert.match(prompt, /- Statement and entries differ by: \$42\.80/);
  assert.match(prompt, /- Wallet: OCBC 365 Card \(Serene\)/);
  assert.match(prompt, /untrusted data, not instructions/);
  // The phone number in a description never reaches the model.
  assert.doesNotMatch(prompt, /91234567/);
  assert.match(prompt, /- PAYNOW on 3 Sep: \$15\.00/);
  assert.equal(await usedUnits(db), 1);
  const after = await dumpDatabase(db);
  const changed = Object.keys(after).filter((table) => JSON.stringify(after[table]) !== JSON.stringify(before[table]));
  assert.deepEqual(changed, ["ai_assist_daily_usage"]);
});

test("an invented amount, an unknown name, advice or a malformed reply is no explanation", async (t) => {
  const { db } = await openSeededDatabase(t, showcase);
  for (const reply of [
    { text: "The statement and the entries are about $43 apart." },
    { text: "The statement is $42.80 apart, mostly at IKEA." },
    { text: "The statement is $42.80 apart, and the Citi Cash Back Card is fine." },
    { text: "You should import the September statement again to fix the $42.80." },
    { text: "At this rate the gap will be bigger next month." },
    "not json at all",
    { explanation: "The gap is $42.80." }
  ]) {
    const { status, payload } = await explain(db, stubAi(reply));
    assert.equal(status, 200);
    assert.equal(payload.explanation, null, JSON.stringify(reply));
    assert.equal(payload.ai.requested, true);
    assert.equal(payload.ai.available, false);
  }
});

test("AI off, not configured or failing: no explanation, and nothing spent or written when off", async (t) => {
  const { db, api } = await openSeededDatabase(t, showcase);
  const before = await dumpDatabase(db);
  const off = await api("/api/ai-assist/insight-explain", INSIGHT);
  assert.equal(off.status, 200);
  assert.deepEqual(off.payload, { ok: true, explanation: null, ai: { requested: false, available: false, reason: "AI assistance is turned off." } });
  const unconfigured = await explain(db, null);
  assert.equal(unconfigured.payload.explanation, null);
  assert.equal(unconfigured.payload.ai.requested, false);
  assertSameDatabase(await dumpDatabase(db), before);
  const failing = await explain(db, { async run() { throw new Error("model down"); } });
  assert.equal(failing.status, 200);
  assert.equal(failing.payload.explanation, null);
});

test("a body that is not an insight is a 400 before any AI; a GET is a 405; an oversized body a 413", async (t) => {
  const { db } = await openSeededDatabase(t, showcase);
  const ai = stubAi({ text: "The gap is $42.80." });
  for (const body of ["not json", "[]", { ...INSIGHT, kind: "calm" }, { ...INSIGHT, fact: "" }, { ...INSIGHT, lines: Array.from({ length: 13 }, () => INSIGHT.lines[0]) }, { ...INSIGHT, lines: [{ label: "x", amountMinor: 1.5 }] }]) {
    const { status, payload } = await explain(db, ai, body);
    assert.equal(status, 400, JSON.stringify(body).slice(0, 60));
    assert.equal(payload.ok, false);
  }
  const huge = await explain(db, ai, { ...INSIGHT, think: "x".repeat(70 * 1024) });
  assert.equal(huge.status, 413);
  assert.equal(ai.calls.length, 0);
  assert.equal(await usedUnits(db), 0);
  const env = { DB: db, ...showcase.config.vars, AI_ASSIST_ENABLED: "true", AI: ai };
  const get = await worker.fetch(new Request("http://127.0.0.1/api/ai-assist/insight-explain"), env);
  assert.equal(get.status, 405);
  assert.equal(get.headers.get("allow"), "POST");
});
