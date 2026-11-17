// "Dinner ramen split with Joyce": a few words about a quick payment
// (DOMAIN.md "Quick Entry"; src/domain/ask-describe-entry.ts), through the
// real Worker on a local D1 and a stubbed AI provider:
//
// - with AI off the rules read the words box into one change card: the name,
//   the category from the words, Splits half each with the person named
//   (assumed and said). Save posts the card's own steps (entries/update, then
//   add-usual) and Undo takes both back.
// - the model reports what was said; the server derives the rest, and refuses
//   words the person never wrote, a person the household does not have, or
//   sharing with the payer themselves (a question back with the people).
// - "the 85,000 was ramen" typed into Ask finds the newest quick payment of
//   that amount still waiting for words; none says so.
import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.ts";
import { todayInAppTimeZone } from "../src/lib/app-calendar.ts";
import { readDescribeRules } from "../src/domain/ask-describe-entry.ts";
import { runChangeSteps } from "../src/client/ask-turn-api.js";
import { createSeededTemplate, dumpDatabase, assertSameDatabase, openSeededDatabase, rows } from "./support/d1-workspace.mjs";
import { saveRate } from "./support/foreign-wallet.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const TODAY = todayInAppTimeZone();

function stubAi(reply) {
  const calls = [];
  return { calls, async run(model, input) { calls.push({ model, input }); return { choices: [{ message: { role: "assistant", content: JSON.stringify(reply) } }] }; } };
}

async function turn(db, body, { model = null } = {}) {
  const stub = stubAi(model);
  const response = await worker.fetch(new Request("http://127.0.0.1/api/ask/turn", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ viewId: "person-tim", scope: "direct_plus_shared", month: TODAY.slice(0, 7), page: "ask", focus: null, history: [], ...body })
  }), { DB: db, ...template.config.vars, AI: stub, AI_ASSIST_ENABLED: model ? "true" : "false" });
  assert.equal(response.status, 200);
  return { payload: await response.json(), calls: stub.calls };
}

function pageFetch(db) {
  return async (path, init) => worker.fetch(new Request(`http://127.0.0.1${path}`, { ...init, headers: { ...init.headers, origin: "http://127.0.0.1" } }), { DB: db, ...template.config.vars });
}

// Tim's card payment typed on the pad in rupiah, amount only.
async function quickCardPayment(api, db, amountMinor = 8_500_000) {
  await api("/api/ask/habits/setting", { enabled: false });
  await saveRate(db, { quote: "IDR", quotePerBase: 13_500, rateDate: TODAY });
  const saved = await api("/api/cash-entries/create", { requestId: crypto.randomUUID(), personId: "person-tim", way: "card", accountId: "acct-uob-one", amountMinor, currency: "IDR" });
  assert.equal(saved.status, 200, JSON.stringify(saved.payload));
  return saved.payload.entry.entryId;
}

const wordsFocus = (entryId) => ({ kind: "saved_entry", entryId, words: true });

test("AI off: the words box reads name, category and 'split with Joyce' into one card; Save and Undo go through the existing commands", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const entryId = await quickCardPayment(api, db);
  const before = await dumpDatabase(db);

  const { payload, calls } = await turn(db, { text: "dinner ramen split with joyce", focus: wordsFocus(entryId) });

  assert.equal(calls.length, 0);
  assert.equal(payload.mode, "rules");
  assert.equal(payload.action, "describe_entry");
  const { change } = payload.reply;
  assert.equal(change.type, "edit_entry");
  assert.deepEqual(change.rows, [
    { field: "description", before: "Card payment", after: "Dinner ramen" },
    { field: "category", before: "Other", after: "Food & Drinks" },
    { field: "splits", before: "Not on Splits", after: "Half each with Joyce" }
  ]);
  assert.deepEqual(change.save.map((step) => step.path), ["/api/entries/update", "/api/splits/expenses/add-usual"]);
  assert.deepEqual(change.save[1].body, { groups: [{ splitGroupId: null, payerShareBasisPoints: 5000, entryIds: [entryId] }] });
  assert.deepEqual(change.undo.map((step) => step.path), ["/api/splits/expenses/remove-added", "/api/entries/update"]);
  assert.deepEqual(payload.reply.assumptions.map((line) => line.text), ["Shared half each with Joyce, as you didn't say the shares."]);
  // The amount on the card is the entry's own (SGD 6.30), never a figure from the words.
  assert.deepEqual([change.entries[0].amountMinor, change.entries[0].currency], [630, "SGD"]);
  assertSameDatabase(await dumpDatabase(db), before);

  const saved = await runChangeSteps(change.save, { fetchImpl: pageFetch(db) });
  assert.equal(saved.ok, true, saved.error);
  assert.deepEqual(await rows(db, `
    SELECT transactions.description, categories.name AS category, transactions.amount_minor, transactions.original_amount_minor
    FROM transactions LEFT JOIN categories ON categories.id = transactions.category_id WHERE transactions.id = ?`, entryId), [
    { description: "Dinner ramen", category: "Food & Drinks", amount_minor: 630, original_amount_minor: 8_500_000 }
  ]);
  assert.deepEqual(await rows(db, "SELECT payer_person_id, deleted_at IS NULL AS live FROM split_expenses WHERE linked_transaction_id = ?", entryId), [{ payer_person_id: "person-tim", live: 1 }]);

  const undone = await runChangeSteps(change.undo, { result: saved.result, fetchImpl: pageFetch(db) });
  assert.equal(undone.ok, true, undone.error);
  assert.deepEqual(await rows(db, "SELECT description FROM transactions WHERE id = ?", entryId), [{ description: "Card payment" }]);
  assert.deepEqual(await rows(db, "SELECT COUNT(*) AS n FROM split_expenses WHERE linked_transaction_id = ? AND deleted_at IS NULL", entryId), [{ n: 0 }]);
});

test("AI off: a partial word names it; a name the household does not have, or the payer themselves, is asked back with the people", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const entryId = await quickCardPayment(api, db);

  const partial = (await turn(db, { text: "ramen", focus: wordsFocus(entryId) })).payload;
  assert.deepEqual(partial.reply.change.rows, [{ field: "description", before: "Card payment", after: "Ramen" }]);
  assert.deepEqual(partial.reply.change.save.map((step) => step.path), ["/api/entries/update"]);

  const unknown = (await turn(db, { text: "dinner split with sam", focus: wordsFocus(entryId) })).payload;
  assert.equal(unknown.reply.kind, "clarify");
  assert.match(unknown.reply.question, /^Who did you share it with\?/);
  assert.deepEqual(unknown.reply.options, ["Tim", "Joyce"]);
  assert.equal("error" in unknown.reply, false);

  // The person's chip answer reads the words again with that person.
  const answered = (await turn(db, {
    text: "Joyce",
    focus: wordsFocus(entryId),
    history: [{ role: "user", text: "dinner split with sam" }, { role: "app", text: unknown.reply.question }]
  })).payload;
  assert.deepEqual(answered.reply.change.rows.map((row) => [row.field, row.after]), [["description", "Dinner"], ["category", "Food & Drinks"], ["splits", "Half each with Joyce"]]);

  const self = (await turn(db, { text: "lunch split with tim", focus: wordsFocus(entryId) })).payload;
  assert.equal(self.reply.kind, "clarify");
  assert.match(self.reply.question, /^Who did you share it with\?/);
});

test("the model reports the words; the server names, files and splits; words the person never wrote are asked back", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const entryId = await quickCardPayment(api, db);

  const { payload } = await turn(db, { text: "dinnr ramen splt w joyce 70/30", focus: wordsFocus(entryId) }, {
    model: { action: "describe_entry", describe: { words: "dinnr ramen", category: null, shared_with: "joyce", amount: null }, split: { shares: [{ person: "Tim", value: "70%" }] } }
  });
  assert.equal(payload.mode, "ai", JSON.stringify(payload));
  assert.deepEqual(payload.reply.change.rows.map((row) => [row.field, row.after]), [
    ["description", "Dinnr ramen"],
    ["splits", "Tim 70% and Joyce 30%"]
  ]);
  assert.deepEqual(payload.reply.change.save[1].body.groups[0].payerShareBasisPoints, 7000);

  const invented = (await turn(db, { text: "the usual", focus: wordsFocus(entryId) }, {
    model: { action: "describe_entry", describe: { words: "sushi omakase", category: null, shared_with: null, amount: null } }
  })).payload;
  assert.equal(invented.reply.kind, "clarify");
  assert.equal(invented.reply.question, "What was it? A few words are enough, like: dinner ramen.");
});

test("'the 85,000 was ramen with joyce' in Ask finds the newest quick payment of that amount; an amount with none says so", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const older = await quickCardPayment(api, db);
  const newest = await quickCardPayment(api, db);
  await quickCardPayment(api, db, 12_000_000);

  const found = (await turn(db, { text: "the 85,000 was ramen with joyce" })).payload;
  assert.equal(found.mode, "rules");
  assert.equal(found.reply.kind, "change", JSON.stringify(found.reply));
  assert.equal(found.reply.change.entries[0].entryId, newest);
  assert.notEqual(found.reply.change.entries[0].entryId, older);
  assert.deepEqual(found.reply.change.rows.map((row) => row.field), ["description", "splits"]);

  const none = (await turn(db, { text: "the 99,000 was taxi" })).payload;
  assert.deepEqual(none.reply, { kind: "note", text: "No payment of 99,000 from the last 3 days is waiting for a few words." });
});

test("the rules reader: category words, 'with NAME' only for a household person, a stated share kept out of the name", () => {
  const context = {
    people: [{ id: "person-tim", name: "Tim" }, { id: "person-joyce", name: "Joyce" }],
    viewId: "person-tim",
    text: "",
    entry: { categoryNames: ["Food & Drinks", "Groceries", "Travel", "Other"] },
    focus: null
  };
  const read = (text, options) => readDescribeRules(text, { ...context, text }, options)?.describe ?? null;
  assert.deepEqual(read("dinner ramen split with joyce"), { words: "dinner ramen", category: null, shared_with: "joyce", amount: null });
  assert.deepEqual(read("coffee with milk"), { words: "coffee with milk", category: null, shared_with: null, amount: null });
  assert.deepEqual(read("ramen with Joyce"), { words: "ramen", category: null, shared_with: "Joyce", amount: null });
  assert.deepEqual(read("bintang groceries"), { words: "bintang groceries", category: "Groceries", shared_with: null, amount: null });
  assert.deepEqual(read("flight home, travel"), { words: "flight home travel", category: "Travel", shared_with: null, amount: null });
  assert.deepEqual(read("groceries"), { words: "groceries", category: "Groceries", shared_with: null, amount: null });
  assert.deepEqual(read("it was taxi, shared w/ joyce 60/40"), { words: "taxi", category: null, shared_with: "joyce", amount: null });
  assert.deepEqual(read("the 85,000 was ramen", { byAmount: true }), { words: "ramen", category: null, shared_with: null, amount: "85,000" });
  assert.equal(read("ramen", { byAmount: true }), null);
  assert.equal(read("   "), null);
});
