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

  test(`v${release.version}: an Amaze tap in dollars or in yen lands on the card behind Amaze; a real card name stays on that card`, async (t) => {
    const { db, fetchWorker } = await setUp(t);
    // Wallet writes "$12.34" when the amount is in the card's own currency
    // (home, or SGD chosen on a terminal abroad): still the card behind Amaze.
    const dollars = await post(fetchWorker, releaseBody(release, { amount: "$12.34", merchant: "Kopitiam" }));
    assert.equal(dollars.status, 200, JSON.stringify(dollars.payload));
    assert.deepEqual(await savedEntry(db, dollars.payload.entryId), {
      amount_minor: 1234, currency: "SGD", original_amount_minor: null, original_currency: null,
      // v1 sends no Wallet card name at all, so the server cannot know the
      // card is Amaze and its dollar tap goes to the first card (a yen tap
      // still reaches the card behind it by its currency, below).
      account_name: release.keys.includes("name") ? "Citi Rewards" : "UOB One"
    });
    const yen =await post(fetchWorker, releaseBody(release, { amount: "JP¥965", merchant: "FamilyMart Shibuya", walletName: "Amaze Card" }));
    assert.equal(yen.status, 200, JSON.stringify(yen.payload));
    assert.deepEqual(await savedEntry(db, yen.payload.entryId), {
      amount_minor: Math.round(96500 / JPY_PER_SGD), currency: "SGD", original_amount_minor: 96500, original_currency: "JPY", account_name: "Citi Rewards"
    });
    // Negative: another card's own name in dollars is that card.
    const own = await post(fetchWorker, releaseBody(release, { amount: "$5.00", merchant: "Toast Box", walletName: "UOB One" }));
    assert.equal((await savedEntry(db, own.payload.entryId)).account_name, "UOB One");
  });

  // The owner's taps in Takayama on 22 Nov 2026, as Wallet named them: the
  // shop in Japanese script or with a space before a comma, then the town and
  // prefecture, on his UOB and Citibank cards (Wallet's own card names, which
  // match no account by themselves).
  test(`v${release.version}: a Takayama yen tap on a real card is saved on the card for other currencies, the shop kept as Wallet wrote it`, async (t) => {
    const { db, fetchWorker } = await setUp(t);
    for (const [merchant, amount, walletName, yen] of [
      ["駿河屋 エブリフレスポ店, Takayama, Gifu", "JP¥10", "UOB", 10],
      ["駿河屋 エブリフレスポ店, Takayama, Gifu", "JP¥10", "Citibank Singapore", 10],
      ["駿河屋 エブリフレスポ店, Takayama, Gifu", "JP¥10", "UOB One Card", 10],
      ["Pen Shop IMAI , Takayama, Gifu", "JP¥3,300", "Citibank Singapore", 3300]
    ]) {
      const { status, payload } = await post(fetchWorker, releaseBody(release, { amount, merchant, walletName }));
      assert.equal(status, 200, `${merchant} ${walletName}: ${JSON.stringify(payload)}`);
      assert.equal(payload.description, merchant);
      assert.equal(payload.accountResolution, "foreign_currency");
      assert.deepEqual(await savedEntry(db, payload.entryId), {
        amount_minor: Math.max(1, Math.round((yen * 100) / JPY_PER_SGD)),
        currency: "SGD",
        original_amount_minor: yen * 100,
        original_currency: "JPY",
        account_name: "Citi Rewards"
      }, `${merchant} ${walletName}`);
    }
    // Negative: a Takayama tap with no amount saves nothing as an entry.
    const before = (await rows(db, "SELECT COUNT(*) AS n FROM transactions"))[0].n;
    const blank = await post(fetchWorker, releaseBody(release, { amount: "", merchant: "駿河屋 エブリフレスポ店, Takayama, Gifu", walletName: "Citibank Singapore" }));
    assert.equal(blank.status, blankStatus(release), JSON.stringify(blank.payload));
    assert.equal((await rows(db, "SELECT COUNT(*) AS n FROM transactions"))[0].n, before);
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
    const kept = (await rows(db, "SELECT COUNT(*) AS n FROM waiting_taps WHERE status = 'waiting' AND merchant = 'Lawson Ginza'"))[0].n;
    assert.equal(status, blankStatus(release), JSON.stringify(payload));
    if (release.readsHeld) {
      assert.equal(payload.held, true);
      assert.equal(payload.notice, "Lawson Ginza noted. Waiting for the amount.");
      assert.equal(kept, 1);
    } else if (release.readsNeedsAmount) {
      // v7 still asks for the amount on needsAmount; the tap is kept too, so
      // Cancel leaves it on Entries and the answer finishes it.
      assert.equal(payload.needsAmount, true);
      assert.equal(payload.held, true);
      assert.equal(payload.error, "Missing or invalid shortcut fields: amount.");
      assert.equal(kept, 1);
    } else if (release.version >= 2) {
      // "Not saved Lawson Ginza • Kept on Entries until its amount comes in."
      assert.equal(payload.openUrl, undefined);
      assert.equal(payload.needsAmount, undefined);
      assert.equal(payload.error, "Kept on Entries until its amount comes in.");
      assert.equal(kept, 1);
    } else {
      // v1 sends no request id: nothing can be kept safely, as before.
      assert.equal(payload.needsAmount, true);
      assert.equal(payload.error, "Missing or invalid shortcut fields: amount.");
      assert.equal(kept, 0);
    }
    assert.equal((await rows(db, "SELECT COUNT(*) AS n FROM transactions"))[0].n, before);
  });
}

// A blank amount with a shop: v8 reads `held` (202); v7 keeps its question
// (400 needsAmount, the tap kept as well); v2 to v6 get a kept tap and words
// for their "Not saved" line (202); v1 sends no request id (400, as before).
function blankStatus(release) {
  if (release.readsHeld) return 202;
  if (release.readsNeedsAmount) return 400;
  return release.version >= 2 ? 202 : 400;
}

// What each release shows for a reply, exactly as its signed file's actions
// build it (decoded from shortcuts/apple-pay-api/releases; README "What each
// release shows"): v8 shows `notice` when `held`; with `openUrl` every
// release shows "Saved <shop> • <Wallet amount>[ • <card>]"; v7 and v8 ask
// on `needsAmount`; v2 to v8 otherwise show "Not saved <shop> • <error>";
// v1 shows nothing.
function shownBy(release, payload, { merchant, amount }) {
  if (release.readsHeld && payload.held) return payload.notice;
  if (payload.openUrl) return release.version === 1 ? `Saved ${merchant} • ${amount}` : `Saved ${merchant} • ${amount} • ${payload.accountName}`;
  if (release.readsNeedsAmount && payload.needsAmount) return "(asks How much was it?)";
  return release.version === 1 ? null : `Not saved ${merchant} • ${payload.error}`;
}

// The owner's taps in Japan since iOS 27.2 (November 2026): Wallet runs the
// automation before it has the details, so the shop, the amount or both
// come blank and only the card is named. Every release, every shape.
const SHOP = "Familymart Nagoya Kokusai Center S-Shop";
const SHAPES = [
  { shape: "no shop, no amount", merchant: "", amount: "" },
  { shape: "shop only", merchant: SHOP, amount: "" },
  { shape: "amount only", merchant: "", amount: "JP¥965" },
  { shape: "shop and amount", merchant: SHOP, amount: "JP¥965" }
];
const EXPECTED = {
  1: [
    [400, null, 0], [400, null, 0], [400, null, 0], [200, `Saved ${SHOP} • JP¥965`, 0]
  ],
  older: [
    [202, "Not saved  • Payment on UOB One kept on Entries until its details come in.", 1],
    [202, `Not saved ${SHOP} • Kept on Entries until its amount comes in.`, 1],
    [202, "Not saved  • Payment of JPY 965 on Citi Rewards kept on Entries until its details come in.", 1],
    [200, `Saved ${SHOP} • JP¥965 • Citi Rewards`, 0]
  ],
  7: [
    [202, "Not saved  • Payment on UOB One kept on Entries until its details come in.", 1],
    [400, "(asks How much was it?)", 1],
    [202, "Not saved  • Payment of JPY 965 on Citi Rewards kept on Entries until its details come in.", 1],
    [200, `Saved ${SHOP} • JP¥965 • Citi Rewards`, 0]
  ],
  8: [
    [202, "Payment on UOB One noted. Waiting for its details.", 1],
    [202, `${SHOP} noted. Waiting for the amount.`, 1],
    [202, "Payment of JPY 965 on Citi Rewards noted. Waiting for its details.", 1],
    [200, `Saved ${SHOP} • JP¥965 • Citi Rewards`, 0]
  ]
};

for (const release of fixture.releases) {
  test(`v${release.version}: a Wallet tap with its shop, amount or both missing is kept and the release shows a true line`, async (t) => {
    const { db, fetchWorker } = await setUp(t);
    const expected = EXPECTED[release.version] ?? EXPECTED.older;
    for (const [index, { shape, merchant, amount }] of SHAPES.entries()) {
      const before = (await rows(db, "SELECT COUNT(*) AS n FROM waiting_taps"))[0].n;
      const entriesBefore = (await rows(db, "SELECT COUNT(*) AS n FROM transactions"))[0].n;
      const { status, payload } = await post(fetchWorker, releaseBody(release, { amount, merchant, walletName: "Citibank Singapore" }));
      const [code, shown, keptCount] = expected[index];
      assert.equal(status, code, `${shape}: ${JSON.stringify(payload)}`);
      const line = shownBy(release, payload, { merchant, amount });
      assert.equal(line, shown, shape);
      const kept = (await rows(db, "SELECT COUNT(*) AS n FROM waiting_taps"))[0].n - before;
      assert.equal(kept, keptCount, shape);
      const saved = (await rows(db, "SELECT COUNT(*) AS n FROM transactions"))[0].n - entriesBefore;
      // "Saved" only ever for an entry that was saved.
      assert.equal(saved, String(line ?? "").startsWith("Saved") ? 1 : 0, shape);
      if (kept && !merchant) {
        const [row] = await rows(db, "SELECT merchant, wallet_name, status FROM waiting_taps ORDER BY received_at DESC, rowid DESC LIMIT 1");
        assert.deepEqual(row, { merchant: "", wallet_name: "Citibank Singapore", status: "waiting" }, shape);
      }
    }
  });
}

test("a run with nothing at all (no shop, no amount, no card name) is still refused by every release", async (t) => {
  const { db, fetchWorker } = await setUp(t);
  for (const release of fixture.releases) {
    const { status, payload } = await post(fetchWorker, releaseBody(release, { amount: "", merchant: "", walletName: "" }));
    assert.equal(status, 400, `v${release.version}: ${JSON.stringify(payload)}`);
    assert.equal(payload.held, undefined);
    assert.match(payload.error, /^Missing or invalid shortcut fields: /);
  }
  assert.equal((await rows(db, "SELECT COUNT(*) AS n FROM waiting_taps"))[0].n, 0);
});

// v8 holds a blank tap. A purchase at another shop in the same town a
// minute later is its own entry: Wallet's ", Takayama, Gifu" is not the shop,
// so it never completes the held tap (before, the shared town words did).
test("v8: a held Takayama tap is not completed by a purchase at another Takayama shop", async (t) => {
  const { db, fetchWorker } = await setUp(t);
  const v8 = fixture.releases.find((release) => release.version === 8);
  const held = await post(fetchWorker, releaseBody(v8, { amount: "", merchant: "駿河屋 エブリフレスポ店, Takayama, Gifu", walletName: "Citibank Singapore" }));
  assert.equal(held.status, 202, JSON.stringify(held.payload));
  const other = await post(fetchWorker, releaseBody(v8, { amount: "JP¥3,300", merchant: "Pen Shop IMAI , Takayama, Gifu", walletName: "Citibank Singapore" }));
  assert.equal(other.status, 200, JSON.stringify(other.payload));
  assert.equal(other.payload.completedHeldTap, undefined);
  assert.equal(other.payload.description, "Pen Shop IMAI , Takayama, Gifu");
  assert.deepEqual(await rows(db, "SELECT merchant, status FROM waiting_taps"), [{ merchant: "駿河屋 エブリフレスポ店, Takayama, Gifu", status: "waiting" }]);
  // The same shop's second run does complete it.
  const same = await post(fetchWorker, releaseBody(v8, { amount: "JP¥10", merchant: "駿河屋 エブリフレスポ店, Takayama, Gifu", walletName: "Citibank Singapore" }));
  assert.equal(same.payload.completedHeldTap, true, JSON.stringify(same.payload));
  assert.deepEqual(await rows(db, "SELECT status FROM waiting_taps"), [{ status: "completed" }]);
});

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
