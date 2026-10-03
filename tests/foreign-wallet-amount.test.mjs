// Apple Pay in another currency: a Wallet amount such as "IDR 159,000" on an
// SGD card (an Amaze card proxying a holiday purchase in Bali) is saved in
// the card's currency at the day's exchange rate, with the original amount
// kept on the entry, instead of being refused. Real Worker and a real local
// D1 (Miniflare). The test Worker runs with FX_RATES_OFFLINE, so routes only
// read the saved rate; the network path is tested on the module with a fake
// fetch.
import assert from "node:assert/strict";
import test from "node:test";

import { createSeededTemplate, openSeededDatabase, rows } from "./support/d1-workspace.mjs";
import { convertForeignAmount, FxRateUnavailableError } from "../src/domain/foreign-currency.ts";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const TOKEN = "test-shortcut-token";
const HOUR = 60 * 60 * 1000;

async function enableShortcut(db) {
  await db.prepare("INSERT OR REPLACE INTO app_settings (key, value_json) VALUES ('shortcut_api', ?)").bind(JSON.stringify({ apiKey: TOKEN })).run();
}

async function saveRate(db, { quotePerBase = 14025, fetchedAt = new Date().toISOString(), rateDate = "2026-10-02", source = "frankfurter" } = {}) {
  await db.prepare("INSERT OR REPLACE INTO fx_rates (base_currency, quote_currency, quote_per_base, rate_date, source, fetched_at) VALUES ('SGD', 'IDR', ?, ?, ?, ?)")
    .bind(quotePerBase, rateDate, source, fetchedAt).run();
}

async function postWalletPurchase(fetchWorker, body) {
  const response = await fetchWorker(`/api/shortcuts/entries/create?shortcut_token=${TOKEN}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ date: "2026-10-03", ...body })
  });
  return { status: response.status, payload: await response.json() };
}

test("an IDR Wallet purchase on an SGD card is saved at the day's rate, with the IDR amount kept", async (t) => {
  const { db, fetch: fetchWorker } = await openSeededDatabase(t, template);
  await enableShortcut(db);
  await saveRate(db);

  const { status, payload } = await postWalletPurchase(fetchWorker, {
    amount: "IDR 159,000",
    description: "Digimap Icon Sanur M23",
    requestId: "apple-pay-digimap-1"
  });

  assert.equal(status, 200, JSON.stringify(payload));
  // 159,000 / 14,025 = 11.3369 SGD.
  assert.deepEqual([payload.amountMinor, payload.currency, payload.originalAmount], [1134, "SGD", "IDR 159,000"]);
  const [entry] = await rows(db, "SELECT amount_minor, currency, original_amount_minor, original_currency, note, bank_certification_status FROM transactions WHERE id = ?", payload.entryId);
  assert.deepEqual(entry, {
    amount_minor: 1134,
    currency: "SGD",
    original_amount_minor: 15900000,
    original_currency: "IDR",
    note: "Paid IDR 159,000. Saved as about SGD 11.34 at 1 SGD = 14,025 IDR (2 Oct 2026). Your card's SGD amount may differ.",
    bank_certification_status: "provisional"
  });

  // The Shortcut's retry of the same purchase saves nothing new.
  const replay = await postWalletPurchase(fetchWorker, { amount: "IDR 159,000", description: "Digimap Icon Sanur M23", requestId: "apple-pay-digimap-1" });
  assert.deepEqual([replay.status, replay.payload.entryId, replay.payload.created], [200, payload.entryId, false]);
});

test("a purchase in the card's own currency is saved exactly as before", async (t) => {
  const { db, fetch: fetchWorker } = await openSeededDatabase(t, template);
  await enableShortcut(db);

  const { status, payload } = await postWalletPurchase(fetchWorker, { amount: "SGD 12.34", description: "Kopitiam" });

  assert.equal(status, 200, JSON.stringify(payload));
  assert.equal(payload.originalAmount, undefined);
  const [entry] = await rows(db, "SELECT amount_minor, original_amount_minor, original_currency, note FROM transactions WHERE id = ?", payload.entryId);
  assert.deepEqual(entry, { amount_minor: 1234, original_amount_minor: null, original_currency: null, note: null });
});

test("with no exchange rate at all, nothing is saved and the Shortcut is told to run again", async (t) => {
  const { db, fetch: fetchWorker } = await openSeededDatabase(t, template);
  await enableShortcut(db);
  const before = (await rows(db, "SELECT COUNT(*) AS count FROM transactions"))[0].count;

  const { status, payload } = await postWalletPurchase(fetchWorker, { amount: "IDR 35,805", description: "Bali Racquet Society" });

  assert.equal(status, 503);
  assert.equal(payload.error, "Couldn't get today's IDR to SGD exchange rate. Nothing was saved. Run the Shortcut again in a minute.");
  assert.equal((await rows(db, "SELECT COUNT(*) AS count FROM transactions"))[0].count, before);
});

test("a saved rate older than two weeks is not used", async (t) => {
  const { db, fetch: fetchWorker } = await openSeededDatabase(t, template);
  await enableShortcut(db);
  await saveRate(db, { fetchedAt: new Date(Date.now() - 15 * 24 * HOUR).toISOString() });

  const { status } = await postWalletPurchase(fetchWorker, { amount: "IDR 35,805", description: "Bali Racquet Society" });

  assert.equal(status, 503);
});

test("the rate comes from the first source that answers, is saved, and covers both sources being down", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const calls = [];
  const fetchFrom = (answers) => async (url) => {
    calls.push(String(url));
    const answer = answers.find(([prefix]) => String(url).startsWith(prefix));
    if (!answer) {
      throw new Error("offline");
    }
    return new Response(JSON.stringify(answer[1]), { status: 200, headers: { "content-type": "application/json" } });
  };

  // Frankfurter is down; open.er-api answers.
  const first = await convertForeignAmount(db, {
    amountMinor: 3580500,
    fromCurrency: "IDR",
    toCurrency: "SGD",
    fetchImpl: fetchFrom([["https://open.er-api.com/", { result: "success", time_last_update_utc: "Sat, 03 Oct 2026 00:02:32 +0000", rates: { IDR: 13967.161708 } }]])
  });
  assert.deepEqual(calls.map((url) => new URL(url).host), ["api.frankfurter.dev", "open.er-api.com"]);
  // 35,805 / 13,967.16 = 2.5635 SGD.
  assert.deepEqual([first.amountMinor, first.quotePerBase, first.rateDate, first.source], [256, 13967.161708, "2026-10-03", "open.er-api"]);

  // Both down: the rate just saved is used.
  const second = await convertForeignAmount(db, { amountMinor: 3580500, fromCurrency: "IDR", toCurrency: "SGD", fetchImpl: fetchFrom([]), now: Date.now() + 13 * HOUR });
  assert.equal(second.amountMinor, 256);

  // A fresh saved rate is used without asking the network at all.
  calls.length = 0;
  await convertForeignAmount(db, { amountMinor: 3580500, fromCurrency: "IDR", toCurrency: "SGD", fetchImpl: fetchFrom([]) });
  assert.deepEqual(calls, []);

  // A source answering nonsense is not trusted.
  await db.prepare("DELETE FROM fx_rates").run();
  await assert.rejects(
    convertForeignAmount(db, { amountMinor: 3580500, fromCurrency: "IDR", toCurrency: "SGD", fetchImpl: fetchFrom([["https://api.frankfurter.dev/", { rates: { IDR: -1 } }], ["https://open.er-api.com/", { result: "error" }]]) }),
    FxRateUnavailableError
  );
});
