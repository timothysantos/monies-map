import { expect, test } from "@playwright/test";

import { reseedDemo } from "./helpers";

// H12c: generic route data has one owner. A background refresh of the old
// month (another tab's entry change) that finishes after the person has
// moved to another month must not replace the new month's page.

async function waitUsable(page) {
  await expect.poll(() => page.evaluate(() => window.__MONIES_MAP_ROUTE_WORK__?.usable ?? false), { timeout: 30_000 }).toBe(true);
}

test("a late background refresh of the previous month never replaces the month the person moved to", async ({ page }) => {
  await reseedDemo(page);
  await page.addInitScript(() => { window.__MONIES_MAP_WARMUP_MODE__ = "off"; });
  const other = await page.context().newPage();
  await page.goto("/month?view=household&month=2026-05&scope=direct_plus_shared");
  await other.goto("/month?view=household&month=2026-05&scope=direct_plus_shared");
  await waitUsable(page);

  let holdMay = false;
  let heldMay = 0;
  let releaseMay;
  const mayHeld = new Promise((resolve) => { releaseMay = resolve; });
  await page.route("**/api/month-page**", async (route) => {
    if (holdMay && new URL(route.request().url()).searchParams.get("month") === "2026-05") {
      heldMay += 1;
      await mayHeld;
    }
    await route.continue().catch(() => {});
  });

  // Another tab changed a May entry: this tab refreshes May in the background.
  holdMay = true;
  await other.evaluate(() => {
    localStorage.setItem("monies-map-app-sync", JSON.stringify({
      type: "entry-mutation", ts: Date.now(), month: "2026-05", invalidateEntries: true, invalidateMonth: true, invalidateSummary: false
    }));
  });
  await expect.poll(() => heldMay).toBe(1);

  // Meanwhile the person moves to the previous month, which loads at once.
  await page.getByRole("button", { name: /previous/i }).first().click();
  await expect(page).toHaveURL(/month=2025-10/);
  // Background refreshes count as required work (H03), so October is not
  // usable until the May refresh settles.
  await page.waitForTimeout(1_000);

  // The stale May refresh lands now; October must end up on screen and usable.
  releaseMay();
  await waitUsable(page);
  await page.waitForTimeout(1_000);
  await expect(page).toHaveURL(/month=2025-10/);
  await expect(page.locator(".period-range-segment")).toHaveText("Oct 2025");
  expect(await page.evaluate(() => window.__MONIES_MAP_ROUTE_WORK__?.usable)).toBe(true);
  await expect(page.locator(".app-loading-panel")).toHaveCount(0);
  await other.close();
});
