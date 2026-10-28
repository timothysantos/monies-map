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

// CI splits `npm run test:unit` across runners, so each shard must run the
// same runner script the npm script runs (it picks the files), with only
// node --test options added, and the shard count must match the matrix.
test("CI's unit shards run the script npm run test:unit runs", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const workflow = await readFile(new URL("../.github/workflows/verify.yml", import.meta.url), "utf8");
  const script = manifest.scripts["test:unit"].replace(/^node --import tsx /, "");
  assert.equal(script, "scripts/run-unit-tests.mjs");
  // Options are `--name=value`, where a value may hold a `${{ expression }}`.
  const shardRun = workflow.match(/run: node --import tsx (\S+) ((?:--[\w-]+=(?:[^\s$]|\$\{\{[^}]*\}\})+ ?)+)$/m);
  assert.ok(shardRun, "the unit job runs the unit script with its shard options");
  assert.equal(shardRun[1], script);
  assert.match(shardRun[2], /--test-shard=\$\{\{ matrix\.shard \}\}\/3\b/);
  assert.match(workflow, /shard: \[1, 2, 3\]/);
});

// The one check to require is `verify`, and the browser merge keeps the
// `full-e2e` name; both stay and `verify` waits for every other job.
test("CI keeps the verify and full-e2e checks and verify needs every job", async () => {
  const workflow = await readFile(new URL("../.github/workflows/verify.yml", import.meta.url), "utf8");
  assert.match(workflow, /^ {2}verify:\n {4}needs: \[static, unit, full-e2e\]/m);
  assert.match(workflow, /^ {2}full-e2e:\n {4}needs: full-e2e-shard/m);
  assert.match(workflow, /^ {4}branches:\n {6}- master\n/m);
  assert.match(workflow, /cancel-in-progress: \$\{\{ [a-z]+\.ref != 'refs\/heads\/master' \}\}/);
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

// The public demo (owner decision 2026-10-14): Claude through the same
// gateway, with its own caps counted in its own D1, which is never
// production's. Production keeps one shared cap and no visitor cap.
test("the demo has its own small AI caps in its own database, and production is unchanged", async () => {
  const read = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8").then(JSON.parse);
  const demo = await read("wrangler.demo.jsonc");
  const app = await read("wrangler.jsonc");
  assert.equal(demo.vars.AI_ASSIST_ENABLED, "true");
  assert.equal(demo.vars.AI_ASSIST_DAILY_LIMIT, "50");
  assert.equal(demo.vars.AI_ASSIST_VISITOR_DAILY_LIMIT, "10");
  for (const key of ["AI_GATEWAY_ACCOUNT_ID", "AI_GATEWAY_ID", "AI_GATEWAY_BYOK_ALIAS"]) {
    assert.equal(demo.vars[key], app.vars[key], key);
  }
  // The gateway token is a secret, never a var; no Workers AI binding, so
  // without the token the demo answers with its rules and calls nothing.
  assert.equal(demo.vars.AI_GATEWAY_TOKEN, undefined);
  assert.equal(demo.ai, undefined);
  assert.notEqual(demo.d1_databases[0].database_id, app.d1_databases[0].database_id);
  assert.equal(app.vars.AI_ASSIST_VISITOR_DAILY_LIMIT, undefined);
  assert.equal(app.vars.AI_ASSIST_DAILY_LIMIT, "100");
});

// Security review F6: production checks the Access token itself
// (src/server/access-jwt.ts), in enforce mode (it ran in report mode until
// real owner requests verified). The demo has its own Access application and enforces too (since 2026-10-14); the test and shortcuts Workers have no Access in
// front and leave it off, and so does local `npm run dev:api`.
test("production enforces the Access token and the demo enforces it, each against its own app tag", async () => {
  const read = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8").then(JSON.parse);
  const appConfig = await read("wrangler.jsonc");
  assert.equal(appConfig.vars.ACCESS_JWT_MODE, "enforce");
  assert.equal(appConfig.vars.ACCESS_TEAM_DOMAIN, "monies-map.cloudflareaccess.com");
  assert.match(appConfig.vars.ACCESS_AUD, /^[0-9a-f]{64}$/);
  // The demo sits behind its own Access application (invite-only, owner
  // decision 2026-10-14): same team, its own app tag, enforced.
  const demoConfig = await read("wrangler.demo.jsonc");
  assert.equal(demoConfig.vars.ACCESS_JWT_MODE, "enforce");
  assert.equal(demoConfig.vars.ACCESS_TEAM_DOMAIN, appConfig.vars.ACCESS_TEAM_DOMAIN);
  assert.match(demoConfig.vars.ACCESS_AUD, /^[0-9a-f]{64}$/);
  assert.notEqual(demoConfig.vars.ACCESS_AUD, appConfig.vars.ACCESS_AUD, "prod and demo each carry their own app tag");
  for (const name of ["wrangler.test.jsonc", "wrangler.shortcuts.jsonc"]) {
    const vars = (await read(name)).vars ?? {};
    for (const key of ["ACCESS_JWT_MODE", "ACCESS_TEAM_DOMAIN", "ACCESS_AUD"]) {
      assert.equal(vars[key], undefined, `${name} ${key}`);
    }
  }
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(manifest.scripts["dev:api"], /--var ACCESS_JWT_MODE:off/);
});

// The Ask turn route lets a test stand in for the model through a request
// header, but only when APP_ENVIRONMENT is "test". Only wrangler.test.jsonc may set it.
test("only the test Worker sets APP_ENVIRONMENT test, so the Ask turn test-reply header is inert elsewhere", async () => {
  const read = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8").then(JSON.parse);
  assert.equal((await read("wrangler.test.jsonc")).vars.APP_ENVIRONMENT, "test");
  for (const name of ["wrangler.jsonc", "wrangler.demo.jsonc", "wrangler.shortcuts.jsonc"]) {
    const config = await read(name);
    for (const entry of [config, ...Object.values(config.env ?? {})]) {
      assert.notEqual(entry.vars?.APP_ENVIRONMENT, "test", `${name} must not enable the test reply header`);
    }
  }
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.doesNotMatch(JSON.stringify(manifest.scripts), /APP_ENVIRONMENT:test/);
  const source = await readFile(new URL("../src/server/ask-turn-route.ts", import.meta.url), "utf8");
  assert.match(source, /env\.APP_ENVIRONMENT === "test" \? request\.headers\.get\(TEST_REPLY_HEADER\)/);
});
