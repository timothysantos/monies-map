import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Cloudflare Access protects the app's workers.dev address, which is the
// production URL (README "Production Auth"), so workers.dev must stay on.
// Version preview URLs are a second address per upload that the workers.dev
// Access setting does not cover, and no deploy script uses them.
test("the production app keeps its workers.dev address and has no preview URLs", async () => {
  const appConfig = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  assert.notEqual(appConfig.workers_dev, false, "workers.dev is the Access-protected production address");
  assert.equal(appConfig.preview_urls, false);
});

// One Node minimum: package engines, every script guard and the .nvmrc the
// team and CI install from must agree.
test("the Node minimum is the same in engines, script guards and .nvmrc", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const minimum = manifest.engines.node.replace(/^>=/, "");
  assert.equal(minimum, "22.23.0");
  const guards = Object.values(manifest.scripts).join("\n").match(/ensure-node-major\.mjs [0-9.]+/g);
  assert.ok(guards.length >= 5);
  assert.deepEqual([...new Set(guards)], [`ensure-node-major.mjs ${minimum}`]);
  const pinned = (await readFile(new URL("../.nvmrc", import.meta.url), "utf8")).trim().split(".").map(Number);
  const floor = minimum.split(".").map(Number);
  assert.ok(pinned[0] === floor[0] && (pinned[1] > floor[1] || (pinned[1] === floor[1] && pinned[2] >= floor[2])), ".nvmrc meets the minimum");
  const workflow = await readFile(new URL("../.github/workflows/verify.yml", import.meta.url), "utf8");
  const setupAction = await readFile(new URL("../.github/actions/setup-deps/action.yml", import.meta.url), "utf8");
  // Every CI job that installs Node (static, the unit shards, the full-e2e
  // shards and their merge job) goes through the setup-deps action, which
  // installs it from .nvmrc, never a pinned version of its own.
  const setupDepsSteps = (workflow.match(/uses: \.\/\.github\/actions\/setup-deps/g) ?? []).length;
  assert.ok(setupDepsSteps >= 4, `expected static, unit, full-e2e-shard and full-e2e to set up Node, found ${setupDepsSteps}`);
  assert.doesNotMatch(workflow, /actions\/setup-node@|node-version/);
  assert.equal((setupAction.match(/uses: actions\/setup-node@/g) ?? []).length, 1);
  assert.match(setupAction, /node-version-file: \.nvmrc/);
  assert.doesNotMatch(setupAction, /node-version:/);
});

// CI splits `npm run test:unit` across runners with its own tsx command, so
// that command must name the same test files as the script.
test("CI's unit shards run the files npm run test:unit runs", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const workflow = await readFile(new URL("../.github/workflows/verify.yml", import.meta.url), "utf8");
  const scriptFiles = manifest.scripts["test:unit"].replace(/^tsx --test /, "");
  // Options are `--name=value`, where a value may hold a `${{ expression }}`.
  const shardRun = workflow.match(/run: npx tsx --test (?:--[\w-]+=(?:[^\s$]|\$\{\{[^}]*\}\})+ )+(.+)$/m);
  assert.ok(shardRun, "the unit job runs npx tsx --test with its shard options");
  assert.equal(shardRun[1].trim(), scriptFiles);
  assert.match(workflow, /--test-shard=\$\{\{ matrix\.shard \}\}\//);
});

// The production AI allowance (owner-approved 2026-10-11): 40 shared units a
// day, inside the 4 to 60 clamp, so the Worker reserves against 40 exactly.
test("production configures 40 daily AI allowance units and the Worker honours it unclamped", async () => {
  const appConfig = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  assert.equal(appConfig.vars.AI_ASSIST_DAILY_LIMIT, "40");

  const { reserveDailyAiBudget } = await import("../src/domain/ai-assistance.ts");
  const bound = [];
  const db = {
    prepare: () => {
      const statement = {
        bind: (...values) => { bound.push(values); return statement; },
        run: async () => ({ meta: { changes: 1 } }),
        first: async () => ({ used_units: 1 })
      };
      return statement;
    }
  };
  const result = await reserveDailyAiBudget(db, { AI_ASSIST_DAILY_LIMIT: appConfig.vars.AI_ASSIST_DAILY_LIMIT }, 1);
  assert.deepEqual(result, { available: true, remaining: 39 });
  assert.equal(bound[0].at(-1), 40, "the upsert caps usage at the configured limit");
});
