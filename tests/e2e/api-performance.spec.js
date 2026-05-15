import { expect, test } from "@playwright/test";

import { reseedDemo } from "./helpers";

const SLOW_API_BUDGET_MS = 750;

async function expectEndpointWithinBudget(page, label, path) {
  const response = await page.request.get(path);
  expect(response.ok(), await response.text()).toBeTruthy();
  const durationMs = Number(response.headers()["server-timing"]?.match(/dur=([0-9.]+)/)?.[1] ?? NaN);
  expect(Number.isFinite(durationMs), `${label} did not report Server-Timing duration`).toBeTruthy();
  expect(durationMs, `${label} took ${durationMs}ms`).toBeLessThan(SLOW_API_BUDGET_MS);
}

test("seeded page APIs stay below the slow-log budget", async ({ page }) => {
  await reseedDemo(page);

  await expectEndpointWithinBudget(
    page,
    "Entries page",
    "/api/entries-page?view=person-tim&month=2026-01"
  );
  await expectEndpointWithinBudget(
    page,
    "Summary page",
    "/api/summary-page?view=household&month=2026-05&scope=direct_plus_shared"
  );
  await expectEndpointWithinBudget(
    page,
    "Summary account pills",
    "/api/summary-account-pills?view=household"
  );
});
