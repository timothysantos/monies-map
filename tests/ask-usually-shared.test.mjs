// "Add the usual shared ones to Splits" in Ask (docs/flows/ask-flow.md
// "Usually shared"; src/domain/ask-usually-shared.ts), through the real Worker
// on a local D1 and a stubbed AI provider:
//
// - the model reports only the intent (and a shop the person named); the
//   server reads the same list Splits shows and answers with a change card,
//   writing nothing. Save is posted as the page posts it, through
//   POST /api/splits/expenses/add-usual, and Undo through remove-added.
// - the validator's negatives: a shop the person never said asks back, a shop
//   with nothing waiting says so, more than 200 is refused, over ten needs the
//   person's confirmed count (the command checks it).
// - the rules with AI off read the same messages into the same card; a message
//   that is not that request gets no action at all.
import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.ts";
import { todayInAppTimeZone } from "../src/lib/app-calendar.ts";
import { buildUsuallySharedChange, readUsuallySharedRules } from "../src/domain/ask-usually-shared.ts";
import { ASK_CHANGE_PATHS } from "../src/domain/ask-turn-actions.ts";
import { readAskTurnResponse, runChangeSteps } from "../src/client/ask-turn-api.js";
import { assertSameDatabase, createEntry, createSeededTemplate, dumpDatabase, openSeededDatabase, rows } from "./support/d1-workspace.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const TODAY = todayInAppTimeZone();
const SHOP = "Kopi Usual Cafe";
const day = (delta) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);

function stubAi(reply) {
  const calls = [];
  return { calls, async run(model, input) { calls.push({ model, input }); return { choices: [{ message: { role: "assistant", content: JSON.stringify(reply) } }] }; } };
}

async function post(db, body, { model = null, ai = true } = {}) {
  const stub = stubAi(model);
  const response = await worker.fetch(new Request("http://127.0.0.1/api/ask/turn", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ viewId: "person-tim", scope: "direct_plus_shared", month: TODAY.slice(0, 7), page: "ask", focus: null, history: [], ...body })
  }), { DB: db, ...template.config.vars, AI: stub, AI_ASSIST_ENABLED: ai ? "true" : "false" });
  assert.equal(response.status, 200);
  return { payload: await response.json(), calls: stub.calls };
}

const usual = (shop = null) => ({ action: "add_usually_shared", usually_shared: { shop } });

function pageFetch(db) {
  return async (path, init) => worker.fetch(new Request(`http://127.0.0.1${path}`, { ...init, headers: { ...init.headers, origin: "http://127.0.0.1" } }), { DB: db, ...template.config.vars });
}

// Tim shared the shop in Baby River three times long ago (the habit) and
// bought there `fresh` times lately. All are made first so Ask's own habits
// cannot put a new one on Splits by itself.
async function seed(api, { fresh = 2, shop = SHOP, shared = 3 } = {}) {
  await api("/api/ask/habits/setting", { enabled: false });
  const old = [];
  for (let index = 0; index < shared; index += 1) old.push(await createEntry(api, { date: day(-(110 + index * 8)), description: shop, amountMinor: 2_000 }));
  const recent = [];
  for (let index = 0; index < fresh; index += 1) recent.push(await createEntry(api, { date: day(-3 - (index % 60)), description: shop, amountMinor: 1_000 + index }));
  for (const entryId of old) {
    const added = await api("/api/splits/expenses/from-entry", { entryId, splitGroupId: "split-group-baby-river" });
    assert.equal(added.status, 200, JSON.stringify(added.payload));
  }
  return { old, recent };
}

test("the model's intent becomes a card of the same list Splits shows, every figure the app's, and nothing is written", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { recent } = await seed(api);
  const list = await api("/api/splits/usually-shared");
  const before = await dumpDatabase(db);
  const { payload, calls } = await post(db, { text: "add the usual shared ones to splits" }, { model: usual() });
  assert.equal(payload.mode, "ai", JSON.stringify(payload));
  assert.equal(payload.action, "add_usually_shared");
  const { change } = payload.reply;
  assert.equal(payload.reply.kind, "change");
  assert.equal(change.type, "usually_shared");
  assert.equal(change.title, SHOP);
  assert.equal(change.count, 2);
  assert.equal(change.confirmCount, null);
  assert.deepEqual(change.rows, [{ field: "group", before: "Not on Splits", after: "half each with Joyce in Baby River" }]);
  assert.deepEqual(change.entries.map((entry) => entry.entryId).sort(), [...recent].sort());
  assert.deepEqual(change.save, [{
    path: "/api/splits/expenses/add-usual",
    body: { groups: [{ splitGroupId: "split-group-baby-river", payerShareBasisPoints: 5000, entryIds: list.payload.groups[0].entries.map((entry) => entry.id) }] }
  }]);
  assert.deepEqual(change.undo, [{ path: "/api/splits/expenses/remove-added", body: {}, fromResult: { key: "undoSplitExpenseIds", as: "splitExpenseIds" } }]);
  assert.ok(ASK_CHANGE_PATHS.includes(change.save[0].path) && ASK_CHANGE_PATHS.includes(change.undo[0].path));
  // The model was shown no amount or entry: the prompt carries only names.
  assert.equal(calls.length, 1);
  const after = await dumpDatabase(db);
  assertSameDatabase({ ...after, ai_assist_daily_usage: before.ai_assist_daily_usage }, before);

  // The page keeps the card and saves it with its own code, then takes it back.
  const read = readAskTurnResponse({ ok: true, mode: "ai", action: "add_usually_shared", reply: payload.reply });
  assert.equal(read.reply.kind, "change");
  const saved = await runChangeSteps(read.reply.change.save, { fetchImpl: pageFetch(db) });
  assert.equal(saved.ok, true, saved.error);
  assert.equal(saved.result.addedCount, 2);
  for (const id of recent) assert.equal((await rows(db, "SELECT COUNT(*) AS n FROM split_expenses WHERE linked_transaction_id = ? AND deleted_at IS NULL", id))[0].n, 1);
  const undone = await runChangeSteps(read.reply.change.undo, { result: saved.result, fetchImpl: pageFetch(db) });
  assert.equal(undone.ok, true, undone.error);
  for (const id of recent) assert.equal((await rows(db, "SELECT COUNT(*) AS n FROM split_expenses WHERE linked_transaction_id = ? AND deleted_at IS NULL", id))[0].n, 0);
});

test("a shop the person named narrows the card; one with nothing waiting says so; one they never said asks back", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await seed(api);
  const named = await post(db, { text: "add the usual kopi usual ones to splits" }, { model: usual("kopi usual") });
  assert.equal(named.payload.reply.change.title, SHOP);

  const none = await post(db, { text: "add the usual ikea ones to splits" }, { model: usual("ikea") });
  assert.deepEqual(none.payload.reply, { kind: "note", text: "Nothing at ikea is waiting to be added to Splits." });

  const invented = await post(db, { text: "add the usual shared ones to splits" }, { model: usual("Sheng Siong") });
  assert.equal(invented.payload.reply.kind, "clarify");
  assert.equal(invented.payload.reply.question, "Which shop do you mean?");
  assert.equal(invented.calls.length, 1, "no repair turn for a shop only the person can name");
});

test("nothing waiting is a plain note, never an empty card", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const { payload } = await post(db, { text: "add the usual shared ones to splits" }, { model: usual() });
  assert.deepEqual(payload.reply, { kind: "note", text: "Nothing that you usually share is waiting to be added to Splits." });
});

test("over ten entries the card needs the person's count and the command checks it; over 200 no card is made", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  // Unsplit visits count against the habit (the rule's 60%), so the shop was shared often enough to hold with twelve more.
  await seed(api, { fresh: 12, shared: 20 });
  const { payload } = await post(db, { text: "add the usual shared ones to splits" }, { model: usual() });
  const { change } = payload.reply;
  assert.equal(change.count, 12);
  assert.equal(change.confirmCount, 12);
  assert.equal(change.entries.length, 8, "the first rows, and the count");

  const refused = await api("/api/splits/expenses/add-usual", change.save[0].body);
  assert.equal(refused.status, 400);
  assert.match(refused.payload.error, /Confirm adding all 12 entries first/);
  assert.equal((await rows(db, "SELECT COUNT(*) AS n FROM split_expenses WHERE description = ? AND deleted_at IS NULL", SHOP))[0].n, 20);
  const saved = await runChangeSteps(change.save, { confirmedCount: 12, fetchImpl: pageFetch(db) });
  assert.equal(saved.ok, true, saved.error);
  assert.equal(saved.result.addedCount, 12);

  // Pure: more than 200 waiting is refused before any card.
  const group = (entries) => ({ key: "k", shopName: "Big", groupId: "split-group-none", groupName: "Non-group expenses", basisPoints: 5000, ownerPersonId: "p", ownerName: "Tim", otherPersonId: "q", otherPersonName: "Joyce", evidenceCount: 5, matchedCount: 5, matchedBy: "description", currency: "SGD", totalMinor: entries.length * 100, entries });
  const entry = (index) => ({ id: `e${index}`, date: "2026-10-01", description: "Big", amountMinor: 100, currency: "SGD", ownerPersonId: "p", ownerName: "Tim" });
  const tooMany = buildUsuallySharedChange({ type: "usually_shared", shop: "" }, [group(Array.from({ length: 150 }, (_, i) => entry(i))), { ...group(Array.from({ length: 60 }, (_, i) => entry(1000 + i))), key: "k2", shopName: "Bigger" }]);
  assert.equal(tooMany.kind, "note");
  assert.match(tooMany.text, /210 entries are waiting, and Ask adds at most 200 at a time/);
  assert.equal(buildUsuallySharedChange({ type: "usually_shared", shop: "" }, null).kind, "note");
});

test("two shops make one card with 'Several' and one Add for both, each keeping its own split", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await seed(api);
  await seed(api, { shop: "Bakery Usual Two", fresh: 1 });
  const { payload } = await post(db, { text: "add the usual shared ones to splits" }, { model: usual() });
  const { change } = payload.reply;
  assert.equal(change.title, "Usually shared");
  assert.equal(change.rows[0].after, "Several");
  assert.equal(change.count, 3);
  assert.equal(change.save[0].body.groups.length, 2);
  assert.ok(change.entries.every((entry) => entry.detail === "half each with Joyce in Baby River"));
});

test("the rules read the same messages with AI off, typos and the bare two words included, and nothing else", async (t) => {
  for (const text of ["add the usual shared ones to splits", "put the usualy shered ones on splits", "usually shared", "Add the usually shared ones", "review the usual shared entries"]) {
    assert.equal(readUsuallySharedRules(text)?.action, "add_usually_shared", text);
  }
  for (const text of ["how do we usually split dinner", "add 50 to splits", "split this with joyce", "usually", "what is shared", "we usually shared a cab to the airport and it was great fun"]) {
    assert.equal(readUsuallySharedRules(text), null, text);
  }

  const { db, api } = await openSeededDatabase(t, template);
  await seed(api);
  const off = await post(db, { text: "add the usual shared ones to splits" }, { ai: false });
  assert.equal(off.payload.mode, "rules");
  assert.equal(off.payload.action, "add_usually_shared");
  assert.equal(off.payload.reply.kind, "change");
  assert.equal(off.payload.reply.change.count, 2);
  assert.equal(off.calls.length, 0, "no model call");

  // Not that request: with AI off the page's own rules take it, no action here.
  const other = await post(db, { text: "how do we usually split dinner" }, { ai: false });
  assert.equal(other.payload.mode, "rules");
  assert.equal(other.payload.action, undefined);
});
