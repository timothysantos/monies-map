// Order does not matter for files sent to Monies Map (DOMAIN.md "Waiting
// File"). The same two near-real files (a UOB One savings statement for
// April 2026, printed to a real PDF, and a UOB One activity XLS from early
// May) are sent in either order, in one share or two. Each time Imports
// pulls them the way the browser does (one at a time, read by the same
// parsers, queued by the same intake model), reviews them in the queue's
// order and commits each with its waiting file. The queue order, the
// committed ledger and the saved statement come out the same every time,
// and the store is empty after. An activity CSV whose rows are out of date
// order imports the same as the sorted file.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

import { extractTextFromPdfDocument } from "../src/client/pdf-statement-text.js";
import { buildIntakeQueueItem, orderIntakeQueue } from "../src/client/import-intake-model.js";
import { selectWaitingFilesToPull } from "../src/client/waiting-files-model.js";
import { parseCurrentTransactionSpreadsheet, parseOcbcActivityCsv, parseStatementText } from "../src/lib/statement-import.ts";
import { WAITING_FILES_INTAKE_PATH } from "../src/domain/waiting-files-config.ts";
import { createSeededTemplate, openSeededDatabase, rows } from "./support/d1-workspace.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const fixture = (path) => new Uint8Array(readFileSync(new URL(`./fixtures/${path}`, import.meta.url)));
const STATEMENT = ["eStatement_UOB_One_Apr2026.pdf", fixture("locked-pdf/uob-one-savings-apr-2026.plain.pdf")];
const ACTIVITY = ["ACC_TXN_History_04052026210351.xls", fixture("uob-current-transactions/ACC_TXN_History_04052026210351.xls")];
const OCBC_CSV_NAME = "TransactionHistory_20260628140517.csv";
const OCBC_CSV = readFileSync(new URL("./fixtures/ocbc-activity/TransactionHistory_20260628140517-ocbc-360-sanitized.csv", import.meta.url), "utf8");

async function openWorkspace(t) {
  const workspace = await openSeededDatabase(t, template);
  const response = await workspace.fetch("/api/settings/file-intake/new-key", { method: "POST" });
  workspace.key = (await response.json()).key;
  return workspace;
}

async function share(workspace, files) {
  const body = new FormData();
  for (const [name, bytes] of files) {
    body.append("file", new Blob([bytes]), name);
  }
  const response = await workspace.fetch(WAITING_FILES_INTAKE_PATH, { method: "POST", headers: { "X-Monies-Files-Key": workspace.key }, body });
  assert.equal(response.status, 200);
}

// What the browser does with a waiting file's bytes: the same reader a
// dropped file goes through (pdf.js text, then the statement parser; the
// UOB XLS reader; the OCBC CSV reader).
async function readLikeTheBrowser(fileName, bytes) {
  if (/\.pdf$/i.test(fileName)) {
    const document = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
    return { parsed: parseStatementText(await extractTextFromPdfDocument(document), fileName), sourceType: "pdf" };
  }
  if (/\.xls$/i.test(fileName)) {
    return { parsed: parseCurrentTransactionSpreadsheet(bytes.slice().buffer, fileName), sourceType: "csv" };
  }
  return { parsed: parseOcbcActivityCsv(new TextDecoder().decode(bytes), fileName, { accountName: "OCBC 360 Account", accountKind: "bank", institution: "OCBC" }), sourceType: "csv" };
}

// Opens Imports: lists the waiting files, pulls each one's bytes, queues
// them in the intake queue's order.
async function pullIntoQueue(workspace) {
  const page = await (await workspace.fetch("/api/imports-page")).json();
  const toPull = selectWaitingFilesToPull(page.importsPage.waitingFiles, new Set());
  const items = [];
  const fingerprints = new Set();
  for (const waitingFile of toPull) {
    const response = await workspace.fetch(`/api/waiting-files/file?id=${waitingFile.id}`);
    assert.equal(response.status, 200);
    const read = await readLikeTheBrowser(waitingFile.fileName, new Uint8Array(await response.arrayBuffer()));
    const item = buildIntakeQueueItem({ id: `waiting:${waitingFile.id}`, fileName: waitingFile.fileName, parsed: read.parsed, sourceType: read.sourceType, inbox: page.importsPage.importInbox, existingFingerprints: fingerprints });
    item.waitingFile = waitingFile;
    fingerprints.add(item.fingerprint);
    items.push(item);
  }
  return { order: orderIntakeQueue(items), arrival: page.importsPage.waitingFiles.map((file) => file.fileName) };
}

const committable = (previewRows) => previewRows.filter((row) => row.commitStatus !== "skipped" && row.commitStatus !== "needs_review");

// Reviews and commits one queued file the way the page does: preview, then
// commit the rows the preview keeps, naming its waiting file.
async function reviewAndCommit(workspace, item) {
  const statementCheckpoints = item.parsed.checkpoints ?? [];
  const preview = await workspace.api("/api/imports/preview", {
    sourceLabel: item.parsed.sourceLabel,
    sourceType: item.sourceType,
    parserKey: item.parsed.parserKey,
    rows: item.parsed.rows,
    ownershipType: "direct",
    ownerName: "Tim",
    statementCheckpoints
  });
  assert.equal(preview.status, 200, JSON.stringify(preview.payload).slice(0, 400));
  const previewRows = preview.payload.preview.previewRows;
  const commit = await workspace.api("/api/imports/commit", {
    sourceLabel: item.parsed.sourceLabel,
    sourceType: item.sourceType,
    parserKey: item.parsed.parserKey,
    rows: committable(previewRows),
    statementCheckpoints,
    statementControlRows: item.sourceType === "pdf" ? previewRows : undefined,
    waitingFileId: item.waitingFile.id
  });
  assert.equal(commit.status, 200, JSON.stringify(commit.payload).slice(0, 400));
}

// The account's ledger and statements as saved, without ids or clocks.
async function ledgerOf(workspace, accountName) {
  const [account] = await rows(workspace.db, "SELECT id FROM accounts WHERE account_name = ?", accountName);
  const entries = await rows(workspace.db, `
    SELECT t.transaction_date, t.post_date, t.description, t.amount_minor, t.entry_type, t.transfer_direction,
      t.bank_certification_status, c.name AS category, i.source_type, i.parser_key, i.status AS import_status
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    LEFT JOIN imports i ON i.id = t.import_id
    WHERE t.account_id = ?
    ORDER BY t.transaction_date, t.description, t.amount_minor
  `, account.id);
  const statements = await rows(workspace.db, `
    SELECT checkpoint_month, statement_start_date, statement_end_date, statement_balance_minor
    FROM account_balance_checkpoints WHERE account_id = ? ORDER BY checkpoint_month
  `, account.id);
  return { entries, statements };
}

const scenarios = [
  ["one share, statement first", [[STATEMENT, ACTIVITY]]],
  ["one share, activity first", [[ACTIVITY, STATEMENT]]],
  ["two shares, statement first", [[STATEMENT], [ACTIVITY]]],
  ["two shares, activity first", [[ACTIVITY], [STATEMENT]]]
];

test("the same two files in any order, in one share or two, queue and commit the same", async (t) => {
  const results = [];
  for (const [name, shares] of scenarios) {
    const workspace = await openWorkspace(t);
    for (const files of shares) {
      await share(workspace, files);
    }
    const { order, arrival } = await pullIntoQueue(workspace);
    for (const item of order) {
      await reviewAndCommit(workspace, item);
    }
    const remaining = (await (await workspace.fetch("/api/imports-page")).json()).importsPage.waitingFiles;
    results.push({ name, arrival, queue: order.map((item) => item.fileName), ledger: await ledgerOf(workspace, "UOB One"), remaining });
  }

  // They arrived in different orders (two shares list in arrival order)...
  assert.deepEqual(results[2].arrival, [STATEMENT[0], ACTIVITY[0]]);
  assert.deepEqual(results[3].arrival, [ACTIVITY[0], STATEMENT[0]]);
  // ...and every time the statement is reviewed before the activity...
  for (const result of results) {
    assert.deepEqual(result.queue, [STATEMENT[0], ACTIVITY[0]], result.name);
    assert.deepEqual(result.remaining, [], result.name);
  }
  // ...and the saved ledger and statement are the same.
  const [first, ...others] = results;
  assert.ok(first.ledger.entries.length >= 6, `expected the statement's and the export's rows, got ${first.ledger.entries.length}`);
  assert.equal(Math.abs(first.ledger.statements.find((row) => row.checkpoint_month === "2026-04")?.statement_balance_minor ?? 0), 929509);
  assert.deepEqual(first.ledger.statements.filter((row) => row.checkpoint_month === "2026-04"), [
    { checkpoint_month: "2026-04", statement_start_date: "2026-04-01", statement_end_date: "2026-04-30", statement_balance_minor: first.ledger.statements.find((row) => row.checkpoint_month === "2026-04")?.statement_balance_minor }
  ]);
  // The export's two May rows are in the ledger once each.
  const exportRows = first.ledger.entries
    .filter((row) => row.parser_key === "uob_current_transactions_xls")
    .map((row) => [row.transaction_date, row.amount_minor, row.entry_type]);
  assert.deepEqual(exportRows, [["2026-05-02", 45000, "transfer"], ["2026-05-04", 22808, "income"]]);
  assert.ok(first.ledger.entries.some((row) => row.parser_key === "uob_savings_pdf"));
  for (const other of others) {
    assert.deepEqual(other.ledger, first.ledger, other.name);
  }
});

// The OCBC export's records, each with its own (sometimes multi-line)
// description, in the file's own order.
function splitCsvRecords(text) {
  const lines = text.split(/\r?\n/);
  const headerEnd = lines.findIndex((line) => /^Transaction date,/.test(line)) + 1;
  const records = [];
  let footer = [];
  for (const line of lines.slice(headerEnd)) {
    if (/^\d{2}\/\d{2}\/\d{4},/.test(line)) {
      records.push([line]);
    } else if (records.length && !footer.length && line.trim()) {
      records.at(-1).push(line);
    } else {
      footer = [...footer, line];
    }
  }
  return { header: lines.slice(0, headerEnd), records, footer };
}

test("an activity CSV with its rows out of date order imports the same as the sorted file", async (t) => {
  const { header, records, footer } = splitCsvRecords(OCBC_CSV);
  assert.ok(records.length >= 10, `expected the export's records, got ${records.length}`);
  const byDate = (record) => record[0].slice(0, 10).split("/").reverse().join("-");
  const sorted = [...records].sort((left, right) => byDate(left).localeCompare(byDate(right)));
  // Out of order: interleave the halves, newest first.
  const shuffled = [...records].reverse().map((record, index, all) => all[(index * 5) % all.length]);
  assert.equal(new Set(shuffled).size, records.length);
  assert.notDeepEqual(shuffled.map(byDate), sorted.map(byDate));
  const write = (ordered) => new TextEncoder().encode([...header, ...ordered.flat(), ...footer].join("\n"));

  const ledgers = [];
  for (const ordered of [sorted, shuffled]) {
    const workspace = await openWorkspace(t);
    const account = await workspace.api("/api/accounts/create", { name: "OCBC 360 Account", kind: "bank", institution: "OCBC", currency: "SGD", openingBalanceMinor: 0, ownerPersonId: "person-tim" });
    assert.equal(account.status, 200, JSON.stringify(account.payload));
    await share(workspace, [[OCBC_CSV_NAME, write(ordered)]]);
    const { order } = await pullIntoQueue(workspace);
    assert.equal(order.length, 1);
    await reviewAndCommit(workspace, order[0]);
    ledgers.push(await ledgerOf(workspace, "OCBC 360 Account"));
  }
  assert.ok(ledgers[0].entries.length >= 10);
  assert.deepEqual(ledgers[1], ledgers[0]);
});
