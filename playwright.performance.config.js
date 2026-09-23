import { defineConfig, devices } from "@playwright/test";
import os from "node:os";
import path from "node:path";

const port = Number(process.env.PERFORMANCE_PORT ?? 5191);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/performance",
  // Node unit tests (*.test.mjs) in this folder run under `npm run test:unit`.
  testMatch: "**/*.spec.js",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  outputDir: path.join(os.tmpdir(), "monies-map-performance-playwright"),
  use: { baseURL, trace: "off", screenshot: "off", video: "off" },
  webServer: {
    command: `exec "${process.execPath}" scripts/run-performance-worker.mjs`,
    // Health answers before the fixture is seeded, so wait for the runner's
    // post-seed marker instead of a URL (Playwright races url against wait).
    wait: { stdout: /PERFORMANCE_FIXTURE_READY/ },
    reuseExistingServer: false,
    // Default teardown SIGKILLs the group, which skips the runner's cleanup of
    // its detached Wrangler group and temporary persistence.
    gracefulShutdown: { signal: "SIGTERM", timeout: 20_000 },
    stdout: "pipe",
    stderr: "pipe",
    timeout: 150_000
  },
  projects: [
    {
      name: "desktop-chromium-emulated-network",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, isMobile: false }
    },
    {
      name: "mobile-chromium-emulation",
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 }
    }
  ]
});
