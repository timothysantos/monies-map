// The cash pad's client pieces: payments waiting on the device and their
// retries (cash-queue.js), and the pad's view model (cash-pad-model.js):
// money hidden shows names only, the chips after Save follow the guess
// order, and the Save body keeps one request id for every retry.
import assert from "node:assert/strict";
import test from "node:test";

import {
  CASH_QUEUE_KEY,
  flushCashQueue,
  keepWaitingCash,
  readCashQueue,
  removeWaitingCash,
  sendCashEntry
} from "../src/client/cash-queue.js";
import { againChipLabel, buildCashBody, cashCategoryChips, describeCashLine, payWayChoices, quickRowLabel, savedWhat, tapButtonLabel } from "../src/client/cash-pad-model.js";

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    map
  };
}

function reply(status, body) {
  return async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
}

const body = { requestId: "11111111-2222-3333-4444-555555555555", personId: "person-tim", amountMinor: 3_500_000, currency: "IDR", date: "2026-11-17" };
const label = { description: "Cash", amountMinor: 3_500_000, currency: "IDR" };

test("a send is saved, waiting for a network reason, or refused by the server", async () => {
  const entry = { entryId: "txn-1", date: "2026-11-17" };
  assert.deepEqual(await sendCashEntry(body, { fetchImpl: reply(200, { ok: true, entry }) }), { kind: "saved", entry });
  assert.deepEqual(await sendCashEntry(body, { fetchImpl: async () => { throw new TypeError("Failed to fetch"); } }), { kind: "waiting", error: "network" });
  assert.deepEqual(await sendCashEntry(body, { fetchImpl: reply(503, { ok: false, retry: true, error: "no rate" }) }), { kind: "waiting", error: "rate" });
  assert.deepEqual(await sendCashEntry(body, { fetchImpl: reply(502, null) }), { kind: "waiting", error: "502" });
  assert.deepEqual(await sendCashEntry(body, { fetchImpl: reply(400, { ok: false, error: "IDR has no cents. Type a whole amount." }) }), { kind: "refused", error: "IDR has no cents. Type a whole amount." });
  assert.deepEqual(
    await sendCashEntry(body, { fetchImpl: reply(409, { ok: false, needsWallet: true, walletChoices: [{ id: "a", name: "Spare cash" }], error: "Which wallet?" }) }),
    { kind: "refused", error: "Which wallet?", needsWallet: true, walletChoices: [{ id: "a", name: "Spare cash" }] }
  );
});

test("a send that never answers is waiting after the timeout", async () => {
  const hang = (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  });
  assert.deepEqual(await sendCashEntry(body, { fetchImpl: hang, timeoutMs: 20 }), { kind: "waiting", error: "network" });
});

test("waiting payments are kept by request id and removed by the person", () => {
  const storage = memoryStorage();
  keepWaitingCash({ requestId: body.requestId, body, label, queuedAt: "t1" }, storage);
  keepWaitingCash({ requestId: body.requestId, body, label, queuedAt: "t2" }, storage);
  assert.equal(readCashQueue(storage).length, 1, "one request id is one waiting payment");
  assert.equal(readCashQueue(storage)[0].queuedAt, "t2");
  removeWaitingCash(body.requestId, storage);
  assert.deepEqual(readCashQueue(storage), []);
  assert.equal(storage.map.has(CASH_QUEUE_KEY), false, "an empty list leaves nothing behind");
  assert.deepEqual(readCashQueue(memoryStorage({ [CASH_QUEUE_KEY]: "not json" })), []);
  assert.deepEqual(readCashQueue(null), []);
});

test("a flush sends the same request again, stops while the network is down, and keeps a refused one with its reason", async () => {
  const storage = memoryStorage();
  const second = { ...body, requestId: "22222222-2222-3333-4444-555555555555" };
  const third = { ...body, requestId: "33333333-2222-3333-4444-555555555555" };
  keepWaitingCash({ requestId: body.requestId, body, label, queuedAt: "t1" }, storage);
  keepWaitingCash({ requestId: second.requestId, body: second, label, queuedAt: "t2" }, storage);
  keepWaitingCash({ requestId: third.requestId, body: third, label, queuedAt: "t3" }, storage);
  const sentBodies = [];
  let call = 0;
  const fetchImpl = async (_url, init) => {
    sentBodies.push(JSON.parse(init.body));
    call += 1;
    if (call === 1) return { ok: true, status: 200, json: async () => ({ ok: true, entry: { entryId: "txn-1", date: "2026-11-17" } }) };
    if (call === 2) return { ok: false, status: 400, json: async () => ({ ok: false, error: "Choose one of the household's categories." }) };
    throw new TypeError("Failed to fetch");
  };
  const saved = [];

  const sent = await flushCashQueue({ fetchImpl, storage, onSaved: (entry) => saved.push(entry.entryId) });

  assert.equal(sent, 1);
  assert.deepEqual(saved, ["txn-1"]);
  assert.deepEqual(sentBodies.map((sentBody) => sentBody.requestId), [body.requestId, second.requestId, third.requestId], "each retry carries its first request id");
  assert.deepEqual(readCashQueue(storage).map((item) => [item.requestId, item.error ?? null]), [
    [second.requestId, "Choose one of the household's categories."],
    [third.requestId, null]
  ]);

  // The refused one is not sent again by itself; the waiting one is.
  sentBodies.length = 0;
  await flushCashQueue({ fetchImpl: reply(200, { ok: true, entry: { entryId: "txn-3", date: "2026-11-17" } }), storage });
  assert.deepEqual(readCashQueue(storage).map((item) => item.requestId), [second.requestId]);
});

test("two flushes at once are one round, so nothing is sent twice at the same time", async () => {
  const storage = memoryStorage();
  keepWaitingCash({ requestId: body.requestId, body, label, queuedAt: "t1" }, storage);
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { ok: true, status: 200, json: async () => ({ ok: true, entry: { entryId: "txn-1", date: "2026-11-17" } }) };
  };
  const [first, second] = await Promise.all([flushCashQueue({ fetchImpl, storage }), flushCashQueue({ fetchImpl, storage })]);
  assert.equal(calls, 1);
  assert.equal(first, 1);
  assert.equal(second, 1);
});

test("a flush of an empty list does not block the next one", async () => {
  const storage = memoryStorage();
  assert.equal(await flushCashQueue({ fetchImpl: reply(200, {}), storage }), 0);
  keepWaitingCash({ requestId: body.requestId, body, label, queuedAt: "t1" }, storage);
  const sent = await flushCashQueue({ fetchImpl: reply(200, { ok: true, entry: { entryId: "txn-1", date: "2026-11-17" } }), storage });
  assert.equal(sent, 1);
  assert.deepEqual(readCashQueue(storage), []);
});

test("money hidden: Again chips and saved lines show names only", () => {
  const chip = { description: "Coffee", amountMinor: 3_500_000, currency: "IDR" };
  assert.equal(againChipLabel(chip, true), "Coffee 35,000");
  assert.equal(againChipLabel(chip, false), "Coffee");
  assert.equal(savedWhat(chip, true), "Coffee, Rp 35,000");
  assert.equal(savedWhat(chip, false), "Coffee");
});

test("the chips after Save: the guess, then the usual ones, once each, never a catch-all or the current one", () => {
  const categoryNames = ["Food & Drinks", "Transport", "Groceries", "Shopping", "Other", "Transfer"];
  assert.deepEqual(cashCategoryChips({ current: "Other", guess: "Transport", usual: ["Food & Drinks", "Transport", "Other", "Groceries", "Shopping"], categoryNames }), ["Transport", "Food & Drinks", "Groceries"]);
  assert.deepEqual(cashCategoryChips({ current: "Food & Drinks", usual: ["Food & Drinks", "Not here", "Transfer"], categoryNames }), []);
});

test("the Save body: the pad's amount, and an Again chip's name, category and note", () => {
  assert.equal(buildCashBody({ requestId: "r", personId: "p", padText: "", currency: "IDR", date: "2026-11-17" }), null);
  assert.deepEqual(buildCashBody({ requestId: "r", personId: "p", padText: "35000", currency: "IDR", date: "2026-11-17" }), {
    requestId: "r", personId: "p", amountMinor: 3_500_000, currency: "IDR", date: "2026-11-17"
  });
  assert.deepEqual(buildCashBody({
    requestId: "r", personId: "p", padText: "35000", currency: "IDR", date: "2026-11-17", accountId: "acct-cash",
    again: { description: "Coffee", categoryName: "Food & Drinks", note: "Warung" }
  }), {
    requestId: "r", personId: "p", amountMinor: 3_500_000, currency: "IDR", date: "2026-11-17", accountId: "acct-cash",
    description: "Coffee", categoryName: "Food & Drinks", note: "Warung"
  });
});

test("the quiet line names the wallet, currency, day and person, or asks for a wallet", () => {
  assert.deepEqual(describeCashLine({ walletName: "Tim's cash", currency: "IDR", date: "2026-11-17", today: "2026-11-17", personName: "Tim" }), ["Tim's cash", "IDR", "Today", "Tim"]);
  assert.deepEqual(describeCashLine({ walletName: null, currency: "SGD", date: "2026-11-16", today: "2026-11-17", personName: "Joyce" }), ["Choose a wallet", "SGD", "Yesterday", "Joyce"]);
});

test("Paid with: Cash first, then the person's cards by name; the Save body for a card, a waiting tap, and a new payment", () => {
  assert.deepEqual(payWayChoices([{ id: "acct-uob-one", name: "UOB One", currency: "SGD" }]), [
    { value: "cash", label: "Cash" },
    { value: "acct-uob-one", label: "UOB One" }
  ]);
  assert.deepEqual(payWayChoices(), [{ value: "cash", label: "Cash" }]);
  const base = { requestId: "req-12345678", personId: "person-tim", padText: "85000", currency: "IDR", date: "2026-11-17" };
  assert.deepEqual(buildCashBody({ ...base, cardId: "acct-uob-one" }), {
    requestId: "req-12345678", personId: "person-tim", amountMinor: 8_500_000, currency: "IDR", date: "2026-11-17", way: "card", accountId: "acct-uob-one"
  });
  assert.deepEqual(buildCashBody({ ...base, cardId: "acct-uob-one", newPayment: true }).newPayment, true);
  // A cash payment never says it is a new payment.
  assert.equal("newPayment" in buildCashBody({ ...base, newPayment: true }), false);
  // A waiting tap's amount: the tap names the shop and card; an Again chip's name does not ride along.
  assert.deepEqual(buildCashBody({ ...base, tapId: "tap-1", cardId: "acct-uob-one", again: { description: "Coffee" } }), {
    requestId: "req-12345678", personId: "person-tim", amountMinor: 8_500_000, currency: "IDR", date: "2026-11-17", tapId: "tap-1"
  });
  assert.equal(buildCashBody({ ...base, padText: "", tapId: "tap-1" }), null);
});

test("waiting taps and payments that need words: the shop and time; money hidden shows no figure", () => {
  assert.equal(tapButtonLabel({ merchant: "Periplus Bali", time: "14:02" }), "Periplus Bali, 14:02");
  assert.equal(tapButtonLabel({ merchant: "Periplus Bali", time: "" }), "Periplus Bali");
  const entry = { amountMinor: 8_500_000, currency: "IDR", time: "14:02", date: "2026-11-17", accountName: "UOB One" };
  assert.equal(quickRowLabel(entry, true, "2026-11-17"), "Rp 85,000 · 14:02 · UOB One");
  assert.equal(quickRowLabel(entry, false, "2026-11-17"), "14:02 · UOB One");
  assert.doesNotMatch(quickRowLabel(entry, false, "2026-11-17"), /85|Rp/);
  assert.equal(quickRowLabel({ ...entry, time: "" }, false, "2026-11-17"), "Today · UOB One");
});

test("a card payment refused because a tap on that card waits carries the tap to offer", async () => {
  const offerTap = { id: "tap-1", merchant: "Periplus Bali", time: "14:02", date: "2026-11-17", accountId: "acct-uob-one", accountName: "UOB One" };
  const result = await sendCashEntry({ requestId: "req-12345678" }, { fetchImpl: reply(409, { ok: false, offerTap, error: "Is this the Periplus Bali payment from 14:02?" }) });
  assert.deepEqual(result, { kind: "refused", error: "Is this the Periplus Bali payment from 14:02?", offerTap });
  const plain = await sendCashEntry({ requestId: "req-12345678" }, { fetchImpl: reply(409, { ok: false, offerTap: { merchant: "no id" }, error: "x" }) });
  assert.equal("offerTap" in plain, false);
});

test("the app checks the same storage key the queue writes, and loads the queue only then", async () => {
  const { readFile } = await import("node:fs/promises");
  const app = await readFile(new URL("../src/client/App.jsx", import.meta.url), "utf8");
  assert.ok(app.includes(`getItem("${CASH_QUEUE_KEY}")`));
  assert.match(app, /loadRouteModule\("ask"\)\.then\(\(ask\) => ask\.flushCashQueue/);
  assert.doesNotMatch(app, /from "\.\/cash-queue/);
});
