import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const playwrightCli = path.resolve("node_modules/@playwright/test/cli.js");
const serverHealthUrl = "http://127.0.0.1:5173/api/health";
const workflows = [
  {
    name: "import inbox navigation",
    file: "tests/e2e/import-inbox-navigation.spec.js"
  },
  {
    name: "month",
    file: "tests/e2e/month-page.spec.js",
    maxTestsPerProcess: 6
  },
  {
    name: "entry deletion",
    file: "tests/e2e/entries-delete-entry.spec.js"
  },
  {
    name: "entry category filter",
    file: "tests/e2e/entries-category-filter.spec.js"
  },
  {
    name: "entry transfer dialog",
    file: "tests/e2e/entries-transfer-dialog.spec.js"
  },
  {
    name: "add entries to splits",
    file: "tests/e2e/entries-add-to-splits.spec.js"
  },
  {
    name: "API performance",
    file: "tests/e2e/api-performance.spec.js"
  },
  {
    name: "FAQ",
    file: "tests/e2e/faq-content.spec.js"
  },
  {
    name: "summary",
    file: "tests/e2e/summary-workflow.spec.js"
  },
  {
    name: "mobile continuity",
    file: "tests/e2e/mobile-continuity.spec.js"
  },
  {
    name: "money field editability",
    file: "tests/e2e/money-field-editability.spec.js"
  },
  {
    name: "reseed contract",
    file: "tests/e2e/reseed-contract.spec.js"
  },
  {
    name: "settings reference data",
    file: "tests/e2e/settings-reference-data.spec.js"
  },
  {
    name: "import ledger",
    file: "tests/e2e/import-ledger-flow.spec.js"
  }
];

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

for (const workflow of workflows) {
  const workflowSource = workflow.maxTestsPerProcess
    ? readFileSync(workflow.file, "utf8")
    : "";
  const testLines = [...workflowSource.matchAll(/^[\t ]*test\(/gm)].map(
    (match) => workflowSource.slice(0, match.index).split("\n").length
  );
  const batches = workflow.maxTestsPerProcess
    ? Array.from(
        { length: Math.ceil(testLines.length / workflow.maxTestsPerProcess) },
        (_, batchIndex) =>
          testLines
            .slice(
              batchIndex * workflow.maxTestsPerProcess,
              (batchIndex + 1) * workflow.maxTestsPerProcess
            )
            .map((line) => `${workflow.file}:${line}`)
      )
    : [[workflow.file]];

  for (const [batchIndex, targets] of batches.entries()) {
    const batchLabel = batches.length > 1 ? ` (${batchIndex + 1}/${batches.length})` : "";
    console.log(`\nRunning smoke workflow: ${workflow.name}${batchLabel}\n`);
    const result = spawnSync(
      process.execPath,
      [playwrightCli, "test", "--workers=1", ...targets],
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
}
