// An overseas terminal that asks which currency to pay in can reach the
// Apple Pay Shortcut with a blank amount. The server then says the amount is
// all that is missing (`needsAmount`, with the merchant and card for the
// Shortcut's prompt) and saves nothing; the Shortcut posts the same request
// again with the typed amount and exactly one entry is saved. Real Worker and
// real local D1 (demo household).
import assert from "node:assert/strict";
import test from "node:test";

import { createSeededTemplate, openSeededDatabase, rows } from "./support/d1-workspace.mjs";
import { enableShortcut, postWalletPurchase, saveRate } from "./support/foreign-wallet.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const count = async (db) => (await rows(db, "SELECT COUNT(*) AS n FROM transactions"))[0].n;
const base = { description: "Periplus Bali", accountName: "UOB One", date: "2026-10-05", requestId: "apple-pay-20261005120000000" };

test("a blank amount answers needsAmount with the merchant and card and saves nothing", async (t) => {
  const { db, fetch: fetchWorker } = await openSeededDatabase(t, template);
  await enableShortcut(db);
  const before = await count(db);

  for (const amount of ["", "  ", undefined, "Amount unavailable"]) {
    const { status, payload } = await postWalletPurchase(fetchWorker, { ...base, ...(amount === undefined ? {} : { amount }) });
    assert.equal(status, 400);
    assert.deepEqual(payload, {
      ok: false,
      needsAmount: true,
      merchant: "Periplus Bali",
      accountName: "UOB One",
      error: "Missing or invalid shortcut fields: amount."
    });
  }
  assert.equal(await count(db), before);
});

test("posting the same request again with the typed amount saves exactly one entry", async (t) => {
  const { db, fetch: fetchWorker } = await openSeededDatabase(t, template);
  await enableShortcut(db);
  const before = await count(db);

  assert.equal((await postWalletPurchase(fetchWorker, { ...base, amount: "" })).payload.needsAmount, true);
  const typed = await postWalletPurchase(fetchWorker, { ...base, amount: "22.94" });
  assert.equal(typed.status, 200, JSON.stringify(typed.payload));
  assert.deepEqual([typed.payload.amountMinor, typed.payload.currency, typed.payload.accountName], [2294, "SGD", "UOB One"]);

  // A repeat of the typed post is the Shortcut's own retry: nothing new.
  const again = await postWalletPurchase(fetchWorker, { ...base, amount: "22.94" });
  assert.equal(again.payload.created, false);
  assert.equal(await count(db), before + 1);
  const [entry] = await rows(db, "SELECT amount_minor, bank_certification_status FROM transactions WHERE id = ?", typed.payload.entryId);
  assert.deepEqual(entry, { amount_minor: 2294, bank_certification_status: "provisional" });
});

test("a typed Rupiah amount with dots is saved in the card's currency with the Rupiah kept", async (t) => {
  const { db, fetch: fetchWorker } = await openSeededDatabase(t, template);
  await enableShortcut(db);
  await saveRate(db);
  const { status, payload } = await postWalletPurchase(fetchWorker, { ...base, amount: "IDR 150.000" });
  assert.equal(status, 200, JSON.stringify(payload));
  assert.equal(payload.originalAmount, "IDR 150,000");
});

test("any other problem still fails as before, without needsAmount", async (t) => {
  const { db, fetch: fetchWorker } = await openSeededDatabase(t, template);
  await enableShortcut(db);
  const before = await count(db);
  // Blank amount and a bad date: not only the amount is missing.
  const both = await postWalletPurchase(fetchWorker, { ...base, amount: "", date: "not a date" });
  assert.equal(both.status, 400);
  assert.equal("needsAmount" in both.payload, false);
  assert.match(both.payload.error, /date, amount/);
  // A refund or an ambiguous number has an amount in it: not a blank one.
  for (const amount of ["-5.00", "12,34", "SGD 12.345"]) {
    const refused = await postWalletPurchase(fetchWorker, { ...base, amount });
    assert.equal(refused.status, 400, amount);
    assert.equal("needsAmount" in refused.payload, false, amount);
    assert.equal(refused.payload.error, "Missing or invalid shortcut fields: amount.");
  }
  // No merchant: nothing to name in a prompt.
  const noMerchant = await postWalletPurchase(fetchWorker, { accountName: "UOB One", date: base.date, amount: "" });
  assert.equal("needsAmount" in noMerchant.payload, false);
  assert.equal(await count(db), before);
});
