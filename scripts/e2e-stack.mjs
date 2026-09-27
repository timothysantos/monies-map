// One isolated browser test stack: its own Vite port, Wrangler port and
// inspector port, its own local D1 persist directory and its own Vite cache.
// Several stacks can run side by side from the same checkout, and none of
// them touches the default 5173/8787 servers or .wrangler/state.
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";

const wranglerCli = path.resolve("node_modules/wrangler/bin/wrangler.js");
const viteServer = path.resolve("scripts/e2e-vite-server.mjs");

/** Ports and directories for shard `index` (1-based). */
// E2E_PORT_OFFSET moves every shard's ports, so two worktrees (or two
// sessions) can run sharded suites at the same time without colliding.
export function shardStack(index, { logDir = "test-results/e2e-sharded/logs", portOffset = Number(process.env.E2E_PORT_OFFSET) || 0 } = {}) {
  const uiPort = 5500 + portOffset + index;
  const apiPort = 8900 + portOffset + index;
  return {
    index,
    uiPort,
    apiPort,
    inspectorPort: 9500 + portOffset + index,
    baseURL: `http://127.0.0.1:${uiPort}`,
    apiOrigin: `http://127.0.0.1:${apiPort}`,
    persistTo: `.wrangler/state-shard-${index}`,
    viteCacheDir: `node_modules/.vite-shard-${index}`,
    serverLog: path.join(logDir, `shard-${index}-servers.log`)
  };
}

function run(command, args, { env = process.env, label }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`${label} failed with exit code ${code}:\n${output.slice(-4000)}`));
    });
  });
}

function assertPortFree(port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", (error) => {
      reject(new Error(`Port ${port} is already in use (${error.code}); stop the process holding it or pick other shards.`));
    });
    probe.listen({ port, host: "127.0.0.1", exclusive: true }, () => probe.close(resolve));
  });
}

/** Empties the stack's D1 persist directory and applies schema.sql to it. */
export async function prepareStack(stack) {
  await rm(stack.persistTo, { recursive: true, force: true });
  await run(
    process.execPath,
    [
      wranglerCli, "d1", "execute", "monies-map-test",
      "--config", "wrangler.test.jsonc", "--local",
      "--persist-to", stack.persistTo, "--file=schema.sql"
    ],
    { label: `D1 schema for shard ${stack.index}`, env: { ...process.env, WRANGLER_SEND_METRICS: "false" } }
  );
}

function stopGroup(child) {
  return new Promise((resolve) => {
    const killGroup = (signal) => {
      try {
        process.kill(-child.pid, signal);
      } catch {
        // The group is already gone.
      }
    };
    if (child.exitCode !== null || child.signalCode !== null) {
      killGroup("SIGKILL");
      return resolve();
    }
    const timer = setTimeout(() => killGroup("SIGKILL"), 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      // Take any stragglers (workerd, esbuild) with it.
      killGroup("SIGKILL");
      resolve();
    });
    killGroup("SIGTERM");
  });
}

async function waitForHealth(stack, children, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const url = `${stack.baseURL}/api/health`;
  while (Date.now() < deadline) {
    const exited = children.find((child) => child.exitCode !== null || child.signalCode !== null);
    if (exited) throw new Error(`A server for shard ${stack.index} exited early; see ${stack.serverLog}.`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Shard ${stack.index} did not answer ${url} within ${timeoutMs / 1000}s; see ${stack.serverLog}.`);
}

/**
 * The `wrangler dev` arguments for the stack's Worker. `stack.vars` adds
 * Worker vars over wrangler.test.jsonc (the guide screenshots run the
 * showcase demo dataset this way); browser test stacks have none.
 */
export function wranglerDevArgs(stack) {
  return [
    "dev", "--config", "wrangler.test.jsonc",
    "--ip", "127.0.0.1", "--port", String(stack.apiPort),
    "--inspector-port", String(stack.inspectorPort),
    "--persist-to", stack.persistTo,
    ...Object.entries(stack.vars ?? {}).flatMap(([name, value]) => ["--var", `${name}:${value}`])
  ];
}

/**
 * Works around a `wrangler dev` bug (wrangler 4.113, ProxyWorker.ts): when
 * its proxy's fetch to the local Worker fails with "Network connection
 * lost." (a keep-alive race between the two local runtimes), a GET is put
 * in a retry queue that only drains when the next request reaches the
 * proxy. The page's request then waits, unanswered, until something else
 * calls the Worker; in a quiet test that is the 45 s client timeout. A
 * light ping to the Worker every second drains the queue, so such a request
 * is answered within about a second. Pings never overlap and their failures
 * are ignored. Returns `stop()`.
 */
export function startProxyQueueFlush(url, { intervalMs = 1_000, fetchImpl = fetch, clock = globalThis } = {}) {
  let inFlight = false;
  const timer = clock.setInterval(() => {
    if (inFlight) return;
    inFlight = true;
    fetchImpl(url, { signal: AbortSignal.timeout(intervalMs * 5) })
      .then((response) => response.body?.cancel())
      .catch(() => {})
      .finally(() => { inFlight = false; });
  }, intervalMs);
  return () => clock.clearInterval(timer);
}

/**
 * Starts Wrangler and Vite for the stack, each in its own process group, and
 * resolves once `/api/health` answers through the Vite proxy. The returned
 * `stop()` ends both groups and removes the stack's D1 state and Vite cache.
 */
export async function startStack(stack, { timeoutMs = 120_000, keepState = false } = {}) {
  await Promise.all([stack.uiPort, stack.apiPort, stack.inspectorPort].map(assertPortFree));
  await mkdir(path.dirname(stack.serverLog), { recursive: true });
  const log = createWriteStream(stack.serverLog);
  const env = { ...process.env, WRANGLER_SEND_METRICS: "false", VITE_API_ORIGIN: stack.apiOrigin };
  const launch = (label, args, extraEnv = {}) => {
    const child = spawn(process.execPath, args, {
      detached: true,
      env: { ...env, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"]
    });
    const prefix = (chunk) => chunk.toString().replace(/^(?=.)/gm, `[${label}] `);
    child.stdout.on("data", (chunk) => log.write(prefix(chunk)));
    child.stderr.on("data", (chunk) => log.write(prefix(chunk)));
    return child;
  };
  const children = [
    launch("API", [wranglerCli, ...wranglerDevArgs(stack)]),
    launch("UI", [viteServer], { E2E_UI_PORT: String(stack.uiPort), E2E_VITE_CACHE_DIR: stack.viteCacheDir })
  ];

  let stopped;
  let stopQueueFlush = () => {};
  const stop = () => {
    stopped ??= (async () => {
      stopQueueFlush();
      await Promise.all(children.map(stopGroup));
      log.end();
      if (!keepState) {
        await rm(stack.persistTo, { recursive: true, force: true });
        await rm(stack.viteCacheDir, { recursive: true, force: true });
      }
    })();
    return stopped;
  };

  try {
    await waitForHealth(stack, children, timeoutMs);
  } catch (error) {
    await stop();
    throw error;
  }
  stopQueueFlush = startProxyQueueFlush(`${stack.apiOrigin}/api/health`);
  return { stop };
}
