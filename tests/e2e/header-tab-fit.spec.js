import { expect, test } from "@playwright/test";

import { reseedDemo } from "./helpers";

// On a small laptop (1,100 to about 1,220 px) the page tabs and the period
// controls share one header row. When they do not fit, the period controls
// must move below the tabs (as they do from 761 to 1,099 px) instead of the
// tab strip running under the "‹" button. Every page has the same header.

const PAGES = [
  "/summary?view=household&month=2026-05",
  "/month?view=person-tim&month=2026-05",
  "/entries?view=person-tim&month=2026-04",
  "/splits?view=household&month=2026-05",
  "/imports?view=household&month=2026-05",
  "/settings?view=household&month=2026-05",
  "/faq"
];

// For each tab, whether a press at its left edge, centre and right edge
// reaches the tab itself, and whether the period controls are reached at
// their centres.
function readHeaderHits(page) {
  return page.evaluate(() => {
    const reaches = (element, x, y) => {
      const hit = document.elementFromPoint(x, y);
      return Boolean(hit && element.contains(hit));
    };
    const tabs = [...document.querySelectorAll("nav.tab-strip > a.tab")].filter((tab) => tab.offsetParent);
    const tabHits = tabs.map((tab) => {
      const rect = tab.getBoundingClientRect();
      const y = rect.top + rect.height / 2;
      return {
        name: tab.textContent.trim(),
        left: reaches(tab, rect.left + 1, y),
        centre: reaches(tab, rect.left + rect.width / 2, y),
        right: reaches(tab, rect.right - 1, y)
      };
    });
    const controls = ['[aria-label="Previous period"]', '[aria-label="Next period"]', ".period-display", ".totals-visibility-toggle--header"]
      .map((selector) => document.querySelector(selector))
      .filter((element) => element?.offsetParent)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return reaches(element, rect.left + rect.width / 2, rect.top + rect.height / 2);
      });
    return { tabHits, controls };
  });
}

test.describe("header tabs and period controls on a small laptop", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await reseedDemo(page);
  });

  for (const width of [1120, 1200]) {
    test(`no tab is covered by the period controls at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      for (const path of PAGES) {
        await page.goto(path);
        await expect(page.locator("nav.tab-strip > a.tab").first()).toBeVisible();
        await expect(page.locator(".period-display")).toBeVisible();
        await page.evaluate(() => document.fonts.ready);

        const { tabHits, controls } = await readHeaderHits(page);
        expect(tabHits.map((tab) => tab.name), path).toEqual(["Summary", "Month", "Entries", "Splits", "Imports", "Settings", "FAQ"]);
        expect(tabHits.filter((tab) => !tab.left || !tab.centre || !tab.right), path).toEqual([]);
        expect(controls.length, path).toBeGreaterThanOrEqual(3);
        expect(controls.every(Boolean), path).toBe(true);
        // The page itself never scrolls sideways.
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), path).toBe(0);
      }
    });
  }
});
