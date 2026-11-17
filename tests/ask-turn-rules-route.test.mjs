// The offline backup's reading of what a message asks for
// (src/domain/ask-turn-rules.ts; docs/flows/ask-flow.md "Rules reading"),
// through the real Worker on a local D1 seeded with the demo household
// (Tim and Joyce). With AI off:
//
// - "Joyce paid me back $30" is a settle-up payment draft (never an expense),
//   saved through the existing settlement command; delete, import and page
//   messages answer with the existing note and page; a balance is the
//   who-owes-whom answer.
// - the saved entry in focus: "make it Transport", "note: team lunch",
//   "make it 14" are change cards saved through ASK_CHANGE_PATHS; a change
//   the rules can't read says so and changes nothing.
// - the card being filled: "it's Joyce's" sets its owner; "split with Joyce"
//   turns Splits on. A new "dinner $80 split with Joyce" is a shared expense
//   with Splits on.
// - AI on: a model that drafts an expense from a payment back is refused,
//   repaired once, and then answered with the rules' reading.
import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.ts";
import { todayInAppTimeZone } from "../src/lib/app-calendar.ts";
import { runChangeSteps } from "../src/client/ask-turn-api.js";
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
const OFF = "AI assistance is turned off.";

function stubAi(reply) {
  const calls = [];
  return { calls, async run(model, input) { calls.push({ model, input }); return { choices: [{ message: { role: "assistant", content: JSON.stringify(reply) } }] }; } };
}

async function turn(db, body, { ai = null } = {}) {
  const env = { DB: db, ...template.config.vars, ...(ai ? { AI: ai, AI_ASSIST_ENABLED: "true" } : {}) };
  const response = await worker.fetch(new Request("http://127.0.0.1/api/ask/turn", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ viewId: "person-tim", scope: "direct_plus_shared", month: THIS_MONTH, page: "ask", history: [], ...body })
  }), env);
  assert.equal(response.status, 200);
  return response.json();
}

function pageFetch(db) {
  return async (path, init) => worker.fetch(new Request(`http://127.0.0.1${path}`, { ...init, headers: { ...init.headers, origin: "http://127.0.0.1" } }), { DB: db, ...template.config.vars });
}

const draftFocus = (fields = {}) => ({
  kind: "draft",
  draft: { variant: "expense", description: "Koufu lunch", date: TODAY, accountId: "", categoryName: "Food & Drinks", ownerName: "Tim", amountMinor: 1_250, shareOn: false, splitGroupId: "", ...fields }
});

test("AI off: \"Joyce paid me back $30\" is a settle-up payment draft, never an expense, and Record payment saves it", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const before = await dumpDatabase(db);
  const payload = await turn(db, { text: "Joyce paid me back $30" });
  assert.equal(payload.mode, "rules");
  assert.equal(payload.action, "draft_settlement");
  assert.deepEqual(payload.reply, {
    kind: "settlement_draft",
    settlement: { fromPersonName: "Joyce", toPersonName: "Tim", amountMinor: 3_000, currency: "SGD", date: TODAY, groupId: null, groupName: "" }
  });
  // The turn wrote nothing and spent no allowance.
  assertSameDatabase(await dumpDatabase(db), before);

  const { settlement } = payload.reply;
  const saved = await api("/api/splits/settlements/create", { groupId: null, date: settlement.date, fromPersonName: settlement.fromPersonName, toPersonName: settlement.toPersonName, amountMinor: settlement.amountMinor, currency: settlement.currency });
  assert.equal(saved.status, 200, JSON.stringify(saved.payload));
  // No expense was recorded for it.
  assert.deepEqual(await rows(db, "SELECT id FROM transactions WHERE amount_minor = 3000 AND description LIKE '%paid%'"), []);
});

test("AI off: who paid whom, the amount, and the two whole sentences when neither side is known", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const tim = await turn(db, { text: "I paid Joyce back 20" });
  assert.deepEqual([tim.reply.settlement.fromPersonName, tim.reply.settlement.toPersonName, tim.reply.settlement.amountMinor], ["Tim", "Joyce", 2_000]);
  const noAmount = await turn(db, { text: "Joyce paid me back" });
  assert.deepEqual(noAmount.reply, { kind: "clarify", question: "How much was paid back? To settle everything that's owed, use Settle up on Splits.", options: ["Open Splits"] });
  // The household view with no login: "me" is nobody the app knows.
  const household = await turn(db, { text: "paid back 15", viewId: "household" });
  assert.deepEqual(household.reply, { kind: "clarify", question: "Who paid whom back?", options: ["Joyce paid Tim back $15", "Tim paid Joyce back $15"] });
  const chip = await turn(db, { text: "Joyce paid Tim back $15", viewId: "household" });
  assert.deepEqual([chip.reply.settlement.fromPersonName, chip.reply.settlement.toPersonName, chip.reply.settlement.amountMinor], ["Joyce", "Tim", 1_500]);
});

test("AI off: delete, import, a page and a balance get the existing note, page or answer, never a draft", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const before = await dumpDatabase(db);
  assert.deepEqual((await turn(db, { text: "delete the Koufu lunch" })).reply, {
    kind: "open_page", page: "entries", params: { view: "person-tim", month: THIS_MONTH },
    why: "Ask doesn't delete entries. Open the entry in Entries and delete it there, where you can check it first."
  });
  assert.deepEqual((await turn(db, { text: "import my statement" })).reply, {
    kind: "open_page", page: "imports", params: {}, why: "Statements are imported on Imports, where you can check the rows before they're added."
  });
  assert.deepEqual((await turn(db, { text: "open plan" })).reply, { kind: "open_page", page: "month", params: { view: "person-tim", month: THIS_MONTH } });
  assert.deepEqual((await turn(db, { text: "I owe Joyce $20" })).reply, { kind: "question", text: "Who owes whom on Splits?", viewId: "person-tim", scope: "direct_plus_shared", month: THIS_MONTH });
  assertSameDatabase(await dumpDatabase(db), before);
});

test("negative: ordinary entries with those words are left to the page's entry reader", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  for (const text of ["paid $50 for dinner", "Delete Bistro $12", "open-faced sandwich $8", "koufu lunch 12.50 on citi", "who owes who?"]) {
    assert.deepEqual(await turn(db, { text }), { ok: true, mode: "rules", reason: OFF }, text);
  }
});

test("AI off, a saved entry in focus: category, note and amount are change cards saved through their commands; an unreadable change says so", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const entryId = await createEntry(api, { date: TODAY, description: "Koufu lunch", categoryName: "Food & Drinks", amountMinor: 1_250 });
  const focus = { kind: "saved_entry", entryId };

  const category = await turn(db, { text: "make it Transport", focus });
  assert.equal(category.action, "recategorise");
  assert.deepEqual(category.reply.change.rows, [{ field: "category", before: "Food & Drinks", after: "Public Transport" }]);
  assert.deepEqual(category.reply.change.save.map((step) => step.path), ["/api/entries/update-category"]);

  const note = await turn(db, { text: "note: team lunch", focus });
  assert.equal(note.action, "edit_note");
  assert.deepEqual(note.reply.change.rows, [{ field: "note", before: "", after: "team lunch" }]);
  const saved = await runChangeSteps(note.reply.change.save, { fetchImpl: pageFetch(db) });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.deepEqual(await rows(db, "SELECT note FROM transactions WHERE id = ?", entryId), [{ note: "team lunch" }]);

  const amount = await turn(db, { text: "make it 14", focus });
  assert.equal(amount.action, "edit_saved_entry");
  const amountRow = amount.reply.change.rows.find((row) => row.field === "amount");
  assert.deepEqual([amountRow.beforeMinor, amountRow.afterMinor], [1_250, 1_400]);
  assert.deepEqual(amount.reply.change.save.map((step) => step.path), ["/api/entries/update"]);

  const unread = await turn(db, { text: "make it sparkly please", focus });
  assert.deepEqual(unread.reply, { kind: "note", text: "I couldn't read that change, so nothing changed. Tap Open this entry to change it yourself." });

  // A new entry typed after a save is still a new entry.
  assert.deepEqual(await turn(db, { text: "grab 15 citi", focus }), { ok: true, mode: "rules", reason: OFF });
});

test("AI off, a card being filled: \"it's Joyce's\" sets its owner and \"split with Joyce\" turns Splits on; a new shared expense has Splits on", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  assert.deepEqual((await turn(db, { text: "it's Joyce's", focus: draftFocus() })).reply, { kind: "draft_patch", patch: { ownerName: "Joyce" }, share: null });
  assert.deepEqual((await turn(db, { text: "Joyce's", focus: draftFocus() })).reply.patch, { ownerName: "Joyce" });
  const split = await turn(db, { text: "split with Joyce", focus: draftFocus() });
  assert.deepEqual(split.reply.patch, { ownerName: "Shared", splitBasisPoints: 5_000 });
  assert.deepEqual(split.reply.share, { on: true, groupId: "" });
  assert.equal(split.reply.assumptions[0].text, "You didn't say how to split it, so I split it evenly.");
  const stated = await turn(db, { text: "split it, Joyce 30%", focus: draftFocus() });
  assert.equal(stated.reply.patch.splitBasisPoints, 7_000);

  const fresh = await turn(db, { text: "dinner $80 split with Joyce" });
  assert.equal(fresh.action, "draft_split_expense");
  assert.equal(fresh.reply.kind, "entry_draft");
  assert.deepEqual(fresh.reply.share, { on: true, groupId: "" });
  assert.equal(fresh.reply.draft.fields.amountMinor.value, 8_000);
  assert.equal(fresh.reply.draft.fields.ownershipType.value, "shared");
  assert.equal(fresh.reply.draft.fields.splitBasisPoints.value, 5_000);
  const half = await turn(db, { text: "taxi 30 half with joyce" });
  assert.deepEqual(half.reply.share, { on: true, groupId: "" });
  assert.equal(half.reply.assumptions, undefined);

  // Negative: a name that is nobody, or a plain sentence, is left to the page.
  assert.deepEqual(await turn(db, { text: "it's Koufu's", focus: draftFocus() }), { ok: true, mode: "rules", reason: OFF });
  assert.deepEqual(await turn(db, { text: "dinner $80", focus: draftFocus() }), { ok: true, mode: "rules", reason: OFF });
});

test("AI on: a model that drafts an expense from \"Joyce paid me back $30\" is refused, repaired once, then answered with the payment draft", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const ai = stubAi({ action: "draft_entry", entry: { type: "expense", description: "Joyce paid me back", amount: "30" } });
  const payload = await turn(db, { text: "Joyce paid me back $30" }, { ai });
  assert.equal(payload.mode, "ai");
  assert.equal(payload.repaired, false);
  assert.equal(ai.calls.length, 2);
  assert.match(ai.calls[1].input.messages.at(-1).content, /not_an_entry/);
  assert.equal(payload.reply.kind, "settlement_draft");
  assert.equal(payload.reply.settlement.amountMinor, 3_000);

  const deleted = await turn(db, { text: "delete the Koufu lunch" }, { ai: stubAi({ action: "draft_entry", entry: { description: "Koufu lunch" } }) });
  assert.equal(deleted.reply.kind, "open_page");
  assert.equal(deleted.reply.page, "entries");

  // Negative: an ordinary expense the model drafts still drafts.
  const lunch = await turn(db, { text: "paid $50 for dinner" }, { ai: stubAi({ action: "draft_entry", entry: { type: "expense", description: "dinner", amount: "50" } }) });
  assert.equal(lunch.reply.kind, "entry_draft");
  assert.equal(lunch.reply.draft.fields.amountMinor.value, 5_000);
});
