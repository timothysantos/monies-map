// "Repair before asking" (docs/flows/ask-flow.md, "Three principles"):
// when the server's checks refuse the model's action, the route sends ONE
// repair turn with the checks' machine-readable errors and the valid options,
// and shows the corrected action. Only when that also fails does the person
// get the question with chips. The repair counts against the allowance like
// any turn, is capped at one per message, never runs for the model's own
// question or a question only the person can answer, and is logged as
// { action, validatorError, repaired } without the message text.
import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.ts";
import { todayInAppTimeZone } from "../src/lib/app-calendar.ts";
import { ASK_REPAIRABLE_CODES } from "../src/domain/ask-ambiguity.ts";
import { buildAskRepairPrompt } from "../src/domain/ask-turn-repair.ts";
import { createEntry, createSeededTemplate, openSeededDatabase } from "./support/d1-workspace.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const TODAY = todayInAppTimeZone();
const THIS_MONTH = TODAY.slice(0, 7);

// A stand-in for the model that answers each call from a list, in order.
function scripted(...answers) {
  const calls = [];
  return {
    calls,
    async run(model, input) {
      calls.push({ model, input });
      const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
      if (answer instanceof Error) throw answer;
      return { choices: [{ message: { role: "assistant", content: typeof answer === "string" ? answer : JSON.stringify(answer) } }] };
    }
  };
}

async function turn(db, body, { ai, vars = {} } = {}) {
  const env = { DB: db, ...template.config.vars, AI: ai, AI_ASSIST_ENABLED: "true", ...vars };
  const response = await worker.fetch(new Request("http://127.0.0.1/api/ask/turn", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ viewId: "person-tim", scope: "direct_plus_shared", month: THIS_MONTH, page: "ask", ...body })
  }), env);
  return response.json();
}

async function usedUnits(db) {
  const row = await db.prepare("SELECT SUM(used_units) AS used FROM ai_assist_daily_usage").first();
  return Number(row?.used ?? 0);
}

// The route's repair log lines, parsed.
function captureRepairLog(t) {
  const lines = [];
  const original = console.info;
  console.info = (...args) => {
    if (typeof args[0] === "string" && args[0].includes("ask_turn_repair")) lines.push(JSON.parse(args[0]));
    else original(...args);
  };
  t.after(() => {
    console.info = original;
  });
  return lines;
}

const lastPrompt = (ai, index) => ai.calls[index].input.messages.at(-1).content;

async function appleEntry(api) {
  return createEntry(api, { date: TODAY, description: "STARBUCKS PAYNOW 91234567", accountName: "Citi Rewards", categoryName: "Food & Drinks", amountMinor: 4_250 });
}

const SERENE = { action: "add_entry_to_splits", split: { payer: null, group: null, shares: [{ person: "Serene", all: true }] } };
const JOYCE = { action: "add_entry_to_splits", split: { payer: null, group: null, shares: [{ person: "Joyce", all: true }] } };

test("a refused action is repaired once: the second turn carries the errors and the valid options, and the corrected action is shown", async (t) => {
  const log = captureRepairLog(t);
  const { db, api } = await openSeededDatabase(t, template);
  const entryId = await appleEntry(api);
  const ai = scripted(SERENE, JOYCE);

  const payload = await turn(db, { text: "all Serene", focus: { kind: "saved_entry", entryId } }, { ai });

  assert.equal(payload.mode, "ai");
  assert.equal(payload.reply.kind, "split_proposal");
  assert.equal(payload.reply.proposal.splitBasisPoints, 0);
  assert.equal(payload.repaired, true);
  assert.equal(ai.calls.length, 2, "one repair, no more");
  assert.equal(await usedUnits(db), 2, "both turns count against the allowance");
  // The repair prompt: the same context and message, the refused answer, the errors.
  const repair = lastPrompt(ai, 1);
  assert.match(repair, /<message>all Serene<\/message>/);
  assert.match(repair, /<previous_answer>\n\{"action":"add_entry_to_splits","split":\{"shares":\[\{"person":"Serene","all":true\}\]\}\}\n<\/previous_answer>/);
  assert.match(repair, /<errors>\n\[\{"code":"unknown_person","field":"split.shares.person","valid":\["Tim","Joyce"\],"got":"Serene"\}\]\n<\/errors>/);
  assert.doesNotMatch(repair, /91234567|42\.50|4250/, "no number from the household's records is sent");
  // Logged without the message, the name or any amount.
  assert.deepEqual(log, [{ event: "ask_turn_repair", action: "add_entry_to_splits", validatorError: "unknown_person", field: "split.shares.person", repaired: true }]);
  assert.doesNotMatch(JSON.stringify(log), /Serene/);
});

test("negative: when the repair is refused too, the person gets the question with chips (and it is not repaired twice)", async (t) => {
  const log = captureRepairLog(t);
  const { db, api } = await openSeededDatabase(t, template);
  const entryId = await appleEntry(api);
  const ai = scripted(SERENE, { action: "add_entry_to_splits", split: { shares: [{ person: "Serena", all: true }] } }, JOYCE);

  const payload = await turn(db, { text: "all Serene", focus: { kind: "saved_entry", entryId } }, { ai });

  assert.equal(payload.reply.kind, "clarify");
  assert.deepEqual(payload.reply.options, ["Tim", "Joyce"]);
  assert.equal(payload.reply.error, undefined, "the reason for asking is never sent to the page");
  assert.equal(payload.repaired, false);
  assert.equal(ai.calls.length, 2, "capped at one repair");
  assert.equal(await usedUnits(db), 2);
  assert.equal(log[0].repaired, false);
  assert.equal(log[0].validatorError, "unknown_person");
});

test("negative: no repair for the model's own question, or for a question only the person can answer", async (t) => {
  const log = captureRepairLog(t);
  const { db } = await openSeededDatabase(t, template);
  const own = scripted({ action: "ask_clarification", clarify: { question: "Which thing do you mean?", options: ["Lunch", "Groceries"] } });
  const ownReply = await turn(db, { text: "add the thing" }, { ai: own });
  assert.equal(ownReply.reply.kind, "clarify");
  assert.equal(own.calls.length, 1);

  // "Which day?" with no day said is the person's to answer (date_invalid would be repaired; amount_needed is not).
  const needed = scripted({ action: "draft_settlement", settlement: { from: "Joyce", to: "Tim", amount: null } });
  const neededReply = await turn(db, { text: "settle up with joyce" }, { ai: needed });
  assert.equal(neededReply.reply.kind, "clarify");
  assert.equal(needed.calls.length, 1);
  assert.deepEqual(log, []);
  assert.equal(await usedUnits(db), 2);
});

test("negative: a repair that is unusable, throws, or asks again leaves the original question; a day's allowance used up skips the repair", async (t) => {
  const log = captureRepairLog(t);
  const { db, api } = await openSeededDatabase(t, template);
  const entryId = await appleEntry(api);
  const focus = { kind: "saved_entry", entryId };
  for (const second of ["not json", new Error("model down"), { action: "ask_clarification", clarify: { question: "Whose share?", options: ["Tim"] } }]) {
    const ai = scripted(SERENE, second);
    const payload = await turn(db, { text: "all Serene", focus }, { ai });
    assert.equal(payload.mode, "ai");
    assert.equal(payload.reply.kind, "clarify");
    assert.deepEqual(payload.reply.options, ["Tim", "Joyce"]);
    assert.equal(payload.repaired, false);
  }
  assert.deepEqual(log.map((line) => line.repaired), [false, false, false]);

  // Three of the day's four units are already used: the turn gets the fourth, the repair none.
  const { db: limited, api: limitedApi } = await openSeededDatabase(t, template);
  const limitedEntry = await appleEntry(limitedApi);
  await limited.prepare("INSERT INTO ai_assist_daily_usage (household_id, usage_day, used_units) VALUES ('household-default', ?, 3)").bind(new Date().toISOString().slice(0, 10)).run();
  const ai = scripted(SERENE, JOYCE);
  const payload = await turn(limited, { text: "all Serene", focus: { kind: "saved_entry", entryId: limitedEntry } }, { ai, vars: { AI_ASSIST_DAILY_LIMIT: "4" } });
  assert.equal(payload.reply.kind, "clarify");
  assert.equal(ai.calls.length, 1, "no second call over the allowance");
  assert.equal(payload.repaired, false);
});

test("a name the checks could not place is repaired with the valid options: a wallet, a category, a day, a month", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  // Each first answer is one the checks refuse (nothing else to fall back on), each repair a valid one.
  const cases = [
    {
      text: "make it travel",
      focus: { kind: "draft", draft: { variant: "expense", description: "Taxi", date: TODAY, accountId: "", categoryName: "Other", ownerName: "Tim", amountMinor: 1_200, shareOn: false, splitGroupId: "" } },
      first: { action: "edit_draft", entry: { category: "Voyages" } },
      repaired: { action: "edit_draft", entry: { category: "Public Transport" } },
      error: /"code":"unknown_category","field":"category","valid":\[[^\]]*"Public Transport"/,
      check: (reply) => assert.deepEqual(reply.patch, { categoryName: "Public Transport" })
    },
    {
      text: "how much did I save",
      first: { action: "answer_question", question: { topic: "saved", month: "sometime" } },
      repaired: { action: "answer_question", question: { topic: "saved", month: THIS_MONTH } },
      error: /"code":"month_invalid"/,
      check: (reply) => assert.equal(reply.kind, "question")
    }
  ];
  for (const { text, focus, first, repaired, error, check } of cases) {
    const ai = scripted(first, repaired);
    const payload = await turn(db, { text, ...(focus ? { focus } : {}) }, { ai });
    assert.equal(payload.repaired, true, text);
    assert.match(lastPrompt(ai, 1), error);
    check(payload.reply);
  }
});

test("the repair prompt: compact, scrubbed, and only for the codes a model can fix", () => {
  const context = {
    today: TODAY, month: THIS_MONTH, viewId: "person-tim", scope: "direct_plus_shared", page: "ask",
    people: [{ id: "person-tim", name: "Tim" }, { id: "person-joyce", name: "Joyce" }],
    entry: { today: TODAY, accounts: [], people: [], categoryNames: ["Groceries"], categoryMatchRules: [], defaultAccountPriorityIds: [], viewerName: "Tim" },
    groups: [], planLines: [], focus: null, history: [], text: "pay 4417123412341234 to joyce"
  };
  const prompt = buildAskRepairPrompt(context, { action: "draft_settlement", settlement: { from: "Joyce 91234567", to: null, amount: "30" }, entry: null }, { code: "unknown_person", field: "settlement.from", valid: ["Tim", "Joyce"], got: "Joyce 91234567" });
  assert.doesNotMatch(prompt, /4417123412341234|91234567/);
  assert.match(prompt, /<previous_answer>\n\{"action":"draft_settlement","settlement":\{"from":"Joyce \[number\]","amount":"30"\}\}\n<\/previous_answer>/);
  assert.ok(prompt.length < 6_000, "a repair adds only a few hundred characters to the turn's prompt");
  assert.deepEqual([...ASK_REPAIRABLE_CODES].sort(), [
    "amount_not_stated", "date_invalid", "month_invalid", "other", "plan_unreadable", "question_unclear",
    "shares_mismatch", "shares_unreadable", "unknown_category", "unknown_group", "unknown_person", "unknown_trip_event", "unknown_wallet"
  ]);
});
