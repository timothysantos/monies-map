import assert from "node:assert/strict";
import test from "node:test";

import { shardStack, startProxyQueueFlush, wranglerDevArgs } from "../scripts/e2e-stack.mjs";

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

function manualInterval() {
  let tick = null;
  return {
    setInterval(callback) { tick = callback; return 1; },
    clearInterval() { tick = null; },
    tick: () => tick?.(),
    running: () => tick !== null
  };
}

// wrangler dev parks a GET whose proxied fetch lost its connection until the
// next request arrives; the stack pings the Worker so none waits for long.
test("the proxy-queue flush pings the Worker each interval, never overlaps, survives failures and stops", async () => {
  const clock = manualInterval();
  const calls = [];
  const fetchImpl = (url) => new Promise((resolve, reject) => calls.push({ url, resolve, reject }));
  const stop = startProxyQueueFlush("http://127.0.0.1:8901/api/health", { fetchImpl, clock });
  const settle = () => new Promise((resolve) => setImmediate(resolve));

  clock.tick();
  clock.tick();
  assert.deepEqual(calls.map((call) => call.url), ["http://127.0.0.1:8901/api/health"], "no second ping while one is in flight");
  calls[0].reject(new Error("ECONNREFUSED"));
  await settle();
  clock.tick();
  assert.equal(calls.length, 2, "a failed ping does not stop the next one");
  calls[1].resolve({ body: null });
  await settle();

  stop();
  assert.equal(clock.running(), false);
  clock.tick();
  assert.equal(calls.length, 2);
});
