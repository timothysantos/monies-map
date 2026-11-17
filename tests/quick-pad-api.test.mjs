// The quick pad's card payments and failed Apple Pay taps (DOMAIN.md "Quick
// Entry", "Waiting Tap"; docs/flows/cash-entry-flow.md) through the real
// Worker and a real local D1 (demo household: Tim owns UOB One, Joyce owns
// UOB Lady's and Citi Rewards). A card payment typed in the trip's currency
// is a Foreign Currency Estimate that the card's statement row replaces; a
// waiting tap is finished from the pad through its own complete command,
// once; the person's own cards and taps only.
import assert from "node:assert/strict";
import test from "node:test";

import { createSeededTemplate, openSeededDatabase, rows } from "./support/d1-workspace.mjs";
import { enableShortcut, saveRate, TOKEN } from "./support/foreign-wallet.mjs";
import { addDays } from "../src/domain/cash-entry.ts";
import { todayInAppTimeZone } from "../src/lib/app-calendar.ts";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const TIM = "person-tim";
const JOYCE = "person-joyce";
const V8 = "apple-pay-api-2026-11-17-v8";
const JOYCE_KEY = "mm_joyce-phone-key";
const today = todayInAppTimeZone();

const accountId = async (db, name) => (await rows(db, "SELECT id FROM accounts WHERE account_name = ?", name))[0].id;
const entryCount = async (db) => (await rows(db, "SELECT COUNT(*) AS n FROM transactions"))[0].n;

async function addTrip(api, currency = "IDR") {
  const trip = await api("/api/trip-events/save", { name: "Bali trip", startDate: addDays(today, -2), endDate: addDays(today, 5), currency });
  assert.equal(trip.status, 200, JSON.stringify(trip.payload));
}

function save(api, body, options) {
  return api("/api/cash-entries/create", { requestId: crypto.randomUUID(), personId: TIM, ...body }, options);
}

// An Apple Pay tap that came with no amount (Shortcut v8), on the key's card.
async function holdTap(fetchWorker, { requestId = "apple-pay-20261117140200000", description = "Periplus Bali", name = "UOB One", key = TOKEN } = {}) {
  const response = await fetchWorker(`/api/shortcuts/entries/create?shortcut_token=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ date: today, description, name, requestId, clientVersion: V8, amount: "" })
  });
  const payload = await response.json();
  assert.equal(response.status, 202, JSON.stringify(payload));
  return payload;
}

const tapRows = (db) => rows(db, "SELECT id, person_id, status, completed_by, entry_id FROM waiting_taps ORDER BY received_at");

test("the pad offers only the person's own cards, most recently used first, and only their waiting taps", async (t) => {
  const { db, api, fetch: fetchWorker } = await openSeededDatabase(t, template);
  await enableShortcut(db);
  await api("/api/settings/shortcuts/save", { personId: JOYCE, apiKey: JOYCE_KEY, defaultAccountPriorityIds: [await accountId(db, "Citi Rewards")], defaultParams: "", foreignCurrencyAccountId: "" });
  await holdTap(fetchWorker, {});
  await holdTap(fetchWorker, { requestId: "apple-pay-20261117141000000", description: "Bintang Supermarket", name: "Citi Rewards", key: JOYCE_KEY });
  const citi = await accountId(db, "Citi Rewards");
  const lady = await accountId(db, "UOB Lady's");
  // Joyce paid with UOB Lady's yesterday: it comes before Citi Rewards.
  const paid = await save(api, { personId: JOYCE, way: "card", accountId: lady, amountMinor: 1250, currency: "SGD", date: addDays(today, -1) });
  assert.equal(paid.status, 200, JSON.stringify(paid.payload));

  const tim = (await api(`/api/cash-entries/defaults?person=${TIM}`)).payload.defaults;
  const joyce = (await api(`/api/cash-entries/defaults?person=${JOYCE}`)).payload.defaults;

  assert.deepEqual(tim.cards, [{ id: await accountId(db, "UOB One"), name: "UOB One", currency: "SGD" }]);
  assert.deepEqual(joyce.cards.map((card) => card.name), ["UOB Lady's", "Citi Rewards"]);
  assert.deepEqual(tim.waitingTaps.map((tap) => [tap.merchant, tap.accountName]), [["Periplus Bali", "UOB One"]]);
  assert.match(tim.waitingTaps[0].time, /^\d{2}:\d{2}$/);
  assert.deepEqual(joyce.waitingTaps.map((tap) => [tap.merchant, tap.accountName]), [["Bintang Supermarket", "Citi Rewards"]]);
  // No digits of any card in what the pad reads.
  assert.doesNotMatch(JSON.stringify(tim.cards) + JSON.stringify(joyce.cards), /\d{4}/);
  assert.equal(citi.length > 0, true);
});

test("a card payment in the trip's currency is saved as an estimate at the day's rate, the rupiah kept; another person's card is refused", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await addTrip(api);
  await saveRate(db, { quote: "IDR", quotePerBase: 13_500, rateDate: today });
  const uobOne = await accountId(db, "UOB One");

  const saved = await save(api, { way: "card", accountId: uobOne, amountMinor: 8_500_000 });

  assert.equal(saved.status, 200, JSON.stringify(saved.payload));
  assert.deepEqual({ ...saved.payload.entry, entryId: undefined, storedNote: undefined }, {
    entryId: undefined,
    created: true,
    date: today,
    description: "Card payment",
    categoryName: "Other",
    personId: TIM,
    personName: "Tim",
    accountId: uobOne,
    accountName: "UOB One",
    amountMinor: 630,
    accountCurrency: "SGD",
    paidAmountMinor: 8_500_000,
    paidCurrency: "IDR",
    note: null,
    storedNote: undefined
  });
  const [row] = await rows(db, `
    SELECT amount_minor, currency, original_amount_minor, original_currency, bank_certification_status, note, external_reference
    FROM transactions WHERE id = ?`, saved.payload.entry.entryId);
  assert.equal(row.amount_minor, 630);
  assert.equal(row.original_amount_minor, 8_500_000);
  assert.equal(row.original_currency, "IDR");
  assert.equal(row.bank_certification_status, "provisional");
  assert.match(row.note, /^Paid IDR 85,000\. Saved as about SGD 6\.30 at 1 SGD = 13,500 IDR .*Your card's SGD amount may differ\.$/);
  assert.match(row.external_reference, /^cash:/);

  // Joyce's card from Tim's pad, a cash wallet as a "card", an unknown id: nothing saved.
  const before = await entryCount(db);
  for (const card of [await accountId(db, "Citi Rewards"), await accountId(db, "UOB Savings"), "acct-nope"]) {
    const refused = await save(api, { way: "card", accountId: card, amountMinor: 8_500_000 });
    assert.deepEqual([refused.status, refused.payload.field], [400, "wallet"], card);
  }
  assert.equal(await entryCount(db), before);
});

// Near-real rows: Citi Rewards activity export wording from a Bali trip
// (tests/fixtures/citibank-activity/ACCT_349_26_09_2026-bali-sanitized.csv),
// moved to this week so the pad could have typed them.
test("the card's statement rows replace the pad's estimates instead of adding to them; an ordinary row is never taken for one", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await addTrip(api);
  await saveRate(db, { quote: "IDR", quotePerBase: 13_500, rateDate: today });
  const citi = await accountId(db, "Citi Rewards");
  const yesterday = addDays(today, -1);
  const pad = async (amountMinor) => {
    const saved = await save(api, { personId: JOYCE, way: "card", accountId: citi, amountMinor, date: yesterday });
    assert.equal(saved.status, 200, JSON.stringify(saved.payload));
    return saved.payload.entry.entryId;
  };
  // A Grab ride straight on the card (the row prints the rupiah), a dinner
  // through Amaze (the row names the shop, which the pad never had), and a
  // third one the size of an ordinary Singapore row.
  const grab = await pad(8_050_000);
  const dinner = await pad(9_200_000);
  const third = await pad(31_050_000);

  const rowsOut = [
    [yesterday, "Grab* A-9TRT9C5GW86TAV   JAKARTA PUSATID XXXX-XXXX-XXXX- IDR 80,500 Rp. 80,500", "5.96"],
    [today, "AMAZE* KULA PADI         SINGAPORE    SG", "6.84"],
    [today, "SHOPEE SG MP           SINGAPORE     SGP", "23.00"]
  ];
  const { status, payload } = await api("/api/imports/preview", {
    sourceLabel: "Citi Rewards activity",
    sourceType: "csv",
    rows: rowsOut.map(([date, description, amount]) => ({ date, description, expense: amount, income: "", account: "Citi Rewards", category: "Other", type: "expense" })),
    ownershipType: "direct",
    ownerName: "Joyce",
    statementCheckpoints: []
  });
  assert.equal(status, 200, JSON.stringify(payload));
  const targets = payload.preview.previewRows.map((row) => row.reconciliationTargetTransactionId ?? null);
  assert.deepEqual(targets, [grab, dinner, null]);
  assert.notEqual(targets[2], third);
});

test("a card payment while a tap on that card waits offers the tap and saves nothing; New payment saves it; another card or person is not offered", async (t) => {
  const { db, api, fetch: fetchWorker } = await openSeededDatabase(t, template);
  await enableShortcut(db);
  await holdTap(fetchWorker, {});
  const uobOne = await accountId(db, "UOB One");
  const before = await entryCount(db);

  const offered = await save(api, { way: "card", accountId: uobOne, amountMinor: 4_590, currency: "SGD" });

  assert.equal(offered.status, 409, JSON.stringify(offered.payload));
  const [tap] = await tapRows(db);
  assert.equal(offered.payload.offerTap.id, tap.id);
  assert.equal(offered.payload.offerTap.merchant, "Periplus Bali");
  assert.equal(offered.payload.offerTap.accountName, "UOB One");
  assert.equal(await entryCount(db), before);

  // Cash never asks about a card's tap.
  const cash = await api("/api/accounts/create", { name: "Tim's cash", institution: "Cash", kind: "cash", currency: "SGD", ownerPersonId: TIM });
  await api("/api/settings/payment-ways/save", { personId: TIM, bankTransferAccountId: "", cashAccountId: cash.payload.accountId });
  assert.equal((await save(api, { amountMinor: 450, currency: "SGD" })).status, 200);

  // An hour and more later the tap is no longer offered.
  await db.prepare("UPDATE waiting_taps SET received_at = ?").bind(new Date(Date.now() - 61 * 60_000).toISOString()).run();
  assert.equal((await save(api, { way: "card", accountId: uobOne, amountMinor: 4_590, currency: "SGD" })).status, 200);
  await db.prepare("UPDATE waiting_taps SET received_at = ?").bind(new Date().toISOString()).run();

  const separate = await save(api, { way: "card", accountId: uobOne, amountMinor: 4_590, currency: "SGD", newPayment: true });
  assert.equal(separate.status, 200, JSON.stringify(separate.payload));
  assert.equal((await tapRows(db))[0].status, "waiting");
});

test("finishing a waiting tap from the pad completes it once through its own command: the tap's shop and card, never a second entry", async (t) => {
  const { db, api, fetch: fetchWorker } = await openSeededDatabase(t, template);
  await enableShortcut(db);
  await saveRate(db, { quote: "IDR", quotePerBase: 13_500, rateDate: today });
  await holdTap(fetchWorker, {});
  const [tap] = await tapRows(db);
  const before = await entryCount(db);
  const requestId = crypto.randomUUID();
  const body = { requestId, tapId: tap.id, amountMinor: 45_000_000, currency: "IDR" };

  const done = await save(api, body);

  assert.equal(done.status, 200, JSON.stringify(done.payload));
  assert.equal(done.payload.completedTap, true);
  const entry = done.payload.entry;
  assert.deepEqual([entry.description, entry.accountName, entry.paidAmountMinor, entry.paidCurrency, entry.amountMinor], ["Periplus Bali", "UOB One", 45_000_000, "IDR", 3333]);
  assert.deepEqual(await tapRows(db), [{ id: tap.id, person_id: TIM, status: "completed", completed_by: "app", entry_id: entry.entryId }]);
  assert.equal(await entryCount(db), before + 1);

  // The answer was lost and the pad sends it again; or another Save: the same entry.
  const again = await save(api, body);
  const other = await save(api, { ...body, requestId: crypto.randomUUID() });
  assert.deepEqual([again.status, again.payload.entry.entryId], [200, entry.entryId]);
  assert.deepEqual([other.status, other.payload.entry.entryId], [200, entry.entryId]);
  assert.equal(await entryCount(db), before + 1);
});

test("another person's tap cannot be finished from a pad, and a bad amount writes nothing", async (t) => {
  const { db, api, fetch: fetchWorker } = await openSeededDatabase(t, template);
  await enableShortcut(db);
  await holdTap(fetchWorker, {});
  const [tap] = await tapRows(db);
  const before = await entryCount(db);

  const joyce = await save(api, { personId: JOYCE, tapId: tap.id, amountMinor: 4_590, currency: "SGD" });
  const zero = await save(api, { tapId: tap.id, amountMinor: 0, currency: "SGD" });
  const cents = await save(api, { tapId: tap.id, amountMinor: 4_590_050, currency: "IDR" });
  const unknown = await save(api, { tapId: "tap-nope", amountMinor: 4_590, currency: "SGD" });

  assert.deepEqual([joyce.status, joyce.payload.field], [400, "tap"]);
  assert.deepEqual([zero.status, zero.payload.field], [400, "amount"]);
  assert.deepEqual([cents.status, cents.payload.field], [400, "amount"]);
  assert.deepEqual([unknown.status, unknown.payload.field], [400, "tap"]);
  assert.equal(await entryCount(db), before);
  assert.equal((await tapRows(db))[0].status, "waiting");
});

test("quick entries waiting for a few words: the pad's own name, in Other, no note, the last 3 days; the person's own", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const uobOne = await accountId(db, "UOB One");
  const lady = await accountId(db, "UOB Lady's");
  const made = {};
  for (const [name, body] of [
    ["today", { way: "card", accountId: uobOne, amountMinor: 1200, currency: "SGD" }],
    ["twoDaysAgo", { way: "card", accountId: uobOne, amountMinor: 1300, currency: "SGD", date: addDays(today, -2) }],
    ["threeDaysAgo", { way: "card", accountId: uobOne, amountMinor: 1400, currency: "SGD", date: addDays(today, -3) }],
    ["named", { way: "card", accountId: uobOne, amountMinor: 1500, currency: "SGD", description: "Ramen" }],
    ["noted", { way: "card", accountId: uobOne, amountMinor: 1600, currency: "SGD", note: "for the kids" }],
    ["joyce", { personId: JOYCE, way: "card", accountId: lady, amountMinor: 1700, currency: "SGD" }]
  ]) {
    const saved = await save(api, body);
    assert.equal(saved.status, 200, `${name}: ${JSON.stringify(saved.payload)}`);
    made[name] = saved.payload.entry.entryId;
  }
  // A category chosen after Save counts as described.
  const categorised = await save(api, { way: "card", accountId: uobOne, amountMinor: 1800, currency: "SGD" });
  const recategorised = await api("/api/entries/update-category", { entryId: categorised.payload.entry.entryId, categoryName: "Shopping" });
  assert.equal(recategorised.status, 200, JSON.stringify(recategorised.payload));

  const tim = (await api(`/api/cash-entries/defaults?person=${TIM}`)).payload.defaults;

  assert.deepEqual(tim.undescribed.map((entry) => entry.entryId), [made.today, made.twoDaysAgo]);
  assert.deepEqual(tim.undescribed.map((entry) => [entry.amountMinor, entry.currency, entry.accountName]), [[1200, "SGD", "UOB One"], [1300, "SGD", "UOB One"]]);

  const reminders = (await api(`/api/reminders?view=${TIM}`)).payload.reminders.filter((reminder) => reminder.kind === "quick_words");
  assert.deepEqual(reminders, [{
    key: `quick_words:${TIM}:${made.today}`,
    kind: "quick_words",
    personId: TIM,
    personName: "Tim",
    count: 2,
    allToday: false,
    newestDate: today
  }]);
  const household = (await api("/api/reminders?view=household")).payload.reminders.filter((reminder) => reminder.kind === "quick_words");
  assert.deepEqual(household.map((reminder) => [reminder.personName, reminder.count, reminder.allToday]), [["Joyce", 1, true], ["Tim", 2, false]]);
});
