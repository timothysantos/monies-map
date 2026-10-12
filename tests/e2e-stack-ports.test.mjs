import assert from "node:assert/strict";
import test from "node:test";

import { e2eOutputSuffix, shardStack, wranglerDevArgs } from "../scripts/e2e-stack.mjs";

test("shard stacks get distinct ports, and an offset moves all of them together", () => {
  const plain = [0, 1, 2].map((index) => shardStack(index, { portOffset: 0 }));
  assert.deepEqual(plain.map((stack) => [stack.uiPort, stack.apiPort, stack.inspectorPort]), [[5500, 8900, 9500], [5501, 8901, 9501], [5502, 8902, 9502]]);
  assert.equal(plain[1].baseURL, "http://127.0.0.1:5501");
  assert.equal(plain[1].apiOrigin, "http://127.0.0.1:8901");

  const offset = [0, 1, 2].map((index) => shardStack(index, { portOffset: 20 }));
  assert.deepEqual(offset.map((stack) => [stack.uiPort, stack.apiPort, stack.inspectorPort]), [[5520, 8920, 9520], [5521, 8921, 9521], [5522, 8922, 9522]]);
  // No port is shared between the two runs.
  const ports = (stacks) => stacks.flatMap((stack) => [stack.uiPort, stack.apiPort, stack.inspectorPort]);
  assert.equal(ports(plain).filter((port) => ports(offset).includes(port)).length, 0);
});

// Worktrees often share one node_modules (a symlink), and a stack removes
// its Vite cache when it stops. The cache follows the stack's UI port, so a
// run with another offset never shares, or deletes, a running stack's cache.
test("each stack's Vite cache follows its port, so offset runs never share one", () => {
  assert.equal(shardStack(1, { portOffset: 0 }).viteCacheDir, "node_modules/.vite-shard-5501");
  assert.equal(shardStack(1, { portOffset: 700 }).viteCacheDir, "node_modules/.vite-shard-6201");
  const dirs = [0, 20, 700].flatMap((portOffset) => [1, 2, 3].map((index) => shardStack(index, { portOffset }).viteCacheDir));
  assert.equal(new Set(dirs).size, dirs.length);
});

// Two runs from the same checkout with different E2E_PORT_OFFSET values
// used to share .wrangler/state-shard-N, so one run emptied or migrated the
// other's D1 mid-test. The state folder follows the stack's Wrangler port.
test("each stack's D1 state follows its Wrangler port, so offset runs in one checkout never share it", () => {
  assert.equal(shardStack(1, { portOffset: 0 }).persistTo, ".wrangler/state-shard-8901");
  assert.equal(shardStack(1, { portOffset: 700 }).persistTo, ".wrangler/state-shard-9601");
  const dirs = [0, 20, 700].flatMap((portOffset) => [1, 2, 3].map((index) => shardStack(index, { portOffset }).persistTo));
  assert.equal(new Set(dirs).size, dirs.length);
  // Never the default dev state.
  assert.equal(dirs.includes(".wrangler/state"), false);
});

// The guide screenshot stack runs the showcase demo data by passing Worker
// vars over wrangler.test.jsonc; browser test stacks keep the test config's
// default demo seed.
test("a stack's Worker vars become wrangler --var pairs, and test stacks pass none", () => {
  const stack = shardStack(2, { portOffset: 0 });
  assert.deepEqual(wranglerDevArgs(stack), [
    "dev", "--config", "wrangler.test.jsonc",
    "--ip", "127.0.0.1", "--port", "8902",
    "--inspector-port", "9502",
    "--persist-to", ".wrangler/state-shard-8902"
  ]);
  const guide = { ...stack, vars: { DEMO_DATASET: "showcase", DEMO_SEED_MONTH: "2026-09" } };
  assert.deepEqual(wranglerDevArgs(guide).slice(-4), ["--var", "DEMO_DATASET:showcase", "--var", "DEMO_SEED_MONTH:2026-09"]);
  assert.equal(wranglerDevArgs(guide).filter((arg) => arg === "--var").length, 2);
});

// Two runs from one checkout on different offsets must not empty each
// other's logs, blobs or reports either.
test("a run with a port offset logs and reports under its own folders", () => {
  assert.equal(e2eOutputSuffix(0), "");
  assert.equal(e2eOutputSuffix(300), "-300");
  assert.equal(shardStack(1, { portOffset: 0 }).serverLog, "test-results/e2e-sharded/logs/shard-1-servers.log");
  assert.equal(shardStack(1, { portOffset: 300 }).serverLog, "test-results/e2e-sharded-300/logs/shard-1-servers.log");
  assert.notEqual(shardStack(1, { portOffset: 300 }).serverLog, shardStack(1, { portOffset: 310 }).serverLog);
});
