// An Ask card saved with no connection (Ask audit A9; docs/flows/
// ask-flow.md "No connection"): a plain expense waits in the quick pad's
// "Waiting to send" list (cash-queue.js) and is sent once, by its
// `ask:<card id>` reference, when the connection is back. Splits,
// transfers and income never wait.
import assert from "node:assert/strict";
import test from "node:test";

import { CASH_CREATE_ENDPOINT, ENTRY_CREATE_ENDPOINT, CASH_QUEUE_KEY, flushCashQueue, keepWaitingCash, readCashQueue, removeWaitingCash, sendCashEntry } from "../src/client/cash-queue.js";
import { canCardWait, waitingItemForCard } from "../src/client/ask-waiting.js";
import { buildCardCreateDraft, createAskCard, markCardSaving, setCardField, setCardVariant, setShare } from "../src/client/ask-card-model.js";

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    map
  };
}

const context = {
  today: "2026-11-17",
  viewId: "person-ethan",
  people: [{ id: "person-ethan", name: "Ethan" }, { id: "person-serene", name: "Serene" }],
  accounts: [{ id: "acct-citi", name: "Citi Rewards Card", currency: "SGD", isActive: true }, { id: "acct-dbs", name: "DBS", currency: "SGD", isActive: true }],
  categories: [{ name: "Other" }, { name: "Food & Drinks" }]
};

function sendingCard(change = (card) => card) {
  const filled = setCardField(createAskCard(context), { amountInput: "18", description: "Koufu dinner", accountId: "acct-citi" }, context);
  return markCardSaving(change(filled));
}

test("only a plain expense can wait; Splits, a transfer and income cannot", () => {
  const plain = sendingCard();
  assert.equal(canCardWait(plain, buildCardCreateDraft(plain, context)), true);
  const onSplits = sendingCard((card) => setShare(card, { on: true, splitGroupId: "group-home" }));
  assert.equal(canCardWait(onSplits, buildCardCreateDraft(onSplits, context, { splitGroups: [{ id: "group-home", name: "Home" }] })), false);
  const transfer = sendingCard((card) => setCardVariant(card, "transfer", context));
  assert.equal(canCardWait(transfer, buildCardCreateDraft(transfer, context)), false);
  const income = sendingCard((card) => setCardVariant(card, "income", context));
  assert.equal(canCardWait(income, buildCardCreateDraft(income, context)), false);
  // A card with no reference could land twice: it never waits.
  assert.equal(canCardWait(plain, { ...buildCardCreateDraft(plain, context), externalReference: undefined }), false);
});

test("the waiting item is the create body itself, keyed by the card's reference", () => {
  const card = sendingCard();
  const draft = buildCardCreateDraft(card, context);
  const item = waitingItemForCard(draft, { currency: "SGD", now: new Date("2026-11-17T12:00:00Z") });
  assert.equal(item.requestId, `ask:${card.clientId}`);
  assert.equal(item.endpoint, ENTRY_CREATE_ENDPOINT);
  assert.deepEqual(item.label, { description: "Koufu dinner", amountMinor: 1800, currency: "SGD" });
  assert.equal(item.queuedAt, "2026-11-17T12:00:00.000Z");
  assert.equal(item.body.externalReference, `ask:${card.clientId}`);
  assert.equal(item.body.amountMinor, 1800);
  assert.equal(item.body.entryType, "expense");
  assert.equal(item.body.accountId, "acct-citi");
  // Kept twice (two taps on Save), it waits once.
  const storage = memoryStorage();
  keepWaitingCash(item, storage);
  keepWaitingCash(item, storage);
  assert.equal(readCashQueue(storage).length, 1);
  removeWaitingCash(item.requestId, storage);
  assert.deepEqual(readCashQueue(storage), []);
});

test("a waiting Ask card is sent to the entry create route once, then leaves the list", async () => {
  const card = sendingCard();
  const item = waitingItemForCard(buildCardCreateDraft(card, context));
  const storage = memoryStorage();
  keepWaitingCash(item, storage);
  const calls = [];
  const saved = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ entryId: "txn-ask-1", created: calls.length === 1 }), { status: 200 });
  };
  assert.equal(await flushCashQueue({ fetchImpl, storage, onSaved: (entry) => saved.push(entry) }), 1);
  assert.deepEqual(calls.map((call) => call.url), [ENTRY_CREATE_ENDPOINT]);
  assert.equal(calls[0].body.externalReference, item.requestId);
  assert.deepEqual(saved, [{ entryId: "txn-ask-1", date: "2026-11-17", description: "Koufu dinner" }]);
  assert.deepEqual(readCashQueue(storage), []);
  // Nothing is left to send again.
  assert.equal(await flushCashQueue({ fetchImpl, storage }), 0);
  assert.equal(calls.length, 1);
});

test("still offline it keeps waiting; a refusal stays with its reason; a pad payment still goes to the pad's route", async () => {
  const card = sendingCard();
  const item = waitingItemForCard(buildCardCreateDraft(card, context));
  const offline = async () => { throw new TypeError("Failed to fetch"); };
  assert.deepEqual(await sendCashEntry(item.body, { endpoint: ENTRY_CREATE_ENDPOINT, fetchImpl: offline }), { kind: "waiting", error: "network" });
  const refused = async () => new Response(JSON.stringify({ ok: false, error: "This entry was already saved with different details. Check Entries before saving it again." }), { status: 409 });
  assert.equal((await sendCashEntry(item.body, { endpoint: ENTRY_CREATE_ENDPOINT, fetchImpl: refused })).kind, "refused");
  // A 200 without an entry id is not a save.
  const empty = async () => new Response("null", { status: 200 });
  assert.equal((await sendCashEntry(item.body, { endpoint: ENTRY_CREATE_ENDPOINT, fetchImpl: empty })).kind, "waiting");

  const storage = memoryStorage();
  const pad = { requestId: "11111111-2222-3333-4444-555555555555", body: { requestId: "11111111-2222-3333-4444-555555555555", personId: "person-ethan", amountMinor: 500, currency: "SGD", date: "2026-11-17" }, label: { description: "Cash", amountMinor: 500, currency: "SGD" }, queuedAt: "2026-11-17T00:00:00Z" };
  keepWaitingCash(pad, storage);
  keepWaitingCash(item, storage);
  const urls = [];
  await flushCashQueue({
    storage,
    fetchImpl: async (url) => {
      urls.push(url);
      return url === CASH_CREATE_ENDPOINT
        ? new Response(JSON.stringify({ ok: true, entry: { entryId: "txn-cash", date: "2026-11-17" } }), { status: 200 })
        : new Response(JSON.stringify({ entryId: "txn-ask" }), { status: 200 });
    }
  });
  assert.deepEqual(urls, [CASH_CREATE_ENDPOINT, ENTRY_CREATE_ENDPOINT]);
  // An item naming any other address is never read back, so never sent.
  const forged = memoryStorage({ [CASH_QUEUE_KEY]: JSON.stringify([{ ...item, endpoint: "/api/entries/delete" }]) });
  assert.deepEqual(readCashQueue(forged), []);
});
