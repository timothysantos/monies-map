import { expect, test } from "@playwright/test";

import { reseedDemo } from "./helpers";

// A refresh after a save runs in the background. When it fails, the saved
// result stays on screen and a non-blocking notice offers a retry; the page
// never turns into the error screen. A refresh that a newer navigation
// superseded stays silent.

async function waitUsable(page) {
  await expect.poll(() => page.evaluate(() => window.__MONIES_MAP_ROUTE_WORK__?.usable ?? false), { timeout: 30_000 }).toBe(true);
}

const notice = (page) => page.locator(".refresh-failure-notice");

function failJson(route) {
  return route.fulfill({
    status: 500,
    contentType: "application/json",
    body: JSON.stringify({ error: "Refresh failed in test." })
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("monies-map:money-totals-visible", "true");
    window.__MONIES_MAP_WARMUP_MODE__ = "off";
  });
  await reseedDemo(page);
});

test("a failed refresh after a month save keeps the saved value and offers a retry", async ({ page }) => {
  await page.goto("/month?view=person-tim&month=2026-05&scope=direct_plus_shared");
  await waitUsable(page);

  const row = page.locator("tr").filter({ hasText: "Entertainment" }).first();
  await expect(row).toBeVisible();
  await row.getByText("Entertainment").first().click();
  await row.locator(".table-edit-input-money").fill("123.45");

  let failRefresh = true;
  let refreshAttempts = 0;
  await page.route("**/api/month-page**", async (route) => {
    refreshAttempts += 1;
    if (failRefresh) {
      await failJson(route);
      return;
    }
    await route.continue().catch(() => {});
  });

  await page.locator(".month-inline-action-row").first().getByTestId("month-inline-save-button").click();
  await expect(notice(page)).toBeVisible();
  await expect(notice(page)).toContainText("saved");
  expect(refreshAttempts).toBeGreaterThan(0);
  // The saved value stays on screen and the page is not the error screen.
  await expect(row.locator("td").nth(2)).toContainText("123.45");
  await expect(page.getByRole("heading", { name: "Month", exact: true })).toBeVisible();
  await expect(page.locator(".app-loading-panel-error")).toHaveCount(0);

  // Retry once the server is back: the notice clears after a good refresh.
  failRefresh = false;
  const refreshed = page.waitForResponse((response) => response.url().includes("/api/month-page") && response.ok());
  await notice(page).getByRole("button", { name: "Refresh now" }).click();
  await refreshed;
  await expect(notice(page)).toHaveCount(0);
  await expect(row.locator("td").nth(2)).toContainText("123.45");
});

test("a failed background refresh from another tab's change shows the notice, not the error screen", async ({ page }) => {
  const other = await page.context().newPage();
  await page.goto("/month?view=household&month=2026-05&scope=direct_plus_shared");
  await other.goto("/month?view=household&month=2026-05&scope=direct_plus_shared");
  await waitUsable(page);

  await page.route("**/api/month-page**", failJson);
  await page.route("**/api/app-shell**", failJson);
  await other.evaluate(() => {
    localStorage.setItem("monies-map-app-sync", JSON.stringify({
      type: "entry-mutation", ts: Date.now(), month: "2026-05", invalidateEntries: true, invalidateMonth: true, invalidateSummary: false
    }));
  });

  await expect(notice(page)).toBeVisible();
  await expect(page.locator(".app-loading-panel-error")).toHaveCount(0);
  await expect(page.locator(".period-range-segment")).toHaveText("May 2026");
  await other.close();
});

test("a refresh superseded by moving to another month stays silent", async ({ page }) => {
  const other = await page.context().newPage();
  await page.goto("/month?view=household&month=2026-05&scope=direct_plus_shared");
  await other.goto("/month?view=household&month=2026-05&scope=direct_plus_shared");
  await waitUsable(page);

  let holdMay = false;
  let heldMay = 0;
  let releaseMay;
  const mayHeld = new Promise((resolve) => { releaseMay = resolve; });
  const failIfHeldMay = async (route) => {
    if (holdMay && new URL(route.request().url()).searchParams.get("month") === "2026-05") {
      heldMay += 1;
      await mayHeld;
      await failJson(route).catch(() => {});
      return;
    }
    await route.continue().catch(() => {});
  };
  await page.route("**/api/month-page**", failIfHeldMay);
  await page.route("**/api/app-shell**", failIfHeldMay);

  holdMay = true;
  await other.evaluate(() => {
    localStorage.setItem("monies-map-app-sync", JSON.stringify({
      type: "entry-mutation", ts: Date.now(), month: "2026-05", invalidateEntries: true, invalidateMonth: true, invalidateSummary: false
    }));
  });
  await expect.poll(() => heldMay).toBeGreaterThan(0);

  await page.getByRole("button", { name: /previous/i }).first().click();
  await expect(page).toHaveURL(/month=2025-10/);
  releaseMay();
  await waitUsable(page);
  await page.waitForTimeout(1_000);

  await expect(page.locator(".period-range-segment")).toHaveText("Oct 2025");
  await expect(notice(page)).toHaveCount(0);
  await expect(page.locator(".app-loading-panel-error")).toHaveCount(0);
  await other.close();
});
