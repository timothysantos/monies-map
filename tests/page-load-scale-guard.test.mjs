// Slow-path regression guard for the pages that were slow in production
// (Imports ~4-52 s, Settings ~4 s, Summary account pills ~2-3 s). The
// household is built at the size and shape that hurt: 10,000 imported
// transactions, 60 imports that each kept a large stored preview, and 200
// saved error diagnostics with full-size (20 KB) response bodies. A page load must not
// touch those heavy tables, must stay within a fixed number of D1 round trips
// and rows, and must not grow its payload. A cold isolate is pinned
// separately in cold-start-statement-budget.test.mjs.
//
// Bounds are about 2x what the pages measure today, so only a real regression
// (an N+1, a whole-table read, a blob column in a page query) trips them.
import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.ts";
import { countingDatabase } from "./support/d1-counting.mjs";
import { createSeededTemplate, openSeededDatabase } from "./support/d1-workspace.mjs";
import { seedSettledSplitHistory } from "./support/settled-split-history.mjs";
import {
  buildLargeHousehold,
  DIAGNOSTIC_BODY_BYTES,
  DIAGNOSTIC_COUNT,
  IMPORT_COUNT,
  PREVIEW_ROW_BYTES,
  PREVIEW_ROWS_PER_IMPORT,
  TRANSACTION_COUNT
} from "./support/large-household.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

// Rows and bytes a page may read: the fixture's heavy tables hold ~50 MB, so
// any bound far below that proves they are not read.
const PAGES = [
  { name: "imports-page", path: "/api/imports-page", maxStatements: 22, maxRowsRead: 250_000, maxRowBytes: 400_000, maxResponseBytes: 60_000 },
  // Settings shows the latest 50 diagnostics with their bodies (50 x 20 KB), the one heavy read a page may make.
  { name: "settings-page", path: "/api/settings-page", maxStatements: 34, maxRowsRead: 250_000, maxRowBytes: 1_700_000, maxResponseBytes: 1_700_000, mayReadDiagnostics: true },
  { name: "summary-account-pills", path: "/api/summary-account-pills?view=household", maxStatements: 20, maxRowsRead: 250_000, maxRowBytes: 1_100_000, maxResponseBytes: 12_000 }
];
// A handler that does a per-row JS loop or per-import query shows up as node
// CPU long before it shows up in production; this is a catastrophe bound.
const MAX_MEDIAN_NODE_CPU_MS = 600;

test("a 10k-transaction household with heavy stored previews and diagnostics keeps page loads bounded", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  await buildLargeHousehold(db);
  const sizes = await db.prepare("SELECT (SELECT COUNT(*) FROM transactions) AS txns, (SELECT SUM(length(response_body)) FROM app_error_diagnostics) AS diag, (SELECT SUM(length(raw_row_json)) FROM import_rows) AS preview").first();
  assert.ok(sizes.txns >= TRANSACTION_COUNT);
  assert.ok(sizes.diag >= DIAGNOSTIC_COUNT * DIAGNOSTIC_BODY_BYTES, "fixture holds the large diagnostics bodies");
  assert.ok(sizes.preview >= IMPORT_COUNT * PREVIEW_ROWS_PER_IMPORT * PREVIEW_ROW_BYTES, "fixture holds the large stored previews");

  const results = [];
  for (const page of PAGES) {
    const counting = countingDatabase(db);
    const env = { DB: counting.db, ...template.config.vars };
    const call = async () => {
      const response = await worker.fetch(new Request(`http://127.0.0.1${page.path}`), env);
      const body = await response.text();
      assert.equal(response.status, 200, `${page.name}: ${body.slice(0, 200)}`);
      return body.length;
    };
    await call(); // warms the isolate: the cold path is pinned elsewhere
    const cpuSamples = [];
    let measured;
    for (let run = 0; run < 5; run += 1) {
      counting.reset();
      const before = process.cpuUsage();
      const responseBytes = await call();
      const used = process.cpuUsage(before);
      cpuSamples.push((used.user + used.system) / 1000);
      measured = { responseBytes, ...counting.summary(), calls: [...counting.calls] };
    }
    cpuSamples.sort((left, right) => left - right);
    results.push({ page, measured, cpuMedianMs: cpuSamples[2] });
  }

  for (const { page, measured, cpuMedianMs } of results) {
    console.log(`# ${page.name}: ${measured.statements} round trips, ${measured.rowsRead} rows read, ${measured.rowBytes} row bytes, ${measured.responseBytes} response bytes, ${cpuMedianMs.toFixed(0)} ms node CPU`);
    const heavyReads = measured.calls.filter((call) => /response_body|raw_row_json|app_error_diagnostics|FROM import_rows/.test(call.sql)
      && !(page.mayReadDiagnostics && /FROM app_error_diagnostics/.test(call.sql)));
    assert.deepEqual(heavyReads.map((call) => call.sql.slice(0, 90)), [], `${page.name} must not read stored previews or diagnostics`);
    assert.ok(measured.statements <= page.maxStatements, `${page.name}: ${measured.statements} round trips (max ${page.maxStatements})`);
    assert.ok(measured.rowsRead <= page.maxRowsRead, `${page.name}: ${measured.rowsRead} rows read (max ${page.maxRowsRead})`);
    assert.ok(measured.rowBytes <= page.maxRowBytes, `${page.name}: ${measured.rowBytes} row bytes (max ${page.maxRowBytes})`);
    assert.ok(measured.responseBytes <= page.maxResponseBytes, `${page.name}: ${measured.responseBytes} response bytes (max ${page.maxResponseBytes})`);
    assert.ok(cpuMedianMs <= MAX_MEDIAN_NODE_CPU_MS, `${page.name}: median node CPU ${cpuMedianMs.toFixed(0)} ms (max ${MAX_MEDIAN_NODE_CPU_MS})`);
  }
});

// The Splits page on the same 10k household plus production's settled
// history (352 records one settlement covered, 287 in one group): the page
// must never send a settled row (they are ~1 kB each and load when a section
// opens), its settled part is a few summaries and counts, and the lazy rows
// of the largest section stay a bounded, quick read.
test("the Splits page never sends settled rows; a settled section's rows are one bounded read", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  await buildLargeHousehold(db);
  const history = await seedSettledSplitHistory(db);
  const counting = countingDatabase(db);
  const env = { DB: counting.db, ...template.config.vars };
  const call = async (path) => {
    const response = await worker.fetch(new Request(`http://127.0.0.1${path}`), env);
    const body = await response.text();
    assert.equal(response.status, 200, `${path}: ${body.slice(0, 200)}`);
    return body;
  };
  const measure = async (path) => {
    await call(path);
    // Node CPU, as for the other pages: wall time swings with the machine's load.
    const samples = [];
    let measured;
    for (let run = 0; run < 5; run += 1) {
      counting.reset();
      const before = process.cpuUsage();
      const body = await call(path);
      const used = process.cpuUsage(before);
      samples.push((used.user + used.system) / 1000);
      measured = { body, ...counting.summary(), calls: [...counting.calls] };
    }
    samples.sort((left, right) => left - right);
    return { ...measured, medianMs: samples[2] };
  };

  const page = await measure("/api/splits-page?view=person-tim&month=2025-10");
  const dto = JSON.parse(page.body).splitsPage;
  const rows = await measure(`/api/splits/settled-rows?view=person-tim&checkpoint=${history.checkpointId}&group=${history.bigGroupId}`);
  console.log(`# splits-page: ${page.statements} round trips, ${page.rowsRead} rows read, ${page.body.length} response bytes, ${page.medianMs.toFixed(0)} ms node CPU`);
  // The bank-match suggestion scan: the records it reads (unlinked, and no
  // settlement checkpoint covers them) and the imported rows in their date
  // windows.
  const scanRecords = page.calls.filter((call) => /FROM split_(expenses|settlements)\b.*\.linked_transaction_id IS NULL AND NOT split_(expenses|settlements)\.id IN/.test(call.sql));
  const scanRows = page.calls.filter((call) => /FROM transactions INNER JOIN imports .*split_settlement_checkpoint_matches/.test(call.sql));
  console.log(`# match scan: ${scanRecords.reduce((sum, call) => sum + call.rows, 0)} records, ${scanRows.reduce((sum, call) => sum + call.rows, 0)} imported rows (${scanRows.reduce((sum, call) => sum + call.rowsRead, 0)} read, ${scanRows.reduce((sum, call) => sum + call.bytes, 0)} B)`);
  console.log(`# settled-rows (287 rows): ${rows.statements} round trips, ${rows.rowsRead} rows read, ${rows.body.length} response bytes, ${rows.medianMs.toFixed(0)} ms node CPU`);

  assert.equal(dto.activity.filter((item) => item.settlementCheckpointId && !item.isArchived).length, 0, "no settled row in the page");
  assert.ok(dto.settlementCheckpoints.every((checkpoint) => !checkpoint.includedRecordIds), "no covered record ids in the page");
  assert.equal(dto.settledSections.reduce((sum, section) => sum + section.entryCount, 0), history.coveredTotal);
  assert.ok(page.body.length <= 30_000, `splits-page: ${page.body.length} response bytes (max 30,000; ~342,500 before)`);
  assert.ok(page.statements <= 24, `splits-page: ${page.statements} round trips (max 24)`);
  // A settled record is never suggested a bank row, so the scan neither
  // reads the 352 settled records nor the imported rows around their dates
  // (before: 181 records and 4,999 rows, 20,220 read, 1.08 MB; ~2.1 s of a
  // 2.3 s handler). The fixture has 5 open unlinked records plus the demo's.
  assert.equal(scanRecords.length, 2, "the scan reads open expenses and open settle-ups, one query each");
  assert.equal(scanRows.length, 1, "one candidate query");
  assert.ok(scanRecords.reduce((sum, call) => sum + call.rows, 0) <= 20, "the scan reads open records only");
  assert.ok(scanRows[0].rows <= 2_000, `match scan: ${scanRows[0].rows} imported rows (max 2,000; 4,999 before)`);
  assert.ok(scanRows[0].rowsRead <= 8_000, `match scan: ${scanRows[0].rowsRead} rows read (max 8,000; 20,220 before)`);
  assert.ok(page.rowsRead <= 110_000, `splits-page: ${page.rowsRead} rows read (max 110,000)`);
  assert.ok(page.medianMs <= MAX_MEDIAN_NODE_CPU_MS, `splits-page: median node CPU ${page.medianMs.toFixed(0)} ms (max ${MAX_MEDIAN_NODE_CPU_MS}; ~2,300 before)`);
  assert.equal(JSON.parse(rows.body).items.length, 287);
  assert.ok(rows.statements <= 8, `settled-rows: ${rows.statements} round trips (max 8)`);
  assert.ok(rows.medianMs <= MAX_MEDIAN_NODE_CPU_MS, `settled-rows: ${rows.medianMs.toFixed(0)} ms (max ${MAX_MEDIAN_NODE_CPU_MS})`);
});
