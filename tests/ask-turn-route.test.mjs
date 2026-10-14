// POST /api/ask/turn (docs/flows/ask-flow.md "AI first"), through the real
// Worker on a local D1 seeded with the demo household, with a stubbed AI
// provider returning each action. The route spends one allowance unit,
// checks the action against the household's data, and writes nothing else;
// AI off answers "rules" at once and spends nothing. The owner's case runs
// end to end: an Apple Pay entry, "Add to splits, all Joyce", the proposal,
// then the existing Add to Splits command, and Splits shows Joyce owing the
// whole amount.
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

async function turn(db, body, { ai = null, vars = {}, headers = {} } = {}) {
  const env = { DB: db, ...template.config.vars, ...(ai ? { AI: ai, AI_ASSIST_ENABLED: "true" } : {}), ...vars };
  const response = await worker.fetch(new Request("http://127.0.0.1/api/ask/turn", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ viewId: "person-tim", scope: "direct_plus_shared", month: THIS_MONTH, page: "ask", ...body })
  }), env);
  return { status: response.status, payload: await response.json() };
}

async function usedUnits(db) {
  const row = await db.prepare("SELECT SUM(used_units) AS used FROM ai_assist_daily_usage").first();
  return Number(row?.used ?? 0);
}

function promptOf(ai) {
  return ai.calls[0].input.messages.at(-1).content;
}

async function applePayEntry(api) {
  return createEntry(api, { date: TODAY, description: "STARBUCKS PAYNOW 91234567", accountName: "Citi Rewards", categoryName: "Food & Drinks", amountMinor: 4_250 });
}

test("with AI off the route answers rules at once: no context read, no allowance, nothing written", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const before = await dumpDatabase(db);
  const { status, payload } = await turn(db, { text: "Add to splits, all Joyce" });
  assert.equal(status, 200);
  assert.deepEqual(payload, { ok: true, mode: "rules", reason: "AI assistance is turned off." });
  assertSameDatabase(await dumpDatabase(db), before);
});

test("the owner's case: Apple Pay entry, \"Add to splits, all Joyce\", Save, and Splits shows Joyce owes the whole amount", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const entryId = await applePayEntry(api);
  const before = await dumpDatabase(db);
  const ai = stubAi({ action: "add_entry_to_splits", split: { payer: null, group: null, shares: [{ person: "Joyce", percent: null, amount: null, all: true }] } });

  const { status, payload } = await turn(db, { text: "Add to splits, all Joyce", focus: { kind: "saved_entry", entryId } }, { ai });

  assert.equal(status, 200);
  assert.equal(payload.mode, "ai");
  assert.equal(payload.action, "add_entry_to_splits");
  assert.deepEqual(payload.reply, {
    kind: "split_proposal",
    proposal: {
      entryId,
      description: "STARBUCKS PAYNOW 91234567",
      date: TODAY,
      amountMinor: 4_250,
      currency: "SGD",
      payerName: "Tim",
      groupId: null,
      groupName: "",
      splitBasisPoints: 0,
      shares: [{ personName: "Tim", basisPoints: 0, amountMinor: 0 }, { personName: "Joyce", basisPoints: 10_000, amountMinor: 4_250 }]
    }
  });
  // The prompt named the entry without its PayNow number or its amount.
  const prompt = promptOf(ai);
  assert.match(prompt, /In focus: a saved expense "Starbucks/);
  assert.doesNotMatch(prompt, /91234567|42\.50|4250/);
  // The turn itself wrote only the allowance counter.
  assert.equal(await usedUnits(db), 1);
  const after = await dumpDatabase(db);
  assertSameDatabase({ ...after, ai_assist_daily_usage: before.ai_assist_daily_usage }, before);

  // Save: the existing command with the proposal's share.
  const saved = await api("/api/splits/expenses/from-entry", { entryId, splitGroupId: payload.reply.proposal.groupId, splitBasisPoints: payload.reply.proposal.splitBasisPoints });
  assert.equal(saved.status, 200, JSON.stringify(saved.payload));
  const splits = await api(`/api/splits-page?view=person-joyce&month=${THIS_MONTH}`);
  const item = splits.payload.splitsPage.activity.find((activity) => activity.id === saved.payload.splitExpenseId);
  assert.equal(item.paidByPersonName, "Tim");
  assert.deepEqual(item.shares.map((share) => [share.personName, share.amountMinor]), [["Tim", 0], ["Joyce", 4_250]]);
  assert.equal(item.viewerAmountMinor, 4_250);
});

test("negative: an entry id from outside the household is no focus, and nothing is proposed", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const ai = stubAi({ action: "add_entry_to_splits", split: { shares: [{ person: "Joyce", all: true }] } });
  const { payload } = await turn(db, { text: "Add to splits, all Joyce", focus: { kind: "saved_entry", entryId: "txn-someone-elses" } }, { ai });
  assert.deepEqual(payload.reply, { kind: "note", text: "Which entry should go on Splits? Open it from Entries, then ask again." });
  assert.doesNotMatch(promptOf(ai), /someone-elses/);
});

test("each action comes back checked against the demo household", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const cases = [
    {
      text: "lunch 12.50 on UOB One",
      model: { action: "draft_entry", entry: { type: "expense", description: "lunch", amount: "12.50", wallet: "UOB One", owner: "me" } },
      check: (reply) => {
        assert.equal(reply.kind, "entry_draft");
        assert.equal(reply.draft.createBody.amountMinor, 1_250);
        assert.equal(reply.draft.createBody.accountName, "UOB One");
      }
    },
    {
      text: "dinner 80 I paid, Joyce half",
      model: { action: "draft_split_expense", entry: { description: "dinner", amount: "80" }, split: { payer: "me", shares: [{ person: "Joyce", percent: 50 }] } },
      check: (reply) => {
        assert.equal(reply.kind, "entry_draft");
        assert.deepEqual(reply.share, { on: true, groupId: "" });
        assert.equal(reply.draft.fields.splitBasisPoints.value, 5_000);
      }
    },
    {
      text: "Joyce paid me back 30",
      model: { action: "draft_settlement", settlement: { from: "Joyce", to: "Tim", amount: "30" } },
      check: (reply) => assert.deepEqual(reply.settlement, { fromPersonName: "Joyce", toPersonName: "Tim", amountMinor: 3_000, currency: "SGD", date: TODAY, groupId: null, groupName: "" })
    },
    {
      text: "where did my money go in may 2026",
      model: { action: "answer_question", question: { topic: "spending_where", month: "2026-05" } },
      check: (reply) => assert.deepEqual(reply, { kind: "question", text: "Where did my money go in May 2026?", viewId: "person-tim", scope: "direct_plus_shared", month: "2026-05" })
    },
    {
      text: "groceries in may 2026",
      model: { action: "search_entries", search: { categories: ["Groceries"], month: "2026-05" } },
      check: (reply) => assert.deepEqual(reply.filter.categories, ["Groceries"])
    },
    {
      text: "open splits",
      model: { action: "open_page", page: { name: "splits" } },
      check: (reply) => assert.deepEqual(reply, { kind: "open_page", page: "splits", params: { view: "person-tim", month: THIS_MONTH } })
    },
    {
      text: "add the thing",
      model: { action: "ask_clarification", clarify: { question: "Which thing do you mean?", options: ["Lunch", "Groceries"] } },
      check: (reply) => assert.deepEqual(reply, { kind: "clarify", question: "Which thing do you mean?", options: ["Lunch", "Groceries"] })
    },
    {
      text: "book me a flight",
      model: { action: "cannot_help", note: "Ask records and explains money; it can't book flights." },
      check: (reply) => assert.deepEqual(reply, { kind: "note", text: "Ask records and explains money; it can't book flights." })
    }
  ];
  for (const { text, model, check } of cases) {
    const { payload } = await turn(db, { text }, { ai: stubAi(model) });
    assert.equal(payload.mode, "ai", text);
    check(payload.reply);
  }
});

test("plan_change is drafted against May's real plan rows, with the plan's own figures", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const ai = stubAi({ action: "plan_change", plan: { month: "2026-05", copy_from: null, ops: [{ kind: "move", line: null, from: "food", to: "groceries", amount: "20" }] } });
  const { payload } = await turn(db, { text: "shift 20 bucks from food over to groceries for may 2026", month: "2026-05" }, { ai });
  assert.equal(payload.reply.kind, "plan");
  assert.equal(payload.reply.reading.source, "ai");
  assert.deepEqual(payload.reply.reading.draft.changes.map((change) => [change.label, change.beforeMinor, change.afterMinor]), [["Food", 65_000, 63_000], ["Groceries", 14_000, 16_000]]);
});

test("a malformed or unknown model answer falls back to the rules, with the allowance spent", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  for (const reply of ["not json", { action: "delete_everything" }]) {
    const { payload } = await turn(db, { text: "lunch 12" }, { ai: stubAi(reply) });
    assert.equal(payload.ok, true);
    assert.equal(payload.mode, "rules");
    assert.equal(payload.reason, "AI returned an unusable suggestion.");
  }
  assert.equal(await usedUnits(db), 2);
});

test("over the day's allowance the route answers rules and the provider is never called", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const ai = stubAi({ action: "cannot_help", note: "x" });
  const { payload } = await turn(db, { text: "lunch 12" }, { ai, vars: { AI_ASSIST_DAILY_LIMIT: "4" } });
  assert.equal(payload.mode, "ai");
  await db.prepare("UPDATE ai_assist_daily_usage SET used_units = 4").run();
  const over = await turn(db, { text: "lunch 12" }, { ai, vars: { AI_ASSIST_DAILY_LIMIT: "4" } });
  assert.equal(over.payload.mode, "rules");
  assert.match(over.payload.reason, /allowance/);
  assert.equal(ai.calls.length, 1);
});

// The public demo (wrangler.demo.jsonc): a whole-demo cap and a per-visitor
// cap, each counted by the Singapore day in the demo's own D1. A used-up cap
// answers rules with the plain demo note; the visitor is stored as a hash.
const DEMO_CAPS = { AI_ASSIST_DAILY_LIMIT: "4", AI_ASSIST_VISITOR_DAILY_LIMIT: "2" };
const visitor = (address, agent = "Safari") => ({ "cf-connecting-ip": address, "user-agent": agent });

test("demo: a visitor over their own daily cap gets the rules with the demo note; another visitor still gets Claude", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const ai = stubAi({ action: "cannot_help", note: "x" });
  for (let index = 0; index < 2; index += 1) {
    const { payload } = await turn(db, { text: "lunch 12" }, { ai, vars: DEMO_CAPS, headers: visitor("203.0.113.7") });
    assert.equal(payload.mode, "ai");
  }
  const over = await turn(db, { text: "lunch 12" }, { ai, vars: DEMO_CAPS, headers: visitor("203.0.113.7") });
  assert.deepEqual(over.payload, {
    ok: true,
    mode: "rules",
    reason: "The demo's Claude allowance is used up for today, so Ask is using its built-in rules.",
    notice: "demo_allowance",
    remaining: 0
  });
  assert.equal(ai.calls.length, 2, "the provider is not called over the cap");
  const other = await turn(db, { text: "lunch 12" }, { ai, vars: DEMO_CAPS, headers: visitor("203.0.113.7", "Chrome") });
  assert.equal(other.payload.mode, "ai", "the same address in another browser is another visitor");

  const counters = await rows(db, "SELECT household_id, usage_day, used_units FROM ai_assist_daily_usage ORDER BY household_id");
  assert.deepEqual(
    counters.map((row) => [row.household_id.replace(/[0-9a-f]{32}$/, "<hash>"), row.usage_day, row.used_units]).sort((left, right) => left[0].localeCompare(right[0]) || right[2] - left[2]),
    [["demo-visitor:<hash>", TODAY, 2], ["demo-visitor:<hash>", TODAY, 1], ["household-default", TODAY, 3]]
  );
  assert.doesNotMatch(JSON.stringify(counters), /203\.0\.113\.7|Safari|Chrome/, "no address or browser is stored");
});

test("demo: the whole demo's cap answers rules with the demo note and hands the visitor's unit back", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const ai = stubAi({ action: "cannot_help", note: "x" });
  await db.prepare("INSERT INTO ai_assist_daily_usage (household_id, usage_day, used_units) VALUES ('household-default', ?, 4)").bind(TODAY).run();
  const { payload } = await turn(db, { text: "lunch 12" }, { ai, vars: DEMO_CAPS, headers: visitor("198.51.100.4") });
  assert.equal(payload.mode, "rules");
  assert.equal(payload.notice, "demo_allowance");
  assert.equal(ai.calls.length, 0);
  const [{ used }] = await rows(db, "SELECT used_units AS used FROM ai_assist_daily_usage WHERE household_id LIKE 'demo-visitor:%'");
  assert.equal(used, 0);
});

test("negative: without the demo's visitor cap the allowance note stays production's and no visitor is counted", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const ai = stubAi({ action: "cannot_help", note: "x" });
  await db.prepare("INSERT INTO ai_assist_daily_usage (household_id, usage_day, used_units) VALUES ('household-default', ?, 4)").bind(new Date().toISOString().slice(0, 10)).run();
  const { payload } = await turn(db, { text: "lunch 12" }, { ai, vars: { AI_ASSIST_DAILY_LIMIT: "4" }, headers: visitor("198.51.100.4") });
  assert.equal(payload.mode, "rules");
  assert.equal(payload.notice, undefined);
  assert.match(payload.reason, /optional AI allowance/);
  assert.deepEqual(await rows(db, "SELECT household_id FROM ai_assist_daily_usage WHERE household_id LIKE 'demo-visitor:%'"), []);
});

test("the test reply header stands in for the model only in the test environment", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const entryId = await applePayEntry(api);
  const header = { "x-ask-turn-test-reply": JSON.stringify({ action: "add_entry_to_splits", split: { shares: [{ person: "Joyce", all: true }] } }) };
  const testEnv = await turn(db, { text: "Add to splits, all Joyce", focus: { kind: "saved_entry", entryId } }, { headers: header });
  assert.equal(testEnv.payload.reply.kind, "split_proposal");
  assert.equal(await usedUnits(db), 0);
  const production = await turn(db, { text: "Add to splits", focus: { kind: "saved_entry", entryId } }, { headers: header, vars: { APP_ENVIRONMENT: "production" } });
  assert.deepEqual(production.payload, { ok: true, mode: "rules", reason: "AI assistance is turned off." });
});

test("negative requests: no text, too long, too large, wrong method, another site's write", async (t) => {
  const { db, fetch } = await openSeededDatabase(t, template);
  assert.equal((await turn(db, { text: "  " })).status, 400);
  assert.equal((await turn(db, { text: "x".repeat(301) })).status, 400);
  const big = await fetch("/api/ask/turn", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "hi", pad: "x".repeat(70 * 1024) }) });
  assert.equal(big.status, 413);
  assert.equal((await fetch("/api/ask/turn")).status, 405);
  const crossSite = await fetch("/api/ask/turn", { method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "cross-site" }, body: JSON.stringify({ text: "hi" }) });
  assert.equal(crossSite.status, 403);
  assert.deepEqual(await rows(db, "SELECT * FROM ai_assist_daily_usage"), []);
});

// --- One stated share is enough (the owner's iPhone report) -------------------

async function toriEntry(api) {
  return createEntry(api, { date: TODAY, description: "Tori-Q", accountName: "Citi Rewards", categoryName: "Food & Drinks", amountMinor: 790 });
}

const figures = (reply) => reply.proposal.shares.map((share) => [share.personName, share.amountMinor]);

test("\"Add to splits, Joyce's share 1.6\" on a saved $7.90 entry: the model's two-person list with nothing in Tim still drafts Tim $6.30, Joyce $1.60", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const entryId = await toriEntry(api);
  const before = await dumpDatabase(db);
  const ai = stubAi({ action: "add_entry_to_splits", split: { payer: null, group: null, shares: [{ person: "Joyce", percent: null, amount: "1.6", all: null }, { person: "Tim", percent: null, amount: null, all: null }] } });
  const { payload } = await turn(db, { text: "Add to splits, Joyce's share 1.6", focus: { kind: "saved_entry", entryId } }, { ai });
  assert.equal(payload.mode, "ai");
  assert.equal(payload.reply.kind, "split_proposal");
  assert.deepEqual(figures(payload.reply), [["Tim", 630], ["Joyce", 160]]);
  assert.equal(payload.reply.proposal.percentGuess.retryText, "Add to splits, Joyce's share is 1.6%");
  // The prompt tells the model one share is enough, and carries no amount from the records.
  assert.match(promptOf(ai), /One stated share is enough/);
  assert.doesNotMatch(promptOf(ai), /7\.90|790/);
  assert.equal(await usedUnits(db), 1);
  assertSameDatabase({ ...(await dumpDatabase(db)), ai_assist_daily_usage: before.ai_assist_daily_usage }, before);
  // Saving is the existing command with the draft's share.
  const saved = await api("/api/splits/expenses/from-entry", { entryId, splitGroupId: payload.reply.proposal.groupId, splitBasisPoints: payload.reply.proposal.splitBasisPoints });
  assert.equal(saved.status, 200, JSON.stringify(saved.payload));
});

// AI off: the rules' own reader gives the same drafts for the same phrasings.
const OFFLINE = [
  ["Add to splits, Joyce's share 1.6", [630, 160]],
  ["Joyce pays 2", [590, 200]],
  ["Joyce owes me 1.60", [630, 160]],
  ["Joyce 30%", [553, 237]],
  ["Tim 70%", [553, 237]],
  ["all Joyce", [0, 790]],
  ["Joyce's share is 100", [0, 790]],
  ["split 50/50", [395, 395]]
];

for (const [text, [tim, joyce]] of OFFLINE) {
  test(`AI off, "${text}" on the saved entry: rules draft Tim ${tim}, Joyce ${joyce}; no allowance, nothing written`, async (t) => {
    const { db, api } = await openSeededDatabase(t, template);
    const entryId = await toriEntry(api);
    const before = await dumpDatabase(db);
    const { payload } = await turn(db, { text, focus: { kind: "saved_entry", entryId } });
    assert.equal(payload.mode, "rules");
    assert.equal(payload.reason, "AI assistance is turned off.");
    assert.equal(payload.action, "add_entry_to_splits");
    assert.deepEqual(figures(payload.reply), [["Tim", tim], ["Joyce", joyce]]);
    assertSameDatabase(await dumpDatabase(db), before);
  });
}

test("negative: AI off, a share too big, a message with no share, or no saved entry in focus gets no draft", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const entryId = await toriEntry(api);
  const focus = { kind: "saved_entry", entryId };
  const tooMuch = await turn(db, { text: "Joyce pays $10", focus });
  assert.deepEqual(tooMuch.payload.reply, { kind: "clarify", question: "Joyce's share can't be more than $7.90.", options: [] });
  assert.deepEqual((await turn(db, { text: "add to splits", focus })).payload, { ok: true, mode: "rules", reason: "AI assistance is turned off." });
  assert.deepEqual((await turn(db, { text: "lunch 12 on citi", focus })).payload, { ok: true, mode: "rules", reason: "AI assistance is turned off." });
  assert.deepEqual((await turn(db, { text: "Joyce's share 1.6" })).payload, { ok: true, mode: "rules", reason: "AI assistance is turned off." });
  assert.deepEqual(await rows(db, "SELECT * FROM ai_assist_daily_usage"), []);
});

test("a provider that answers nothing usable falls back to the rules' reading of the share", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const entryId = await toriEntry(api);
  const { payload } = await turn(db, { text: "Joyce 30%", focus: { kind: "saved_entry", entryId } }, { ai: stubAi("not json at all") });
  assert.equal(payload.mode, "rules");
  assert.equal(payload.reply.kind, "split_proposal");
  assert.deepEqual(figures(payload.reply), [["Tim", 553], ["Joyce", 237]]);
});
