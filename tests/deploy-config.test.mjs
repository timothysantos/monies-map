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
  assert.equal((workflow.match(/node-version-file: \.nvmrc/g) ?? []).length, 2);
});
