// Runs the Playwright browser suite as N parallel shards. Each shard gets its
// own isolated stack (Vite + Wrangler + local D1, see scripts/e2e-stack.mjs)
// and runs its spec files in one Playwright process with one worker, so tests
// inside a shard behave exactly as in a serial run. Results are written as
// blob reports and merged into one summary, one JSON report and one HTML
// report; the run fails when any test fails or the merged test count differs
// from `playwright test --list`.
//
//   npm run test:e2e:sharded                    full suite on 3 shards (fewer on small machines)
//   npm run test:e2e:sharded -- --shards 3      pick the shard count
//   npm run test:e2e:sharded -- --smoke         the smoke bundle
//   npm run test:e2e:sharded -- --shard 2       only shard 2 of N (CI matrix job)
//   npm run test:e2e:sharded -- --merge <dir>   merge downloaded blob reports (CI)
//   npm run test:e2e:sharded -- --update-weights  refresh tests/e2e/shard-weights.json
//   npm run test:e2e:sharded -- tests/e2e/month-page.spec.js  only these spec files
//   npm run test:e2e:sharded -- -- --grep "Month"  Playwright options for every shard
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { DEFAULT_SHARD_COUNT, DEFAULT_SMOKE_SHARD_COUNT, planShards, unitsFromPlaywrightList, weightsFromJsonReport } from "./e2e-shard-plan.mjs";
import { smokeBatches } from "./e2e-smoke-workflows.mjs";
import { prepareStack, shardStack, startStack } from "./e2e-stack.mjs";

const playwrightCli = path.resolve("node_modules/@playwright/test/cli.js");
const outRoot = path.resolve("test-results/e2e-sharded");
const blobRoot = path.join(outRoot, "blobs");
const weightsFile = path.resolve("tests/e2e/shard-weights.json");
const testDir = "tests/e2e";
const activePlaywright = new Set();

function parseArgs(argv) {
  const separator = argv.indexOf("--");
  const own = separator === -1 ? argv : argv.slice(0, separator);
  const options = {
    shards: Number(process.env.E2E_SHARDS) || null,
    only: null,
    smoke: false,
    build: true,
    merge: null,
    updateWeights: false,
    keepState: false,
    // File filters (like `playwright test <files>`) only narrow the listing
    // the shards are planned from; each shard then runs its own files.
    files: [],
    // Playwright options (e.g. --grep) go to the listing and to every shard.
    playwrightArgs: separator === -1 ? [] : argv.slice(separator + 1)
  };
  for (let i = 0; i < own.length; i += 1) {
    const arg = own[i];
    const value = () => {
      const next = own[++i];
      if (next === undefined) throw new Error(`${arg} needs a value.`);
      return next;
    };
    if (arg === "--shards") options.shards = Number(value());
    else if (arg === "--shard") options.only = Number(value());
    else if (arg === "--smoke") options.smoke = true;
    else if (arg === "--skip-build") options.build = false;
    else if (arg === "--merge") options.merge = path.resolve(value());
    else if (arg === "--update-weights") options.updateWeights = true;
    else if (arg === "--keep-state") options.keepState = true;
    else if (!arg.startsWith("-")) options.files.push(arg);
    else throw new Error(`Unknown option ${arg}. Put Playwright options after "--".`);
  }
  // Each stack runs Chromium, workerd and Vite. Without --shards, never start
  // more stacks than half the CPUs can carry; the smoke bundle also runs
  // inside `npm run verify` on small CI runners (two vCPUs -> one stack).
  const cpuCap = Math.max(1, Math.floor(os.availableParallelism() / 2));
  options.shards ??= Math.min(options.smoke ? DEFAULT_SMOKE_SHARD_COUNT : DEFAULT_SHARD_COUNT, cpuCap);
  if (!Number.isInteger(options.shards) || options.shards < 1) throw new Error("--shards must be a positive integer.");
  if (options.only !== null && !(Number.isInteger(options.only) && options.only >= 1 && options.only <= options.shards)) {
    throw new Error(`--shard must be between 1 and ${options.shards}.`);
  }
  return options;
}

function playwrightJson(args, env = {}) {
  const result = spawnSync(process.execPath, [playwrightCli, ...args], {
    encoding: "utf8",
    env: { ...process.env, PLAYWRIGHT_USE_EXISTING_SERVER: "1", ...env },
    maxBuffer: 256 * 1024 * 1024
  });
  if (result.status !== 0 && !result.stdout.trim().startsWith("{")) {
    throw new Error(`playwright ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

function readWeights() {
  return existsSync(weightsFile) ? JSON.parse(readFileSync(weightsFile, "utf8")) : { files: {} };
}

/**
 * The work to split. Full mode: one unit per spec file that Playwright lists
 * (so a new spec is always included). Smoke mode: one unit per smoke batch.
 * Each unit carries the CLI targets that run it.
 */
function listUnits(options) {
  if (options.smoke) {
    const batches = smokeBatches();
    const listReport = playwrightJson([
      "test", "--list", "--reporter=json", ...batches.flatMap((batch) => batch.targets), ...options.playwrightArgs
    ]);
    // One line per listed test, so a batch of `file:line` targets counts a
    // test declared in a loop once per test, as Playwright runs it.
    const testLines = [];
    const visit = (suite) => {
      for (const spec of suite.specs ?? []) {
        for (let i = 0; i < spec.tests.length; i += 1) testLines.push(`${path.join(testDir, spec.file)}:${spec.line}`);
      }
      for (const child of suite.suites ?? []) visit(child);
    };
    for (const suite of listReport.suites ?? []) visit(suite);
    const units = batches.map((batch) => ({
      id: batch.label,
      file: path.relative(testDir, batch.file),
      tests: testLines.filter((line) => batch.targets.some((target) => target === batch.file ? line.startsWith(`${target}:`) : line === target)).length,
      targets: batch.targets
    }));
    return { units, expectedTests: testLines.length };
  }
  const units = unitsFromPlaywrightList(playwrightJson(["test", "--list", "--reporter=json", ...options.playwrightArgs, ...options.files]))
    .map((unit) => ({ ...unit, targets: [path.join(testDir, unit.file)] }));
  return { units, expectedTests: units.reduce((total, unit) => total + unit.tests, 0) };
}

function build() {
  console.log("Building dist/ once for every shard (Wrangler serves it as the assets directory)...");
  const result = spawnSync("npm", ["run", "build"], { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) throw new Error("npm run build failed.");
}

function prefixStream(stream, label, sink) {
  let pending = "";
  stream.on("data", (chunk) => {
    pending += chunk;
    const lines = pending.split("\n");
    pending = lines.pop();
    for (const line of lines) {
      process.stdout.write(`${label} ${line}\n`);
      sink.write(`${line}\n`);
    }
  });
  stream.on("end", () => {
    if (pending) {
      process.stdout.write(`${label} ${pending}\n`);
      sink.write(`${pending}\n`);
    }
  });
}

/** One Playwright process against one stack. Resolves with its exit code. */
function runPlaywright({ stack, targets, blobDir, outputDir, label, log, playwrightArgs }) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [playwrightCli, "test", "--workers=1", "--reporter=list,blob", `--output=${outputDir}`, ...playwrightArgs, ...targets],
      {
        env: {
          ...process.env,
          E2E_BASE_URL: stack.baseURL,
          PLAYWRIGHT_USE_EXISTING_SERVER: "1",
          PLAYWRIGHT_BLOB_OUTPUT_DIR: blobDir,
          FORCE_COLOR: "0"
        },
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    activePlaywright.add(child);
    prefixStream(child.stdout, label, log);
    prefixStream(child.stderr, label, log);
    child.on("exit", (code, signal) => {
      activePlaywright.delete(child);
      resolve(code ?? (signal ? 1 : 0));
    });
  });
}

async function runShard(shard, options) {
  const stack = shardStack(shard.index);
  const label = `[${shard.index}/${options.shards}]`;
  if (!shard.units.length) return { index: shard.index, exitCode: 0, seconds: 0, tests: 0 };
  await mkdir(path.join(outRoot, "logs"), { recursive: true });
  const log = createWriteStream(path.join(outRoot, "logs", `shard-${shard.index}.log`));
  const started = Date.now();
  let stackHandle;
  let exitCode = 0;
  try {
    await prepareStack(stack);
    stackHandle = await startStack(stack, { keepState: options.keepState });
    console.log(`${label} stack ready on ${stack.baseURL} (API ${stack.apiOrigin}); ${shard.units.length} unit(s), ${shard.tests} test(s)`);
    // Full mode: all files in one process, like `npm run test:e2e`. Smoke
    // mode: one process per smoke batch, like `npm run test:e2e:smoke`.
    const processes = options.smoke
      ? shard.units.map((unit, i) => ({ targets: unit.targets, name: `${String(i + 1).padStart(2, "0")}` }))
      : [{ targets: shard.units.flatMap((unit) => unit.targets), name: "all" }];
    for (const run of processes) {
      if (stopping || !run.targets.length) continue;
      const code = await runPlaywright({
        stack,
        targets: run.targets,
        blobDir: path.join(blobRoot, `shard-${shard.index}-${run.name}`),
        outputDir: path.join(outRoot, `shard-${shard.index}`, run.name),
        label,
        log,
        playwrightArgs: options.playwrightArgs
      });
      if (code !== 0) exitCode = code;
    }
  } catch (error) {
    console.error(`${label} ${error.message}`);
    exitCode = 1;
  } finally {
    await stackHandle?.stop();
    log.end();
  }
  return { index: shard.index, exitCode, seconds: (Date.now() - started) / 1000, tests: shard.tests };
}

/** Collects every blob zip under `sourceDir` into one flat directory. */
async function collectBlobs(sourceDir, targetDir) {
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });
  const found = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith(".zip")) found.push(full);
    }
  };
  if (existsSync(sourceDir)) await walk(sourceDir);
  for (const [i, file] of found.sort().entries()) {
    await copyFile(file, path.join(targetDir, `report-${String(i + 1).padStart(3, "0")}.zip`));
  }
  return found.length;
}

/** Merges blobs into a JSON and an HTML report and returns the JSON report. */
async function mergeReports(sourceDir) {
  const mergedDir = path.join(outRoot, "merged-blobs");
  const count = await collectBlobs(sourceDir, mergedDir);
  if (!count) throw new Error(`No blob reports found under ${sourceDir}.`);
  const jsonFile = path.join(outRoot, "report.json");
  const result = spawnSync(process.execPath, [playwrightCli, "merge-reports", "--reporter=json,html", mergedDir], {
    stdio: ["ignore", "ignore", "inherit"],
    env: {
      ...process.env,
      PLAYWRIGHT_JSON_OUTPUT_FILE: jsonFile,
      PLAYWRIGHT_HTML_OUTPUT_DIR: path.resolve("playwright-report"),
      PLAYWRIGHT_HTML_OPEN: "never"
    }
  });
  if (result.status !== 0) throw new Error("playwright merge-reports failed.");
  return JSON.parse(readFileSync(jsonFile, "utf8"));
}

function failedTests(report) {
  const failed = [];
  const visit = (suite, titles) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        if (test.status === "unexpected") failed.push(`${spec.file}:${spec.line} ${[...titles, spec.title].join(" > ")}`);
      }
    }
    for (const child of suite.suites ?? []) visit(child, [...titles, child.title]);
  };
  for (const suite of report.suites ?? []) visit(suite, []);
  return failed;
}

function summarize(report, expectedTests) {
  const { expected = 0, unexpected = 0, flaky = 0, skipped = 0 } = report.stats ?? {};
  const total = expected + unexpected + flaky + skipped;
  console.log(`\nMerged result: ${total} tests, ${expected} passed, ${unexpected} failed, ${flaky} flaky, ${skipped} skipped`);
  for (const title of failedTests(report)) console.log(`  failed: ${title}`);
  let ok = unexpected === 0;
  if (expectedTests !== null && total !== expectedTests) {
    console.log(`  Test count mismatch: Playwright lists ${expectedTests} tests, the shards reported ${total}.`);
    ok = false;
  }
  console.log("HTML report: playwright-report/index.html; JSON: test-results/e2e-sharded/report.json");
  return ok;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.merge) {
    const report = await mergeReports(options.merge);
    const { expectedTests } = listUnits(options);
    process.exit(summarize(report, expectedTests) ? 0 : 1);
  }

  const { units, expectedTests } = listUnits(options);
  const plan = planShards(units, options.shards, readWeights());
  const selected = options.only === null ? plan : plan.filter((shard) => shard.index === options.only);
  console.log(`${options.smoke ? "Smoke bundle" : "Full suite"}: ${expectedTests} tests on ${options.shards} shard(s)`);
  for (const shard of plan) {
    const marker = selected.includes(shard) ? "" : " (not run here)";
    console.log(`  shard ${shard.index}: ${shard.tests} tests, ~${Math.round(shard.seconds)}s estimated, ${shard.units.map((unit) => unit.id).join(", ")}${marker}`);
  }

  if (options.build || !existsSync("dist/index.html")) build();
  await rm(outRoot, { recursive: true, force: true });

  const started = Date.now();
  const results = await Promise.all(selected.map((shard) => runShard(shard, options)));
  const wallSeconds = (Date.now() - started) / 1000;

  console.log("");
  for (const result of results) {
    console.log(`shard ${result.index}: ${result.tests} tests, ${result.seconds.toFixed(0)}s, exit ${result.exitCode}`);
  }
  console.log(`Wall time for the shard runs: ${wallSeconds.toFixed(0)}s`);

  const report = await mergeReports(blobRoot);
  const expectedHere = selected.reduce((total, shard) => total + shard.tests, 0);
  let ok = summarize(report, options.only === null ? expectedTests : expectedHere);
  if (results.some((result) => result.exitCode !== 0)) ok = false;

  if (options.updateWeights) {
    if (options.smoke || options.only !== null || options.playwrightArgs.length || options.files.length) {
      console.log("Weights are only refreshed from a complete, unfiltered full run; not updated.");
    } else if (!ok) {
      console.log("Weights are only refreshed from a passing run; not updated.");
    } else {
      await writeFile(weightsFile, `${JSON.stringify(weightsFromJsonReport(report), null, 2)}\n`);
      console.log(`Updated ${path.relative(process.cwd(), weightsFile)}.`);
    }
  }
  process.exit(ok ? 0 : 1);
}

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    // Stacks run in their own process groups. Ending the Playwright children
    // lets each runShard finally block stop its stack and remove its state.
    if (stopping) process.exit(130);
    stopping = true;
    console.log(`\n${signal} received: stopping shards and their servers...`);
    for (const child of activePlaywright) child.kill(signal);
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
