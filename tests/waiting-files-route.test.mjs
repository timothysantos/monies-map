// "Send to Monies Map" (DOMAIN.md "Waiting File"): the share-sheet endpoint
// against the real Worker and a real local D1. Files wait, are listed on the
// Imports page by name only, are read back one at a time behind Access, are
// removed for good, and leave the store when their import commits. Every
// refusal has its negative here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import worker from "../src/index.ts";
import { createSeededTemplate, openSeededDatabase, rows } from "./support/d1-workspace.mjs";
import { WAITING_FILES_INTAKE_PATH } from "../src/domain/waiting-files-config.ts";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const fixture = (path) => new Uint8Array(readFileSync(new URL(`./fixtures/${path}`, import.meta.url)));
const PDF = fixture("locked-pdf/uob-one-savings-apr-2026.plain.pdf");
const XLS = fixture("uob-current-transactions/ACC_TXN_History_04052026210351.xls");
const CSV = fixture("ocbc-activity/TransactionHistory_20260628140517-ocbc-360-sanitized.csv");

function form(files) {
  const body = new FormData();
  for (const [name, bytes, type = "application/octet-stream"] of files) {
    body.append("file", new Blob([bytes], { type }), name);
  }
  return body;
}

async function makeKey(workspace) {
  const response = await workspace.fetch("/api/settings/file-intake/new-key", { method: "POST" });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.keySource, "app");
  assert.equal(payload.endpoint, `https://monies-map-shortcuts.test${WAITING_FILES_INTAKE_PATH}`);
  assert.match(payload.key, /^[A-Za-z0-9_-]{43}$/);
  return payload.key;
}

async function send(workspace, key, files, headers = {}) {
  const response = await workspace.fetch(WAITING_FILES_INTAKE_PATH, {
    method: "POST",
    headers: key ? { "X-Monies-Files-Key": key, ...headers } : headers,
    body: form(files)
  });
  return { status: response.status, payload: await response.json() };
}

async function waitingList(workspace) {
  const response = await workspace.fetch("/api/imports-page");
  assert.equal(response.status, 200);
  return (await response.json()).importsPage.waitingFiles;
}

test("two files in one share wait, are listed by name only, and read back byte for byte", async (t) => {
  const workspace = await openSeededDatabase(t, template);
  const key = await makeKey(workspace);
  const sent = await send(workspace, key, [["eStatement Apr 2026.pdf", PDF], ["ACC_TXN_History.xls", XLS]]);
  assert.equal(sent.status, 200);
  assert.deepEqual(sent.payload, {
    ok: true,
    message: "Got it. 2 files are waiting in Monies Map; open Imports to review them.",
    files: [
      { name: "eStatement Apr 2026.pdf", result: "received", message: "" },
      { name: "ACC_TXN_History.xls", result: "received", message: "" }
    ]
  });

  const list = await waitingList(workspace);
  assert.deepEqual(list.map(({ fileName, fileKind, sizeBytes, arrivedVia }) => ({ fileName, fileKind, sizeBytes, arrivedVia })), [
    { fileName: "eStatement Apr 2026.pdf", fileKind: "pdf", sizeBytes: PDF.byteLength, arrivedVia: "shortcut" },
    { fileName: "ACC_TXN_History.xls", fileKind: "xls", sizeBytes: XLS.byteLength, arrivedVia: "shortcut" }
  ]);
  assert.deepEqual(Object.keys(list[0]).sort(), ["arrivedVia", "fileKind", "fileName", "id", "receivedAt", "sizeBytes"]);

  const fileResponse = await workspace.fetch(`/api/waiting-files/file?id=${list[0].id}`);
  assert.equal(fileResponse.status, 200);
  assert.equal(fileResponse.headers.get("content-type"), "application/octet-stream");
  assert.equal(fileResponse.headers.get("content-disposition"), "attachment");
  assert.equal(fileResponse.headers.get("x-content-type-options"), "nosniff");
  assert.equal(fileResponse.headers.get("cache-control"), "no-store");
  assert.deepEqual(new Uint8Array(await fileResponse.arrayBuffer()), PDF);

  // The audit lines name the kind and size, never the file name.
  const audit = await rows(workspace.db, "SELECT action, detail FROM audit_events WHERE entity_type = 'waiting_file' ORDER BY detail");
  assert.deepEqual(audit.map((row) => row.action), ["waiting_file_received", "waiting_file_received"]);
  assert.ok(audit.every((row) => !row.detail.includes("eStatement") && !row.detail.includes("ACC_TXN")));
});

test("a file of more than one chunk is stored in pieces and comes back whole", async (t) => {
  const workspace = await openSeededDatabase(t, template);
  const key = await makeKey(workspace);
  const big = new Uint8Array(1_200_000);
  big.set(PDF);
  big.fill(0x20, PDF.byteLength);
  const sent = await send(workspace, key, [["scanned.pdf", big]]);
  assert.equal(sent.status, 200);
  const [file] = await waitingList(workspace);
  assert.deepEqual(await rows(workspace.db, "SELECT chunk_index, length(bytes) AS size FROM waiting_file_chunks WHERE file_id = ? ORDER BY chunk_index", file.id), [
    { chunk_index: 0, size: 524288 },
    { chunk_index: 1, size: 524288 },
    { chunk_index: 2, size: 151424 }
  ]);
  const back = await workspace.fetch(`/api/waiting-files/file?id=${file.id}`);
  assert.deepEqual(new Uint8Array(await back.arrayBuffer()), big);
});

test("the same file sent twice is kept once and reads 'already received'", async (t) => {
  const workspace = await openSeededDatabase(t, template);
  const key = await makeKey(workspace);
  await send(workspace, key, [["one.pdf", PDF]]);
  const again = await send(workspace, key, [["renamed copy.pdf", PDF], ["activity.csv", CSV, "text/csv"]]);
  assert.equal(again.status, 200);
  assert.deepEqual(again.payload.files, [
    { name: "renamed copy.pdf", result: "already_received", message: "Already received. It is waiting in Monies Map." },
    { name: "activity.csv", result: "received", message: "" }
  ]);
  assert.equal(again.payload.message, "Got it. The file is waiting in Monies Map; open Imports to review it.\nrenamed copy.pdf: Already received. It is waiting in Monies Map.");
  // Twice in one share is also one file.
  const twice = await send(workspace, key, [["a.xls", XLS], ["b.xls", XLS]]);
  assert.deepEqual(twice.payload.files.map((file) => file.result), ["received", "already_received"]);
  assert.deepEqual((await waitingList(workspace)).map((file) => file.fileName), ["one.pdf", "activity.csv", "a.xls"]);
  // Only new files count towards the day.
  assert.deepEqual(await rows(workspace.db, "SELECT received_count FROM waiting_file_daily_counts"), [{ received_count: 3 }]);
});

test("the key: none set up, missing, wrong, in the address, or replaced is refused", async (t) => {
  const workspace = await openSeededDatabase(t, template);
  const notSetUp = await send(workspace, "anything", [["one.pdf", PDF]]);
  assert.equal(notSetUp.status, 503);
  assert.equal(notSetUp.payload.message, "Sending files to Monies Map is not set up.");

  const key = await makeKey(workspace);
  for (const attempt of [
    await send(workspace, "", [["one.pdf", PDF]]),
    await send(workspace, `${key}x`, [["one.pdf", PDF]]),
    await send(workspace, key.slice(0, -1), [["one.pdf", PDF]])
  ]) {
    assert.equal(attempt.status, 401);
    assert.equal(attempt.payload.message, "Monies Map did not recognise this Shortcut's key. Copy the key again from Settings.");
  }
  // A key in the address is never read (addresses end up in logs).
  const inAddress = await workspace.fetch(`${WAITING_FILES_INTAKE_PATH}?key=${key}`, { method: "POST", body: form([["one.pdf", PDF]]) });
  assert.equal(inAddress.status, 401);
  // The Apple Pay Shortcut's key does not open it.
  const applePayEnv = { DB: workspace.db, ...template.config.vars, SHORTCUT_INGEST_TOKEN: "apple-pay-shortcut-key" };
  const withApplePayKey = await worker.fetch(new Request(`http://127.0.0.1${WAITING_FILES_INTAKE_PATH}`, {
    method: "POST",
    headers: { "X-Monies-Files-Key": "apple-pay-shortcut-key", "X-Monies-Shortcut-Token": "apple-pay-shortcut-key" },
    body: form([["one.pdf", PDF]])
  }), applePayEnv);
  assert.equal(withApplePayKey.status, 401);

  const bearer = await send(workspace, "", [["one.pdf", PDF]], { Authorization: `Bearer ${key}` });
  assert.equal(bearer.status, 200);

  // A new key stops the old one.
  const newKey = await makeKey(workspace);
  assert.notEqual(newKey, key);
  assert.equal((await send(workspace, key, [["two.csv", CSV]])).status, 401);
  assert.equal((await send(workspace, newKey, [["two.csv", CSV]])).status, 200);
  const audit = await rows(workspace.db, "SELECT detail FROM audit_events WHERE action = 'file_intake_key_replaced'");
  assert.equal(audit.length, 2);
  assert.ok(audit.every((row) => !row.detail.includes(key) && !row.detail.includes(newKey)));
});

test("the Worker secret is the key until one is made in Settings", async (t) => {
  const workspace = await openSeededDatabase(t, template);
  const env = { DB: workspace.db, ...template.config.vars, FILE_INTAKE_KEY: "worker-secret-key-for-tests" };
  const post = (key) => worker.fetch(new Request(`http://127.0.0.1${WAITING_FILES_INTAKE_PATH}`, { method: "POST", headers: { "X-Monies-Files-Key": key }, body: form([["one.pdf", PDF]]) }), env);
  assert.equal((await post("worker-secret-key-for-tests")).status, 200);
  assert.equal((await post("wrong")).status, 401);
  const settings = await (await worker.fetch(new Request("http://127.0.0.1/api/settings/file-intake"), env)).json();
  assert.equal(settings.keySource, "environment");
});

test("files that are not bank files, too big, too many or not a form are refused and nothing is stored", async (t) => {
  const workspace = await openSeededDatabase(t, template);
  const key = await makeKey(workspace);
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);
  const html = new TextEncoder().encode("<!doctype html><html><body><a href='https://bank.example'>Open your statement</a></body></html>");
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const refused = await send(workspace, key, [["statements.zip", zip], ["statement.html", html], ["page.csv", html], ["photo.png", png], ["empty.pdf", new Uint8Array(0)]]);
  assert.equal(refused.status, 422);
  assert.deepEqual(refused.payload.files.map((file) => [file.name, file.result, file.message]), [
    ["statements.zip", "refused", "Monies Map only takes PDF statements and CSV, TSV or XLS bank exports."],
    ["statement.html", "refused", "Monies Map only takes PDF statements and CSV, TSV or XLS bank exports."],
    ["page.csv", "refused", "Monies Map only takes PDF statements and CSV, TSV or XLS bank exports."],
    ["photo.png", "refused", "Monies Map only takes PDF statements and CSV, TSV or XLS bank exports."],
    ["empty.pdf", "refused", "This file is empty."]
  ]);

  const tooBig = new Uint8Array(10 * 1024 * 1024 + 1);
  tooBig.set(PDF);
  const big = await send(workspace, key, [["huge.pdf", tooBig]]);
  assert.equal(big.status, 422);
  assert.equal(big.payload.files[0].message, "This file is larger than 10 MB.");

  // A refused file beside a good one: the good one waits.
  const mixed = await send(workspace, key, [["photo.png", png], ["ok.pdf", PDF]]);
  assert.equal(mixed.status, 200);
  assert.equal(mixed.payload.message, "Got it. The file is waiting in Monies Map; open Imports to review it.\nphoto.png: Monies Map only takes PDF statements and CSV, TSV or XLS bank exports.");

  const eleven = await send(workspace, key, Array.from({ length: 11 }, (_, index) => [`f${index}.csv`, new TextEncoder().encode(`date,amount\n2026-05-0${index % 9 + 1},${index}\n`)]));
  assert.equal(eleven.status, 413);
  assert.equal(eleven.payload.message, "Send at most 10 files at a time.");

  const noFile = await workspace.fetch(WAITING_FILES_INTAKE_PATH, { method: "POST", headers: { "X-Monies-Files-Key": key }, body: (() => { const body = new FormData(); body.append("note", "hello"); return body; })() });
  assert.equal(noFile.status, 400);
  assert.equal((await noFile.json()).message, "No file came with this. Share a PDF, CSV, TSV or XLS file.");

  const raw = await workspace.fetch(WAITING_FILES_INTAKE_PATH, { method: "POST", headers: { "X-Monies-Files-Key": key, "content-type": "application/pdf" }, body: PDF });
  assert.equal(raw.status, 415);

  // Past 25 MB the body is cut off while it arrives, with no length given.
  const chunk = new Uint8Array(1024 * 1024);
  let sentChunks = 0;
  const stream = new ReadableStream({
    pull(controller) {
      sentChunks += 1;
      if (sentChunks > 30) {
        controller.close();
      } else {
        controller.enqueue(chunk);
      }
    }
  });
  const flood = await workspace.fetch(WAITING_FILES_INTAKE_PATH, { method: "POST", headers: { "X-Monies-Files-Key": key, "content-type": "multipart/form-data; boundary=x" }, body: stream, duplex: "half" });
  assert.equal(flood.status, 413);
  assert.equal((await flood.json()).message, "These files are larger than 25 MB together. Send fewer at a time.");
  assert.ok(sentChunks < 30);

  assert.deepEqual((await waitingList(workspace)).map((file) => file.fileName), ["ok.pdf"]);
});

test("the daily limit and the number of files waiting are kept", async (t) => {
  const workspace = await openSeededDatabase(t, template);
  const key = await makeKey(workspace);
  await send(workspace, key, [["one.pdf", PDF]]);
  await workspace.db.prepare("UPDATE waiting_file_daily_counts SET received_count = 40").run();
  const overDay = await send(workspace, key, [["two.csv", CSV]]);
  assert.equal(overDay.status, 429);
  assert.equal(overDay.payload.message, "Monies Map has taken as many files as it takes in one day. Try again tomorrow.");
  // A repeat is not a new file, so it still answers.
  assert.equal((await send(workspace, key, [["one.pdf", PDF]])).payload.files[0].result, "already_received");

  await workspace.db.prepare("DELETE FROM waiting_file_daily_counts").run();
  const fillers = [];
  for (let index = 0; index < 39; index += 1) {
    fillers.push(workspace.db.prepare(`
      INSERT INTO waiting_files (id, household_id, file_name, file_kind, content_type, size_bytes, sha256, chunk_count, arrived_via, received_at, expires_at)
      SELECT ?, household_id, 'filler.csv', 'csv', 'text/csv', 0, ?, 0, 'shortcut', '2026-11-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z' FROM waiting_files LIMIT 1
    `).bind(`waiting-00000000-0000-0000-0000-0000000000${String(index).padStart(2, "0")}`, `filler-${index}`));
  }
  await workspace.db.batch(fillers);
  const full = await send(workspace, key, [["two.csv", CSV]]);
  assert.equal(full.status, 429);
  assert.equal(full.payload.message, "40 files are already waiting. Open Imports and review or remove some first.");
});

test("a file waiting past its 30 days is never listed and is deleted for good", async (t) => {
  const workspace = await openSeededDatabase(t, template);
  const key = await makeKey(workspace);
  await send(workspace, key, [["old.pdf", PDF], ["new.csv", CSV]]);
  await workspace.db.prepare("UPDATE waiting_files SET expires_at = '2020-01-01T00:00:00.000Z' WHERE file_name = 'old.pdf'").run();
  const [oldId] = (await rows(workspace.db, "SELECT id FROM waiting_files WHERE file_name = 'old.pdf'")).map((row) => row.id);
  assert.equal((await workspace.fetch(`/api/waiting-files/file?id=${oldId}`)).status, 404);
  assert.deepEqual((await waitingList(workspace)).map((file) => file.fileName), ["new.csv"]);
  assert.deepEqual(await rows(workspace.db, "SELECT count(*) AS n FROM waiting_file_chunks WHERE file_id = ?", oldId), [{ n: 0 }]);
  assert.deepEqual(await rows(workspace.db, "SELECT count(*) AS n FROM waiting_files WHERE id = ?", oldId), [{ n: 0 }]);
  assert.deepEqual((await rows(workspace.db, "SELECT detail FROM audit_events WHERE action = 'waiting_files_expired'")).map((row) => row.detail), [
    "1 file sent to Monies Map waited 30 days unopened and was deleted."
  ]);
  // Sending it again after it was deleted keeps it again.
  assert.equal((await send(workspace, key, [["old.pdf", PDF]])).payload.files[0].result, "received");
});

test("Remove deletes the file for good; another household's file is never read or removed", async (t) => {
  const workspace = await openSeededDatabase(t, template);
  const key = await makeKey(workspace);
  await send(workspace, key, [["one.pdf", PDF], ["two.csv", CSV]]);
  const [first] = await waitingList(workspace);
  const remove = (id) => workspace.fetch("/api/waiting-files/remove", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
  assert.equal((await remove(first.id)).status, 200);
  assert.equal((await remove(first.id)).status, 404);
  assert.equal((await remove("../../etc")).status, 404);
  assert.deepEqual(await rows(workspace.db, "SELECT count(*) AS n FROM waiting_file_chunks WHERE file_id = ?", first.id), [{ n: 0 }]);
  assert.deepEqual((await waitingList(workspace)).map((file) => file.fileName), ["two.csv"]);
  assert.deepEqual((await rows(workspace.db, "SELECT detail FROM audit_events WHERE action = 'waiting_file_removed'")).map((row) => row.detail), [
    "A PDF file sent to Monies Map was removed without importing it."
  ]);

  // A row of another household (the app holds one; this proves the scope).
  await workspace.db.prepare("INSERT OR IGNORE INTO households (id, name) VALUES ('household-other', 'Other')").run().catch(() => undefined);
  await workspace.db.prepare("PRAGMA foreign_keys = OFF").run();
  await workspace.db.prepare(`
    INSERT INTO waiting_files (id, household_id, file_name, file_kind, content_type, size_bytes, sha256, chunk_count, arrived_via, received_at, expires_at)
    VALUES ('waiting-11111111-1111-1111-1111-111111111111', 'household-other', 'theirs.pdf', 'pdf', 'application/pdf', 3, 'theirs', 1, 'shortcut', '2026-11-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')
  `).run();
  await workspace.db.prepare("INSERT INTO waiting_file_chunks (file_id, chunk_index, bytes) VALUES ('waiting-11111111-1111-1111-1111-111111111111', 0, X'255044')").run();
  assert.equal((await workspace.fetch("/api/waiting-files/file?id=waiting-11111111-1111-1111-1111-111111111111")).status, 404);
  assert.equal((await remove("waiting-11111111-1111-1111-1111-111111111111")).status, 404);
  assert.deepEqual((await waitingList(workspace)).map((file) => file.fileName), ["two.csv"]);
  assert.deepEqual(await rows(workspace.db, "SELECT count(*) AS n FROM waiting_file_chunks WHERE file_id = 'waiting-11111111-1111-1111-1111-111111111111'"), [{ n: 1 }]);
});

test("the file leaves the store in its import's own commit", async (t) => {
  const workspace = await openSeededDatabase(t, template);
  const key = await makeKey(workspace);
  await send(workspace, key, [["activity.csv", CSV]]);
  const [file] = await waitingList(workspace);
  const rowsToImport = [{ rowId: "r1", rowIndex: 0, date: "2026-06-20", description: "Kopi", amountMinor: 450, entryType: "expense", accountName: "UOB One", categoryName: "Food & Drinks", ownershipType: "direct", ownerName: "Tim", splitBasisPoints: 10000, rawRow: {} }];
  const commit = await workspace.api("/api/imports/commit", { sourceLabel: "activity.csv", sourceType: "csv", parserKey: "generic_csv", rows: rowsToImport, waitingFileId: file.id });
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  assert.deepEqual(await waitingList(workspace), []);
  assert.deepEqual(await rows(workspace.db, "SELECT count(*) AS n FROM waiting_file_chunks"), [{ n: 0 }]);
  assert.deepEqual((await rows(workspace.db, "SELECT detail FROM audit_events WHERE action = 'waiting_file_imported'")).map((row) => row.detail), [
    `A CSV file sent to Monies Map was imported (${commit.payload.importId}) and deleted.`
  ]);

  // The same file sent again waits again; committing it again finds the
  // import already saved and still takes the copy away.
  await send(workspace, key, [["activity.csv", CSV]]);
  const [again] = await waitingList(workspace);
  const repeat = await workspace.api("/api/imports/commit", { sourceLabel: "activity.csv", sourceType: "csv", parserKey: "generic_csv", rows: rowsToImport, waitingFileId: again.id });
  assert.equal(repeat.payload.created, false);
  assert.deepEqual(await waitingList(workspace), []);

  // A file id that is not waiting does not stop the commit.
  const other = await workspace.api("/api/imports/commit", { sourceLabel: "other.csv", sourceType: "csv", parserKey: "generic_csv", rows: [{ ...rowsToImport[0], description: "Teh" }], waitingFileId: "waiting-22222222-2222-2222-2222-222222222222" });
  assert.equal(other.status, 200);
});

test("only the send path is open on the Shortcut Worker and outside Access; reading files back is not", async (t) => {
  const workspace = await openSeededDatabase(t, template);
  const key = await makeKey(workspace);
  const gatewayEnv = { DB: workspace.db, ...template.config.vars, SHORTCUT_API_ONLY: "true" };
  const viaGateway = (path, init) => worker.fetch(new Request(`http://127.0.0.1${path}`, init), gatewayEnv);
  assert.equal((await viaGateway(WAITING_FILES_INTAKE_PATH, { method: "POST", headers: { "X-Monies-Files-Key": key }, body: form([["one.pdf", PDF]]) })).status, 200);
  assert.equal((await viaGateway(WAITING_FILES_INTAKE_PATH, { method: "GET" })).status, 405);
  assert.equal((await viaGateway("/api/imports-page")).status, 404);
  assert.equal((await viaGateway("/api/waiting-files/file?id=x")).status, 404);
  assert.equal((await viaGateway("/api/settings/file-intake")).status, 404);

  const accessEnv = { DB: workspace.db, ...template.config.vars, ACCESS_JWT_MODE: "enforce", ACCESS_TEAM_DOMAIN: "team.example", ACCESS_AUD: "aud" };
  const viaAccess = (path, init) => worker.fetch(new Request(`http://127.0.0.1${path}`, init), accessEnv);
  const [file] = await waitingList(workspace);
  // The send path reaches its own key check without an Access token...
  const unsigned = await viaAccess(WAITING_FILES_INTAKE_PATH, { method: "POST", body: form([["two.csv", CSV]]) });
  assert.equal(unsigned.status, 401);
  assert.equal((await unsigned.json()).message, "Monies Map did not recognise this Shortcut's key. Copy the key again from Settings.");
  // ...and nothing else does.
  for (const [path, init] of [
    [`/api/waiting-files/file?id=${file.id}`, { method: "GET" }],
    ["/api/waiting-files/remove", { method: "POST", body: JSON.stringify({ id: file.id }) }],
    ["/api/settings/file-intake", { method: "GET" }],
    ["/api/settings/file-intake/new-key", { method: "POST" }],
    [WAITING_FILES_INTAKE_PATH, { method: "GET" }]
  ]) {
    const response = await viaAccess(path, init);
    assert.ok([401, 405].includes(response.status), `${path} ${response.status}`);
    if (response.status === 401) {
      assert.deepEqual(await response.json(), { ok: false, error: "Not signed in." });
    }
  }
});

test("a browser page on another site cannot remove a file or replace the key", async (t) => {
  const workspace = await openSeededDatabase(t, template);
  const key = await makeKey(workspace);
  await send(workspace, key, [["one.pdf", PDF]]);
  const [file] = await waitingList(workspace);
  const crossSite = { "Sec-Fetch-Site": "cross-site", "content-type": "application/json" };
  assert.equal((await workspace.fetch("/api/waiting-files/remove", { method: "POST", headers: crossSite, body: JSON.stringify({ id: file.id }) })).status, 403);
  assert.equal((await workspace.fetch("/api/settings/file-intake/new-key", { method: "POST", headers: crossSite })).status, 403);
  assert.equal((await waitingList(workspace)).length, 1);
});

test("with the store missing, Imports loads as before and the send path refuses plainly", async (t) => {
  const workspace = await openSeededDatabase(t, template);
  const key = await makeKey(workspace);
  await workspace.db.batch([
    workspace.db.prepare("DROP TABLE waiting_file_chunks"),
    workspace.db.prepare("DROP TABLE waiting_files"),
    workspace.db.prepare("DROP TABLE waiting_file_daily_counts")
  ]);
  const page = await workspace.fetch("/api/imports-page");
  assert.equal(page.status, 200);
  const payload = await page.json();
  assert.deepEqual(payload.importsPage.waitingFiles, []);
  assert.ok(payload.importsPage.importInbox);
  const sent = await send(workspace, key, [["one.pdf", PDF]]);
  assert.equal(sent.status, 503);
  assert.equal(sent.payload.message, "Sending files to Monies Map is not set up.");
  assert.equal((await workspace.fetch("/api/waiting-files/file?id=waiting-11111111-1111-1111-1111-111111111111")).status, 404);
  const rowsToImport = [{ rowId: "r1", rowIndex: 0, date: "2026-06-20", description: "Kopi", amountMinor: 450, entryType: "expense", accountName: "UOB One", categoryName: "Food & Drinks", ownershipType: "direct", ownerName: "Tim", splitBasisPoints: 10000, rawRow: {} }];
  const commit = await workspace.api("/api/imports/commit", { sourceLabel: "a.csv", sourceType: "csv", parserKey: "generic_csv", rows: rowsToImport, waitingFileId: "waiting-11111111-1111-1111-1111-111111111111" });
  assert.equal(commit.status, 200);
});
