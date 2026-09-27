import assert from "node:assert/strict";
import test from "node:test";

import { shardStack, wranglerDevArgs } from "../scripts/e2e-stack.mjs";

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

// The guide screenshot stack runs the showcase demo data by passing Worker
// vars over wrangler.test.jsonc; browser test stacks keep the test config's
// default demo seed.
test("a stack's Worker vars become wrangler --var pairs, and test stacks pass none", () => {
  const stack = shardStack(2, { portOffset: 0 });
  assert.deepEqual(wranglerDevArgs(stack), [
    "dev", "--config", "wrangler.test.jsonc",
    "--ip", "127.0.0.1", "--port", "8902",
    "--inspector-port", "9502",
    "--persist-to", ".wrangler/state-shard-2"
  ]);
  const guide = { ...stack, vars: { DEMO_DATASET: "showcase", DEMO_SEED_MONTH: "2026-09" } };
  assert.deepEqual(wranglerDevArgs(guide).slice(-4), ["--var", "DEMO_DATASET:showcase", "--var", "DEMO_SEED_MONTH:2026-09"]);
  assert.equal(wranglerDevArgs(guide).filter((arg) => arg === "--var").length, 2);
});
