import { defineConfig, devices } from "@playwright/test";

// The sharded runner (scripts/run-e2e-sharded.mjs) starts its own isolated
// stacks and points each Playwright run at one through E2E_BASE_URL.
const isolatedBaseURL = process.env.E2E_BASE_URL;
const baseURL = isolatedBaseURL ?? "http://127.0.0.1:5173";
const shouldStartWebServer = !process.env.PLAYWRIGHT_USE_EXISTING_SERVER && !isolatedBaseURL;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 120_000,
  workers: 1,
  captureGitInfo: {
    commit: true,
    diff: false
  },
  expect: {
    timeout: 10_000
  },
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL,
    trace: "on-first-retry"
  },
  webServer: shouldStartWebServer
    ? {
        command: "npm run dev:test:servers",
        url: "http://127.0.0.1:5173/api/health",
        // Skip wrangler dev's request-trace capture, as the sharded stacks do
        // (scripts/e2e-stack.mjs).
        env: { X_LOCAL_OBSERVABILITY: "false" },
        reuseExistingServer: !process.env.CI,
        stdout: "pipe",
        stderr: "pipe",
        timeout: 120_000
      }
    : undefined,
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
