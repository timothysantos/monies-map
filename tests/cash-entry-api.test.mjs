// Cash entries through the real Worker and a real local D1 (demo household:
// Tim the owner, Joyce the partner): the pad's defaults, an amount-only
// save in the trip's currency, retries that never save twice, the person
// and household scope, and the "Log cash" Shortcut's token-protected route.
// The test Worker runs with FX_RATES_OFFLINE, so only saved rates are read.
import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.ts";
import { createSeededTemplate, openSeededDatabase, rows } from "./support/d1-workspace.mjs";
import { enableShortcut, saveRate, TOKEN } from "./support/foreign-wallet.mjs";
import { addDays } from "../src/domain/cash-entry.ts";
import { todayInAppTimeZone } from "../src/lib/app-calendar.ts";
import { loadTripEventRowFacts } from "../src/domain/app-repository-trip-events.ts";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const TIM = "person-tim";
const JOYCE = "person-joyce";
const today = todayInAppTimeZone();

async function addCashWallet(api, { personId = TIM, name = "Tim's cash", setPaymentWay = true } = {}) {
  const account = await api("/api/accounts/create", { name, institution: "Cash", kind: "cash", currency: "SGD", ownerPersonId: personId });
  assert.equal(account.status, 200, JSON.stringify(account.payload));
  if (setPaymentWay) {
    const way = await api("/api/settings/payment-ways/save", { personId, bankTransferAccountId: "", cashAccountId: account.payload.accountId });
    assert.equal(way.status, 200, JSON.stringify(way.payload));
  }
  return account.payload.accountId;
}

async function addTrip(api, { currency = "IDR", start = addDays(today, -2), end = addDays(today, 5), name = "Bali trip" } = {}) {
  const trip = await api("/api/trip-events/save", { name, startDate: start, endDate: end, currency });
  assert.equal(trip.status, 200, JSON.stringify(trip.payload));
  return trip.payload.tripEvent.id;
}

function save(api, body, options) {
  return api("/api/cash-entries/create", { requestId: crypto.randomUUID(), personId: TIM, ...body }, options);
}

test("the pad opens in the trip's currency on the person's cash wallet", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const walletId = await addCashWallet(api);
  const tripId = await addTrip(api);

  const response = await api(`/api/cash-entries/defaults?person=${TIM}`);

  assert.equal(response.status, 200, JSON.stringify(response.payload));
  assert.deepEqual(response.payload.defaults, {
    personId: TIM,
    personName: "Tim",
    wallet: { id: walletId, name: "Tim's cash", currency: "SGD", kind: "cash" },
    walletChoices: [],
    currency: "IDR",
    currencyReason: "trip",
    trip: { id: tripId, name: "Bali trip" },
    today,
    again: [],
    usualCategories: [],
    // Paid with: Tim's own card; no tap waiting, nothing to describe yet.
    cards: [{ id: "acct-uob-one", name: "UOB One", currency: "SGD" }],
    waitingTaps: [],
    undescribed: []
  });
  await rows(db, "SELECT 1");
});

test("with no trip the pad opens in the last cash currency of the last 7 days, else the wallet's", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await addCashWallet(api);
  await saveRate(db, { quote: "THB", quotePerBase: 26 });

  const before = await api(`/api/cash-entries/defaults?person=${TIM}`);
  assert.equal(before.payload.defaults.currency, "SGD");
  assert.equal(before.payload.defaults.currencyReason, "wallet");

  const saved = await save(api, { amountMinor: 12_000, currency: "THB", description: "Pad thai", date: addDays(today, -3) });
  assert.equal(saved.status, 200, JSON.stringify(saved.payload));

  const after = await api(`/api/cash-entries/defaults?person=${TIM}`);
  assert.equal(after.payload.defaults.currency, "THB");
  assert.equal(after.payload.defaults.currencyReason, "recent");
  assert.deepEqual(after.payload.defaults.again, [
    { description: "Pad thai", amountMinor: 12_000, currency: "THB", categoryName: after.payload.defaults.again[0].categoryName, note: null }
  ]);
  // Joyce's pad is not Tim's: her own (none) history and no wallet.
  const joyce = await api(`/api/cash-entries/defaults?person=${JOYCE}`);
  assert.equal(joyce.payload.defaults.currency, "SGD");
  assert.deepEqual(joyce.payload.defaults.again, []);
  assert.equal(joyce.payload.defaults.wallet, null);
});

test("an amount-only save in the trip's currency is one entry at the day's rate, the rupiah kept", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const walletId = await addCashWallet(api);
  await addTrip(api);
  await saveRate(db, { quote: "IDR", quotePerBase: 14025, rateDate: "2026-10-02" });
  const requestId = crypto.randomUUID();

  const response = await api("/api/cash-entries/create", { requestId, personId: TIM, amountMinor: 3_500_000 });

  assert.equal(response.status, 200, JSON.stringify(response.payload));
  const entry = response.payload.entry;
  assert.equal(entry.created, true);
  assert.deepEqual({ ...entry, entryId: undefined }, {
    entryId: undefined,
    created: true,
    date: today,
    description: "Cash",
    categoryName: "Other",
    personId: TIM,
    personName: "Tim",
    accountId: walletId,
    accountName: "Tim's cash",
    amountMinor: 250,
    accountCurrency: "SGD",
    paidAmountMinor: 3_500_000,
    paidCurrency: "IDR",
    note: null,
    storedNote: "Paid IDR 35,000 cash. Saved as about SGD 2.50 at 1 SGD = 14,025 IDR (2 Oct 2026)."
  });
  assert.deepEqual(await rows(db, `
    SELECT transactions.account_id, transactions.transaction_date, transactions.description, transactions.amount_minor, transactions.currency,
      transactions.original_amount_minor, transactions.original_currency, transactions.entry_type, transactions.owner_person_id,
      transactions.external_reference, transactions.note, categories.name AS category
    FROM transactions LEFT JOIN categories ON categories.id = transactions.category_id
    WHERE transactions.id = ?`, entry.entryId), [{
    account_id: walletId,
    transaction_date: today,
    description: "Cash",
    amount_minor: 250,
    currency: "SGD",
    original_amount_minor: 3_500_000,
    original_currency: "IDR",
    entry_type: "expense",
    owner_person_id: TIM,
    external_reference: `cash:${requestId}`,
    note: "Paid IDR 35,000 cash. Saved as about SGD 2.50 at 1 SGD = 14,025 IDR (2 Oct 2026).",
    category: "Other"
  }]);

  // The trip's dashed chip offers it, like an Apple Pay entry paid in won;
  // nothing put it on the trip by itself.
  assert.deepEqual(await rows(db, "SELECT * FROM trip_event_entries WHERE transaction_id = ?", entry.entryId), []);
  const facts = await loadTripEventRowFacts(db, addDays(today, -30), addDays(today, 1), today);
  assert.equal(facts.suggestions.has(entry.entryId), true);
});

test("a retry with the same request id never saves twice, even after the rate changed", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await addCashWallet(api);
  await addTrip(api);
  await saveRate(db, { quote: "IDR", quotePerBase: 14025 });
  const requestId = crypto.randomUUID();
  const body = { requestId, personId: TIM, amountMinor: 3_500_000, description: "coffee" };

  const first = await api("/api/cash-entries/create", body);
  await saveRate(db, { quote: "IDR", quotePerBase: 15000 });
  const second = await api("/api/cash-entries/create", body);

  assert.equal(first.status, 200, JSON.stringify(first.payload));
  assert.equal(second.status, 200, JSON.stringify(second.payload));
  assert.equal(second.payload.entry.created, false);
  assert.equal(second.payload.entry.entryId, first.payload.entry.entryId);
  assert.equal(second.payload.entry.amountMinor, 250, "the saved amount, not a new conversion");
  assert.deepEqual(await rows(db, "SELECT COUNT(*) AS n FROM transactions WHERE external_reference = ?", `cash:${requestId}`), [{ n: 1 }]);
  assert.equal(first.payload.entry.description, "Coffee");
  assert.equal(first.payload.entry.categoryName, "Food & Drinks", "the category guess for coffee");
});

test("one person's request id never answers for another person", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  await addCashWallet(api);
  await addCashWallet(api, { personId: JOYCE, name: "Joyce's cash" });
  const requestId = crypto.randomUUID();
  const tim = await api("/api/cash-entries/create", { requestId, personId: TIM, amountMinor: 500, currency: "SGD" });
  assert.equal(tim.status, 200);

  const joyce = await api("/api/cash-entries/create", { requestId, personId: JOYCE, amountMinor: 500, currency: "SGD" });

  assert.equal(joyce.status, 400);
  assert.equal(joyce.payload.field, "request");
});

test("refused saves write nothing: cents in rupiah, zero, an unknown person, a bad currency, no request id", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await addCashWallet(api);
  await saveRate(db, { quote: "IDR", quotePerBase: 14025 });
  const [{ n: before }] = await rows(db, "SELECT COUNT(*) AS n FROM transactions");

  const cents = await save(api, { amountMinor: 3_500_050, currency: "IDR" });
  assert.equal(cents.status, 400);
  assert.equal(cents.payload.error, "IDR has no cents. Type a whole amount.");
  const zero = await save(api, { amountMinor: 0 });
  assert.equal(zero.status, 400);
  assert.equal(zero.payload.field, "amount");
  const stranger = await save(api, { personId: "person-nobody", amountMinor: 500 });
  assert.equal(stranger.status, 400);
  assert.equal(stranger.payload.field, "person");
  const currency = await save(api, { amountMinor: 500, currency: "RUPIAH" });
  assert.equal(currency.status, 400);
  assert.equal(currency.payload.field, "currency");
  const noId = await api("/api/cash-entries/create", { personId: TIM, amountMinor: 500 });
  assert.equal(noId.status, 400);
  assert.equal(noId.payload.field, "request");
  const category = await save(api, { amountMinor: 500, categoryName: "Not a category" });
  assert.equal(category.status, 400);
  assert.equal(category.payload.field, "category");

  assert.deepEqual(await rows(db, "SELECT COUNT(*) AS n FROM transactions"), [{ n: before }]);
});

test("no cash wallet: nothing is saved and the person's accounts are offered, cash first; a chosen one saves", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const spareCash = await addCashWallet(api, { name: "Spare cash", setPaymentWay: false });

  const asked = await save(api, { amountMinor: 450, currency: "SGD" });

  assert.equal(asked.status, 409);
  assert.equal(asked.payload.needsWallet, true);
  assert.deepEqual(asked.payload.walletChoices.map((choice) => [choice.name, choice.kind]), [
    ["Spare cash", "cash"],
    ["Household Float", "bank"],
    ["UOB Savings", "bank"],
    ["UOB One", "credit_card"]
  ]);
  assert.deepEqual(await rows(db, "SELECT COUNT(*) AS n FROM transactions WHERE account_id = ?", spareCash), [{ n: 0 }]);

  const chosen = await save(api, { amountMinor: 450, currency: "SGD", accountId: spareCash });
  assert.equal(chosen.status, 200, JSON.stringify(chosen.payload));
  assert.equal(chosen.payload.entry.accountId, spareCash);

  const archived = await save(api, { amountMinor: 450, currency: "SGD", accountId: "acct-not-here" });
  assert.equal(archived.status, 400);
  assert.equal(archived.payload.field, "wallet");
});

test("no rate for the currency: nothing is saved and the pad is told to try again", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await addCashWallet(api);
  const [{ n: before }] = await rows(db, "SELECT COUNT(*) AS n FROM transactions");

  const response = await save(api, { amountMinor: 50_000, currency: "KRW" });

  assert.equal(response.status, 503);
  assert.equal(response.payload.retry, true);
  assert.match(response.payload.error, /KRW to SGD exchange rate\. Nothing was saved\./);
  assert.deepEqual(await rows(db, "SELECT COUNT(*) AS n FROM transactions"), [{ n: before }]);
});

test("a body over the limit is refused before any work", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  const response = await save(api, { amountMinor: 500, note: "x".repeat(9000) });
  assert.equal(response.status, 413);
});

// ------------------------------------------------------------ Log cash Shortcut

function logCash(fetchWorker, key, body, env) {
  const init = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  const path = `/api/shortcuts/cash/create${key === null ? "" : `?shortcut_token=${encodeURIComponent(key)}`}`;
  return fetchWorker(path, init, env).then(async (response) => ({ status: response.status, payload: await response.json() }));
}

test("Log cash saves for the key's person with the pad's defaults and answers with the notification line", async (t) => {
  const { db, fetch: fetchWorker, api } = await openSeededDatabase(t, template);
  await enableShortcut(db);
  await addCashWallet(api);
  await addTrip(api);
  await saveRate(db, { quote: "IDR", quotePerBase: 14025 });

  const response = await logCash(fetchWorker, TOKEN, { text: "35000 coffee", requestId: "cash-20261117103000123", clientVersion: "log-cash-1" });

  assert.equal(response.status, 200, JSON.stringify(response.payload));
  assert.equal(response.payload.notification, "Saved: Coffee, Rp 35,000 cash");
  assert.equal(response.payload.created, true);
  const [entry] = await rows(db, "SELECT owner_person_id, amount_minor, original_amount_minor, original_currency, description, external_reference FROM transactions WHERE id = ?", response.payload.entryId);
  assert.deepEqual(entry, { owner_person_id: TIM, amount_minor: 250, original_amount_minor: 3_500_000, original_currency: "IDR", description: "Coffee", external_reference: "cash:cash-20261117103000123" });

  // The number pad's amount alone, and the same request again.
  const padOnly = await logCash(fetchWorker, TOKEN, { amount: 20000, requestId: "cash-20261117103100456" });
  assert.equal(padOnly.payload.notification, "Saved: Cash, Rp 20,000 cash");
  const again = await logCash(fetchWorker, TOKEN, { amount: 20000, requestId: "cash-20261117103100456" });
  assert.equal(again.payload.entryId, padOnly.payload.entryId);
  assert.equal(again.payload.created, false);
});

test("Log cash: another person's key saves as that person, whatever the body says", async (t) => {
  const { db, fetch: fetchWorker, api } = await openSeededDatabase(t, template);
  await enableShortcut(db);
  await addCashWallet(api, { personId: JOYCE, name: "Joyce's cash" });
  const all = await rows(db, "SELECT id FROM accounts WHERE account_name = ?", "UOB Lady's");
  const saved = await api("/api/settings/shortcuts/save", { personId: JOYCE, apiKey: "mm_joyce-cash-key", defaultAccountPriorityIds: [all[0].id], defaultParams: "", foreignCurrencyAccountId: "" });
  assert.equal(saved.status, 200, JSON.stringify(saved.payload));

  const response = await logCash(fetchWorker, "mm_joyce-cash-key", { text: "12.50 taxi", personId: TIM, requestId: "cash-joyce-0001" });

  assert.equal(response.status, 200, JSON.stringify(response.payload));
  assert.equal(response.payload.notification, "Saved: Taxi, $12.50 cash");
  assert.deepEqual(await rows(db, "SELECT owner_person_id FROM transactions WHERE id = ?", response.payload.entryId), [{ owner_person_id: JOYCE }]);
});

test("Log cash refuses a missing or wrong key, a missing amount and a person with no cash wallet", async (t) => {
  const { db, fetch: fetchWorker, api } = await openSeededDatabase(t, template);
  await enableShortcut(db);
  const [{ n: before }] = await rows(db, "SELECT COUNT(*) AS n FROM transactions");

  assert.equal((await logCash(fetchWorker, null, { amount: 5 })).status, 401);
  assert.equal((await logCash(fetchWorker, "wrong-key", { amount: 5 })).status, 401);
  const noWallet = await logCash(fetchWorker, TOKEN, { amount: 5 });
  assert.equal(noWallet.status, 409);
  assert.equal(noWallet.payload.error, "No cash wallet for Tim. Choose one in Monies Map, Settings, Payment ways. Nothing was saved.");

  await addCashWallet(api);
  const noAmount = await logCash(fetchWorker, TOKEN, { text: "coffee" });
  assert.equal(noAmount.status, 400);
  assert.equal(noAmount.payload.needsAmount, true);
  const badId = await logCash(fetchWorker, TOKEN, { amount: 5, requestId: "bad id!" });
  assert.equal(badId.status, 400);

  assert.deepEqual(await rows(db, "SELECT COUNT(*) AS n FROM transactions"), [{ n: before }]);
});

test("the Shortcut Worker answers the Log cash path and still hides the in-app cash routes", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  await enableShortcut(db);
  const env = { DB: db, ...template.config.vars, SHORTCUT_API_ONLY: "true" };
  const call = (path, init) => worker.fetch(new Request(`http://127.0.0.1${path}`, init), env);

  const logged = await call(`/api/shortcuts/cash/create?shortcut_token=${TOKEN}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "coffee" }) });
  assert.equal(logged.status, 400, "reached the route (needs an amount), not 404");
  const get = await call("/api/shortcuts/cash/create", { method: "GET" });
  assert.equal(get.status, 405);
  assert.equal((await call(`/api/cash-entries/defaults?person=${TIM}`)).status, 404);
  assert.equal((await call("/api/cash-entries/create", { method: "POST", body: "{}" })).status, 404);
});

test("the browser tests' rate header works only on a test Worker that cannot fetch rates", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await addCashWallet(api);
  const send = (vars) => worker.fetch(new Request("http://127.0.0.1/api/cash-entries/create", {
    method: "POST",
    headers: { "content-type": "application/json", "x-cash-test-rate": "SGD/KRW=1000" },
    body: JSON.stringify({ requestId: crypto.randomUUID(), personId: TIM, amountMinor: 5_000_000, currency: "KRW" })
  }), { DB: db, ...template.config.vars, ...vars });

  const production = await send({ APP_ENVIRONMENT: "production" });
  assert.equal(production.status, 503, "a production Worker ignores the header");
  const tests = await send({});
  assert.equal(tests.status, 200);
  assert.equal((await tests.json()).entry.amountMinor, 5_000);
});
