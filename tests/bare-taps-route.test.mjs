// Bare taps (DOMAIN.md "Bare Tap"): since iOS 27.2, and on most taps
// abroad, Wallet runs the automation before it has the payment's details, so
// the Apple Pay Shortcut gets no shop and often no amount, only the card.
// Such a tap is kept as a waiting tap with no shop, and its details come
// later from Entries' card (shop and amount), the bank's alert, a receipt in
// Ask (receipt-match tests), a second Shortcut run that has them, or the
// statement import (waiting-taps tests). Negatives: never another person's,
// never outside the window, two bare taps stay two, a day's bound, and a run
// with nothing at all is refused. Real Worker and real local D1 (demo
// household: Tim the owner, Joyce the partner).
import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_HOUSEHOLD_ID } from "../src/domain/app-repository-constants.ts";
import { BARE_TAPS_PER_PERSON_PER_DAY } from "../src/domain/waiting-taps-config.ts";
import { createSeededTemplate, openSeededDatabase, rows } from "./support/d1-workspace.mjs";
import { enableShortcut, saveRate, TOKEN } from "./support/foreign-wallet.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const V8 = "apple-pay-api-2026-11-17-v8";
const V6 = "apple-pay-api-2026-08-24-v6";
const JOYCE = "person-joyce";
const JOYCE_KEY = "mm_joyce-phone-key";
let counter = 0;
const nextId = () => `apple-pay-20261120${String(180000000 + (counter += 1)).padStart(9, "0")}`;

function post(fetchWorker, path, body, key = TOKEN) {
  return fetchWorker(`${path}?shortcut_token=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  }).then(async (response) => ({ status: response.status, payload: await response.json() }));
}

// A run as the released Shortcut sends it: by default a bare tap on the
// owner's Citibank card, as Wallet names it.
const run = (fetchWorker, body = {}, key) => post(fetchWorker, "/api/shortcuts/entries/create", {
  amount: "", description: "", date: "2026-11-20", name: "Citibank Singapore", requestId: nextId(), clientVersion: V8, ...body
}, key);

const accountId = async (db, name) => (await rows(db, "SELECT id FROM accounts WHERE account_name = ?", name))[0].id;
const tapRows = (db) => rows(db, `
  SELECT person_id, merchant, wallet_name, tap_date, status, completed_by, entry_id IS NOT NULL AS has_entry
  FROM waiting_taps ORDER BY received_at, rowid`);
const entryCount = async (db) => (await rows(db, "SELECT COUNT(*) AS n FROM transactions"))[0].n;

async function setUp(t) {
  const opened = await openSeededDatabase(t, template);
  const { db } = opened;
  // The owner's setting: UOB One first, Citi Rewards for other currencies.
  await enableShortcut(db, { defaultAccountPriorityIds: [await accountId(db, "UOB One")], foreignCurrencyAccountId: await accountId(db, "Citi Rewards") });
  await saveRate(db, { quote: "JPY", quotePerBase: 115.5, rateDate: "2026-11-20" });
  return opened;
}

async function addJoyce(db, api) {
  const saved = await api("/api/settings/shortcuts/save", {
    personId: JOYCE, apiKey: JOYCE_KEY, defaultAccountPriorityIds: [await accountId(db, "UOB One")], defaultParams: "", foreignCurrencyAccountId: ""
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.payload));
}

async function ageAll(db, seconds) {
  await db.prepare("UPDATE waiting_taps SET received_at = ?").bind(new Date(Date.now() - seconds * 1000).toISOString()).run();
}

test("a bare tap is kept with no shop, the card Wallet named and the phone's day; its audit line says so", async (t) => {
  const { db, fetch: fetchWorker } = await setUp(t);
  const before = await entryCount(db);
  const kept = await run(fetchWorker, { name: "UOB One" });
  assert.equal(kept.status, 202, JSON.stringify(kept.payload));
  const { openUrl, ...reply } = kept.payload;
  assert.deepEqual(reply, {
    ok: true, held: true, requestId: kept.payload.requestId, merchant: "", accountName: "UOB One",
    notice: "Payment on UOB One noted. Waiting for its details."
  });
  const [row] = await rows(db, "SELECT id, account_id FROM waiting_taps");
  assert.equal(openUrl, `http://127.0.0.1/entries?waiting_tap=${row.id}`);
  assert.equal(row.account_id, await accountId(db, "UOB One"));
  assert.deepEqual(await tapRows(db), [{
    person_id: "person-tim", merchant: "", wallet_name: "UOB One", tap_date: "2026-11-20", status: "waiting", completed_by: null, has_entry: 0
  }]);
  assert.equal(await entryCount(db), before);
  const [audit] = await rows(db, "SELECT detail FROM audit_events WHERE entity_type = 'waiting_tap'");
  assert.equal(audit.detail, "An Apple Pay tap on 2026-11-20 came with no shop and no amount and is waiting for its details.");

  // The same run again (the Shortcut's own retry) is the same tap.
  const again = await run(fetchWorker, { name: "UOB One", requestId: kept.payload.requestId });
  assert.deepEqual(again.payload, kept.payload);
  assert.equal((await tapRows(db)).length, 1);
});

test("an unknown card name is still kept, on the first card in the person's order; its Wallet name kept", async (t) => {
  const { db, fetch: fetchWorker } = await setUp(t);
  const kept = await run(fetchWorker, { name: "Some Card Wallet Knows" });
  assert.equal(kept.status, 202, JSON.stringify(kept.payload));
  assert.equal(kept.payload.accountName, "UOB One");
  assert.deepEqual((await tapRows(db)).map((row) => row.wallet_name), ["Some Card Wallet Knows"]);
});

test("an amount with no shop is kept; the amount is said once and never stored", async (t) => {
  const { db, fetch: fetchWorker } = await setUp(t);
  const kept = await run(fetchWorker, { amount: "JP¥965" });
  assert.equal(kept.status, 202, JSON.stringify(kept.payload));
  assert.equal(kept.payload.notice, "Payment of JPY 965 on Citi Rewards noted. Waiting for its details.");
  assert.equal(kept.payload.accountName, "Citi Rewards");
  const dump = JSON.stringify(await rows(db, "SELECT * FROM waiting_taps"));
  assert.doesNotMatch(dump, /965/);
  assert.equal((await rows(db, "SELECT detail FROM audit_events WHERE entity_type = 'waiting_tap'"))[0].detail,
    "An Apple Pay tap on 2026-11-20 came with no shop and is waiting for its details.");
});

test("a bare tap's status read never asks (the Shortcut's question cannot bring the shop)", async (t) => {
  const { fetch: fetchWorker } = await setUp(t);
  const kept = await run(fetchWorker, {});
  assert.equal(kept.status, 202);
  assert.equal(kept.payload.askAfterSeconds, undefined);
  const read = await post(fetchWorker, "/api/shortcuts/taps/status", { requestId: kept.payload.requestId });
  assert.equal(read.status, 200);
  assert.equal(read.payload.ask, undefined);
  assert.equal(read.payload.status, "waiting");
  assert.equal(read.payload.notice, `Payment on ${kept.payload.accountName} noted. Waiting for its details.`);
});

test("two bare taps the same hour stay two; a later run with the details finishes neither, and is its own entry", async (t) => {
  const { db, fetch: fetchWorker } = await setUp(t);
  await run(fetchWorker, { name: "UOB One" });
  await run(fetchWorker, { name: "UOB One" });
  assert.equal((await tapRows(db)).length, 2);
  const full = await run(fetchWorker, { name: "UOB One", description: "Lawson Ginza", amount: "$12.34" });
  assert.equal(full.status, 200, JSON.stringify(full.payload));
  assert.equal(full.payload.completedHeldTap, undefined);
  assert.deepEqual((await tapRows(db)).map((row) => row.status), ["waiting", "waiting"]);
});

test("one bare tap is finished by a run with the details on the same card within two minutes; the entry is the run's shop and amount", async (t) => {
  const { db, fetch: fetchWorker } = await setUp(t);
  await run(fetchWorker, { name: "UOB One" });
  const full = await run(fetchWorker, { name: "UOB One", description: "Lawson Ginza", amount: "$12.34" });
  assert.equal(full.status, 200, JSON.stringify(full.payload));
  assert.equal(full.payload.completedHeldTap, true);
  const [tap] = await tapRows(db);
  assert.deepEqual([tap.status, tap.completed_by, tap.has_entry], ["completed", "second_tap", 1]);
  const [entry] = await rows(db, "SELECT description, amount_minor, transaction_date FROM transactions WHERE id = ?", full.payload.entryId);
  assert.deepEqual(entry, { description: "Lawson Ginza", amount_minor: 1234, transaction_date: "2026-11-20" });
});

test("a run with the details after the window, on another card or from another person never finishes a bare tap", async (t) => {
  const { db, api, fetch: fetchWorker } = await setUp(t);
  await addJoyce(db, api);
  await run(fetchWorker, { name: "UOB One" });

  // Another person's purchase on a card of the same name.
  const joyce = await run(fetchWorker, { name: "UOB One", description: "Lawson Ginza", amount: "$12.34" }, JOYCE_KEY);
  assert.deepEqual([joyce.status, joyce.payload.completedHeldTap], [200, undefined]);
  // Another card.
  const ocbc = await run(fetchWorker, { name: "OCBC 365", accountName: "OCBC 365", description: "Lawson Ginza", amount: "$12.34" });
  assert.equal(ocbc.payload.completedHeldTap, undefined, JSON.stringify(ocbc.payload));
  // Past the window.
  await ageAll(db, 3 * 60);
  const late = await run(fetchWorker, { name: "UOB One", description: "Lawson Ginza", amount: "$12.34" });
  assert.deepEqual([late.status, late.payload.completedHeldTap], [200, undefined]);
  assert.deepEqual((await tapRows(db)).map((row) => row.status), ["waiting"]);
});

test(`at most ${BARE_TAPS_PER_PERSON_PER_DAY} bare taps a person a day are kept; the next is refused in words the Shortcut shows`, async (t) => {
  const { db, api, fetch: fetchWorker } = await setUp(t);
  await addJoyce(db, api);
  const uob = await accountId(db, "UOB One");
  // A day's worth already kept (some since put away: they still count).
  await db.batch(Array.from({ length: BARE_TAPS_PER_PERSON_PER_DAY }, (_, index) => db.prepare(`
    INSERT INTO waiting_taps (id, household_id, request_id, person_id, account_id, merchant, tap_date, received_at, status)
    VALUES (?, ?, ?, 'person-tim', ?, '', '2026-11-20', ?, 'not_a_payment')
  `).bind(`tap-cap-${index}`, DEFAULT_HOUSEHOLD_ID, `apple-pay-cap-${index}`, uob, new Date().toISOString())));

  const refused = await run(fetchWorker, {});
  assert.deepEqual([refused.status, refused.payload], [429, { ok: false, error: "Too many payments came without details today. This one was not kept." }]);
  // v6 shows it on its line: "Not saved  • Too many payments came without details today. This one was not kept."
  const v6 = await run(fetchWorker, { clientVersion: V6 });
  assert.equal(v6.status, 429);
  // Another day, another person, and a tap with a shop are not bounded by it.
  assert.equal((await run(fetchWorker, { date: "2026-11-21" })).status, 202);
  assert.equal((await run(fetchWorker, {}, JOYCE_KEY)).status, 202);
  assert.equal((await run(fetchWorker, { description: "Lawson Ginza" })).status, 202);
});

test("Entries' card finishes a bare tap with the shop and amount typed; without a shop it is refused and nothing changes", async (t) => {
  const { db, api, fetch: fetchWorker } = await setUp(t);
  await run(fetchWorker, {});
  const [{ id }] = await rows(db, "SELECT id FROM waiting_taps");
  const before = await entryCount(db);

  const noShop = await api("/api/waiting-taps/complete", { tapId: id, amount: "12.50", currency: "SGD" });
  assert.deepEqual([noShop.status, noShop.payload], [400, { ok: false, error: "Type the shop's name." }]);
  const blankShop = await api("/api/waiting-taps/complete", { tapId: id, amount: "12.50", currency: "SGD", merchant: "   " });
  assert.equal(blankShop.status, 400);
  assert.equal(await entryCount(db), before);

  const saved = await api("/api/waiting-taps/complete", { tapId: id, amount: "965", currency: "JPY", merchant: "FamilyMart Nagoya" });
  assert.equal(saved.status, 200, JSON.stringify(saved.payload));
  const [entry] = await rows(db, `
    SELECT t.description, t.original_amount_minor, t.original_currency, t.transaction_date, a.account_name
    FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE t.id = ?`, saved.payload.entryId);
  // In yen: on the card for other currencies, as the Shortcut would save it.
  assert.deepEqual(entry, { description: "FamilyMart Nagoya", original_amount_minor: 96500, original_currency: "JPY", transaction_date: "2026-11-20", account_name: "Citi Rewards" });
  assert.deepEqual((await tapRows(db)).map((row) => [row.status, row.completed_by]), [["completed", "app"]]);
  // A tap with its own shop ignores a typed one.
  await run(fetchWorker, { name: "UOB One", description: "Toast Box" });
  const [named] = await rows(db, "SELECT id FROM waiting_taps WHERE merchant = 'Toast Box'");
  const other = await api("/api/waiting-taps/complete", { tapId: named.id, amount: "5", currency: "SGD", merchant: "Something Else" });
  assert.equal((await rows(db, "SELECT description FROM transactions WHERE id = ?", other.payload.entryId))[0].description, "Toast Box");
});

const AMAZE_ALERT = "Payment successful\nYou have just paid JPY 440 to FAMILYMART NAGOYA. Your total wallet balance is running low at SGD 3.41. Top up now to continue using your amaze wallet";
const alert = (fetchWorker, key, requestId = `bank-alert-${nextId()}`) => post(fetchWorker, "/api/shortcuts/alerts/bank", {
  text: AMAZE_ALERT, receivedAt: new Date().toISOString(), requestId, clientVersion: "bank-alert-2026-11-17-v1"
}, key);

test("the bank's alert finishes the person's one bare tap with the alert's shop and amount", async (t) => {
  const { db, fetch: fetchWorker } = await setUp(t);
  await run(fetchWorker, { name: "Amaze" });
  const reply = await alert(fetchWorker);
  assert.equal(reply.status, 200, JSON.stringify(reply.payload));
  assert.equal(reply.payload.completed, true);
  const [entry] = await rows(db, `
    SELECT t.description, t.original_amount_minor, t.original_currency, a.account_name
    FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE t.id = ?`, reply.payload.entryId);
  assert.deepEqual(entry, { description: "FAMILYMART NAGOYA", original_amount_minor: 44000, original_currency: "JPY", account_name: "Citi Rewards" });
  assert.deepEqual((await tapRows(db)).map((row) => [row.status, row.completed_by]), [["completed", "bank_alert"]]);
  // The alert's text is not kept anywhere beyond the entry's shop and amount.
  assert.doesNotMatch(JSON.stringify(await rows(db, "SELECT * FROM audit_events")), /wallet balance|3\.41/);
});

test("the bank's alert never finishes another person's bare tap, two bare taps, or one outside its window", async (t) => {
  const { db, api, fetch: fetchWorker } = await setUp(t);
  await addJoyce(db, api);
  await run(fetchWorker, { name: "Amaze" });
  // Joyce's alert: Tim's tap is not hers.
  const joyce = await alert(fetchWorker, JOYCE_KEY);
  assert.deepEqual(joyce.payload, { ok: true, completed: false, reason: "no_tap" });
  // Two bare taps: neither is guessed.
  await run(fetchWorker, { name: "Amaze" });
  const two = await alert(fetchWorker);
  assert.deepEqual(two.payload, { ok: true, completed: false, reason: "several_taps" });
  // One, but long before the alert.
  await db.prepare("UPDATE waiting_taps SET status = 'not_a_payment' WHERE rowid = (SELECT MAX(rowid) FROM waiting_taps)").run();
  await ageAll(db, 2 * 60 * 60);
  const late = await alert(fetchWorker);
  assert.deepEqual(late.payload, { ok: true, completed: false, reason: "no_tap" });
  assert.deepEqual((await tapRows(db)).map((row) => row.status), ["waiting", "not_a_payment"]);
});

test("the bank's alert prefers a waiting tap whose shop agrees over a bare tap", async (t) => {
  const { db, fetch: fetchWorker } = await setUp(t);
  await run(fetchWorker, { name: "Amaze" });
  await run(fetchWorker, { name: "Amaze", description: "FamilyMart Nagoya" });
  const reply = await alert(fetchWorker);
  assert.equal(reply.payload.completed, true, JSON.stringify(reply.payload));
  assert.deepEqual((await tapRows(db)).map((row) => [row.merchant, row.status]), [["", "waiting"], ["FamilyMart Nagoya", "completed"]]);
});

test("the household scope: another household's key cannot read or finish a bare tap", async (t) => {
  const { db, api, fetch: fetchWorker } = await setUp(t);
  const kept = await run(fetchWorker, {});
  const wrongKey = await post(fetchWorker, "/api/shortcuts/taps/status", { requestId: kept.payload.requestId }, "not-a-key");
  assert.equal(wrongKey.status, 401);
  const [{ id }] = await rows(db, "SELECT id FROM waiting_taps");
  await db.prepare("INSERT INTO households (id, name) VALUES ('household-other', 'Other')").run();
  await db.prepare("UPDATE waiting_taps SET household_id = 'household-other'").run();
  const finish = await api("/api/waiting-taps/complete", { tapId: id, amount: "5", currency: "SGD", merchant: "Toast Box" });
  assert.equal(finish.status, 409);
  const page = await api("/api/entries-page?view=household&month=2026-11");
  assert.equal(page.status, 200);
  assert.equal(page.payload.waitingTaps, undefined);
  const alertReply = await alert(fetchWorker);
  assert.deepEqual(alertReply.payload, { ok: true, completed: false, reason: "no_tap" });
});
