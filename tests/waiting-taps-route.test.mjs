// Waiting taps (DOMAIN.md "Waiting Tap"): an overseas terminal that asks
// which currency to pay in reaches the Apple Pay Shortcut with a blank
// amount. Shortcut v8 gets a held tap and a quiet reply; v7 and older keep
// the needsAmount answer exactly. The amount then arrives by a second
// Shortcut run, the Shortcut's own question, or Entries' card, and an import
// can clear the tap. Real Worker and real local D1 (demo household: Tim the
// owner, Joyce the partner). The test Worker runs with FX_RATES_OFFLINE.
import assert from "node:assert/strict";
import test from "node:test";

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
const V7 = "apple-pay-api-2026-11-10-v7";
const JOYCE_KEY = "mm_joyce-phone-key";
const TIM = "person-tim";
const JOYCE = "person-joyce";
const TAP_1 = "apple-pay-20261005120000000";
const TAP_2 = "apple-pay-20261005120031000";

function post(fetchWorker, path, body, key = TOKEN) {
  return fetchWorker(`${path}?shortcut_token=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  }).then(async (response) => ({ status: response.status, payload: await response.json() }));
}

const tap = (fetchWorker, body, key) => post(fetchWorker, "/api/shortcuts/entries/create", {
  date: "2026-10-05", description: "Periplus Bali", name: "UOB One", requestId: TAP_1, clientVersion: V8, amount: "", ...body
}, key);
const status = (fetchWorker, requestId, key) => post(fetchWorker, "/api/shortcuts/taps/status", { requestId }, key);

const taps = (db) => rows(db, `
  SELECT request_id, person_id, merchant, wallet_name, tap_date, client_version, status, completed_by, entry_id IS NOT NULL AS has_entry,
    second_run_seconds, second_run_had_amount
  FROM waiting_taps ORDER BY received_at`);
const entryCount = async (db) => (await rows(db, "SELECT COUNT(*) AS n FROM transactions"))[0].n;
const uobOne = async (db) => (await rows(db, "SELECT id FROM accounts WHERE account_name = 'UOB One'"))[0].id;

// Moves the tap's arrival back in time, as if it came `seconds` ago.
async function ageTap(db, requestId, seconds) {
  await db.prepare("UPDATE waiting_taps SET received_at = ? WHERE request_id = ?")
    .bind(new Date(Date.now() - seconds * 1000).toISOString(), requestId).run();
}

test("v8: a blank amount holds a tap, answers quietly, and saves no entry", async (t) => {
  const { db, fetch: fetchWorker } = await openSeededDatabase(t, template);
  await enableShortcut(db);
  const before = await entryCount(db);

  const held = await tap(fetchWorker, {});

  assert.equal(held.status, 202, JSON.stringify(held.payload));
  const { openUrl, ...reply } = held.payload;
  assert.deepEqual(reply, {
    ok: true,
    held: true,
    requestId: TAP_1,
    merchant: "Periplus Bali",
    accountName: "UOB One",
    notice: "Periplus Bali noted. Waiting for the amount."
  });
  const [row] = await rows(db, "SELECT id, account_id FROM waiting_taps");
  assert.equal(openUrl, `http://127.0.0.1/entries?waiting_tap=${row.id}`);
  assert.equal(row.account_id, await uobOne(db));
  assert.deepEqual(await taps(db), [{
    request_id: TAP_1, person_id: TIM, merchant: "Periplus Bali", wallet_name: "UOB One", tap_date: "2026-10-05",
    client_version: V8, status: "waiting", completed_by: null, has_entry: 0, second_run_seconds: null, second_run_had_amount: null
  }]);
  assert.equal(await entryCount(db), before);
  const [audit] = await rows(db, "SELECT action, detail FROM audit_events WHERE entity_type = 'waiting_tap'");
  assert.deepEqual(audit, { action: "waiting_tap_held", detail: "An Apple Pay tap on 2026-10-05 came with no amount and is waiting for it." });
});

test("an unknown version and no version keep the needsAmount answer exactly, and hold nothing", async (t) => {
  const { db, fetch: fetchWorker } = await openSeededDatabase(t, template);
  await enableShortcut(db);
  for (const clientVersion of ["playwright-contract", undefined]) {
    const { status: code, payload } = await tap(fetchWorker, { clientVersion });
    assert.equal(code, 400, String(clientVersion));
    assert.deepEqual(payload, {
      ok: false,
      needsAmount: true,
      merchant: "Periplus Bali",
      accountName: "UOB One",
      error: "Missing or invalid shortcut fields: amount."
    });
  }
  assert.deepEqual(await taps(db), []);
});

test("v7 keeps its question and the tap; v6 keeps the tap and says so on its Not saved line; v7's answer finishes the kept tap", async (t) => {
  const { db, fetch: fetchWorker } = await openSeededDatabase(t, template);
  await enableShortcut(db);
  const v7 = await tap(fetchWorker, { clientVersion: V7 });
  assert.deepEqual([v7.status, v7.payload], [400, {
    ok: false, needsAmount: true, held: true, merchant: "Periplus Bali", accountName: "UOB One", error: "Missing or invalid shortcut fields: amount."
  }]);
  const v6 = await tap(fetchWorker, { clientVersion: "apple-pay-api-2026-08-24-v6", requestId: TAP_2, description: "Toast Box" });
  assert.equal(v6.status, 202);
  assert.deepEqual(v6.payload, {
    ok: true, held: true, requestId: TAP_2, merchant: "Toast Box", accountName: "UOB One",
    notice: "Toast Box noted. Waiting for the amount.", error: "Kept on Entries until its amount comes in."
  });
  assert.deepEqual((await taps(db)).map((row) => [row.merchant, row.status]), [["Periplus Bali", "waiting"], ["Toast Box", "waiting"]]);

  // v7's "How much was it?" answer: the same request with the amount.
  const answered = await tap(fetchWorker, { clientVersion: V7, amount: "22.94" });
  assert.equal(answered.status, 200, JSON.stringify(answered.payload));
  assert.equal(answered.payload.completedHeldTap, true);
  const rowsNow = await taps(db);
  assert.deepEqual(rowsNow.map((row) => [row.merchant, row.status, row.completed_by]), [["Periplus Bali", "completed", "shortcut_answer"], ["Toast Box", "waiting", null]]);
});

test("v8 with no request id, a refused figure or a missing merchant is not held", async (t) => {
  const { db, fetch: fetchWorker } = await openSeededDatabase(t, template);
  await enableShortcut(db);
  assert.equal((await tap(fetchWorker, { requestId: undefined })).payload.needsAmount, true);
  const refund = await tap(fetchWorker, { amount: "-12.00" });
  assert.deepEqual([refund.status, "needsAmount" in refund.payload, refund.payload.held], [400, false, undefined]);
  const noMerchant = await tap(fetchWorker, { description: "", name: "" });
  assert.deepEqual([noMerchant.status, noMerchant.payload.held], [400, undefined]);
  assert.deepEqual(await taps(db), []);
});

test("the same tap posted again is the same held tap, never a second one", async (t) => {
  const { db, fetch: fetchWorker } = await openSeededDatabase(t, template);
  await enableShortcut(db);
  const first = await tap(fetchWorker, {});
  const again = await tap(fetchWorker, {});
  assert.deepEqual(again, first);
  assert.equal((await taps(db)).length, 1);
});

test("tap 2 with the amount inside the window saves the entry and completes the tap in one go", async (t) => {
  const { db, fetch: fetchWorker } = await openSeededDatabase(t, template);
  await enableShortcut(db);
  await tap(fetchWorker, {});
  await ageTap(db, TAP_1, 31);
  const before = await entryCount(db);

  const second = await tap(fetchWorker, { requestId: TAP_2, amount: "22.94" });

  assert.equal(second.status, 200, JSON.stringify(second.payload));
  assert.deepEqual(
    [second.payload.amountMinor, second.payload.currency, second.payload.accountName, second.payload.completedHeldTap, second.payload.heldTapSeconds],
    [2294, "SGD", "UOB One", true, 31]
  );
  assert.equal(await entryCount(db), before + 1);
  const [row] = await taps(db);
  assert.deepEqual(
    [row.status, row.completed_by, row.has_entry, row.second_run_seconds, row.second_run_had_amount],
    ["completed", "second_tap", 1, 31, 1]
  );
  const [entry] = await rows(db, "SELECT transaction_date, amount_minor, external_reference, owner_person_id FROM transactions WHERE id = ?", second.payload.entryId);
  assert.deepEqual(entry, { transaction_date: "2026-10-05", amount_minor: 2294, external_reference: `shortcut:${TAP_2}`, owner_person_id: TIM });
  const [audit] = await rows(db, "SELECT detail FROM audit_events WHERE action = 'waiting_tap_completed'");
  assert.match(audit.detail, /completed by a second Shortcut run with the amount 31 seconds after the first/);

  // Asking about tap 1 now: it is saved, with the entry's words.
  const asked = await status(fetchWorker, TAP_1);
  assert.equal(asked.status, 200);
  assert.deepEqual([asked.payload.status, asked.payload.ask, asked.payload.notice], ["completed", undefined, "Saved Periplus Bali • SGD 22.94 • UOB One"]);
  // And the Shortcut's own answer for tap 1 arriving late saves nothing new.
  const late = await tap(fetchWorker, { amount: "22.94" });
  assert.deepEqual([late.status, late.payload.created, late.payload.entryId], [200, false, second.payload.entryId]);
  assert.equal(await entryCount(db), before + 1);
});

test("tap 2 after the window, or for another merchant or card, is just a normal entry", async (t) => {
  const { db, fetch: fetchWorker } = await openSeededDatabase(t, template);
  await enableShortcut(db);
  await tap(fetchWorker, {});

  await ageTap(db, TAP_1, 601);
  const late = await tap(fetchWorker, { requestId: "apple-pay-20261005121100000", amount: "22.94" });
  assert.deepEqual([late.status, late.payload.completedHeldTap], [200, undefined]);

  await ageTap(db, TAP_1, 20);
  const otherShop = await tap(fetchWorker, { requestId: "apple-pay-20261005121200000", amount: "5.00", description: "Starbucks Seminyak" });
  assert.deepEqual([otherShop.status, otherShop.payload.completedHeldTap], [200, undefined]);
  const otherCard = await tap(fetchWorker, { requestId: "apple-pay-20261005121300000", amount: "5.00", name: "Citi Rewards" });
  assert.deepEqual([otherCard.status, otherCard.payload.completedHeldTap, otherCard.payload.accountName], [200, undefined, "Citi Rewards"]);

  assert.deepEqual((await taps(db)).map((row) => row.status), ["waiting"]);
});

test("another person's second tap never completes this person's tap, and their key cannot read it", async (t) => {
  const { db, fetch: fetchWorker, api } = await openSeededDatabase(t, template);
  await enableShortcut(db);
  const saved = await api("/api/settings/shortcuts/save", {
    personId: JOYCE, apiKey: JOYCE_KEY, defaultAccountPriorityIds: [await uobOne(db)], defaultParams: "", foreignCurrencyAccountId: ""
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.payload));
  await tap(fetchWorker, {});

  const joyce = await tap(fetchWorker, { requestId: TAP_2, amount: "22.94" }, JOYCE_KEY);
  assert.deepEqual([joyce.status, joyce.payload.completedHeldTap], [200, undefined]);
  assert.deepEqual((await taps(db)).map((row) => row.status), ["waiting"]);

  const read = await status(fetchWorker, TAP_1, JOYCE_KEY);
  assert.deepEqual([read.status, read.payload], [404, { ok: false, error: "No payment is waiting for this tap." }]);
});

test("the status read needs the key, answers the person's waiting tap, and nothing else", async (t) => {
  const { db, fetch: fetchWorker } = await openSeededDatabase(t, template);
  await enableShortcut(db);
  await tap(fetchWorker, {});

  const noKey = await fetchWorker("/api/shortcuts/taps/status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: TAP_1 }) });
  assert.equal(noKey.status, 401);
  assert.equal((await status(fetchWorker, TAP_1, "wrong-key")).status, 401);
  const unknown = await status(fetchWorker, "apple-pay-20990101000000000");
  assert.equal(unknown.status, 404);
  assert.equal((await status(fetchWorker, "")).status, 400);

  const waiting = await status(fetchWorker, TAP_1);
  const { openUrl, ...reply } = waiting.payload;
  assert.deepEqual(reply, { ok: true, status: "waiting", ask: true, requestId: TAP_1, merchant: "Periplus Bali", accountName: "UOB One" });
  assert.match(openUrl, /\/entries\?waiting_tap=tap-/);
  // A GET is not answered.
  assert.notEqual((await fetchWorker(`/api/shortcuts/taps/status?shortcut_token=${TOKEN}&requestId=${TAP_1}`)).status, 200);
});

test("the Shortcut's own question: the typed amount with the same request id completes the tap", async (t) => {
  const { db, fetch: fetchWorker } = await openSeededDatabase(t, template);
  await enableShortcut(db);
  await saveRate(db);
  await tap(fetchWorker, {});

  const answered = await tap(fetchWorker, { amount: "IDR 150.000" });

  assert.equal(answered.status, 200, JSON.stringify(answered.payload));
  assert.deepEqual([answered.payload.originalAmount, answered.payload.completedHeldTap], ["IDR 150,000", true]);
  const [row] = await taps(db);
  assert.deepEqual([row.status, row.completed_by, row.second_run_seconds], ["completed", "shortcut_answer", null]);
  // The Shortcut's retry of the same answer: the same entry.
  const retry = await tap(fetchWorker, { amount: "IDR 150.000" });
  assert.deepEqual([retry.payload.entryId, retry.payload.created], [answered.payload.entryId, false]);
});

test("a second blank run for a waiting tap is recorded on it and does not ask again", async (t) => {
  const { db, fetch: fetchWorker } = await openSeededDatabase(t, template);
  await enableShortcut(db);
  await tap(fetchWorker, {});
  await ageTap(db, TAP_1, 12);

  const second = await tap(fetchWorker, { requestId: TAP_2 });

  assert.equal(second.status, 202);
  assert.deepEqual([second.payload.requestId, second.payload.askAfterSeconds], [TAP_1, undefined]);
  assert.deepEqual((await taps(db)).map((row) => [row.request_id, row.status, row.second_run_seconds, row.second_run_had_amount]), [[TAP_1, "waiting", 12, 0]]);
});

test("Entries: Save runs the Apple Pay save in the card's currency or another, and Not a payment removes the tap", async (t) => {
  const { db, fetch: fetchWorker, api } = await openSeededDatabase(t, template);
  await enableShortcut(db);
  await saveRate(db);
  await tap(fetchWorker, {});
  await tap(fetchWorker, { requestId: TAP_2, description: "Bintang Supermarket" });
  const [first, second] = await rows(db, "SELECT id FROM waiting_taps ORDER BY received_at");

  const page = await api(`/api/entries-page?view=household&month=2026-10`);
  assert.equal(page.status, 200);
  assert.deepEqual(page.payload.waitingTaps.map((item) => [item.merchant, item.date, item.accountName, item.currency, item.personName]), [
    ["Periplus Bali", "2026-10-05", "UOB One", "SGD", "Tim"],
    ["Bintang Supermarket", "2026-10-05", "UOB One", "SGD", "Tim"]
  ]);
  // A person's view shows only their own taps.
  const joycePage = await api(`/api/entries-page?view=${JOYCE}&month=2026-10`);
  assert.equal(joycePage.payload.waitingTaps, undefined);

  const refused = await api("/api/waiting-taps/complete", { tapId: first.id, amount: "0", currency: "SGD" });
  assert.deepEqual([refused.status, refused.payload.error], [400, "Type the amount, like 12.50."]);

  const saved = await api("/api/waiting-taps/complete", { tapId: first.id, amount: "22.94", currency: "SGD" });
  assert.equal(saved.status, 200, JSON.stringify(saved.payload));
  assert.deepEqual([saved.payload.amountMinor, saved.payload.accountName, saved.payload.completedHeldTap], [2294, "UOB One", true]);

  const inRupiah = await api("/api/waiting-taps/complete", { tapId: second.id, amount: "150.000", currency: "IDR" });
  assert.equal(inRupiah.status, 200, JSON.stringify(inRupiah.payload));
  assert.equal(inRupiah.payload.originalAmount, "IDR 150,000");
  const [estimate] = await rows(db, "SELECT original_amount_minor, original_currency, external_reference FROM transactions WHERE id = ?", inRupiah.payload.entryId);
  assert.deepEqual(estimate, { original_amount_minor: 15000000, original_currency: "IDR", external_reference: `shortcut:${TAP_2}` });

  assert.deepEqual((await taps(db)).map((row) => [row.status, row.completed_by]), [["completed", "app"], ["completed", "app"]]);
  const again = await api("/api/waiting-taps/complete", { tapId: first.id, amount: "22.94", currency: "SGD" });
  assert.deepEqual([again.status, again.payload.error], [409, "This payment was already sorted."]);
  assert.equal((await api(`/api/entries-page?view=household&month=2026-10`)).payload.waitingTaps, undefined);
});

test("Entries: Not a payment removes the tap, saves nothing, and cannot be done twice", async (t) => {
  const { db, fetch: fetchWorker, api } = await openSeededDatabase(t, template);
  await enableShortcut(db);
  await tap(fetchWorker, {});
  const [{ id }] = await rows(db, "SELECT id FROM waiting_taps");
  const before = await entryCount(db);

  const removed = await api("/api/waiting-taps/remove", { tapId: id });
  assert.deepEqual([removed.status, removed.payload], [200, { ok: true, tapId: id, status: "not_a_payment" }]);
  assert.equal(await entryCount(db), before);
  assert.deepEqual((await taps(db)).map((row) => row.status), ["not_a_payment"]);
  const twice = await api("/api/waiting-taps/remove", { tapId: id });
  assert.equal(twice.status, 409);
  const asked = await status(fetchWorker, TAP_1);
  assert.deepEqual([asked.payload.status, asked.payload.notice], ["not_a_payment", "Periplus Bali is already sorted in Monies Map."]);
  // The app routes take POST only.
  assert.equal((await fetchWorker("/api/waiting-taps/remove")).status, 405);
});

test("Ask's reminders list a waiting tap first, and it opens Entries' card", async (t) => {
  const { db, fetch: fetchWorker, api } = await openSeededDatabase(t, template);
  await enableShortcut(db);
  await tap(fetchWorker, {});
  const [{ id }] = await rows(db, "SELECT id FROM waiting_taps");
  const reminders = await api("/api/reminders?view=household");
  assert.equal(reminders.status, 200);
  assert.deepEqual(reminders.payload.reminders[0], {
    key: `waiting_tap:${id}`, kind: "waiting_tap", tapId: id, merchant: "Periplus Bali", date: "2026-10-05",
    time: reminders.payload.reminders[0].time, accountName: "UOB One"
  });
  assert.match(reminders.payload.reminders[0].time, /^\d{2}:\d{2}$/);
  const joyce = await api(`/api/reminders?view=${JOYCE}`);
  assert.equal(joyce.payload.reminders.some((item) => item.kind === "waiting_tap"), false);
});

test("with the table missing everything works as before: needsAmount, Entries, reminders, an import", async (t) => {
  const { db, fetch: fetchWorker, api } = await openSeededDatabase(t, template);
  await enableShortcut(db);
  await db.prepare("DROP TABLE waiting_taps").run();

  const blank = await tap(fetchWorker, {});
  assert.deepEqual([blank.status, blank.payload.needsAmount], [400, true]);
  const withAmount = await tap(fetchWorker, { amount: "22.94" });
  assert.equal(withAmount.status, 200, JSON.stringify(withAmount.payload));
  assert.equal((await status(fetchWorker, TAP_1)).status, 404);
  const page = await api(`/api/entries-page?view=household&month=2026-10`);
  assert.deepEqual([page.status, page.payload.waitingTaps], [200, undefined]);
  assert.equal((await api("/api/reminders?view=household")).status, 200);
  assert.equal((await api("/api/waiting-taps/complete", { tapId: "tap-x", amount: "1", currency: "SGD" })).status, 409);
  const commit = await api("/api/imports/commit", {
    sourceLabel: "No table", sourceType: "csv", parserKey: "generic_csv",
    rows: [{ rowId: "r1", rowIndex: 0, date: "2026-10-05", description: "PERIPLUS BALI", amountMinor: 2294, entryType: "expense", accountName: "UOB One", categoryName: "Other", ownershipType: "direct", ownerName: "Tim", splitBasisPoints: 10000, rawRow: {} }]
  });
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
});

test("the ask delay comes only from the server: the Worker var makes the reply carry it, 'off' leaves it out", async (t) => {
  for (const [value, expected] of [["45", 45], ["0", 0], ["off", undefined]]) {
    const withVar = { ...template, config: { ...template.config, vars: { ...template.config.vars, WAITING_TAP_ASK_AFTER_SECONDS: value } } };
    const { db, fetch: fetchWorker } = await openSeededDatabase(t, withVar);
    await enableShortcut(db);
    const held = await tap(fetchWorker, {});
    assert.deepEqual([held.status, held.payload.askAfterSeconds], [202, expected], value);
    // A second blank run never asks a second time.
    const second = await tap(fetchWorker, { requestId: TAP_2 });
    assert.equal(second.payload.askAfterSeconds, undefined, value);
  }
});

test("a tap nobody finished in a week leaves the card and the reminders, and stays in the audit trail", async (t) => {
  const { db, fetch: fetchWorker, api } = await openSeededDatabase(t, template);
  await enableShortcut(db);
  await tap(fetchWorker, {});
  await tap(fetchWorker, { requestId: TAP_2, description: "Bintang Supermarket" });
  await ageTap(db, TAP_1, 7 * 24 * 3600 + 60);
  await ageTap(db, TAP_2, 7 * 24 * 3600 - 60);

  const page = await api("/api/entries-page?view=household&month=2026-10");
  assert.deepEqual(page.payload.waitingTaps.map((item) => item.merchant), ["Bintang Supermarket"]);
  assert.deepEqual((await taps(db)).map((row) => [row.merchant, row.status]), [["Periplus Bali", "expired"], ["Bintang Supermarket", "waiting"]]);
  const [audit] = await rows(db, "SELECT detail FROM audit_events WHERE action = 'waiting_tap_expired'");
  assert.equal(audit.detail, "A tap waiting for its amount was not finished within a week and was put away.");
  const reminders = await api("/api/reminders?view=household");
  assert.deepEqual(reminders.payload.reminders.filter((item) => item.kind === "waiting_tap").map((item) => item.merchant), ["Bintang Supermarket"]);
  assert.equal((await status(fetchWorker, TAP_1)).payload.notice, "Periplus Bali is already sorted in Monies Map.");
});

// Two Wallet runs for one payment that both carry the amount: the request id
// guard covers a repeat of the same run, not two runs with their own ids.
// Pinned here and reported (docs/audits/waiting-taps.md, "Duplicate runs");
// a 90-second same amount, shop and card rule is not built.
test("duplicate runs: the same request id saves once; two runs with their own ids save two entries today", async (t) => {
  const { db, fetch: fetchWorker } = await openSeededDatabase(t, template);
  await enableShortcut(db);
  const before = await entryCount(db);
  const first = await tap(fetchWorker, { amount: "22.94" });
  const repeat = await tap(fetchWorker, { amount: "22.94" });
  assert.deepEqual([first.payload.created, repeat.payload.created, repeat.payload.entryId], [true, false, first.payload.entryId]);
  assert.equal(await entryCount(db), before + 1);
  const otherRun = await tap(fetchWorker, { requestId: TAP_2, amount: "22.94" });
  assert.deepEqual([otherRun.status, otherRun.payload.created], [200, true]);
  assert.equal(await entryCount(db), before + 2);
});
