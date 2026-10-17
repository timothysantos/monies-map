import { expect, test } from "@playwright/test";

import { postJson, reseedDemo } from "./helpers";

const ENTRIES = "/entries?view=person-tim&month=2025-10&entries_scope=direct_plus_shared";

async function seedLongEntries(page, count = 18) {
  for (let index = 0; index < count; index += 1) {
    await postJson(page, "/api/entries/create", {
      date: `2025-10-${String(index + 1).padStart(2, "0")}`,
      description: `Scrolling shortcut ${index + 1}`,
      accountName: "UOB One",
      categoryName: "Groceries",
      amountMinor: 1200 + index,
      entryType: "expense",
      ownershipType: "direct",
      ownerName: "Tim"
    });
  }
}

async function openLongEntries(page, viewport) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize(viewport);
  await reseedDemo(page);
  await seedLongEntries(page);
  await page.goto(ENTRIES, { waitUntil: "domcontentloaded" });
  await expect.poll(() => page.evaluate(() => window.__MONIES_MAP_ROUTE_WORK__?.usable ?? false), { timeout: 60_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight * 1.7)).toBe(true);
}

async function scrollTo(page, top) {
  await page.evaluate((value) => window.scrollTo({ top: value, behavior: "instant" }), top);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(160);
}

test.describe("context and scroll shortcuts", () => {
  test("desktop restores View and scope after the Entries header has scrolled away", async ({ page }) => {
    await openLongEntries(page, { width: 1280, height: 800 });
    await scrollTo(page, 360);

    const bar = page.locator(".mobile-context-sticky-wrap.is-desktop-visible");
    await expect(bar).toBeVisible();
    await expect(bar.locator(".desktop-floating-tabs")).toBeVisible();
    await expect(bar.locator(".desktop-floating-tabs").getByRole("link", { name: "Summary" })).toBeVisible();
    await expect(bar.locator(".desktop-floating-tabs").getByRole("link", { name: "Entries" })).toBeVisible();
    await expect(bar.locator(".desktop-floating-tabs").getByRole("link", { name: "Splits" })).toBeVisible();
    await expect(bar.locator(".desktop-floating-tabs").getByRole("link", { name: "Ask" })).toBeVisible();
    await expect(bar.locator(".mobile-context-person-chip")).toHaveText("Tim");
    await expect(bar.locator(".mobile-context-scope")).toHaveText("Direct + Shared");
    const box = await bar.boundingBox();
    expect(box.x).toBeLessThanOrEqual(23);
    expect(Math.abs(box.y + box.height - 800 + 29)).toBeLessThanOrEqual(2);
    const tabsBox = await bar.locator(".desktop-floating-tabs").boundingBox();
    expect(Math.abs((tabsBox.y + tabsBox.height / 2) - (box.y + box.height / 2))).toBeLessThanOrEqual(1);
    for (const tab of await bar.locator(".desktop-floating-tabs .tab").all()) {
      const tabBox = await tab.boundingBox();
      expect(Math.abs((tabBox.y + tabBox.height / 2) - (box.y + box.height / 2))).toBeLessThanOrEqual(1);
    }
    const monthJump = await bar.locator(".mobile-month-jump").boundingBox();
    expect(Math.abs(monthJump.x + monthJump.width - box.x - box.width)).toBeLessThanOrEqual(10);
    await bar.locator(".mobile-context-trigger").click();
    await expect(page.getByRole("dialog", { name: "View and scope" })).toBeVisible();
  });

  for (const [name, viewport] of [
    ["desktop", { width: 1280, height: 800 }],
    ["phone", { width: 390, height: 844 }]
  ]) {
    test(`${name} shows a short-lived direction button and moves to both ends`, async ({ page }) => {
      await openLongEntries(page, viewport);
      await scrollTo(page, 560);
      const toBottom = page.getByRole("button", { name: "Go to bottom" });
      await expect(toBottom).toBeVisible();
      const directionBox = await toBottom.boundingBox();
      expect(Math.abs((directionBox.x + directionBox.width / 2) - viewport.width / 2)).toBeLessThanOrEqual(1);
      expect(directionBox.y + directionBox.height).toBeGreaterThan(viewport.height - 160);
      await page.evaluate(() => window.scrollTo({ top: 220, behavior: "instant" }));
      const toTop = page.getByRole("button", { name: "Go to top" });
      await expect(toTop).toBeVisible();
      await toTop.click();
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(1);

      await scrollTo(page, 420);
      await expect(toBottom).toBeVisible();
      await toBottom.click();
      await expect.poll(() => page.evaluate(() => Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight - 2)).toBe(true);
    });
  }
});
