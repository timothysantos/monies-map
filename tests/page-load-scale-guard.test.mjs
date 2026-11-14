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
import { buildUsuallySharedDto } from "../src/domain/pages/usually-shared.ts";
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
  { name: "summary-account-pills", path: "/api/summary-account-pills?view=household", maxStatements: 20, maxRowsRead: 250_000, maxRowBytes: 1_100_000, maxResponseBytes: 12_000 },
  // The first screen and the two busiest pages (speed pass 2026-10): Summary
  // made 69 round trips (a plan read per month) and moved 5.3 MB of entry
  // rows for a year of totals; it reads a year of entries without their
  // display columns now.
  { name: "summary-page", path: "/api/summary-page?view=household&month=2026-08&scope=direct_plus_shared&summary_start=2025-09&summary_end=2026-08", maxStatements: 16, maxRowsRead: 45_000, maxRowBytes: 3_500_000, maxResponseBytes: 12_000 },
  { name: "month-page", path: "/api/month-page?view=household&month=2026-08&scope=direct_plus_shared", maxStatements: 20, maxRowsRead: 30_000, maxRowBytes: 2_200_000, maxResponseBytes: 240_000 },
  { name: "entries-page", path: "/api/entries-page?view=household&month=2026-08", maxStatements: 8, maxRowsRead: 10_000, maxRowBytes: 450_000, maxResponseBytes: 240_000 },
  // Subscriptions and bills (2026-11): 26 months of expenses grouped in SQL
  // by description and month, read in one step (measured 4 round trips,
  // 40,200 rows, 612 kB of rows, ~40 ms node CPU for either view).
  { name: "repeating-charges household", path: "/api/repeating-charges?view=household", maxStatements: 8, maxRowsRead: 80_000, maxRowBytes: 1_300_000, maxResponseBytes: 12_000 },
  { name: "repeating-charges person", path: "/api/repeating-charges?view=person-tim&scope=direct_plus_shared", maxStatements: 8, maxRowsRead: 80_000, maxRowBytes: 1_300_000, maxResponseBytes: 12_000 },
  // What changed this month (2026-11): the view's entries of 7 months in the
  // one date-window read Ask's "What changed?" uses; optional, read after the
  // first screen (measured 6 round trips, 11,155 rows, 1.7 MB of rows, ~45 ms node CPU).
  { name: "summary-changed household", path: "/api/summary-changed?view=household", maxStatements: 12, maxRowsRead: 25_000, maxRowBytes: 3_500_000, maxResponseBytes: 40_000 },
  { name: "summary-changed person", path: "/api/summary-changed?view=person-tim&scope=direct_plus_shared", maxStatements: 12, maxRowsRead: 25_000, maxRowBytes: 3_500_000, maxResponseBytes: 40_000 },
  // Miles and cashback (2026-11): the credit card entries of the last four
  // months by date, in one step with the rules and the people.
  { name: "card-rewards household", path: "/api/card-rewards?view=household", maxStatements: 8, maxRowsRead: 20_000, maxRowBytes: 450_000, maxResponseBytes: 12_000 },
  { name: "card-rewards rules", path: "/api/card-rewards/rules", maxStatements: 8, maxRowsRead: 20_000, maxRowBytes: 450_000, maxResponseBytes: 12_000 }
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

// Production waits a network trip for every D1 round trip a request makes
// one after another (about 100 to 180 ms each, measured from the production
// logs: Entries ~0.9 s over 5 sequential trips), so the length of that chain
// is what a page costs (docs/audits/speed-pass-2026-10.md). Each page read
// here waits ROUND_TRIP_WAIT_MS before every D1 call, which makes the chain
// measurable: `waves` is its length. The bounds are the measured value plus
// one step; before the speed pass Summary waited on 9 steps (69 trips),
// Month on 15, the pills on 8, Settings on 9, Imports on 7 and an Ask turn
// on 12 before its model call. Rows read pin the whole-table reads away
// (every page read ~24,000 rows for its month list alone).
const ROUND_TRIP_WAIT_MS = 30;
// summary-page person: 17 round trips since 2026-11-14 (one grouped read of the
// split groups' open balances for the Splits tile, run beside the others in the
// same wave, so the chain is no longer; measured 17 against a limit of 16).
const PAGE_CHAINS = [
  { name: "app-shell", path: "/api/app-shell?view=household", maxStatements: 4, maxWaves: 2, maxRowsRead: 2_000 },
  { name: "summary-page household", path: "/api/summary-page?view=household&month=2026-08&scope=direct_plus_shared&summary_start=2025-09&summary_end=2026-08", maxStatements: 16, maxWaves: 3, maxRowsRead: 45_000 },
  { name: "summary-page person", path: "/api/summary-page?view=person-tim&month=2026-08&scope=direct_plus_shared&summary_start=2025-09&summary_end=2026-08", maxStatements: 17, maxWaves: 3, maxRowsRead: 45_000 },
  { name: "summary-account-pills", path: "/api/summary-account-pills?view=household", maxStatements: 11, maxWaves: 2, maxRowsRead: 100_000 },
  { name: "month-page", path: "/api/month-page?view=person-tim&month=2026-08&scope=direct_plus_shared", maxStatements: 20, maxWaves: 3, maxRowsRead: 30_000 },
  { name: "entries-page", path: "/api/entries-page?view=household&month=2026-08", maxStatements: 8, maxWaves: 3, maxRowsRead: 10_000 },
  { name: "splits-page", path: "/api/splits-page?view=person-tim&month=2026-08", maxStatements: 24, maxWaves: 5, maxRowsRead: 70_000 },
  { name: "reminders", path: "/api/reminders?view=household", maxStatements: 15, maxWaves: 4, maxRowsRead: 40_000 },
  { name: "repeating-charges household", path: "/api/repeating-charges?view=household", maxStatements: 8, maxWaves: 2, maxRowsRead: 80_000 },
  { name: "repeating-charges person", path: "/api/repeating-charges?view=person-tim", maxStatements: 8, maxWaves: 2, maxRowsRead: 80_000 },
  { name: "card-rewards household", path: "/api/card-rewards?view=household", maxStatements: 8, maxWaves: 2, maxRowsRead: 20_000 },
  { name: "imports-page", path: "/api/imports-page", maxStatements: 15, maxWaves: 4, maxRowsRead: 250_000 },
  { name: "settings-page", path: "/api/settings-page", maxStatements: 21, maxWaves: 2, maxRowsRead: 250_000 },
  { name: "ask turn", path: "/api/ask/turn", body: { text: "what did I spend on food", viewId: "household", scope: "direct_plus_shared", month: "2026-08", page: "ask" }, maxStatements: 16, maxWaves: 3, maxRowsRead: 5_000 }
];

test("every page read on the 10k household waits on a short chain of D1 round trips", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  await buildLargeHousehold(db);
  const counting = countingDatabase(db, { latencyMs: ROUND_TRIP_WAIT_MS });
  // A model stand-in, so the Ask turn reads its whole context.
  const ai = { run: async () => ({ choices: [{ message: { role: "assistant", content: JSON.stringify({ action: "cannot_help", note: "x" }) } }] }) };
  const env = { DB: counting.db, ...template.config.vars, AI: ai, AI_ASSIST_ENABLED: "true" };
  const call = async (page) => {
    const response = await worker.fetch(new Request(`http://127.0.0.1${page.path}`, page.body
      ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(page.body) }
      : undefined), env);
    const text = await response.text();
    assert.equal(response.status, 200, `${page.name}: ${text.slice(0, 200)}`);
  };

  const failures = [];
  for (const page of PAGE_CHAINS) {
    await call(page); // the cold path is pinned in cold-start-statement-budget.test.mjs
    counting.reset();
    await call(page);
    const measured = counting.summary();
    console.log(`# ${page.name}: ${measured.statements} round trips in ${measured.waves} sequential steps, ${measured.rowsRead + measured.batchRowsRead} rows read`);
    if (measured.statements > page.maxStatements) failures.push(`${page.name}: ${measured.statements} round trips (max ${page.maxStatements})`);
    if (measured.waves > page.maxWaves) failures.push(`${page.name}: ${measured.waves} sequential steps (max ${page.maxWaves})`);
    if (measured.rowsRead + measured.batchRowsRead > page.maxRowsRead) failures.push(`${page.name}: ${measured.rowsRead + measured.batchRowsRead} rows read (max ${page.maxRowsRead})`);
  }
  assert.deepEqual(failures, []);
});

// The trip view (DOMAIN.md "Trip or Event") on the 10k household: a trip
// holding 200 entries spread over a year, and every trip together (the
// Trips & events sheet), are bounded by the link table: three sequential
// steps, a few round trips, and the rows of the trip's entries only.
test("the trip view and the Trips & events totals read a bounded chain on the 10k household", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  await buildLargeHousehold(db);
  await db.prepare("INSERT INTO trip_events (id, household_id, name, icon_key, start_date, end_date) VALUES ('trip-scale', 'household-1', 'Big move', 'house', '2025-09-01', '2026-08-31')").run();
  await db.prepare(`
    INSERT INTO trip_event_entries (transaction_id, trip_event_id, household_id)
    SELECT id, 'trip-scale', 'household-1' FROM transactions
    WHERE household_id = 'household-1' AND transaction_date BETWEEN '2025-09-01' AND '2026-08-31' AND entry_type = 'expense'
    ORDER BY id LIMIT 200
  `).run();
  const counting = countingDatabase(db, { latencyMs: ROUND_TRIP_WAIT_MS });
  const env = { DB: counting.db, ...template.config.vars };
  const failures = [];
  for (const [name, path] of [["trip view", "/api/entries-page?view=household&month=2026-08&trip=trip-scale"], ["all trips", "/api/entries-page?view=person-tim&month=2026-08&trip=all"]]) {
    const call = async () => {
      const response = await worker.fetch(new Request(`http://127.0.0.1${path}`), env);
      const body = await response.json();
      assert.equal(response.status, 200, `${name}: ${JSON.stringify(body).slice(0, 200)}`);
      return body;
    };
    await call();
    counting.reset();
    const body = await call();
    const measured = counting.summary();
    console.log(`# ${name}: ${measured.statements} round trips in ${measured.waves} sequential steps, ${measured.rowsRead + measured.batchRowsRead} rows read`);
    assert.ok(body.monthPage.entries.length > 0 && body.monthPage.entries.length <= 200, `${name}: ${body.monthPage.entries.length} entries`);
    if (measured.statements > 10) failures.push(`${name}: ${measured.statements} round trips (max 10)`);
    if (measured.waves > 3) failures.push(`${name}: ${measured.waves} sequential steps (max 3)`);
    if (measured.rowsRead + measured.batchRowsRead > 12_000) failures.push(`${name}: ${measured.rowsRead + measured.batchRowsRead} rows read (max 12,000)`);
  }
  assert.deepEqual(failures, []);
});

// Trip suggestions (DOMAIN.md "Trip or Event", "Suggestions") on the 10k
// household: the review list of a month-long trip linked to a split group,
// "Booked before you went?" over the 12 months before it, and the Entries
// page while a trip with a currency is on today and 60 Apple Pay entries
// wait for the dashed chip. Each is bounded by dates and a LIMIT: a few
// round trips, two sequential steps (the page keeps its own), and never the
// whole table.
test("trip suggestions and the Entries page's dashed chip read a bounded chain on the 10k household", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  await buildLargeHousehold(db);
  const { todayInAppTimeZone } = await import("../src/lib/app-calendar.ts");
  const today = todayInAppTimeZone();
  const shift = (days) => {
    const date = new Date(`${today}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };
  const group = await db.prepare("SELECT id FROM split_groups WHERE household_id = 'household-1' LIMIT 1").first();
  await db.prepare("INSERT INTO trip_events (id, household_id, name, icon_key, start_date, end_date, currency, split_group_id) VALUES ('trip-busy', 'household-1', 'Long stay', 'plane', '2026-08-01', '2026-08-31', 'KRW', ?)").bind(group?.id ?? null).run();
  await db.prepare("INSERT INTO trip_events (id, household_id, name, icon_key, start_date, end_date, currency) VALUES ('trip-now', 'household-1', 'Seoul trip', 'plane', ?, ?, 'KRW')").bind(shift(-3), shift(3)).run();
  const account = await db.prepare("SELECT id FROM accounts WHERE household_id = 'household-1' LIMIT 1").first();
  await db.prepare(`
    WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 60)
    INSERT INTO transactions (id, household_id, account_id, transaction_date, description, amount_minor, entry_type, external_reference, original_currency, original_amount_minor)
    SELECT 'applepay-' || i, 'household-1', ?, ?, 'Seoul shop ' || i, 1000 + i, 'expense', 'shortcut:scale-' || i, CASE WHEN i % 2 = 0 THEN 'KRW' ELSE NULL END, 100000 * i FROM n
  `).bind(account.id, today).run();
  const counting = countingDatabase(db, { latencyMs: ROUND_TRIP_WAIT_MS });
  const env = { DB: counting.db, ...template.config.vars };
  const failures = [];
  const checks = [
    // A month of the 10k household with each entry's joins, plus the split
    // group's rows: about 12,300 rows today. A whole-table read would be 70k+.
    ["trip suggestions", "/api/trip-events/suggestions?tripEventId=trip-busy", { statements: 3, waves: 2, rows: 16_000 }],
    ["trip search", "/api/trip-events/search?tripEventId=trip-busy&q=shop", { statements: 2, waves: 2, rows: 12_000 }],
    ["entries-page with a trip on today", `/api/entries-page?view=household&month=${today.slice(0, 7)}`, { statements: 8, waves: 3, rows: 10_000 }]
  ];
  for (const [name, path, max] of checks) {
    const call = async () => {
      const response = await worker.fetch(new Request(`http://127.0.0.1${path}`), env);
      const body = await response.json();
      assert.equal(response.status, 200, `${name}: ${JSON.stringify(body).slice(0, 200)}`);
      return body;
    };
    await call();
    counting.reset();
    const body = await call();
    const measured = counting.summary();
    console.log(`# ${name}: ${measured.statements} round trips in ${measured.waves} sequential steps, ${measured.rowsRead + measured.batchRowsRead} rows read`);
    if (name === "trip suggestions") {
      assert.ok(body.groups.reduce((count, item) => count + item.entries.length, 0) <= 600, `${name}: listed too many`);
    }
    if (name.startsWith("entries-page")) {
      assert.equal(body.monthPage.entries.filter((entry) => entry.suggestedTripEventId === "trip-now").length, 30, `${name}: the won Apple Pay entries get the chip`);
    }
    if (measured.statements > max.statements) failures.push(`${name}: ${measured.statements} round trips (max ${max.statements})`);
    if (measured.waves > max.waves) failures.push(`${name}: ${measured.waves} sequential steps (max ${max.waves})`);
    if (measured.rowsRead + measured.batchRowsRead > max.rows) failures.push(`${name}: ${measured.rowsRead + measured.batchRowsRead} rows read (max ${max.rows})`);
  }
  assert.deepEqual(failures, []);
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

// "Usually shared, not on Splits yet" (DOMAIN.md "Usually Shared") on the 10k
// household: the sweep reads at most 500 candidate entries (last 90 days, on
// no split) and at most 6,000 history entries (the year before), each by a
// date window and a LIMIT, in a few round trips, and answers every candidate
// through the single-entry rule without a scan per candidate. The fixture's
// entries run to the end of August 2026, so the list is read as of 2026-08-24.
test("Usually shared reads a bounded window on the 10k household and stays within the CPU bound", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  await buildLargeHousehold(db);
  const counting = countingDatabase(db);
  await buildUsuallySharedDto(counting.db, { today: "2026-08-24" });
  const cpuSamples = [];
  let measured;
  let dto;
  for (let run = 0; run < 5; run += 1) {
    counting.reset();
    const before = process.cpuUsage();
    dto = await buildUsuallySharedDto(counting.db, { today: "2026-08-24" });
    const used = process.cpuUsage(before);
    cpuSamples.push((used.user + used.system) / 1000);
    measured = { ...counting.summary(), calls: [...counting.calls] };
  }
  cpuSamples.sort((left, right) => left - right);
  console.log(`# usually-shared: ${measured.statements} round trips, ${measured.rowsRead} rows read, ${measured.rowBytes} row bytes, ${cpuSamples[2].toFixed(0)} ms node CPU, ${dto.entryCount} entries in ${dto.shopCount} groups`);
  const entryReads = measured.calls.filter((call) => /FROM transactions/.test(call.sql));
  assert.equal(entryReads.length, 2, "one candidate read and one history read");
  assert.ok(entryReads.every((call) => /LIMIT \?/.test(call.sql) && /transaction_date BETWEEN/.test(call.sql)), "both reads are bounded by a date window and a LIMIT");
  assert.ok(entryReads[0].rows <= 500, `candidates: ${entryReads[0].rows} rows (max 500)`);
  assert.ok(entryReads[1].rows <= 6_000, `history: ${entryReads[1].rows} rows (max 6,000)`);
  assert.ok(measured.statements <= 6, `usually-shared: ${measured.statements} round trips (max 6)`);
  // Measured: 4 round trips, 77,323 rows read, 1.69 MB of rows, ~240 ms node CPU.
  assert.ok(measured.rowsRead <= 120_000, `usually-shared: ${measured.rowsRead} rows read (max 120,000)`);
  assert.ok(measured.rowBytes <= 2_100_000, `usually-shared: ${measured.rowBytes} row bytes (max 2,100,000)`);
  assert.ok(JSON.stringify(dto).length <= 400_000, "the answer stays small");
  assert.ok(cpuSamples[2] <= MAX_MEDIAN_NODE_CPU_MS, `usually-shared: median node CPU ${cpuSamples[2].toFixed(0)} ms (max ${MAX_MEDIAN_NODE_CPU_MS})`);
});
