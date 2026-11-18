// Ask audit 2 through the real Worker on a seeded local D1, with the model
// stubbed (no live model in CI):
// - B14: "make all Grab rides Transport" with the model leaving the
//   category out is the bulk change card in one model call; saving it moves
//   exactly those rows.
// - The rules backup wins over a question loop: "settle up with Joyce", read
//   by the model as a payment with no amount, is the settle-up question with
//   each group to tap (B20); a rules "couldn't read that" never replaces the
//   model's own question.
// - B15: "make that one Groceries" after an answer that showed one entry is
//   a change to that entry, with AI and with the rules; an id from outside
//   the household is no entry.
// - B31: the day's allowance used up says so.
// - B27: a note change's history line names no Splits sync.
import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.ts";
import { todayInAppTimeZone } from "../src/lib/app-calendar.ts";
import { assertSameDatabase, createEntry, createSeededTemplate, dumpDatabase, openSeededDatabase, rows } from "./support/d1-workspace.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const TODAY = todayInAppTimeZone();
const THIS_MONTH = TODAY.slice(0, 7);

function stubAi(...replies) {
  const calls = [];
  return {
    calls,
    async run(model, input) {
      calls.push(input.messages.at(-1).content);
      const value = replies[Math.min(calls.length - 1, replies.length - 1)];
      return { choices: [{ message: { role: "assistant", content: JSON.stringify(value) } }] };
    }
  };
}

async function turn(db, body, { ai = null, vars = {} } = {}) {
  const env = { DB: db, ...template.config.vars, ...(ai ? { AI: ai, AI_ASSIST_ENABLED: "true" } : {}), ...vars };
  const response = await worker.fetch(new Request("http://127.0.0.1/api/ask/turn", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ viewId: "person-tim", scope: "direct_plus_shared", month: THIS_MONTH, page: "ask", ...body })
  }), env);
  return { status: response.status, payload: await response.json() };
}

function withoutUsage(dump, before) {
  return { ...dump, ai_assist_daily_usage: before.ai_assist_daily_usage };
}

test("B14: the model left the category out: one call, the bulk card for Public Transport, and Save moves exactly those rows", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const ids = [];
  for (const [index, amountMinor] of [1_850, 2_240, 1_620].entries()) {
    ids.push(await createEntry(api, { date: TODAY, description: `ZQGRAB* RIDE ${index}`, accountName: "UOB One", categoryName: "Food & Drinks", amountMinor }));
  }
  const before = await dumpDatabase(db);
  const ai = stubAi({ action: "recategorise", recategorise: { category: null, words: "zqgrab" } });
  const { payload } = await turn(db, { text: "make all ZQGrab rides Transport" }, { ai });

  assert.equal(ai.calls.length, 1, "no repair turn spent");
  assert.equal(payload.mode, "ai");
  assert.equal(payload.reply.kind, "change");
  assert.equal(payload.reply.change.type, "recategorise_bulk");
  assert.equal(payload.reply.change.count, 3);
  assert.deepEqual(payload.reply.change.rows[0], { field: "category", before: "Food & Drinks", after: "Public Transport" });
  // The names it moves are on the card (B10).
  assert.equal(payload.reply.change.rows[1].field, "description");
  assertSameDatabase(withoutUsage(await dumpDatabase(db), before), before);

  const [step] = payload.reply.change.save;
  assert.equal(step.path, "/api/entries/update-category");
  const saved = await api(step.path, step.body);
  assert.equal(saved.status, 200, JSON.stringify(saved.payload));
  const after = await rows(db, `SELECT transactions.id, categories.name AS category FROM transactions JOIN categories ON categories.id = transactions.category_id WHERE transactions.id IN (${ids.map(() => "?").join(",")}) ORDER BY transactions.id`, ...ids);
  assert.deepEqual(after.map((row) => row.category), ["Public Transport", "Public Transport", "Public Transport"]);
});

test("B14 negative: no category in the words is the question, with categories to tap as whole messages", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await createEntry(api, { date: TODAY, description: "ZQGRAB* RIDE", accountName: "UOB One", categoryName: "Food & Drinks", amountMinor: 1_200 });
  const ai = stubAi({ action: "recategorise", recategorise: { category: null, words: "zqgrab" } });
  const { payload } = await turn(db, { text: "make all zqgrab rides" }, { ai });
  assert.equal(payload.reply.kind, "clarify");
  assert.equal(payload.reply.question, "Which category should it go in?");
  assert.ok(payload.reply.options.length >= 1 && payload.reply.options.length <= 3, JSON.stringify(payload.reply.options));
  for (const option of payload.reply.options) assert.match(option, /^Move all zqgrab to /);
  assert.ok(!("error" in payload.reply));
});

test("B20: \"settle up with Joyce\" read by the model as a payment with no amount is the settle-up question with the groups, not \"how much?\"", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const before = await dumpDatabase(db);
  const ai = stubAi({ action: "draft_settlement", settlement: { from: "Joyce", to: null, amount: null } });
  const { payload } = await turn(db, { text: "settle up with joyce" }, { ai });
  assert.equal(payload.mode, "ai");
  assert.equal(payload.action, "split_group");
  assert.equal(payload.reply.kind, "clarify");
  assert.ok(payload.reply.options.length >= 2, JSON.stringify(payload.reply.options));
  for (const option of payload.reply.options) assert.match(option, /^Settle up /);
  assert.equal(ai.calls.length, 1);
  assertSameDatabase(withoutUsage(await dumpDatabase(db), before), before);
});

test("negative: a rules \"couldn't read that\" never replaces the model's question with chips", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const entryId = await createEntry(api, { date: TODAY, description: "KOUFU", accountName: "Citi Rewards", categoryName: "Food & Drinks", amountMinor: 700 });
  const ai = stubAi({ action: "recategorise", recategorise: { category: "sparkly" } });
  const { payload } = await turn(db, { text: "make it sparkly", focus: { kind: "saved_entry", entryId } }, { ai });
  assert.equal(payload.reply.kind, "clarify");
  assert.equal(payload.reply.question, "There's no category called \"sparkly\". Which one do you mean?");
  assert.ok(payload.reply.options.length > 0);
  for (const option of payload.reply.options) assert.match(option, /^Make it /);
});

test("B15: after an answer that showed one entry, \"make that one Groceries\" changes that entry, with AI and with the rules", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const entryId = await createEntry(api, { date: TODAY, description: "KOUFU PTE LTD", accountName: "Citi Rewards", categoryName: "Food & Drinks", amountMinor: 700 });
  const focus = { kind: "entry_list", list: { month: THIS_MONTH, search: "koufu", categories: [], entryId } };

  const ai = stubAi({ action: "recategorise", recategorise: { category: "Groceries" } });
  const { payload } = await turn(db, { text: "make that one groceries", focus }, { ai });
  assert.equal(payload.reply.kind, "change");
  assert.equal(payload.reply.change.type, "recategorise");
  assert.equal(payload.reply.change.entries[0].entryId, entryId);
  assert.deepEqual(payload.reply.change.rows, [{ field: "category", before: "Food & Drinks", after: "Groceries" }]);
  assert.match(ai.calls[0], /In focus: a saved expense "Koufu/);

  // AI off: the rules read the same.
  const rules = await turn(db, { text: "make that one groceries", focus });
  assert.equal(rules.payload.mode, "rules");
  assert.equal(rules.payload.reply.kind, "change");
  assert.equal(rules.payload.reply.change.entries[0].entryId, entryId);

  // Save: the existing command moves that one row.
  const [step] = payload.reply.change.save;
  const saved = await api(step.path, step.body);
  assert.equal(saved.status, 200, JSON.stringify(saved.payload));
  const [row] = await rows(db, "SELECT categories.name AS category FROM transactions JOIN categories ON categories.id = transactions.category_id WHERE transactions.id = ?", entryId);
  assert.equal(row.category, "Groceries");
});

test("B15 negative: an entry id from outside the household is no entry in focus", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const ai = stubAi({ action: "recategorise", recategorise: { category: "Groceries" } });
  const focus = { kind: "entry_list", list: { month: THIS_MONTH, search: "", categories: [], entryId: "txn-someone-elses" } };
  const { payload } = await turn(db, { text: "make that one groceries", focus }, { ai });
  assert.notEqual(payload.reply.kind, "change");
  assert.doesNotMatch(ai.calls[0], /someone-elses|a saved expense/);
});

test("B31: the day's allowance used up: the rules read it, and the page is told why", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const day = new Date().toISOString().slice(0, 10);
  await db.prepare("INSERT INTO ai_assist_daily_usage (household_id, usage_day, used_units) VALUES ('household-default', ?, 4)").bind(day).run();
  const ai = stubAi({ action: "draft_entry", entry: { description: "lunch", amount: "9" } });
  const { payload } = await turn(db, { text: "lunch 9" }, { ai, vars: { AI_ASSIST_DAILY_LIMIT: "4" } });
  assert.equal(payload.mode, "rules");
  assert.equal(payload.notice, "allowance_used");
  assert.equal(ai.calls.length, 0);
});

test("B31 negative: AI turned off is not the allowance", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const { payload } = await turn(db, { text: "lunch 9" });
  assert.equal(payload.mode, "rules");
  assert.equal(payload.notice, undefined);
});

test("B27: a note change's history line says what changed, not \"linked split note sync\"", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const entryId = await createEntry(api, { date: TODAY, description: "KOUFU", accountName: "Citi Rewards", categoryName: "Food & Drinks", amountMinor: 700 });
  const saved = await api("/api/entries/update-note", { entryId, note: "team lunch" });
  assert.equal(saved.status, 200, JSON.stringify(saved.payload));
  const events = await rows(db, "SELECT detail FROM audit_events WHERE entity_id = ? AND action = 'entry_note_updated'", entryId);
  assert.deepEqual(events.map((event) => event.detail), ["Updated entry note."]);
});
