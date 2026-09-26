import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

import { smokeBatches } from "./e2e-smoke-workflows.mjs";

const playwrightCli = path.resolve("node_modules/@playwright/test/cli.js");
const serverHealthUrl = "http://127.0.0.1:5173/api/health";

async function waitForServerTeardown() {
  const deadline = Date.now() + 15_000;
  let consecutiveOfflineChecks = 0;
  while (Date.now() < deadline) {
    try {
      await fetch(serverHealthUrl, { signal: AbortSignal.timeout(500) });
      consecutiveOfflineChecks = 0;
    } catch {
      consecutiveOfflineChecks += 1;
      if (consecutiveOfflineChecks >= 3) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Playwright web server did not release ${serverHealthUrl} before the next smoke workflow.`);
}

for (const batch of smokeBatches()) {
  console.log(`\nRunning smoke workflow: ${batch.label}\n`);
  const result = spawnSync(
    process.execPath,
    [playwrightCli, "test", "--workers=1", ...batch.targets],
    { detached: true, env: process.env, stdio: "inherit" }
  );

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  // Playwright can return before its detached Wrangler/Vite process group is
  // fully gone. Starting the next workflow during that window lets the old
  // teardown kill the new server.
  await waitForServerTeardown();
}
