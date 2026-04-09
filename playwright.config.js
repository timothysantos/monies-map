import { defineConfig, devices } from "@playwright/test";

const shouldStartWebServer = !process.env.PLAYWRIGHT_USE_EXISTING_SERVER;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 120_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry"
  },
  webServer: shouldStartWebServer
    ? {
        command: "zsh -lc 'source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run dev'",
        url: "http://127.0.0.1:5173",
        reuseExistingServer: !process.env.CI,
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
