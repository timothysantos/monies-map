import { defineConfig, devices } from "@playwright/test";

import baseConfig from "./playwright.config.js";

// Runs the tests tagged @webkit in WebKit with an iPhone profile. WebKit, like
// iPhone and iPad Safari, does not focus a button that is clicked or tapped,
// so it catches focus handling that only works in Chromium. It is kept out of
// the default suite: `npm run test:e2e:webkit` (needs
// `npx playwright install webkit` once). Servers and E2E_BASE_URL work as in
// playwright.config.js.
export default defineConfig({
  ...baseConfig,
  grep: /@webkit/,
  projects: [
    {
      name: "webkit-iphone",
      use: { ...devices["iPhone 13"] }
    }
  ]
});
