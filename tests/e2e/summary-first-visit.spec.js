import { expect, test } from "@playwright/test";

import { reseedDemo } from "./helpers";

// The import banner on Summary reads the Imports answer, which a desktop
// fetches a few seconds after the first screen (route warmup), so on a device
// that has never seen it the banner used to land late and push the whole page
// down (about 90px, layout shift 0.055 at 1440). A first visit now keeps the
// room a banner usually takes (src/client/import-banner-reserve.js), and a
// phone, which never fetches Imports for the banner, keeps none. The default
// test profile has no remembered banner height, so every test here is a first visit.

test.describe("First visit: the import banner arrives late", () => {
  test.beforeEach(async ({ page }) => {
    await reseedDemo(page);
  });

  test("1440: nothing under the banner moves when it lands on a device that has never seen it", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      window.__shift = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) window.__shift += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto("/?view=household");
    const lead = page.locator(".summary-lead");
    await expect(lead).toBeVisible({ timeout: 30_000 });
    // Before the Imports answer: the room is already kept.
    const slot = page.locator(".import-banner-slot");
    await expect(slot).toBeVisible();
    const top = () => lead.evaluate((element) => Math.round(element.getBoundingClientRect().top));
    const before = await top();
    expect(await slot.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(70);
    // The banner lands and the lead has not moved (give or take the banner's own wrapping).
    await expect(slot.locator(".state-banner")).toBeVisible({ timeout: 30_000 });
    expect(Math.abs((await top()) - before)).toBeLessThanOrEqual(24);
    const afterLanding = await top();
    await page.waitForTimeout(1500);
    expect(await top()).toBe(afterLanding);
    // The page's whole layout shift stays small (it was 0.065 with the banner pushing the page).
    expect(await page.evaluate(() => window.__shift)).toBeLessThanOrEqual(0.03);
    // The real height is remembered for the next visit.
    expect(await page.evaluate(() => Number(window.localStorage.getItem("monies-map:import-banner-height")))).toBeGreaterThan(0);
  });

  test("390: a phone keeps no room for a banner it never fetches", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?view=household");
    await expect(page.locator(".summary-lead")).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    await expect(page.locator(".import-banner-slot")).toHaveCount(0);
  });
});
