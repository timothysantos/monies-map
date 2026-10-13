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
  // Every CI job that installs Node (verify, the full-e2e shards and their
  // merge job) installs it from .nvmrc, never a pinned version of its own.
  const setupNodeSteps = (workflow.match(/uses: actions\/setup-node@/g) ?? []).length;
  assert.ok(setupNodeSteps >= 3, `expected verify, full-e2e-shard and full-e2e to set up Node, found ${setupNodeSteps}`);
  assert.equal((workflow.match(/node-version-file: \.nvmrc/g) ?? []).length, setupNodeSteps);
  assert.doesNotMatch(workflow, /node-version:/);
});

// The production AI allowance (owner-approved 2026-10-12): 100 shared units a
// day, inside the 4 to 100 clamp, so the Worker reserves against 100 exactly.
test("production configures 100 daily AI allowance units and the Worker honours it unclamped", async () => {
  const appConfig = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  assert.equal(appConfig.vars.AI_ASSIST_DAILY_LIMIT, "100");

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
  assert.deepEqual(result, { available: true, remaining: 99 });
  assert.equal(bound[0].at(-1), 100, "the upsert caps usage at the configured limit");
});

// Security review F6: production checks the Access token itself
// (src/server/access-jwt.ts), in report mode until the owner has seen real
// requests verify. The demo, test and shortcuts Workers have no Access in
// front and leave it off, and so does local `npm run dev:api`.
test("only production checks the Access token, against its own team and app tag", async () => {
  const read = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8").then(JSON.parse);
  const appConfig = await read("wrangler.jsonc");
  assert.equal(appConfig.vars.ACCESS_JWT_MODE, "report");
  assert.equal(appConfig.vars.ACCESS_TEAM_DOMAIN, "monies-map.cloudflareaccess.com");
  assert.match(appConfig.vars.ACCESS_AUD, /^[0-9a-f]{64}$/);
  for (const name of ["wrangler.demo.jsonc", "wrangler.test.jsonc", "wrangler.shortcuts.jsonc"]) {
    const vars = (await read(name)).vars ?? {};
    for (const key of ["ACCESS_JWT_MODE", "ACCESS_TEAM_DOMAIN", "ACCESS_AUD"]) {
      assert.equal(vars[key], undefined, `${name} ${key}`);
    }
  }
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(manifest.scripts["dev:api"], /--var ACCESS_JWT_MODE:off/);
});
