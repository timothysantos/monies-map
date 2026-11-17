// Bank alerts (DOMAIN.md "Bank Alert"): POST /api/shortcuts/alerts/bank, the
// "Bank alert to Monies Map" Shortcut's route. A bank's payment alert
// completes exactly one waiting tap of the key's person through the one save
// path (completed_by "bank_alert"); anything else changes nothing and answers
// ok. The text is never stored or logged. Real Worker and real local D1
// (demo household: Tim the owner, Joyce the partner). The alert texts are
// invented, unverified wordings (src/domain/bank-alerts-config.ts).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { createSeededTemplate, dumpDatabase, openSeededDatabase, rows } from "./support/d1-workspace.mjs";
import { enableShortcut, saveRate, TOKEN } from "./support/foreign-wallet.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const V8 = "apple-pay-api-2026-11-17-v8";
const ALERT_VERSION = "bank-alert-2026-11-17-v1";
const JOYCE = "person-joyce";
const JOYCE_KEY = "mm_joyce-phone-key";
const TAP_1 = "apple-pay-20261005120000000";
const TAP_2 = "apple-pay-20261005120031000";
const ALERT_1 = "bank-alert-20261005120130000";
const ALERT_2 = "bank-alert-20261005120200000";
const UOB_ALERT = "A transaction of SGD 22.94 was made with your UOB Card ending 8073 on 05/10/26 at PERIPLUS BALI. If unauthorised, call 24/7 Fraud Hotline 6222 2121 now.";

function post(fetchWorker, pathname, body, key = TOKEN) {
  return fetchWorker(`${pathname}${key === null ? "" : `?shortcut_token=${encodeURIComponent(key)}`}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body)
  }).then(async (response) => ({ status: response.status, payload: await response.json() }));
}

const tap = (fetchWorker, body = {}, key) => post(fetchWorker, "/api/shortcuts/entries/create", {
  date: "2026-10-05", description: "Periplus Bali", name: "UOB One", requestId: TAP_1, clientVersion: V8, amount: "", ...body
}, key);
const bankAlert = (fetchWorker, body = {}, key) => post(fetchWorker, "/api/shortcuts/alerts/bank", {
  text: UOB_ALERT, receivedAt: new Date().toISOString(), requestId: ALERT_1, clientVersion: ALERT_VERSION, ...body
}, key);

const taps = (db) => rows(db, "SELECT request_id, status, completed_by, entry_id IS NOT NULL AS has_entry FROM waiting_taps ORDER BY received_at");
const entryCount = async (db) => (await rows(db, "SELECT COUNT(*) AS n FROM transactions"))[0].n;

// Every row written or changed between two dumps, as text, with ids
// (random UUIDs) taken out so only what the route chose to keep is checked.
function writtenSince(before, after) {
  const seen = new Set(Object.values(before).flat().map((row) => JSON.stringify(row)));
  const written = Object.values(after).flat().filter((row) => !seen.has(JSON.stringify(row)));
  return JSON.stringify(written).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>");
}

// Every console line the Worker writes while `run` runs.
async function captureLogs(run) {
  const lines = [];
  const originals = {};
  for (const level of ["log", "info", "warn", "error", "debug"]) {
    originals[level] = console[level];
    console[level] = (...args) => lines.push(args.map((arg) => (arg instanceof Error ? `${arg.name} ${arg.message}` : typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
  }
  try {
    return { result: await run(), lines };
  } finally {
    Object.assign(console, originals);
  }
}

test("an alert for the one waiting tap completes it like any Apple Pay entry, and keeps none of its text", async (t) => {
  const { db, fetch: fetchWorker } = await openSeededDatabase(t, template);
  await enableShortcut(db);
  await tap(fetchWorker);
  const before = await entryCount(db);
  const dumpBefore = await dumpDatabase(db);

  const { result: reply, lines } = await captureLogs(() => bankAlert(fetchWorker));

  assert.equal(reply.status, 200, JSON.stringify(reply.payload));
  assert.equal(reply.payload.ok, true);
  assert.equal(reply.payload.completed, true);
  assert.deepEqual(await taps(db), [{ request_id: TAP_1, status: "completed", completed_by: "bank_alert", has_entry: 1 }]);
  assert.equal(await entryCount(db), before + 1);
  const [entry] = await rows(db, `
    SELECT transactions.description, transactions.amount_minor, transactions.transaction_date, transactions.external_reference,
      accounts.account_name, people.display_name AS owner
    FROM transactions
    JOIN accounts ON accounts.id = transactions.account_id
    LEFT JOIN people ON people.id = transactions.owner_person_id
    WHERE transactions.id = ?`, reply.payload.entryId);
  // The tap's own shop, day and card; the alert's amount.
  assert.deepEqual(
    { ...entry, amount_minor: Math.abs(entry.amount_minor) },
    { description: "Periplus Bali", amount_minor: 2294, transaction_date: "2026-10-05", external_reference: `shortcut:${TAP_1}`, account_name: "UOB One", owner: "Tim" }
  );
  const [audit] = await rows(db, "SELECT detail FROM audit_events WHERE action = 'waiting_tap_completed'");
  assert.match(audit.detail, /completed by the bank's alert/);

  // Nothing of the alert's text is anywhere: not its card or phone digits,
  // not its wording, not the shop as the bank wrote it; nor in any log line.
  const everything = writtenSince(dumpBefore, await dumpDatabase(db));
  assert.match(everything, /Periplus Bali/);
  for (const kept of ["8073", "6222", "2121", "was made with", "PERIPLUS BALI", "Fraud Hotline", ALERT_1]) {
    assert.equal(everything.includes(kept), false, kept);
    assert.equal(lines.some((line) => line.includes(kept)), false, `log: ${kept}`);
  }
});

test("the route needs the person's key, answers POST only, and cuts off an oversize body", async (t) => {
  const { db, fetch: fetchWorker } = await openSeededDatabase(t, template);
  await enableShortcut(db);
  await tap(fetchWorker);

  assert.equal((await bankAlert(fetchWorker, {}, null)).status, 401);
  assert.equal((await bankAlert(fetchWorker, {}, "wrong-key")).status, 401);
  const get = await fetchWorker(`/api/shortcuts/alerts/bank?shortcut_token=${TOKEN}`);
  assert.equal(get.status, 405);
  const huge = await bankAlert(fetchWorker, { text: `${UOB_ALERT} ${"x".repeat(9000)}` });
  assert.deepEqual([huge.status, huge.payload], [413, { ok: false, error: "Request is too large." }]);
  const noId = await bankAlert(fetchWorker, { requestId: "" });
  assert.equal(noId.status, 400);
  assert.deepEqual(await taps(db), [{ request_id: TAP_1, status: "waiting", completed_by: null, has_entry: 0 }]);
});

test("the Shortcut Worker answers the bank alert path, and still nothing else", async (t) => {
  const apiOnly = { ...template, config: { ...template.config, vars: { ...template.config.vars, SHORTCUT_API_ONLY: "true" } } };
  const { db, fetch: fetchWorker } = await openSeededDatabase(t, apiOnly);
  await enableShortcut(db);
  await tap(fetchWorker);
  const reply = await bankAlert(fetchWorker);
  assert.deepEqual([reply.status, reply.payload.completed], [200, true]);
  assert.equal((await fetchWorker("/api/shortcuts/alerts/banks", { method: "POST" })).status, 404);
});

test("another person's tap is never completed by this person's alert", async (t) => {
  const { db, fetch: fetchWorker, api } = await openSeededDatabase(t, template);
  await enableShortcut(db);
  const [{ id: uobOne }] = await rows(db, "SELECT id FROM accounts WHERE account_name = 'UOB One'");
  const saved = await api("/api/settings/shortcuts/save", {
    personId: JOYCE, apiKey: JOYCE_KEY, defaultAccountPriorityIds: [uobOne], defaultParams: "", foreignCurrencyAccountId: ""
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.payload));
  await tap(fetchWorker);

  const joyce = await bankAlert(fetchWorker, {}, JOYCE_KEY);
  assert.deepEqual([joyce.status, joyce.payload], [200, { ok: true, completed: false, reason: "no_tap" }]);
  assert.deepEqual((await taps(db)).map((row) => row.status), ["waiting"]);
});

test("another household's tap is never matched", async (t) => {
  const { db, fetch: fetchWorker } = await openSeededDatabase(t, template);
  await enableShortcut(db);
  const [{ id: uobOne }] = await rows(db, "SELECT id FROM accounts WHERE account_name = 'UOB One'");
  await db.prepare("INSERT INTO households (id, name) VALUES ('household-elsewhere', 'Elsewhere')").run();
  await db.prepare(`
    INSERT INTO waiting_taps (id, household_id, request_id, person_id, account_id, merchant, wallet_name, tap_date, received_at, status)
    VALUES ('tap-elsewhere', 'household-elsewhere', ?, 'person-tim', ?, 'Periplus Bali', 'UOB One', '2026-10-05', ?, 'waiting')
  `).bind(TAP_1, uobOne, new Date().toISOString()).run();
  const before = await entryCount(db);

  const reply = await bankAlert(fetchWorker);
  assert.deepEqual([reply.status, reply.payload], [200, { ok: true, completed: false, reason: "no_tap" }]);
  assert.deepEqual(await rows(db, "SELECT status, completed_by FROM waiting_taps"), [{ status: "waiting", completed_by: null }]);
  assert.equal(await entryCount(db), before);
});

test("two waiting taps that both fit: nothing changes", async (t) => {
  const { db, fetch: fetchWorker } = await openSeededDatabase(t, template);
  await enableShortcut(db);
  await tap(fetchWorker);
  // A second blank tap at the same shop on another card a minute later (a
  // second run on the same card would be recorded on the first tap).
  await db.prepare(`
    INSERT INTO waiting_taps (id, household_id, request_id, person_id, account_id, merchant, wallet_name, tap_date, received_at, status)
    SELECT 'tap-second', household_id, ?, person_id, (SELECT id FROM accounts WHERE id <> waiting_taps.account_id ORDER BY id LIMIT 1),
      'Periplus Bali Seminyak', '', tap_date, ?, 'waiting'
    FROM waiting_taps
  `).bind(TAP_2, new Date(Date.now() + 60_000).toISOString()).run();
  const before = await entryCount(db);

  const reply = await bankAlert(fetchWorker);
  assert.deepEqual([reply.status, reply.payload], [200, { ok: true, completed: false, reason: "several_taps" }]);
  assert.deepEqual((await taps(db)).map((row) => row.status), ["waiting", "waiting"]);
  assert.equal(await entryCount(db), before);
});

test("the same alert posted again saves once; a second alert for the same payment changes nothing", async (t) => {
  const { db, fetch: fetchWorker } = await openSeededDatabase(t, template);
  await enableShortcut(db);
  await tap(fetchWorker);
  const before = await entryCount(db);

  const [first, again] = [await bankAlert(fetchWorker), await bankAlert(fetchWorker)];
  const email = await bankAlert(fetchWorker, { requestId: ALERT_2 });
  assert.equal(first.payload.completed, true);
  assert.deepEqual([again.status, again.payload], [200, { ok: true, completed: false, reason: "no_tap" }]);
  assert.deepEqual([email.status, email.payload], [200, { ok: true, completed: false, reason: "no_tap" }]);
  assert.equal(await entryCount(db), before + 1);

  // Two at once (the Shortcut's own retry racing the first): still one entry.
  await tap(fetchWorker, { requestId: TAP_2 });
  const raced = await Promise.all([bankAlert(fetchWorker, { requestId: "bank-alert-race-1" }), bankAlert(fetchWorker, { requestId: "bank-alert-race-1" })]);
  assert.ok(raced.every((reply) => reply.status === 200 && reply.payload.ok), JSON.stringify(raced));
  assert.equal(await entryCount(db), before + 2);
});

test("a tap already finished (in Entries) keeps its entry; the alert changes nothing", async (t) => {
  const { db, fetch: fetchWorker, api } = await openSeededDatabase(t, template);
  await enableShortcut(db);
  await tap(fetchWorker);
  const [{ id: tapId }] = await rows(db, "SELECT id FROM waiting_taps");
  const saved = await api("/api/waiting-taps/complete", { tapId, amount: "20.00", currency: "SGD" });
  assert.equal(saved.status, 200, JSON.stringify(saved.payload));
  const before = await dumpDatabase(db);

  const reply = await bankAlert(fetchWorker);
  assert.deepEqual([reply.status, reply.payload], [200, { ok: true, completed: false, reason: "no_tap" }]);
  const [entry] = await rows(db, "SELECT amount_minor FROM transactions WHERE id = ?", saved.payload.entryId);
  assert.equal(Math.abs(entry.amount_minor), 2000);
  assert.deepEqual(await dumpDatabase(db), before);
});

test("with the waiting-tap table missing the alert answers ok and does nothing", async (t) => {
  const { db, fetch: fetchWorker } = await openSeededDatabase(t, template);
  await enableShortcut(db);
  await db.prepare("DROP TABLE waiting_taps").run();
  const before = await dumpDatabase(db);
  const reply = await bankAlert(fetchWorker);
  assert.deepEqual([reply.status, reply.payload], [200, { ok: true, completed: false, reason: "no_tap" }]);
  assert.deepEqual(await dumpDatabase(db), before);
});

test("a one-time code, a sign-in, money in, or text it cannot read: ok, and nothing changes or is kept", async (t) => {
  const { db, fetch: fetchWorker } = await openSeededDatabase(t, template);
  await enableShortcut(db);
  await tap(fetchWorker);
  const before = await dumpDatabase(db);
  const cases = [
    ["Your OTP for the transaction of SGD 22.94 at PERIPLUS BALI is 482913. Do not share it.", "one_time_code"],
    ["You have logged in to UOB TMRW on a new device.", "not_a_payment"],
    ["You have received SGD 22.94 from TAN AH KOW via PayNow.", "not_a_payment"],
    ["Your card was used.", "no_amount"],
    ["", "empty"]
  ];
  const { lines } = await captureLogs(async () => {
    for (const [text, reason] of cases) {
      const reply = await bankAlert(fetchWorker, { text });
      assert.deepEqual([reply.status, reply.payload], [200, { ok: true, completed: false, reason }], text);
    }
  });
  assert.deepEqual(await dumpDatabase(db), before);
  assert.equal(lines.some((line) => line.includes("482913")), false);
});

test("an Amaze alert in Rupiah finishes the tap with the foreign-currency estimate", async (t) => {
  const { db, fetch: fetchWorker } = await openSeededDatabase(t, template);
  await enableShortcut(db);
  await saveRate(db);
  await tap(fetchWorker, { description: "Warung Made Seminyak" });

  const reply = await bankAlert(fetchWorker, { text: "Amaze: You spent IDR 150.000 (≈ SGD 12.80) at AMAZE*WARUNG MADE with your Amaze card ending 7741." });
  assert.equal(reply.payload.completed, true, JSON.stringify(reply.payload));
  const [entry] = await rows(db, "SELECT description, original_amount_minor, original_currency FROM transactions WHERE id = ?", reply.payload.entryId);
  assert.deepEqual(entry, { description: "Warung Made Seminyak", original_amount_minor: 15000000, original_currency: "IDR" });
  assert.deepEqual((await taps(db)).map((row) => row.completed_by), ["bank_alert"]);
});

test("an alert from long before or after the tap does not fit it", async (t) => {
  const { db, fetch: fetchWorker } = await openSeededDatabase(t, template);
  await enableShortcut(db);
  await tap(fetchWorker);
  await db.prepare("UPDATE waiting_taps SET received_at = ?").bind(new Date(Date.now() - 31 * 60 * 1000).toISOString()).run();
  const reply = await bankAlert(fetchWorker);
  assert.deepEqual(reply.payload, { ok: true, completed: false, reason: "no_tap" });
});

// The Shortcut, step by step as its actions run: the setup Text holds the
// copied connection URL; Replace Text swaps entries/create for alerts/bank;
// one POST of { text, receivedAt, requestId, clientVersion }; then it ends,
// reading nothing from the reply (no notification, no question).
const SOURCE = path.join(process.cwd(), "shortcuts/bank-alert/monies-map-bank-alert.plist");

test("the Shortcut's source: one POST to alerts/bank with the four fields, then silence", async () => {
  const source = await readFile(SOURCE, "utf8");
  assert.match(source, /<key>WFReplaceTextFind<\/key>\s*<string>entries\/create<\/string>\s*<key>WFReplaceTextReplace<\/key>\s*<string>alerts\/bank<\/string>/);
  assert.equal((source.match(/<string>is\.workflow\.actions\.downloadurl<\/string>/g) ?? []).length, 1);
  for (const forbidden of ["notification", "ask", "alert", "showresult", "openurl", "getvalueforkey", "conditional", "delay"]) {
    assert.equal(source.includes(`<string>is.workflow.actions.${forbidden}</string>`), false, forbidden);
  }
  const keys = [...source.matchAll(/<key>WFKey<\/key>\s*<dict>\s*<key>Value<\/key>\s*<dict>\s*<key>string<\/key>\s*<string>([^<]+)<\/string>/g)].map((match) => match[1]);
  assert.deepEqual(keys, ["text", "receivedAt", "requestId", "clientVersion"]);
  assert.match(source, new RegExp(`<string>${ALERT_VERSION}</string>`));
});

async function runAlertShortcut(fetchWorker, connectionUrl, notificationText) {
  const alertUrl = connectionUrl.replace("entries/create", "alerts/bank");
  const url = new URL(alertUrl);
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 17);
  await fetchWorker(`${url.pathname}${url.search}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: notificationText, receivedAt: new Date().toISOString(), requestId: `bank-alert-${stamp}`, clientVersion: ALERT_VERSION })
  });
  // The Shortcut shows nothing whatever the answer.
  return [];
}

test("simulated runs: a held tap, then the bank's notification finishes it; an OTP and a promotion end silently", async (t) => {
  const { db, fetch: fetchWorker } = await openSeededDatabase(t, template);
  await enableShortcut(db);
  const connection = `https://monies-map-shortcuts.test/api/shortcuts/entries/create?shortcut_token=${TOKEN}`;
  await tap(fetchWorker);

  assert.deepEqual(await runAlertShortcut(fetchWorker, connection, "123456 is your UOB OTP. Never share it."), []);
  assert.deepEqual(await runAlertShortcut(fetchWorker, connection, "Enjoy 10% off at PERIPLUS BALI when you spend SGD 50."), []);
  assert.deepEqual((await taps(db)).map((row) => row.status), ["waiting"]);
  assert.deepEqual(await runAlertShortcut(fetchWorker, connection, UOB_ALERT), []);
  assert.deepEqual(await taps(db), [{ request_id: TAP_1, status: "completed", completed_by: "bank_alert", has_entry: 1 }]);
});

test("the committed Bank alert Shortcut is secret-free, signed, and matches its manifest and the install row", async () => {
  const root = path.join(process.cwd(), "shortcuts/bank-alert");
  const sha256 = (value) => createHash("sha256").update(value).digest("hex");
  const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
  const source = await readFile(path.join(root, manifest.sourceFile));
  const signed = await readFile(path.join(root, manifest.signedReleaseFile));
  const published = await readFile(path.join(root, manifest.publicFile));
  assert.equal(sha256(source), manifest.sourceSha256);
  assert.equal(sha256(signed), manifest.signedReleaseSha256);
  assert.equal(signed.byteLength, manifest.signedReleaseSize);
  assert.equal(sha256(published), manifest.signedReleaseSha256);
  assert.equal(signed.subarray(0, 4).toString("latin1"), "AEA1");
  assert.equal(manifest.appleSigningStatus, "APPROVED");
  const text = source.toString("utf8");
  assert.equal((text.match(/<string>is\.workflow\.actions\.[^<]+<\/string>/g) ?? []).length, manifest.actionCount);
  assert.match(text, /<key>WFWorkflowImportQuestions<\/key>[\s\S]*<key>ActionIndex<\/key>\s*<integer>0<\/integer>/);
  assert.match(text, /<key>WFTextActionText<\/key>\s*<string><\/string>/);
  for (const forbidden of [/shortcut_token\s*=/i, /X-Monies-Shortcut-Token/i, /Authorization/i, /Bearer\s+/i, /monies-map-shortcuts\.[^<\s]+/i, /mm_[a-z0-9_-]{6,}/i]) {
    assert.doesNotMatch(text, forbidden);
    assert.equal(forbidden.test(signed.toString("latin1")), false);
  }
  const settings = await readFile(path.join(process.cwd(), "src/client/settings-sections.jsx"), "utf8");
  const browserTest = await readFile(path.join(process.cwd(), "tests/e2e/settings-reference-data.spec.js"), "utf8");
  assert.ok(settings.includes(manifest.installPath));
  assert.ok(browserTest.includes(manifest.installPath));
});
