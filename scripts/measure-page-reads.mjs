// Server-side cost of every page read, measured through the real Worker
// (src/index.ts) against a real local D1 (docs/audits/speed-pass-2026-10.md).
//
//   node --import tsx scripts/measure-page-reads.mjs [options]
//
//   --db <dir>        a local D1 persistence directory to read (for example a
//                     local copy of a production export loaded with
//                     `wrangler d1 execute monies-map-test --config
//                     wrangler.test.jsonc --local --persist-to <dir> --file
//                     <export.sql>`); default: the demo household plus the
//                     10k-transaction scale household and settled split history
//   --runs <n>        warm runs per endpoint (default 21)
//   --latency <ms>    also time each endpoint with this wait added before every
//                     D1 round trip, the way production waits on the network
//                     (default 25; 0 skips it)
//   --cold <n>        cold samples per endpoint, each in a fresh Node process
//                     (a fresh isolate: schema check, empty caches; default 3)
//   --only a,b        endpoint names to measure
//   --explain         EXPLAIN QUERY PLAN for every distinct statement, flagging
//                     full scans of large tables
//   --out <file>      write the JSON report there
//
// Prints aggregates only: statement SQL shapes and table names, never row
// values or bound parameters, so it is safe to run on a copy of real data.
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import worker from "../src/index.ts";
import { todayInAppTimeZone } from "../src/lib/app-calendar.ts";
import { countingDatabase } from "../tests/support/d1-counting.mjs";
import { createSeededTemplate, openLocalD1 } from "../tests/support/d1-workspace.mjs";
import { buildLargeHousehold } from "../tests/support/large-household.mjs";
import { seedSettledSplitHistory } from "../tests/support/settled-split-history.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const RUNS = Number(option("runs", 21));
const LATENCY_MS = Number(option("latency", 25));
const COLD_SAMPLES = Number(option("cold", 3));
const ONLY = option("only", "")?.split(",").filter(Boolean) ?? [];
const EXPLAIN = args.includes("--explain");
const OUT = option("out", null);
const DB_DIR = option("db", null);
// Internal: measure one endpoint's first request in this fresh process.
const COLD_ONE = option("cold-one", null);

const config = JSON.parse(await readFile(path.join(root, "wrangler.test.jsonc"), "utf8"));
const LARGE_TABLES = new Set(["transactions", "split_expenses", "split_settlements", "audit_events", "import_rows", "app_error_diagnostics", "imports", "monthly_snapshots", "transaction_notes"]);

async function openDatabase() {
  if (DB_DIR) {
    const miniflare = openLocalD1(DB_DIR, { databaseId: config.d1_databases[0].database_id, compatibilityDate: config.compatibility_date });
    return { db: await miniflare.getD1Database("DB"), dispose: () => miniflare.dispose(), dir: DB_DIR };
  }
  const template = await createSeededTemplate();
  const dir = await mkdtemp(path.join(os.tmpdir(), "monies-map-measure-"));
  await cp(template.persistTo, dir, { recursive: true });
  await template.dispose();
  const miniflare = openLocalD1(dir, { databaseId: config.d1_databases[0].database_id, compatibilityDate: config.compatibility_date });
  const db = await miniflare.getD1Database("DB");
  await buildLargeHousehold(db);
  const history = await seedSettledSplitHistory(db);
  return { db, history, dir, dispose: async () => { await miniflare.dispose(); await rm(dir, { recursive: true, force: true }); } };
}

function stubAi() {
  return {
    async run() {
      return { choices: [{ message: { role: "assistant", content: JSON.stringify({ action: "cannot_help", note: "x" }) } }] };
    }
  };
}

// The endpoints a screen reads, for the household and each person view.
async function listEndpoints(db, history) {
  const env = { DB: db, ...config.vars };
  const shellResponse = await worker.fetch(new Request("http://127.0.0.1/api/app-shell?view=household"), env);
  const shell = await shellResponse.json();
  const months = shell.trackedMonths;
  // The month the app opens on: this month when it is tracked (a household
  // with plans for later months still opens on today's), else the latest.
  const today = todayInAppTimeZone().slice(0, 7);
  const month = months.includes(today) ? today : months.at(-1);
  const upTo = months.filter((candidate) => candidate <= month);
  const start = upTo[Math.max(0, upTo.length - 12)];
  const people = shell.household.people.map((person) => person.id);
  const person = people[0];
  const views = [["household", "household"], ["person", person]];
  const endpoints = [
    ["app-shell", "GET", `/api/app-shell?view=household&month=${month}&scope=direct_plus_shared`],
    ["reference-data", "GET", "/api/reference-data"]
  ];
  for (const [label, view] of views) {
    endpoints.push(
      [`summary-page ${label}`, "GET", `/api/summary-page?view=${view}&month=${month}&scope=direct_plus_shared&summary_start=${start}&summary_end=${month}`],
      [`summary-account-pills ${label}`, "GET", `/api/summary-account-pills?view=${view}`],
      [`month-page ${label}`, "GET", `/api/month-page?view=${view}&month=${month}&scope=direct_plus_shared`],
      [`entries-page ${label}`, "GET", `/api/entries-page?view=${view}&month=${month}`],
      [`splits-page ${label}`, "GET", `/api/splits-page?view=${view}&month=${month}`],
      [`reminders ${label}`, "GET", `/api/reminders?view=${view}`]
    );
  }
  endpoints.push(
    ["entries-shell", "GET", `/api/entries-shell?view=household&month=${month}`],
    ["imports-page", "GET", "/api/imports-page"],
    ["settings-page", "GET", "/api/settings-page"],
    ["ledger-checkup", "GET", "/api/ledger-checkup?view=household"],
    ["skew-candidates", "GET", `/api/skew-candidates?view=household&month=${month}&scope=direct_plus_shared`],
    ["ask habits", "GET", "/api/ask/habits"],
    ["ask done", "GET", "/api/ask/done"],
    ["provider-status", "GET", "/api/ai-assist/provider-status"],
    ["ask turn (stub AI)", "POST", "/api/ask/turn", { text: "what did I spend on food", viewId: "household", scope: "direct_plus_shared", month, page: "ask" }, { ai: true }]
  );
  if (history) {
    endpoints.push(["splits settled-rows (287)", "GET", `/api/splits/settled-rows?view=${person}&checkpoint=${history.checkpointId}&group=${history.bigGroupId}`]);
  }
  return { endpoints: endpoints.filter(([name]) => !ONLY.length || ONLY.some((wanted) => name.startsWith(wanted))), month, views: views.length };
}

async function callOnce(endpoint, database, { aiStub } = {}) {
  const [, method, apiPath, body, flags] = endpoint;
  const env = { DB: database, ...config.vars, ...(flags?.ai && aiStub !== false ? { AI: stubAi(), AI_ASSIST_ENABLED: "true" } : {}) };
  const request = new Request(`http://127.0.0.1${apiPath}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const startedAt = performance.now();
  const cpuBefore = process.cpuUsage();
  const response = await worker.fetch(request, env);
  const buffer = Buffer.from(await response.arrayBuffer());
  const cpu = process.cpuUsage(cpuBefore);
  const wallMs = performance.now() - startedAt;
  if (!response.ok) {
    throw new Error(`${endpoint[0]} answered ${response.status}`);
  }
  const app = /app;dur=(\d+(?:\.\d+)?)/.exec(response.headers.get("server-timing") ?? "")?.[1];
  return { wallMs, cpuMs: (cpu.user + cpu.system) / 1000, bytes: buffer.length, gzipBytes: gzipSync(buffer).length, appMs: app ? Number(app) : null };
}

const percentile = (values, fraction) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
};
const round = (value) => Math.round(value * 10) / 10;

async function explainCalls(db, calls) {
  const seen = new Map();
  for (const call of calls) {
    if (call.kind === "batch" || !/^\s*(SELECT|WITH)/i.test(call.sql) || seen.has(call.sql)) continue;
    try {
      const plan = await db.prepare(`EXPLAIN QUERY PLAN ${call.sql}`).bind(...(call.params ?? [])).all();
      const details = plan.results.map((row) => row.detail);
      const scans = details.filter((detail) => /^SCAN /.test(detail) && !/USING (COVERING )?INDEX|CONSTANT ROW|SUBQUERY|CTE|json_each/i.test(detail))
        .map((detail) => detail.replace(/^SCAN /, "").split(" ")[0])
        .filter((table) => LARGE_TABLES.has(table));
      const tempSorts = details.filter((detail) => /USE TEMP B-TREE/.test(detail)).length;
      seen.set(call.sql, { sql: call.sql.slice(0, 160), fullScans: scans, tempSorts, rowsRead: call.rowsRead, rows: call.rows });
    } catch (error) {
      seen.set(call.sql, { sql: call.sql.slice(0, 160), error: String(error?.message ?? error).slice(0, 120) });
    }
  }
  return [...seen.values()];
}

async function measureWarm(db, endpoint) {
  const counting = countingDatabase(db);
  await callOnce(endpoint, counting.db); // the schema check and the first JIT
  const samples = [];
  let last;
  for (let run = 0; run < RUNS; run += 1) {
    counting.reset();
    const sample = await callOnce(endpoint, counting.db);
    samples.push(sample);
    last = { ...counting.summary(), calls: [...counting.calls] };
  }
  // With a wait before every round trip, overlapping reads are told apart
  // from sequential ones reliably, so the waves come from these runs.
  const latency = [];
  let latencyWaves = null;
  if (LATENCY_MS > 0) {
    const slow = countingDatabase(db, { latencyMs: LATENCY_MS });
    await callOnce(endpoint, slow.db);
    for (let run = 0; run < Math.min(RUNS, 7); run += 1) {
      slow.reset();
      latency.push((await callOnce(endpoint, slow.db)).wallMs);
      latencyWaves = slow.summary().waves;
    }
  }
  // Statements repeated within one request (same SQL text run more than once).
  const counts = new Map();
  for (const call of last.calls) counts.set(call.sql, (counts.get(call.sql) ?? 0) + 1);
  const repeated = [...counts.entries()].filter(([, count]) => count > 1).map(([sql, count]) => ({ count, sql: sql.slice(0, 140) }));
  return {
    statements: last.statements,
    waves: latencyWaves ?? last.waves,
    sqlStatements: last.sqlStatements,
    rowsRead: last.rowsRead + last.batchRowsRead,
    rowBytes: last.rowBytes + last.batchBytes,
    bytes: samples.at(-1).bytes,
    gzipBytes: samples.at(-1).gzipBytes,
    cpuP50: round(percentile(samples.map((sample) => sample.cpuMs), 0.5)),
    cpuP95: round(percentile(samples.map((sample) => sample.cpuMs), 0.95)),
    wallP50: round(percentile(samples.map((sample) => sample.wallMs), 0.5)),
    wallP95: round(percentile(samples.map((sample) => sample.wallMs), 0.95)),
    latencyWallP50: latency.length ? round(percentile(latency, 0.5)) : null,
    repeated,
    topReads: [...last.calls].sort((left, right) => right.rowsRead - left.rowsRead).slice(0, 5).map((call) => ({ rowsRead: call.rowsRead, rows: call.rows, bytes: call.bytes, sql: call.sql.slice(0, 160) })),
    explain: EXPLAIN ? await explainCalls(db, last.calls) : undefined
  };
}

function measureCold(endpoint) {
  const endpointName = endpoint[0];
  const samples = [];
  for (let sample = 0; sample < COLD_SAMPLES; sample += 1) {
    const child = spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(import.meta.url), "--cold-one", endpointName, "--db", activeDir], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, MEASURE_LATENCY_MS: String(LATENCY_MS), MEASURE_ENDPOINT: JSON.stringify(endpoint) }
    });
    const line = child.stdout.split("\n").find((text) => text.startsWith("COLD "));
    if (!line) throw new Error(`cold ${endpointName} failed: ${child.stderr.slice(-800)}`);
    samples.push(JSON.parse(line.slice(5)));
  }
  const median = (key) => round(percentile(samples.map((sample) => sample[key]), 0.5));
  return { statements: samples[0].statements, waves: samples[0].waves, wallP50: median("wallMs"), cpuP50: median("cpuMs"), latencyWallP50: median("latencyWallMs") };
}

let activeDir = DB_DIR;

if (COLD_ONE) {
  // One fresh process: the first request is the cold one.
  const { db, dispose } = await openDatabase();
  const endpoint = JSON.parse(process.env.MEASURE_ENDPOINT);
  const latency = Number(process.env.MEASURE_LATENCY_MS ?? 0);
  const counting = countingDatabase(db, { latencyMs: latency });
  const sample = await callOnce(endpoint, counting.db);
  const summary = counting.summary();
  console.log(`COLD ${JSON.stringify({ statements: summary.statements, waves: summary.waves, wallMs: sample.wallMs, cpuMs: sample.cpuMs, latencyWallMs: latency > 0 ? sample.wallMs : null })}`);
  await dispose();
  process.exit(0);
}

const opened = await openDatabase();
activeDir = opened.dir;
const { endpoints, month } = await listEndpoints(opened.db, opened.history);
const sizes = await opened.db.prepare("SELECT (SELECT COUNT(*) FROM transactions) AS transactions, (SELECT COUNT(*) FROM split_expenses) AS splitExpenses, (SELECT COUNT(*) FROM imports) AS imports, (SELECT COUNT(*) FROM audit_events) AS auditEvents").first();
console.error(`# database: ${JSON.stringify(sizes)}, month ${month}, ${endpoints.length} endpoints, ${RUNS} warm runs, latency ${LATENCY_MS} ms`);

const results = [];
for (const endpoint of endpoints) {
  const warm = await measureWarm(opened.db, endpoint);
  const cold = COLD_SAMPLES > 0 ? measureCold(endpoint) : null;
  results.push({ name: endpoint[0], warm, cold });
  console.error(`# ${endpoint[0]}: ${warm.statements} trips (${warm.waves} waves), ${warm.rowsRead} rows read, ${warm.bytes} B (${warm.gzipBytes} gz), cpu ${warm.cpuP50}/${warm.cpuP95} ms, wall ${warm.wallP50}/${warm.wallP95} ms, @${LATENCY_MS}ms ${warm.latencyWallP50} ms; cold ${cold ? `${cold.statements} trips ${cold.wallP50} ms (@lat ${cold.latencyWallP50})` : "-"}`);
}

const header = "| Endpoint | Trips (waves) | Rows read | Row bytes | Response B (gzip) | CPU p50/p95 ms | Wall p50/p95 ms | Wall @" + LATENCY_MS + "ms/trip | Cold trips | Cold wall ms (@lat) |";
console.log(header);
console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
for (const { name, warm, cold } of results) {
  console.log(`| ${name} | ${warm.statements} (${warm.waves}) | ${warm.rowsRead} | ${warm.rowBytes} | ${warm.bytes} (${warm.gzipBytes}) | ${warm.cpuP50}/${warm.cpuP95} | ${warm.wallP50}/${warm.wallP95} | ${warm.latencyWallP50 ?? "-"} | ${cold?.statements ?? "-"} | ${cold ? `${cold.wallP50} (${cold.latencyWallP50 ?? "-"})` : "-"} |`);
}
if (OUT) {
  await writeFile(OUT, `${JSON.stringify({ revision: spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).stdout.trim(), database: sizes, month, runs: RUNS, latencyMs: LATENCY_MS, results }, null, 2)}\n`);
}
await opened.dispose();
