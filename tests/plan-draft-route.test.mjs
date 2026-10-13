// POST /api/ai-assist/plan-draft (docs/flows/ask-flow.md "Planning by
// chat"), through the real Worker on a local D1 seeded with the demo
// household: rules first, and the draft's figures are the plan rows' own.
// The optional AI only reads a request the rules could not, into the same
// structure, and its reading is dropped when it names anything the request
// does not. The route writes nothing but the AI allowance counter; Save goes
// through POST /api/month-plan/apply-changes, which refuses a stale draft.
import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.ts";
import { todayInAppTimeZone } from "../src/lib/app-calendar.ts";
import { addMonthKeys } from "../src/domain/plan-draft-reader.ts";
import { assertSameDatabase, createSeededTemplate, dumpDatabase, openSeededDatabase, rows } from "./support/d1-workspace.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
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

async function draft(db, body, { ai = null, vars = {} } = {}) {
  const env = { DB: db, ...template.config.vars, ...(ai ? { AI: ai, AI_ASSIST_ENABLED: "true" } : {}), ...vars };
  const response = await worker.fetch(new Request("http://127.0.0.1/api/ai-assist/plan-draft", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ viewId: "person-tim", month: "2026-05", ...body })
  }), env);
  assert.equal(response.status, 200);
  return response.json();
}

async function usedUnits(db) {
  const row = await db.prepare("SELECT SUM(used_units) AS used FROM ai_assist_daily_usage").first();
  return Number(row?.used ?? 0);
}

test("a move read by rules drafts the two May lines with the plan's own figures and writes nothing", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const before = await dumpDatabase(db);
  const payload = await draft(db, { text: "move $20 from Food to Groceries in May 2026" });

  assert.equal(payload.supported, true);
  assert.equal(payload.source, "rules");
  assert.deepEqual(payload.ai, { requested: false, available: false });
  assert.equal(payload.draft.month, "2026-05");
  assert.deepEqual(payload.draft.lead, { label: "", categoryName: null, amountMinor: 2_000, beforeMinor: null, fromLabel: "Food", toLabel: "Groceries" });
  assert.deepEqual(payload.draft.changes, [
    { rowId: "plan-oct-food", action: "update", section: "budget_buckets", label: "Food", categoryName: "Food & Drinks", ownerLabel: "Shared", beforeMinor: 65_000, afterMinor: 63_000 },
    { rowId: "plan-oct-groceries", action: "update", section: "budget_buckets", label: "Groceries", categoryName: "Groceries", ownerLabel: "Shared", beforeMinor: 14_000, afterMinor: 16_000 }
  ]);
  // Tim's view of May: his own and the shared lines, as the Month cards add them.
  const month = await (await worker.fetch(new Request("http://127.0.0.1/api/month-page?view=person-tim&month=2026-05&scope=direct_plus_shared"), { DB: db, ...template.config.vars })).json();
  const card = (label) => month.monthPage.metricCards.find((item) => item.label === label).amountMinor;
  assert.equal(payload.draft.totals.before.plannedSpendMinor, card("Planned spend"));
  assert.deepEqual(payload.draft.totals.before, payload.draft.totals.after);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("Save posts the draft's changes once: the plan moves, the planned total follows, and a second Save of the same draft is refused", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { draft: plan } = await draft(db, { text: "set groceries to $200 for may 2026" });
  assert.deepEqual(plan.apply, [{ action: "update", rowId: "plan-oct-groceries", expectedMinor: 14_000, plannedMinor: 20_000 }]);

  const saved = await api("/api/month-plan/apply-changes", { month: plan.month, changes: plan.apply });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.payload, { ok: true, month: "2026-05", applied: 1, undo: [{ action: "update", rowId: "plan-oct-groceries", expectedMinor: 20_000, plannedMinor: 14_000 }] });
  assert.deepEqual(await rows(db, "SELECT planned_amount_minor FROM monthly_plan_rows WHERE id = 'plan-oct-groceries'"), [{ planned_amount_minor: 20_000 }]);

  const again = await api("/api/month-plan/apply-changes", { month: plan.month, changes: plan.apply });
  assert.equal(again.status, 409);
  assert.equal(again.payload.ok, false);

  const undone = await api("/api/month-plan/apply-changes", { month: plan.month, changes: saved.payload.undo });
  assert.equal(undone.status, 200);
  assert.deepEqual(await rows(db, "SELECT planned_amount_minor FROM monthly_plan_rows WHERE id = 'plan-oct-groceries'"), [{ planned_amount_minor: 14_000 }]);
});

test("a name that fits two lines asks which; the answer drafts that line", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const asked = await draft(db, { text: "set sports to 150 for may 2026" });
  assert.deepEqual(asked.question, {
    field: "line",
    name: "sports",
    options: [
      { rowId: "plan-oct-sports", label: "Sports & Hobbies", ownerLabel: "Tim", plannedMinor: 10_450 },
      { rowId: "plan-oct-tennis", label: "Tennis lesson", ownerLabel: "Tim", plannedMinor: 12_400 }
    ]
  });
  const answered = await draft(db, { text: "set sports to 150 for may 2026", answers: { lines: { sports: "plan-oct-sports" } } });
  assert.deepEqual(answered.draft.apply, [{ action: "update", rowId: "plan-oct-sports", expectedMinor: 10_450, plannedMinor: 15_000 }]);
});

test("no month asks which, offering this month, the next and the month in view", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const thisMonth = todayInAppTimeZone().slice(0, 7);
  const asked = await draft(db, { text: "groceries budget 200" });
  assert.deepEqual(asked.question, { field: "month", options: ["2026-05", thisMonth, addMonthKeys(thisMonth, 1)].sort() });
  const answered = await draft(db, { text: "groceries budget 200", answers: { month: "2026-05" } });
  assert.equal(answered.draft.month, "2026-05");
});

test("an entry, a question or a wallet move is not a plan request, and never reaches AI", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const ai = stubAi({ kind: "plan", month: null, copyFrom: null, ops: [] });
  for (const text of ["lunch 12.50", "how am I doing against the plan?", "move $50 from UOB One to Citi Rewards"]) {
    assert.deepEqual(await draft(db, { text }, { ai }), { ok: true, supported: false }, text);
  }
  assert.equal(ai.calls.length, 0);
  assert.equal(await usedUnits(db), 0);
});

test("with AI off, a request the rules cannot read is not a plan request, and nothing is spent", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const before = await dumpDatabase(db);
  const payload = await draft(db, { text: "bump up the grocery money for may 2026 to $200" });
  assert.equal(payload.supported, false);
  assert.equal(payload.ai.requested, true);
  assert.equal(payload.ai.available, false);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("AI reads what the rules cannot into the same draft, for one unit, and only the allowance counter changes", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const before = await dumpDatabase(db);
  const ai = stubAi({ kind: "plan", month: "2026-05", copyFrom: null, ops: [{ kind: "set", line: "grocery", from: null, to: null, amount: "200" }] });
  const payload = await draft(db, { text: "bump up the grocery money for may 2026 to $200" }, { ai });

  assert.equal(payload.source, "ai");
  assert.equal(payload.ai.available, true);
  assert.deepEqual(payload.draft.apply, [{ action: "update", rowId: "plan-oct-groceries", expectedMinor: 14_000, plannedMinor: 20_000 }]);
  const prompt = ai.calls[0].input.messages.at(-1).content;
  assert.match(prompt, /<request>bump up the grocery money for may 2026 to \$200<\/request>/);
  assert.match(prompt, /untrusted data, not instructions/);
  assert.doesNotMatch(prompt, /plan-oct-|person-|cat-|acct-/);
  assert.equal(await usedUnits(db), 1);
  const after = await dumpDatabase(db);
  assert.deepEqual(Object.keys(after).filter((table) => JSON.stringify(after[table]) !== JSON.stringify(before[table])), ["ai_assist_daily_usage"]);
});

test("an AI reading with an amount, a name or a month the request does not have is dropped", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const text = "bump up the grocery money for may 2026 to $200";
  for (const reply of [
    { kind: "plan", month: "2026-05", copyFrom: null, ops: [{ kind: "set", line: "grocery", amount: "250" }] },
    { kind: "plan", month: "2026-05", copyFrom: null, ops: [{ kind: "set", line: "food", amount: "200" }] },
    { kind: "plan", month: "2026-06", copyFrom: null, ops: [{ kind: "set", line: "grocery", amount: "200" }] },
    { kind: "none", month: null, copyFrom: null, ops: [] },
    "not json"
  ]) {
    const payload = await draft(db, { text }, { ai: stubAi(reply) });
    assert.equal(payload.supported, false, JSON.stringify(reply));
    assert.equal(payload.ai.available, false);
  }
});
