// Every released Apple Pay Shortcut keeps working against today's server.
// Installed copies never update themselves (the owner was in Japan on v7 in
// November 2026 and every yen tap was refused), so each release's request
// is replayed here exactly as it sends it (tests/fixtures/
// shortcut-released-requests.json, read from the Apple-signed files): yen,
// rupiah and dollar amounts in the text Wallet hands over on a phone set to
// English (Singapore), and a blank amount. A deploy that breaks an older
// Shortcut fails this file. Real Worker and real local D1 (demo household).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import { createSeededTemplate, openSeededDatabase, rows } from "./support/d1-workspace.mjs";
import { enableShortcut, saveRate, TOKEN } from "./support/foreign-wallet.mjs";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/shortcut-released-requests.json", import.meta.url), "utf8"));
const RELEASES_DIR = new URL("../shortcuts/apple-pay-api/releases/", import.meta.url);
const SOURCE_PLIST = new URL("../shortcuts/apple-pay-api/monies-map-apple-pay-api.plist", import.meta.url);

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

// 1 SGD = 115.5 JPY and 14,025 IDR, saved as if fetched just now (the test
// Worker reads saved rates only).
const JPY_PER_SGD = 115.5;

// What the Wallet automation hands the Shortcut, on a phone set to English
// (Singapore): new Intl.NumberFormat("en-SG", { style: "currency", currency }).
test("the Wallet amounts replayed here are what an English (Singapore) phone writes", () => {
  const enSg = (currency, value) => new Intl.NumberFormat("en-SG", { style: "currency", currency }).format(value);
  assert.equal(enSg("JPY", 965), "JP¥965");
  assert.equal(enSg("JPY", 47684), "JP¥47,684");
  assert.equal(enSg("IDR", 159000).replace(/\s/gu, " "), "IDR 159,000");
  assert.equal(enSg("SGD", 12.34), "$12.34");
  // Other English and Japanese settings write the yen differently.
  assert.equal(new Intl.NumberFormat("en-US", { style: "currency", currency: "JPY" }).format(965), "¥965");
  assert.equal(new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY" }).format(965), "￥965");
});

test("every signed release has its request shape here, and the source matches the newest", () => {
  const releaseFiles = readdirSync(RELEASES_DIR).filter((name) => name.endsWith(".shortcut")).sort();
  assert.deepEqual(fixture.releases.map((release) => release.file).sort(), releaseFiles);

  // The committed source is the newest release: its JSON keys and its
  // clientVersion are the last fixture row's.
  const source = readFileSync(SOURCE_PLIST, "utf8");
  const newest = fixture.releases.at(-1);
  assert.match(source, new RegExp(`<string>${newest.clientVersion}</string>`));
  for (const key of newest.keys) {
    assert.match(source, new RegExp(`<string>${key}</string>`), key);
  }
});

function post(fetchWorker, body) {
  return fetchWorker(`/api/shortcuts/entries/create?shortcut_token=${TOKEN}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  }).then(async (response) => ({ status: response.status, payload: await response.json() }));
}

let tapCounter = 0;
// The body exactly as a release sends it: only its own keys.
function releaseBody(release, { amount, merchant, walletName = "Amaze" }) {
  tapCounter += 1;
  const all = {
    amount,
    description: merchant,
    date: "2026-11-20",
    name: walletName,
    requestId: `apple-pay-20261120${String(120000000 + tapCounter).padStart(9, "0")}`,
    clientVersion: release.clientVersion
  };
  return Object.fromEntries(release.keys.map((key) => [key, all[key]]));
}

async function setUp(t) {
  const { db, api, fetch: fetchWorker } = await openSeededDatabase(t, template);
  const accounts = Object.fromEntries((await rows(db, "SELECT id, account_name FROM accounts WHERE is_active = 1")).map((row) => [row.account_name, row.id]));
  const citiRewards = accounts["Citi Rewards"];
  const uobOne = accounts["UOB One"];
  assert.ok(citiRewards && uobOne);
  // The owner's production setting: UOB One first, Citi Rewards (the card
  // behind Amaze) for purchases in another currency.
  await enableShortcut(db, { defaultAccountPriorityIds: [uobOne], foreignCurrencyAccountId: citiRewards });
  await saveRate(db, { quote: "JPY", quotePerBase: JPY_PER_SGD, rateDate: "2026-11-20" });
  await saveRate(db, { quote: "IDR", quotePerBase: 14025, rateDate: "2026-11-20" });
  return { db, api, fetchWorker };
}

const savedEntry = async (db, entryId) => (await rows(db, `
  SELECT transactions.amount_minor, transactions.currency, transactions.original_amount_minor, transactions.original_currency,
    accounts.account_name
  FROM transactions JOIN accounts ON accounts.id = transactions.account_id WHERE transactions.id = ?`, entryId))[0];

// No yen figure is ever saved as Singapore dollars.
async function assertNoYenAsDollars(db) {
  const wrong = await rows(db, "SELECT id, amount_minor FROM transactions WHERE currency = 'SGD' AND original_currency IS NULL AND amount_minor IN (96500, 4768400)");
  assert.deepEqual(wrong, []);
}

for (const release of fixture.releases) {
  test(`v${release.version}: a yen tap on Amaze is saved in SGD on the card behind it, the yen kept`, async (t) => {
    const { db, fetchWorker } = await setUp(t);
    for (const [amount, yen] of [["JP¥965", 965], ["JP¥ 965", 965], ["¥965", 965], ["￥965", 965], ["JPY 965", 965], ["JP¥47,684", 47684]]) {
      const { status, payload } = await post(fetchWorker, releaseBody(release, { amount, merchant: "FamilyMart Shibuya" }));
      assert.equal(status, 200, `${amount}: ${JSON.stringify(payload)}`);
      const expectedMinor = Math.round((yen * 100) / JPY_PER_SGD);
      assert.deepEqual(await savedEntry(db, payload.entryId), {
        amount_minor: expectedMinor,
        currency: "SGD",
        original_amount_minor: yen * 100,
        original_currency: "JPY",
        account_name: "Citi Rewards"
      }, amount);
      assert.equal(payload.originalAmount, `JPY ${yen.toLocaleString("en-SG")}`);
    }
    await assertNoYenAsDollars(db);
  });

  test(`v${release.version}: rupiah and Singapore dollar taps save as before`, async (t) => {
    const { db, fetchWorker } = await setUp(t);
    const rupiah = await post(fetchWorker, releaseBody(release, { amount: "IDR 159,000", merchant: "Digimap Icon Sanur" }));
    assert.equal(rupiah.status, 200, JSON.stringify(rupiah.payload));
    assert.deepEqual(await savedEntry(db, rupiah.payload.entryId), {
      amount_minor: 1134, currency: "SGD", original_amount_minor: 15900000, original_currency: "IDR", account_name: "Citi Rewards"
    });

    const dollars = await post(fetchWorker, releaseBody(release, { amount: "$12.34", merchant: "Kopitiam", walletName: "UOB One" }));
    assert.equal(dollars.status, 200, JSON.stringify(dollars.payload));
    assert.deepEqual(await savedEntry(db, dollars.payload.entryId), {
      amount_minor: 1234, currency: "SGD", original_amount_minor: null, original_currency: null, account_name: "UOB One"
    });
  });

  test(`v${release.version}: a blank amount gets the answer this release reads`, async (t) => {
    const { db, fetchWorker } = await setUp(t);
    const before = (await rows(db, "SELECT COUNT(*) AS n FROM transactions"))[0].n;
    const { status, payload } = await post(fetchWorker, releaseBody(release, { amount: "", merchant: "Lawson Ginza" }));
    if (release.readsHeld) {
      assert.equal(status, 202, JSON.stringify(payload));
      assert.equal(payload.held, true);
      assert.equal(payload.notice, "Lawson Ginza noted. Waiting for the amount.");
      assert.equal((await rows(db, "SELECT COUNT(*) AS n FROM waiting_taps WHERE status = 'waiting'"))[0].n, 1);
    } else {
      // v7 asks for the amount on needsAmount; older ones show the error.
      assert.equal(status, 400);
      assert.equal(payload.needsAmount, true);
      assert.equal(payload.error, "Missing or invalid shortcut fields: amount.");
    }
    assert.equal((await rows(db, "SELECT COUNT(*) AS n FROM transactions"))[0].n, before);
  });
}

test("a malformed or unknown amount, a refund or an unknown named card is still refused, and nothing is saved", async (t) => {
  const { db, fetchWorker } = await setUp(t);
  const v7 = fixture.releases.find((release) => release.version === 7);
  const before = (await rows(db, "SELECT COUNT(*) AS n FROM transactions"))[0].n;

  for (const amount of ["JP¥96,5", "JP¥965.123", "₾965", "XX¥965", "JP¥-965", "(JP¥965)", "JP¥965 ¥10"]) {
    const { status, payload } = await post(fetchWorker, releaseBody(v7, { amount, merchant: "Don Quijote" }));
    assert.equal(status, 400, amount);
    assert.equal(payload.needsAmount, undefined, amount);
    assert.equal(payload.error, "Missing or invalid shortcut fields: amount.", amount);
  }

  const unknownCard = await post(fetchWorker, { ...releaseBody(v7, { amount: "JP¥965", merchant: "Don Quijote" }), accountName: "Some Other Card" });
  assert.deepEqual([unknownCard.status, unknownCard.payload.error], [400, "Unknown or inactive account: Some Other Card"]);

  assert.equal((await rows(db, "SELECT COUNT(*) AS n FROM transactions"))[0].n, before);
  assert.equal((await rows(db, "SELECT COUNT(*) AS n FROM waiting_taps"))[0].n, 0);
});

test("with no yen rate at all, a yen tap is not saved (and never as dollars), and the Shortcut is told to run again", async (t) => {
  const { db, fetchWorker } = await setUp(t);
  await db.prepare("DELETE FROM fx_rates WHERE quote_currency = 'JPY'").run();
  const v7 = fixture.releases.find((release) => release.version === 7);
  const before = (await rows(db, "SELECT COUNT(*) AS n FROM transactions"))[0].n;

  const { status, payload } = await post(fetchWorker, releaseBody(v7, { amount: "JP¥965", merchant: "FamilyMart Shibuya" }));
  assert.equal(status, 503);
  assert.equal(payload.error, "Couldn't get today's JPY to SGD exchange rate. Nothing was saved. Run the Shortcut again in a minute.");
  assert.equal((await rows(db, "SELECT COUNT(*) AS n FROM transactions"))[0].n, before);
  await assertNoYenAsDollars(db);
});
