import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.ts";
import { handleAiAssistRoute } from "../src/server/ai-assistance-routes.ts";

// H13 contracts for the optional AI routes, through the real Worker fetch
// with a fake D1 and a stub AI binding. They pin method handling, input
// rejection, the missing-binding and disabled fallbacks, the daily quota,
// valid responses and the shortcut-only gateway, so moving the routes out of
// src/index.ts can be proven identical.

const FACTS = {
  contextLabel: "August 2026 entries",
  entryCount: 2,
  spend: "$20.00",
  income: "$100.00",
  net: "$80.00",
  topCategoryName: "Food & Drinks",
  topCategoryAmount: "$20.00",
  topMerchantName: "Cold Storage",
  topMerchantAmount: "$20.00",
  notableFact: "Food & Drinks makes up all spending in this list.",
  cashFlowPrinciple: "$80.00 is left after the spending recorded so far.",
  nextSpendConsideration: "Before buying something non-essential, set aside money for planned bills.",
  accountingAdvice: "Review provisional entries before closing the month.",
  decisionMap: {
    enabled: true,
    needsReview: false,
    lanes: [{ id: "surplus", label: "Money left so far", value: "$80.00", detail: "This is not automatically free cash.", tone: "positive" }]
  }
};

// Every statement succeeds. `quotaChanges` is what the daily-usage upsert
// reports (0 = allowance used up); `usedUnits` is read back afterwards.
function createFakeDb({ quotaChanges = 1, usedUnits = 1 } = {}) {
  const sql = [];
  const statement = (text) => {
    const self = {
      bind() { return self; },
      async run() {
        sql.push(text);
        return { success: true, meta: { changes: /ai_assist_daily_usage/.test(text) ? quotaChanges : 1 } };
      },
      async all() { sql.push(text); return { results: [] }; },
      async first() {
        sql.push(text);
        return /ai_assist_daily_usage/.test(text) ? { used_units: usedUnits } : null;
      },
      async raw() { sql.push(text); return []; }
    };
    return self;
  };
  return {
    sql,
    prepare: (text) => statement(text),
    async batch(statements) { return statements.map(() => ({ results: [] })); },
    async exec() { return {}; }
  };
}

function stubAi(response) {
  const calls = [];
  return {
    calls,
    async run(model, input) {
      calls.push({ model, input });
      return typeof response === "function" ? response(model, input) : response;
    }
  };
}

async function post(env, path, body) {
  return worker.fetch(new Request(`http://127.0.0.1${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  }), env);
}

test("a GET on an AI route is not handled by it and ends in a 404", async () => {
  const response = await worker.fetch(new Request("http://127.0.0.1/api/ai-assist/financial-insight"), { DB: createFakeDb() });
  assert.equal(response.status, 404);
});

test("the insight route rejects facts it cannot trust, without calling AI", async () => {
  const ai = stubAi({ response: "{}" });
  const response = await post({ DB: createFakeDb(), AI: ai, AI_ASSIST_ENABLED: "true" }, "/api/ai-assist/financial-insight", { facts: { ...FACTS, entryCount: -1 } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, available: false, reason: "There is not enough computed information for an insight." });
  assert.equal(ai.calls.length, 0);
});

test("with AI turned off or the binding missing, the insight falls back to computed wording", async () => {
  for (const [env, reason] of [
    [{ DB: createFakeDb() }, "AI assistance is turned off."],
    [{ DB: createFakeDb(), AI_ASSIST_ENABLED: "true" }, "AI assistance is not configured for this environment."]
  ]) {
    const payload = await (await post(env, "/api/ai-assist/financial-insight", { facts: FACTS })).json();
    assert.equal(payload.ok, true);
    assert.equal(payload.available, false);
    assert.equal(payload.source, "deterministic");
    assert.equal(payload.reason, reason);
    assert.match(payload.narrative, /August 2026 entries/);
  }
});

test("a used-up daily allowance falls back without calling AI", async () => {
  const ai = stubAi({ response: "{}" });
  const db = createFakeDb({ quotaChanges: 0 });
  const payload = await (await post({ DB: db, AI: ai, AI_ASSIST_ENABLED: "true", AI_ASSIST_DAILY_LIMIT: "4" }, "/api/ai-assist/financial-insight", { facts: FACTS })).json();
  assert.equal(payload.available, false);
  assert.equal(payload.source, "deterministic");
  assert.equal(payload.reason, "Today's optional AI allowance has been used. The normal workflow is still available.");
  assert.equal(payload.remaining, 0);
  assert.equal(ai.calls.length, 0);
});

test("a valid AI template is rendered from computed facts only, and the remaining allowance is reported", async () => {
  const ai = stubAi({ response: JSON.stringify({ template: "{{notableFact}} {{contextLabel}} {{cashFlowPrinciple}} {{nextSpendConsideration}}" }) });
  const db = createFakeDb({ usedUnits: 3 });
  const payload = await (await post({ DB: db, AI: ai, AI_ASSIST_ENABLED: "true", AI_ASSIST_DAILY_LIMIT: "12" }, "/api/ai-assist/financial-insight", { facts: FACTS })).json();
  assert.deepEqual(payload, {
    ok: true,
    available: true,
    narrative: `${FACTS.notableFact} ${FACTS.contextLabel} ${FACTS.cashFlowPrinciple} ${FACTS.nextSpendConsideration}`,
    source: "ai",
    remaining: 9
  });
  assert.equal(ai.calls[0].model, "@cf/meta/llama-3.2-3b-instruct");
  assert.equal(ai.calls[0].input.max_tokens, 180);
});

test("an AI template with its own figures is refused and the computed wording is used", async () => {
  const ai = stubAi({ response: JSON.stringify({ template: "{{contextLabel}} spending rose 34%." }) });
  const payload = await (await post({ DB: createFakeDb(), AI: ai, AI_ASSIST_ENABLED: "true" }, "/api/ai-assist/financial-insight", { facts: FACTS })).json();
  assert.equal(payload.available, false);
  assert.equal(payload.source, "deterministic");
  assert.equal(payload.reason, "AI returned an unusable suggestion.");
});

test("statement fallback: empty text is refused; valid rows are bounded review rows; account numbers are redacted", async () => {
  const empty = await (await post({ DB: createFakeDb() }, "/api/ai-assist/statement-text-fallback", { fileName: "s.pdf", text: "   " })).json();
  assert.deepEqual(empty, { ok: true, available: false, reason: "No readable statement text was available after local extraction." });

  const ai = stubAi({ response: JSON.stringify({ rows: [
    { date: "2026-05-02", description: "COLD STORAGE", amount: "-12.50" },
    { date: "02/05/2026", description: "bad date", amount: "-1" },
    { date: "2026-05-03", description: "SALARY", amount: "2000" }
  ] }) });
  const payload = await (await post({ DB: createFakeDb(), AI: ai, AI_ASSIST_ENABLED: "true" }, "/api/ai-assist/statement-text-fallback", {
    fileName: "May statement.pdf",
    text: "Account Number: 1234567\n02 May COLD STORAGE 12.50"
  })).json();
  assert.equal(payload.available, true);
  assert.equal(payload.parserKey, "ai_text_fallback_statement");
  assert.equal(payload.sourceLabel, "May statement.pdf (AI review rows)");
  assert.deepEqual(payload.rows.map((row) => [row.date, row.description, row.expense, row.income, row.commitStatus]), [
    ["2026-05-02", "COLD STORAGE", "12.50", "", "needs_review"],
    ["2026-05-03", "SALARY", "", "2000.00", "needs_review"]
  ]);
  assert.doesNotMatch(ai.calls[0].input.messages[1].content, /1234567/);
});

test("transfer ranking needs an entry id; import ranking needs complete pairs", async () => {
  const missing = await post({ DB: createFakeDb() }, "/api/ai-assist/transfer-match-ranking", {});
  assert.equal(missing.status, 400);
  assert.deepEqual(await missing.json(), { ok: false, error: "Missing transfer entry id" });

  const noPairs = await (await post({ DB: createFakeDb() }, "/api/ai-assist/import-match-ranking", { pairs: [{ rowId: "r1" }] })).json();
  assert.deepEqual(noPairs, { ok: true, available: false, scores: [], reason: "There are no deterministic duplicate candidates to rank." });
});

test("import ranking scores complete pairs by embedding similarity", async () => {
  const ai = stubAi({ data: [[1, 0], [1, 0], [1, 0], [0, 1]] });
  const payload = await (await post({ DB: createFakeDb({ usedUnits: 2 }), AI: ai, AI_ASSIST_ENABLED: "true" }, "/api/ai-assist/import-match-ranking", { pairs: [
    { rowId: "r1", existingTransactionId: "t1", incomingDescription: "COLD STORAGE", existingDescription: "COLD STORAGE" },
    { rowId: "r2", existingTransactionId: "t2", incomingDescription: "GRAB", existingDescription: "SALARY" }
  ] })).json();
  assert.equal(payload.available, true);
  assert.deepEqual(payload.scores, [
    { rowId: "r1", existingTransactionId: "t1", similarity: 100 },
    { rowId: "r2", existingTransactionId: "t2", similarity: 0 }
  ]);
  assert.equal(ai.calls[0].model, "@cf/baai/bge-small-en-v1.5");
});

test("category rule suggestions with no categorized evidence propose nothing", async () => {
  const payload = await (await post({ DB: createFakeDb() }, "/api/ai-assist/category-rule-suggestions", {})).json();
  assert.deepEqual(payload, { ok: true, available: false, proposed: 0, reason: "There are not enough categorized expenses to propose a rule." });
});

test("import explanation without a mismatch explains nothing", async () => {
  const payload = await (await post({ DB: createFakeDb() }, "/api/ai-assist/import-explanation", {})).json();
  assert.deepEqual(payload, { ok: true, available: false, explanations: [], reason: "There is no statement mismatch to explain." });
});

test("the shortcut-only gateway hides every AI route before any statement runs", async () => {
  const db = createFakeDb();
  for (const path of ["/api/ai-assist/financial-insight", "/api/ai-assist/statement-text-fallback", "/api/ai-assist/category-rule-suggestions"]) {
    const response = await post({ DB: db, SHORTCUT_API_ONLY: "true", AI: stubAi({}), AI_ASSIST_ENABLED: "true" }, path, { facts: FACTS });
    assert.equal(response.status, 404, path);
  }
  assert.deepEqual(db.sql, []);
});

test("the AI route handler answers null for anything that is not a POST to one of its routes", async () => {
  const db = createFakeDb();
  const env = { DB: db, AI: stubAi({}), AI_ASSIST_ENABLED: "true" };
  const call = (method, path) => handleAiAssistRoute(new Request(`http://127.0.0.1${path}`, { method }), new URL(`http://127.0.0.1${path}`), env);
  assert.equal(await call("GET", "/api/ai-assist/financial-insight"), null);
  assert.equal(await call("POST", "/api/ai-assist/unknown"), null);
  assert.equal(await call("POST", "/api/imports-page"), null);
  assert.deepEqual(db.sql, []);
});
