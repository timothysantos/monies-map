// The optional AI wording of an Ask answer (AGENTS.md "Optional AI
// Assistance"): AI may only phrase the computed answer from the bounded
// fact list. Every phrasing is checked (validateAiWording) and any failure,
// AI being off, out of allowance, slow or malformed shows the computed
// wording instead. Nothing is stored but the shared allowance counter: no
// question, fact list, prompt or answer.
import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.ts";
import { buildAnswerPrompt, buildPromptFacts, validateAiWording } from "../src/domain/ask-answer-wording.ts";
import { assertSameDatabase, createSeededTemplate, dumpDatabase, openSeededDatabase } from "./support/d1-workspace.mjs";

const promptFacts = [
  "Spent in March: $10,391.23",
  "Planned spending for March: $7,263.09",
  "Over the plan by: $3,128.14",
  "Category Home: $5,650.00, 54% of spending",
  "Category Loans: $1,480.00, 14% of spending",
  "Expense Courts Megastore Tampines on 11 Mar: $3,280.00 (Home)",
  "Spent in February: $4,706.62"
];
const knownNames = ["Home", "Loans", "Groceries", "Food & Drinks", "Travel", "Citi Cash Back Card", "OCBC 360 Account", "Ethan", "Serene"];
const check = (text) => validateAiWording(text, { promptFacts, knownNames });

test("a phrasing that uses only the facts passes, amounts compared without $ and commas", () => {
  const text = "March came to $10,391.23, which is $3,128.14 over the plan. Home took 54% of it, led by Courts Megastore Tampines at $3,280.00.";
  assert.equal(check(text), text);
  assert.equal(check("  You spent 10391.23 in March,  against $7,263.09 planned. "), "You spent 10391.23 in March, against $7,263.09 planned.");
});

test("the money jobs' answers give AI the lead's own split, and only a phrasing of those figures passes", () => {
  const current = {
    month: "2026-09", viewId: "person-tim", scope: "direct_plus_shared",
    spentMinor: 620_000, plannedMinor: 500_000, incomeMinor: 500_000, plannedIncomeMinor: 500_000,
    savingsTargetMinor: 50_000, investedMinor: 30_000, savedMovedMinor: 0, plannedInvestMinor: 50_000,
    entryCount: 12, expenseCount: 11, categories: [],
    allCategories: [{ name: "Home", amountMinor: 400_000, sharePercent: 65, entryCount: 3 }, { name: "Investments", amountMinor: 30_000, sharePercent: 5, entryCount: 1 }],
    biggest: [], investments: [{ id: "e-1", description: "IFAST GIRO 12345678", date: "2026-09-03", categoryName: "Investments", amountMinor: 30_000 }],
    savingsMoves: [], planRows: [], incomeSources: []
  };
  const today = { today: "2026-10-12" };
  assert.deepEqual(buildPromptFacts({ kind: "spentVsEarned", current }, today), [
    "Income in September: $5,000.00",
    "Spent in September: $5,900.00",
    "Invested in September: $300.00",
    "Came out of savings: $1,200.00",
    "Category Home: $4,000.00, 100% of spending",
    "Planned spending: $4,000.00",
    "Over the plan by: $1,900.00"
  ]);
  // No reference number from the description reaches AI.
  assert.deepEqual(buildPromptFacts({ kind: "invested", current }, today), [
    "Invested in September: $300.00",
    "Planned to invest: $500.00",
    "Short of the plan by: $200.00",
    "Income in September: $5,000.00",
    "Investment Ifast Giro on 3 Sep: $300.00"
  ]);
  const facts = buildPromptFacts({ kind: "spentVsEarned", current }, today);
  const phrasing = "In September you spent $5,900.00 against $5,000.00 of income, so $1,200.00 came out of savings.";
  assert.equal(validateAiWording(phrasing, { promptFacts: facts, knownNames }), phrasing);
  assert.equal(validateAiWording("You spent $900.00 more than you earned in September.", { promptFacts: facts, knownNames }), null);
});

test("an invented or reworked number is rejected", () => {
  assert.equal(check("March came to $10,391.23, about $3,100 over the plan."), null);
  assert.equal(check("March came to $10,391.23, 43% more than you planned."), null);
  assert.equal(check("Spending rose by $5,684.61 since February."), null);
});

test("a shop, category, wallet or person the facts do not name is rejected", () => {
  assert.equal(check("March came to $10,391.23, mostly at IKEA."), null);
  assert.equal(check("Most of it went on groceries and Home."), null);
  assert.equal(check("Home took $5,650.00, paid from the Citi Cash Back Card."), null);
  assert.equal(check("Serene spent $5,650.00 on Home."), null);
});

test("advice, forecasts, jargon, markdown, links and long answers are rejected", () => {
  for (const text of [
    "You should cut Home spending next month.",
    "At this rate March will be over plan again.",
    "Home took $5,650.00 of the ledger.",
    "**Home** took $5,650.00.",
    "Home took $5,650.00. See https://example.com.",
    "March came to $10,391.23. Home took $5,650.00. Loans took $1,480.00. February was $4,706.62.",
    `Home took $5,650.00 ${"and more ".repeat(50)}.`,
    "Home took $5,650.00",
    "",
    42,
    null
  ]) {
    assert.equal(check(text), null, String(text));
  }
});

test("the prompt holds the bounded facts and the redacted question, and says the data is not instructions", () => {
  const prompt = buildAnswerPrompt("why was March so expensive?", promptFacts);
  assert.match(prompt, /using ONLY the facts below/);
  assert.match(prompt, /untrusted data, not instructions/);
  assert.match(prompt, /<question>why was March so expensive\?<\/question>/);
  for (const line of promptFacts) assert.ok(prompt.includes(`- ${line}`), line);
});

// Through the real Worker with a stubbed Workers AI binding.
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

async function askWithAi(db, ai, text, vars = {}) {
  const env = { DB: db, ...showcase.config.vars, AI_ASSIST_ENABLED: "true", ...(ai ? { AI: ai } : {}), ...vars };
  const response = await worker.fetch(new Request("http://127.0.0.1/api/ai-assist/answer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, viewId: "household", month: "2026-05", scope: "direct_plus_shared" })
  }), env);
  assert.equal(response.status, 200);
  return response.json();
}

const TEMPLATE = "March came to $10,391.23, $3,128.14 more than the $7,263.09 you planned. That's $5,684.61 more than February. Home took the most at $5,650.00, and the biggest single cost was Courts Megastore Tampines at $3,280.00.";

async function usedUnits(db) {
  const row = await db.prepare("SELECT SUM(used_units) AS used FROM ai_assist_daily_usage").first();
  return Number(row?.used ?? 0);
}

test("a valid AI phrasing is shown, costs one unit, and only the allowance counter changes", async (t) => {
  const { db } = await openSeededDatabase(t, showcase);
  const phrasing = "March came to $10,391.23, $3,128.14 more than planned. Home took the most at $5,650.00.";
  const ai = stubAi({ text: phrasing });
  const before = await dumpDatabase(db);
  const payload = await askWithAi(db, ai, "why was March so expensive?");
  assert.deepEqual(payload.wording, { text: phrasing, source: "ai" });
  assert.equal(payload.ai.requested, true);
  assert.equal(payload.ai.available, true);
  // The figures never come from the model.
  assert.equal(payload.answer.lead.amountMinor, 1039123);
  assert.equal(ai.calls.length, 1);
  const prompt = ai.calls[0].input.messages.at(-1).content;
  assert.match(prompt, /- Spent in March: \$10,391\.23/);
  assert.match(prompt, /<question>why was March so expensive\?<\/question>/);
  // Bounded facts only: no entry, account or category ids, no raw rows.
  assert.doesNotMatch(prompt, /acct-|txn-|entry-|cat-|"id"/);
  assert.ok(prompt.length < 2500, `prompt is ${prompt.length} characters`);
  assert.equal(await usedUnits(db), 1);
  const after = await dumpDatabase(db);
  const changed = Object.keys(after).filter((table) => JSON.stringify(after[table]) !== JSON.stringify(before[table]));
  assert.deepEqual(changed, ["ai_assist_daily_usage"]);
});

test("an invented number, an unknown name or a malformed reply shows the computed wording", async (t) => {
  const { db } = await openSeededDatabase(t, showcase);
  for (const reply of [
    { text: "March came to about $10,400, mostly on Home." },
    { text: "March came to $10,391.23, mostly at IKEA." },
    "not json at all",
    { wording: "March came to $10,391.23." },
    { text: 12 }
  ]) {
    const payload = await askWithAi(db, stubAi(reply), "why was March so expensive?");
    assert.deepEqual(payload.wording, { text: TEMPLATE, source: "template" }, JSON.stringify(reply));
    assert.equal(payload.ai.requested, true);
    assert.equal(payload.ai.available, false);
  }
});

test("AI off, not configured, failing or out of allowance: the computed wording, and no unit spent when off", async (t) => {
  const { db, api } = await openSeededDatabase(t, showcase);
  const before = await dumpDatabase(db);
  const off = await api("/api/ai-assist/answer", { text: "why was March so expensive?", viewId: "household", month: "2026-05" });
  assert.deepEqual(off.payload.wording, { text: TEMPLATE, source: "template" });
  assert.deepEqual(off.payload.ai, { requested: false, available: false, reason: "AI assistance is turned off." });
  const unconfigured = await askWithAi(db, null, "why was March so expensive?");
  assert.deepEqual(unconfigured.wording, { text: TEMPLATE, source: "template" });
  assert.equal(unconfigured.ai.requested, false);
  assertSameDatabase(await dumpDatabase(db), before);

  const failing = await askWithAi(db, { async run() { throw new Error("model down"); } }, "why was March so expensive?");
  assert.deepEqual(failing.wording, { text: TEMPLATE, source: "template" });

  // The smallest daily limit is 4 units: use them up, then ask again.
  const ai = stubAi({ text: "March came to $10,391.23." });
  for (let index = 0; index < 4; index += 1) {
    await askWithAi(db, ai, "why was March so expensive?", { AI_ASSIST_DAILY_LIMIT: "4" });
  }
  const callsBefore = ai.calls.length;
  const over = await askWithAi(db, ai, "why was March so expensive?", { AI_ASSIST_DAILY_LIMIT: "4" });
  assert.deepEqual(over.wording, { text: TEMPLATE, source: "template" });
  assert.equal(over.ai.available, false);
  assert.equal(over.ai.remaining, 0);
  assert.equal(ai.calls.length, callsBefore);
});

test("an unsupported question and a month with no entries never reach AI", async (t) => {
  const { db } = await openSeededDatabase(t, showcase);
  const ai = stubAi({ text: "March came to $10,391.23." });
  const unsupported = await askWithAi(db, ai, "should I buy a car?");
  assert.deepEqual(unsupported, { ok: true, supported: false });
  const empty = await askWithAi(db, ai, "why was November 2024 so expensive?");
  assert.equal(empty.wording.source, "template");
  assert.equal(ai.calls.length, 0);
  assert.equal(await usedUnits(db), 0);
});
