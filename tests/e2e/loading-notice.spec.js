import { expect, test } from "@playwright/test";

import { reseedDemo } from "./helpers";

// One loading notice at a time (design.md "Loading, later"). A first visit to
// Entries runs two fetches: the shell's route load and the Entries page's own
// load. Each used to draw its own "Loading latest data..." pill, and the
// Entries one sat inside the card (a backdrop-filter panel is the containing
// block of a fixed child), so the two overlapped and the card's pill covered
// the Combined button. This test slows every API answer, reloads Entries and
// samples every frame: never more than one pill, and a pill never over a
// control.
const SIZES = [
  { name: "desktop 1440", width: 1440, height: 900 },
  { name: "phone 390", width: 390, height: 844 }
];

async function recordPills(page) {
  await page.addInitScript(() => {
    const CONTROLS = "button, a[href], input, select, textarea, summary, [role='button'], [role='tab'], [role='link']";
    const shown = (element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
    const intersects = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    window.__pills = { frames: 0, most: 0, covered: [] };
    const sample = () => {
      const pills = [...document.querySelectorAll(".app-loading-overlay")].filter(shown);
      window.__pills.most = Math.max(window.__pills.most, pills.length);
      if (pills.length) window.__pills.frames += 1;
      for (const pill of pills) {
        const box = pill.getBoundingClientRect();
        for (const control of document.querySelectorAll(CONTROLS)) {
          if (pill.contains(control) || !shown(control)) continue;
          const rect = control.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0 && intersects(box, rect)) {
            const label = (control.getAttribute("aria-label") || control.textContent || control.className || "").trim().slice(0, 40);
            window.__pills.covered.push(`${control.tagName} "${label}"`);
          }
        }
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

test.describe("Loading notice", () => {
  for (const size of SIZES) {
    test(`${size.name}: opening Entries on a slow connection shows one pill and it covers no control`, async ({ page }) => {
      await reseedDemo(page);
      await page.setViewportSize({ width: size.width, height: size.height });
      await recordPills(page);
      await page.route("**/api/**", async (route) => {
        if (!route.request().url().includes("/api/demo/")) await new Promise((resolve) => setTimeout(resolve, 1500));
        await route.continue().catch(() => {});
      });
      await page.goto("/entries?view=household", { waitUntil: "domcontentloaded" });
      await expect(page.locator(".entry-row").first()).toBeVisible({ timeout: 30_000 });
      await expect(page.locator(".app-loading-overlay")).toHaveCount(0, { timeout: 30_000 });

      const seen = await page.evaluate(() => window.__pills);
      // Not vacuous: a pill was on screen for a while.
      expect(seen.frames).toBeGreaterThan(5);
      expect(seen.most, "two loading pills at once").toBe(1);
      expect([...new Set(seen.covered)], "a loading pill covers a control").toEqual([]);
    });
  }
});
