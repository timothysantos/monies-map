// Apple Pay Shortcut v8 (shortcuts/apple-pay-api, DOMAIN.md "Waiting Tap"):
// the committed source reads the server's held answer and ends quietly; it
// waits and asks only when the server sends askAfterSeconds, and asks the
// person only when the status read says `ask`. Then each path is simulated
// against the real Worker and a local D1 the way the Shortcut's actions run
// them: held and ended; held, then completed by a second tap before the
// question; held, asked after the wait, answered; held, asked, Cancel. A real
// two-tap terminal was not tested (none in Singapore asks an SG card).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { createSeededTemplate, openSeededDatabase, rows } from "./support/d1-workspace.mjs";
import { enableShortcut, TOKEN } from "./support/foreign-wallet.mjs";

const SOURCE = path.join(process.cwd(), "shortcuts/apple-pay-api/monies-map-apple-pay-api.plist");
const V8 = "apple-pay-api-2026-11-17-v8";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

test("the v8 source: held first and quiet, the wait and the question only when the server says so", async () => {
  const source = await readFile(SOURCE, "utf8");
  const keysRead = [...source.matchAll(/<key>WFDictionaryKey<\/key>\s*<string>([^<]+)<\/string>/g)].map((match) => match[1]);
  // In action order: held; its notice; askAfterSeconds; the status read's
  // ask, merchant and card; the answer's notice and error; the status
  // notice; then v7's own reads, unchanged, for every other answer.
  assert.deepEqual(keysRead, [
    "held", "notice", "askAfterSeconds", "ask", "merchant", "accountName", "notice", "error", "notice",
    "openUrl", "accountName", "needsAmount", "accountName", "openUrl", "error", "error"
  ]);
  assert.equal((source.match(new RegExp(`<string>${V8}</string>`, "g")) ?? []).length, 4);
  assert.doesNotMatch(source, /apple-pay-api-2026-11-10-v7/);
  // Three posts to the entry endpoint (the tap, v7's needsAmount retry, the
  // answer) and one status read, all with the tap's one request id.
  assert.equal((source.match(/<string>is\.workflow\.actions\.downloadurl<\/string>/g) ?? []).length, 4);
  assert.equal((source.match(/<string>TapRequestId<\/string>/g) ?? []).length, 5);
  assert.match(source, /<key>WFReplaceTextFind<\/key>\s*<string>entries\/create<\/string>\s*<key>WFReplaceTextReplace<\/key>\s*<string>taps\/status<\/string>/);
  // The held notification makes no sound; the question is Text input with
  // the approved hint.
  assert.match(source, /<key>WFNotificationActionSound<\/key>\s*<false\/>/);
  assert.match(source, /How much was [^<]*\?\nPaid on [^<]*\. The amount didn't come through\. Type it in SGD, or add the currency, like IDR 150000\./);
  assert.equal((source.match(/<string>is\.workflow\.actions\.delay<\/string>/g) ?? []).length, 1);
  // The held branch comes before v7's: a held tap never reaches v7's
  // immediate question.
  assert.ok(source.indexOf("<string>held</string>") < source.indexOf("<string>needsAmount</string>"));
});

// The Shortcut's v8 run, step by step as its actions do it.
async function runShortcut(fetchWorker, walletInput, { answer, beforeStatus } = {}) {
  const shown = [];
  const post = (pathname, body) => fetchWorker(`${pathname}?shortcut_token=${TOKEN}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  }).then((response) => response.json());
  const requestId = walletInput.requestId;
  const body = { amount: walletInput.value, description: walletInput.merchant, date: "2026-10-05", name: walletInput.name, requestId, clientVersion: V8 };
  const reply = await post("/api/shortcuts/entries/create", body);
  if (!reply.held) {
    return { reply, shown, asked: false };
  }
  shown.push(reply.notice);
  if (reply.askAfterSeconds === undefined) {
    return { reply, shown, asked: false };
  }
  await beforeStatus?.();
  const status = await post("/api/shortcuts/taps/status", { requestId });
  if (!status.ask) {
    shown.push(status.notice);
    return { reply, shown, asked: false };
  }
  // Ask for Input: Cancel stops the Shortcut there.
  if (answer === undefined) {
    return { reply, shown, asked: true };
  }
  const saved = await post("/api/shortcuts/entries/create", { ...body, amount: answer });
  shown.push(saved.notice ?? `Not saved ${walletInput.merchant} • ${saved.error}`);
  return { reply, shown, asked: true };
}

const wallet = (overrides = {}) => ({ value: "", merchant: "Periplus Bali", name: "UOB One", requestId: "apple-pay-20261005120000000", ...overrides });
const withAsk = (seconds) => ({ ...template, config: { ...template.config, vars: { ...template.config.vars, WAITING_TAP_ASK_AFTER_SECONDS: seconds } } });
const tapStatuses = (db) => rows(db, "SELECT status, completed_by FROM waiting_taps");

test("default: the blank tap shows only the quiet notice and ends; the tap waits for Entries", async (t) => {
  const { db, fetch: fetchWorker } = await openSeededDatabase(t, template);
  await enableShortcut(db);
  const run = await runShortcut(fetchWorker, wallet());
  assert.deepEqual([run.shown, run.asked], [["Periplus Bali noted. Waiting for the amount."], false]);
  assert.deepEqual(await tapStatuses(db), [{ status: "waiting", completed_by: null }]);
});

test("asked after the wait: a second tap finished it first, so the Shortcut only says Saved", async (t) => {
  const { db, fetch: fetchWorker } = await openSeededDatabase(t, withAsk("45"));
  await enableShortcut(db);
  const run = await runShortcut(fetchWorker, wallet(), {
    beforeStatus: () => runShortcut(fetchWorker, wallet({ value: "22.94", requestId: "apple-pay-20261005120031000" }))
  });
  assert.deepEqual([run.shown, run.asked], [["Periplus Bali noted. Waiting for the amount.", "Saved Periplus Bali • SGD 22.94 • UOB One"], false]);
  assert.deepEqual(await tapStatuses(db), [{ status: "completed", completed_by: "second_tap" }]);
});

test("asked after the wait: still waiting, the person types the amount and it is saved on the tap", async (t) => {
  const { db, fetch: fetchWorker } = await openSeededDatabase(t, withAsk("45"));
  await enableShortcut(db);
  const run = await runShortcut(fetchWorker, wallet(), { answer: "22.94" });
  assert.deepEqual([run.shown, run.asked], [["Periplus Bali noted. Waiting for the amount.", "Saved Periplus Bali • SGD 22.94 • UOB One"], true]);
  assert.deepEqual(await tapStatuses(db), [{ status: "completed", completed_by: "shortcut_answer" }]);
});

test("asked after the wait: Cancel saves nothing and the tap still waits for Entries", async (t) => {
  const { db, fetch: fetchWorker } = await openSeededDatabase(t, withAsk("0"));
  await enableShortcut(db);
  const before = (await rows(db, "SELECT COUNT(*) AS n FROM transactions"))[0].n;
  const run = await runShortcut(fetchWorker, wallet());
  assert.equal(run.asked, true);
  assert.equal((await rows(db, "SELECT COUNT(*) AS n FROM transactions"))[0].n, before);
  assert.deepEqual(await tapStatuses(db), [{ status: "waiting", completed_by: null }]);
});

test("a tap with its amount never sees the held branch", async (t) => {
  const { db, fetch: fetchWorker } = await openSeededDatabase(t, template);
  await enableShortcut(db);
  const run = await runShortcut(fetchWorker, wallet({ value: "S$22.94" }));
  assert.deepEqual([run.reply.ok, run.reply.held, run.reply.amountMinor, run.shown], [true, undefined, 2294, []]);
});
