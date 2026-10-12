// The bottom-right Ask field never sits on a page control: the page keeps
// room under its content (and the Imports commit bar stays above the field)
// at 1,280 px (docked) and 1,024 px (popup) widths.
import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";

import { reseedDemo } from "./helpers.js";
import { ONE_CARD, setUpWrongCardLedger } from "./uob-wrong-card-statement.js";

const dockField = (page) => page.locator(".ask-dock-field");

// The control is clear of the field's box and a press at its centre lands on it.
async function expectClearOfDock(page, locator, label) {
  await locator.scrollIntoViewIfNeeded();
  await expect(dockField(page), label).toBeVisible();
  const result = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const dock = document.querySelector(".ask-dock-field").getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      overlaps: rect.left < dock.right && rect.right > dock.left && rect.top < dock.bottom && rect.bottom > dock.top,
      reachable: Boolean(hit && element.contains(hit))
    };
  });
  expect(result, label).toEqual({ overlaps: false, reachable: true });
}

// Scrolled to the end of the page, so only the reserved room can keep a
// last control out from under the fixed field.
async function scrollToEnd(page) {
  // Polled: a late render or a restored scroll position can move it after the first jump.
  await expect.poll(() => page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    return Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight;
  })).toBe(true);
}

for (const width of [1280, 1024]) {
  test.describe(`${width} px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
      await page.setViewportSize({ width, height: 800 });
    });

    test("the Imports commit button is clear of the Ask field", async ({ page }, testInfo) => {
      test.setTimeout(120_000);
      await setUpWrongCardLedger(page);
      const csv = testInfo.outputPath("one-card-activity.csv");
      await writeFile(csv, ["date,description,amount,account,category", `2026-05-15,GRAB RIDES SINGAPORE,-12.30,${ONE_CARD},Other`].join("\n"));
      await page.goto("/imports");
      await page.locator("input[type=file]").setInputFiles(csv);
      await page.getByRole("button", { name: "Preview import" }).click();
      const commit = page.locator(".import-commit-bar .import-commit-button");
      await expect(commit).toBeVisible({ timeout: 60_000 });
      await expect(dockField(page)).toBeVisible();
      await expectClearOfDock(page, commit, "commit, as first shown");
      await scrollToEnd(page);
      await expectClearOfDock(page, commit, "commit, page end");
    });

    test("the Splits controls at the page end are clear of the Ask field", async ({ page }) => {
      await page.goto("/");
      await reseedDemo(page);
      await page.goto("/splits?view=person-tim&month=2025-10&split_group=split-group-baby-river");
      await page.waitForFunction(() => window.__MONIES_MAP_ROUTE_WORK__?.usable === true, null, { timeout: 60_000 });
      await expect(dockField(page)).toBeVisible();
      await scrollToEnd(page);
      await expectClearOfDock(page, page.locator(".splits-fab"), "receipt button");
      // Every button, select and link still on screen at the page end.
      const names = await page.evaluate(() => {
        const dock = document.querySelector(".ask-dock-field").getBoundingClientRect();
        return [...document.querySelectorAll("main button, main select, main a[href], main input")]
          .filter((element) => !element.closest(".ask-dock-field") && element.getBoundingClientRect().width > 0)
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            return rect.left < dock.right && rect.right > dock.left && rect.top < dock.bottom && rect.bottom > dock.top;
          })
          .map((element) => `${element.tagName}.${element.className} ${element.getAttribute("aria-label") ?? element.textContent.trim().slice(0, 40)}`);
      });
      expect(names).toEqual([]);
    });
  });
}
