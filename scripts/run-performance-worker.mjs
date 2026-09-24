// Starts the built client behind an isolated local test Worker for the
// performance harness. Owns its own temporary D1 persistence, seeds the demo
// fixture exactly once per cohort, and prints PERFORMANCE_READY_MARKER only
// after the fixture is proven. Playwright waits for that marker, not for
// /api/health, because health answers before the database is seeded.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import process from "node:process";

import { loadScaleFixture, readFixtureName } from "./load-performance-fixture.mjs";

const PERFORMANCE_READY_MARKER = "PERFORMANCE_FIXTURE_READY";
// Demo seed months for DEMO_SEED_MONTH=2026-05 (see reseed-contract E2E).
const EXPECTED_TRACKED_MONTHS = ["2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2026-05"];

const root = process.cwd();
const configPath = path.join(root, "wrangler.test.jsonc");
const config = JSON.parse(await readFile(configPath, "utf8"));
if (config.vars?.APP_ENVIRONMENT !== "test") {
  throw new Error("Performance harness refuses to seed data unless wrangler.test.jsonc declares APP_ENVIRONMENT=test.");
}
if (!existsSync(path.join(root, "dist", "index.html")) || !existsSync(path.join(root, "dist", ".vite", "manifest.json"))) {
  throw new Error("Built client is missing; run `npm run build` before the performance harness.");
}
const seedMonth = config.vars?.DEMO_SEED_MONTH;
if (seedMonth !== EXPECTED_TRACKED_MONTHS.at(-1)) {
  throw new Error(`Performance fixture expects DEMO_SEED_MONTH=${EXPECTED_TRACKED_MONTHS.at(-1)}, found ${seedMonth}.`);
}

// demo (default), scale-1k or scale-10k; scale rows load after the demo reseed.
const fixtureName = readFixtureName(process.env.PERFORMANCE_FIXTURE);

const port = Number(process.env.PERFORMANCE_PORT ?? 5191);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("PERFORMANCE_PORT must be a valid unprivileged port.");
await new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once("error", (error) => reject(new Error(`Dedicated performance port ${port} is not available; refusing to connect to or seed any existing server (${error.code}).`)));
  probe.listen(port, "127.0.0.1", () => probe.close((error) => error ? reject(error) : resolve()));
});

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "monies-map-performance-"));
const persistencePath = path.join(tempRoot, "wrangler-state");
const env = {
  ...process.env,
  WRANGLER_LOG_PATH: path.join(tempRoot, "wrangler.log"),
  WRANGLER_SEND_METRICS: "false"
};
const wrangler = path.join(root, "node_modules", ".bin", "wrangler");
const baseUrl = `http://127.0.0.1:${port}`;

let server = null;
let stopping = null;

// Idempotent teardown for every exit path. Wrangler runs in its own process
// group so the whole group (wrangler + workerd) can be reaped together.
function stop() {
  if (stopping) return stopping;
  stopping = (async () => {
    if (server?.pid && server.exitCode == null && server.signalCode == null) {
      const exited = new Promise((resolve) => server.once("exit", resolve));
      try { process.kill(-server.pid, "SIGTERM"); } catch {}
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
    }
    // workerd can outlive wrangler; always sweep the harness-owned group.
    if (server?.pid) {
      try { process.kill(-server.pid, "SIGKILL"); } catch {}
    }
    await rm(tempRoot, { recursive: true, force: true });
  })();
  return stopping;
}

async function fail(message) {
  await stop();
  console.error(message);
  process.exit(1);
}

process.once("SIGINT", () => void stop().finally(() => process.exit(130)));
process.once("SIGTERM", () => void stop().finally(() => process.exit(143)));
process.once("exit", () => {
  // Synchronous last resort when the event loop cannot run async cleanup.
  if (server?.pid) {
    try { process.kill(-server.pid, "SIGKILL"); } catch {}
  }
});

// If Playwright dies without signalling, this process is re-parented.
const parentPid = process.ppid;
const parentWatch = setInterval(() => {
  if (process.ppid !== parentPid) void stop().finally(() => process.exit(1));
}, 1000);
parentWatch.unref();

function runD1File(file, label) {
  const result = spawnSync(process.execPath, [wrangler, "d1", "execute", "monies-map-test", "--config", configPath, "--local", "--persist-to", persistencePath, "--file", file], {
    cwd: root,
    env,
    encoding: "utf8",
    stdio: ["ignore", "ignore", "inherit"]
  });
  return result.status === 0 ? null : `Isolated performance D1 ${label} failed with status ${result.status ?? "unknown"}.`;
}

const schemaError = runD1File(path.join(root, "schema.sql"), "schema setup");
if (schemaError) await fail(schemaError);
const preflightError = runD1File(path.join(root, "scripts", "performance-preflight.sql"), "preflight");
if (preflightError) await fail(preflightError);

server = spawn(process.execPath, [wrangler, "dev", "--config", configPath, "--local", "--ip", "127.0.0.1", "--port", String(port), "--persist-to", persistencePath, "--log-level", "error", "--show-interactive-dev-session=false"], {
  cwd: root,
  env,
  stdio: ["ignore", "pipe", "pipe"],
  detached: true
});
let serverOutput = "";
const capture = (chunk, stream) => {
  const text = chunk.toString();
  stream.write(text);
  serverOutput = `${serverOutput}${text}`.slice(-8000);
};
server.stdout.on("data", (chunk) => capture(chunk, process.stdout));
server.stderr.on("data", (chunk) => capture(chunk, process.stderr));
const serverExit = new Promise((resolve) => server.once("exit", (code, signal) => resolve({ code, signal })));
server.once("exit", () => {
  if (!stopping) void fail(`Test Worker exited unexpectedly. Output: ${serverOutput}`);
});

const healthDeadline = Date.now() + 120_000;
let healthy = false;
while (!healthy && Date.now() < healthDeadline && server.exitCode == null) {
  try {
    const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1000) });
    const body = await response.json();
    healthy = response.ok && body.ok === true && body.service === "monies-map";
  } catch {}
  if (!healthy) await new Promise((resolve) => setTimeout(resolve, 250));
}
if (!healthy) await fail(`Test Worker did not pass its health check at ${baseUrl}/api/health. Output: ${serverOutput}`);

// Health proves only that something answers. Confirm the RUNNING Worker reports
// the test environment before the destructive reseed.
const shellParams = `view=household&month=${seedMonth}&scope=direct_plus_shared`;
const environmentResponse = await fetch(`${baseUrl}/api/app-shell?${shellParams}`);
const environmentBody = environmentResponse.ok ? await environmentResponse.json() : null;
if (environmentBody?.appEnvironment !== "test") {
  await fail(`Worker on ${baseUrl} did not report appEnvironment=test (status ${environmentResponse.status}); refusing to reseed.`);
}

const reseedResponse = await fetch(`${baseUrl}/api/demo/reseed`, { method: "POST" });
if (!reseedResponse.ok) await fail(`Test Worker rejected demo reseed (${reseedResponse.status}): ${await reseedResponse.text()}`);

const fixtureResponse = await fetch(`${baseUrl}/api/app-shell?${shellParams}`);
const fixture = fixtureResponse.ok ? await fixtureResponse.json() : null;
const summaryResponse = await fetch(`${baseUrl}/api/summary-page?${shellParams}&summary_start=${EXPECTED_TRACKED_MONTHS[0]}&summary_end=${seedMonth}`);
const summary = summaryResponse.ok ? (await summaryResponse.json()).summaryPage : null;
const trackedMonths = fixture?.trackedMonths ?? [];
if (
  JSON.stringify(trackedMonths) !== JSON.stringify(EXPECTED_TRACKED_MONTHS)
  || summary?.rangeStartMonth !== EXPECTED_TRACKED_MONTHS[0]
  || summary?.rangeEndMonth !== seedMonth
  || summary?.months?.length !== EXPECTED_TRACKED_MONTHS.length
) {
  await fail(`Reseed did not produce the expected demo fixture (tracked ${JSON.stringify(trackedMonths)}, summary ${summary?.rangeStartMonth}..${summary?.rangeEndMonth}); refusing to measure incomplete data.`);
}

if (fixtureName !== "demo") {
  try {
    await loadScaleFixture({ baseUrl, fixtureName, seedMonth, workDir: tempRoot, runSqlFile: runD1File });
  } catch (error) {
    await fail(`Scale fixture ${fixtureName} did not load: ${error instanceof Error ? error.message : error}`);
  }
}

console.log(`${PERFORMANCE_READY_MARKER} ${baseUrl} fixture=${fixtureName}`);
const { code, signal } = await serverExit;
if (!stopping) {
  await stop();
  process.exitCode = code ?? (signal ? 1 : 0);
}
