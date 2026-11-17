// A typed or spoken amount in another currency ("coffee 35000 IDR cash"),
// through the real Worker on a local D1 (demo household; the test Worker
// runs with FX_RATES_OFFLINE, so only saved rates are read). The rules draft
// (/api/ai-assist/entry-draft) and Ask's AI turn (/api/ask/turn) both
// treat it like any foreign entry: the wallet's currency at the day's rate,
// the original kept, shown as an estimate. With no rate nothing is guessed:
// no amount, and one question that names the figure, with no chip.
import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.ts";
import { createSeededTemplate, openSeededDatabase, rows } from "./support/d1-workspace.mjs";
import { saveRate } from "./support/foreign-wallet.mjs";
import { todayInAppTimeZone } from "../src/lib/app-calendar.ts";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const TIM = "person-tim";
const today = todayInAppTimeZone();

async function addCashWallet(api) {
  const account = await api("/api/accounts/create", { name: "Tim's cash", institution: "Cash", kind: "cash", currency: "SGD", ownerPersonId: TIM });
  assert.equal(account.status, 200, JSON.stringify(account.payload));
  const way = await api("/api/settings/payment-ways/save", { personId: TIM, bankTransferAccountId: "", cashAccountId: account.payload.accountId });
  assert.equal(way.status, 200, JSON.stringify(way.payload));
  return account.payload.accountId;
}

async function draftFor(api, text) {
  const { status, payload } = await api("/api/ai-assist/entry-draft", { text, viewId: TIM });
  assert.equal(status, 200, JSON.stringify(payload));
  return payload.draft;
}

test("coffee 35000 IDR cash: an estimate in the cash wallet's dollars, the rupiah kept, no chip", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const walletId = await addCashWallet(api);
  await saveRate(db, { quote: "IDR", quotePerBase: 12500 });
  const draft = await draftFor(api, "coffee 35000 IDR cash");
  assert.equal(draft.fields.accountId.value, walletId);
  assert.deepEqual(draft.fields.amountMinor, { value: 280, source: "rule" });
  const { estimate, ...original } = draft.foreignAmount;
  assert.deepEqual(original, { amountMinor: 3_500_000, currency: "IDR", source: "sentence" });
  assert.equal(estimate.amountMinor, 280);
  assert.equal(estimate.accountCurrency, "SGD");
  assert.match(estimate.note, /^Paid IDR 35,000 cash\. Saved as about SGD 2\.80 at 1 SGD = 12,500 IDR \(.+\)\.$/);
  assert.deepEqual(draft.missing, []);
  assert.deepEqual(draft.questions, []);
  assert.equal(draft.createBody.amountMinor, 280);
});

test("JPY 1500 on the same wallet converts at the JPY rate", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await addCashWallet(api);
  await saveRate(db, { quote: "JPY", quotePerBase: 110 });
  const draft = await draftFor(api, "ramen 1500 JPY cash");
  assert.equal(draft.fields.amountMinor.value, 1364);
  assert.equal(draft.foreignAmount.currency, "JPY");
  assert.equal(draft.foreignAmount.amountMinor, 150_000);
});

test("negative: no rate saved and none reachable: no amount, one question with no chip", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  await addCashWallet(api);
  const draft = await draftFor(api, "coffee 35000 IDR cash");
  assert.equal(draft.fields.amountMinor, undefined);
  assert.deepEqual(draft.missing, ["amountMinor"]);
  assert.deepEqual(draft.questions, [{ field: "amountMinor", reason: "foreign_currency", options: [], foreignAmount: { amountMinor: 3_500_000, currency: "IDR" } }]);
  assert.equal(draft.createBody, undefined);
  assert.equal(draft.foreignAmount.estimate, undefined);
});

test("negative: a rate older than two weeks is not used", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await addCashWallet(api);
  await saveRate(db, { quote: "IDR", quotePerBase: 12500, fetchedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString() });
  const draft = await draftFor(api, "coffee 35000 IDR cash");
  assert.equal(draft.fields.amountMinor, undefined);
  assert.equal(draft.questions[0].reason, "foreign_currency");
});

test("negative: SGD typed stays SGD, and 35000 with no currency is unchanged", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await addCashWallet(api);
  await saveRate(db, { quote: "IDR", quotePerBase: 12500 });
  for (const text of ["coffee 35000 SGD cash", "coffee 35000 cash"]) {
    const draft = await draftFor(api, text);
    assert.deepEqual(draft.fields.amountMinor, { value: 3_500_000, source: "sentence" }, text);
    assert.equal(draft.foreignAmount, undefined, text);
    assert.deepEqual(draft.questions, [], text);
  }
});

test("Ask's AI turn: the model's draft gets the same estimate, and the model's own figure is never used", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const walletId = await addCashWallet(api);
  await saveRate(db, { quote: "IDR", quotePerBase: 12500 });
  const ai = { async run() {
    return { choices: [{ message: { role: "assistant", content: JSON.stringify({ action: "draft_entry", entry: { type: "expense", description: "coffee", amount: "35000", wallet: "Tim's cash", owner: "me" } }) } }] };
  } };
  const response = await worker.fetch(new Request("http://127.0.0.1/api/ask/turn", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ viewId: TIM, scope: "direct_plus_shared", month: today.slice(0, 7), page: "ask", text: "coffee 35000 IDR cash" })
  }), { DB: db, ...template.config.vars, AI: ai, AI_ASSIST_ENABLED: "true" });
  const payload = await response.json();
  assert.equal(payload.mode, "ai");
  assert.equal(payload.reply.kind, "entry_draft");
  const draft = payload.reply.draft;
  assert.equal(draft.fields.accountId.value, walletId);
  assert.equal(draft.fields.amountMinor.value, 280);
  assert.equal(draft.foreignAmount.currency, "IDR");
  assert.deepEqual(draft.questions, []);
});

test("Ask's AI turn with no rate asks in place and never takes the model's 35000 as dollars", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await addCashWallet(api);
  const ai = { async run() {
    return { choices: [{ message: { role: "assistant", content: JSON.stringify({ action: "draft_entry", entry: { type: "expense", description: "coffee", amount: "35000", wallet: "Tim's cash", owner: "me" } }) } }] };
  } };
  const response = await worker.fetch(new Request("http://127.0.0.1/api/ask/turn", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ viewId: TIM, scope: "direct_plus_shared", month: today.slice(0, 7), page: "ask", text: "coffee 35000 IDR cash" })
  }), { DB: db, ...template.config.vars, AI: ai, AI_ASSIST_ENABLED: "true" });
  const draft = (await response.json()).reply.draft;
  assert.equal(draft.fields.amountMinor, undefined);
  assert.deepEqual(draft.questions.map((question) => [question.reason, question.options.length]), [["foreign_currency", 0]]);
  assert.equal(draft.createBody, undefined);
});

test("create keeps what was paid beside the estimate; half a pair or a bad code is refused", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const walletId = await addCashWallet(api);
  const base = { date: today, description: "Coffee", accountId: walletId, categoryName: "Food & Drinks", amountMinor: 280, entryType: "expense", ownershipType: "direct", ownerName: "Tim" };
  const saved = await api("/api/entries/create", { ...base, originalAmountMinor: 3_500_000, originalCurrency: "IDR", note: "Paid IDR 35,000 cash." });
  assert.equal(saved.status, 200, JSON.stringify(saved.payload));
  const [row] = await rows(db, "SELECT amount_minor, original_amount_minor, original_currency, note FROM transactions WHERE id = ?", saved.payload.entryId);
  assert.deepEqual({ ...row }, { amount_minor: 280, original_amount_minor: 3_500_000, original_currency: "IDR", note: "Paid IDR 35,000 cash." });
  for (const extra of [{ originalAmountMinor: 3_500_000 }, { originalCurrency: "IDR" }, { originalAmountMinor: 3_500_000, originalCurrency: "idr" }, { originalAmountMinor: -5, originalCurrency: "IDR" }]) {
    const refused = await api("/api/entries/create", { ...base, ...extra });
    assert.equal(refused.status, 400, JSON.stringify(extra));
  }
});
