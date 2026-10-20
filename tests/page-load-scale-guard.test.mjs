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

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const TRANSACTION_COUNT = 10_000;
const IMPORT_COUNT = 60;
const PREVIEW_ROWS_PER_IMPORT = 40;
const PREVIEW_ROW_BYTES = 4_000;
const DIAGNOSTIC_COUNT = 200;
// Writes cap a stored body at 20,000 characters (app-repository-error-diagnostics.ts).
const DIAGNOSTIC_BODY_BYTES = 20_000;

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

async function buildLargeHousehold(db) {
  const accountCount = (await db.prepare("SELECT COUNT(*) AS n FROM accounts").first()).n;
  const categoryId = (await db.prepare("SELECT id FROM categories ORDER BY id LIMIT 1").first()).id;
  const heavy = (bytes) => `substr(replace(hex(zeroblob(${Math.ceil(bytes / 2)})), '0', 'x'), 1, ${bytes})`;
  await db.prepare(`
    WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${IMPORT_COUNT})
    INSERT INTO imports (id, household_id, source_type, source_label, parser_key, imported_at, status)
    SELECT 'scale-import-' || i, 'household-1', CASE WHEN i % 2 = 0 THEN 'pdf' ELSE 'csv' END, 'Scale statement ' || i, 'generic_csv',
      strftime('%Y-%m-%dT%H:%M:%SZ', '2026-01-01', '+' || i || ' hours'), 'completed' FROM n
  `).run();
  await db.prepare(`
    WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${TRANSACTION_COUNT})
    INSERT INTO transactions (id, household_id, import_id, account_id, transaction_date, post_date, description, amount_minor, currency, entry_type, category_id)
    SELECT 'scale-txn-' || i, 'household-1', 'scale-import-' || (1 + i % ${IMPORT_COUNT}),
      a.id,
      date('2025-01-01', '+' || (i % 600) || ' days'), date('2025-01-01', '+' || ((i % 600) + 1) || ' days'),
      'SCALE MERCHANT ' || (i % 97) || ' SINGAPORE SG', 100 + (i % 9000), 'SGD', 'expense', '${categoryId}'
    FROM n JOIN (SELECT id, row_number() OVER (ORDER BY id) - 1 AS rn FROM accounts) a ON a.rn = n.i % ${accountCount}
  `).run();
  await db.prepare(`
    WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${IMPORT_COUNT * PREVIEW_ROWS_PER_IMPORT})
    INSERT INTO import_rows (id, import_id, row_index, raw_row_json, status)
    SELECT 'scale-row-' || i, 'scale-import-' || (1 + i % ${IMPORT_COUNT}), i, ${heavy(PREVIEW_ROW_BYTES)}, 'imported' FROM n
  `).run();
  await db.prepare(`
    WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${DIAGNOSTIC_COUNT})
    INSERT INTO app_error_diagnostics (id, household_id, source, action, error_message, response_excerpt, response_body, created_at)
    SELECT 'scale-diag-' || i, 'household-1', 'api', 'GET /api/imports-page', 'Scale failure ' || i, substr(${heavy(2000)}, 1, 2000), ${heavy(DIAGNOSTIC_BODY_BYTES)},
      strftime('%Y-%m-%d %H:%M:%S', '2026-01-01', '+' || i || ' minutes') FROM n
  `).run();
}

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
      measured = { body, ...counting.summary() };
    }
    samples.sort((left, right) => left - right);
    return { ...measured, medianMs: samples[2] };
  };

  const page = await measure("/api/splits-page?view=person-tim&month=2025-10");
  const dto = JSON.parse(page.body).splitsPage;
  const rows = await measure(`/api/splits/settled-rows?view=person-tim&checkpoint=${history.checkpointId}&group=${history.bigGroupId}`);
  console.log(`# splits-page: ${page.statements} round trips, ${page.rowsRead} rows read, ${page.body.length} response bytes, ${page.medianMs.toFixed(0)} ms node CPU`);
  console.log(`# settled-rows (287 rows): ${rows.statements} round trips, ${rows.rowsRead} rows read, ${rows.body.length} response bytes, ${rows.medianMs.toFixed(0)} ms node CPU`);

  assert.equal(dto.activity.filter((item) => item.settlementCheckpointId && !item.isArchived).length, 0, "no settled row in the page");
  assert.ok(dto.settlementCheckpoints.every((checkpoint) => !checkpoint.includedRecordIds), "no covered record ids in the page");
  assert.equal(dto.settledSections.reduce((sum, section) => sum + section.entryCount, 0), history.coveredTotal);
  assert.ok(page.body.length <= 30_000, `splits-page: ${page.body.length} response bytes (max 30,000; ~342,500 before)`);
  assert.ok(page.statements <= 24, `splits-page: ${page.statements} round trips (max 24)`);
  assert.equal(JSON.parse(rows.body).items.length, 287);
  assert.ok(rows.statements <= 8, `settled-rows: ${rows.statements} round trips (max 8)`);
  assert.ok(rows.medianMs <= MAX_MEDIAN_NODE_CPU_MS, `settled-rows: ${rows.medianMs.toFixed(0)} ms (max ${MAX_MEDIAN_NODE_CPU_MS})`);
});
