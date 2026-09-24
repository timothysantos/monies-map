import { expect, test } from "@playwright/test";

import { reseedDemo } from "./helpers";

const SLOW_API_BUDGET_MS = 750;

const PAGE_APIS = [
  ["App shell", "/api/app-shell"],
  ["Reference data", "/api/reference-data"],
  ["Entries shell", "/api/entries-shell?view=household&month=2026-05"],
  ["Entries page", "/api/entries-page?view=person-tim&month=2026-01"],
  ["Summary page", "/api/summary-page?view=household&month=2026-05&scope=direct_plus_shared"],
  ["Summary account pills", "/api/summary-account-pills?view=household"],
  ["Month page", "/api/month-page?view=household&month=2026-05&scope=direct_plus_shared"],
  ["Splits page", "/api/splits-page?view=household&month=2026-05"],
  ["Imports page", "/api/imports-page"],
  ["Settings page", "/api/settings-page?view=household"]
];

function readServerTiming(header) {
  const metric = (name) => Number(header?.match(new RegExp(`(?:^|, )${name};dur=([0-9.]+)`))?.[1] ?? NaN);
  return {
    app: metric("app"),
    init: metric("init"),
    initDesc: header?.match(/init;dur=[0-9.]+;desc="(cold|warm)"/)?.[1] ?? null,
    total: metric("total")
  };
}

// Only the handler (`app`) has a budget. `init` and `total` are recorded
// for the audit; the Worker clock only advances across I/O, so they are
// not asserted beyond being present.
test("seeded page APIs stay below the slow-log budget", async ({ page }) => {
  await reseedDemo(page);
  const measurements = [];
  for (const [label, path] of PAGE_APIS) {
    const response = await page.request.get(path);
    expect(response.ok(), await response.text()).toBeTruthy();
    const timing = readServerTiming(response.headers()["server-timing"]);
    expect(Number.isFinite(timing.app), `${label} did not report Server-Timing duration`).toBeTruthy();
    expect(timing.app, `${label} took ${timing.app}ms`).toBeLessThan(SLOW_API_BUDGET_MS);
    expect(Number.isFinite(timing.init) && Number.isFinite(timing.total), `${label} did not report init and total`).toBeTruthy();
    measurements.push({ label, ...timing });
  }
  console.log(`API timing ${JSON.stringify(measurements)}`);
});
