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

// Whether a tap at the element's centre reaches it (nothing floats over it).
function isOnTop(locator) {
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  });
}

function overlaps(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
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
    // The kept-in-view copy of the page links is its own landmark: a screen
    // reader lists two navigations with two names, never one name twice.
    await expect(page.getByRole("navigation", { name: "Dashboard sections", exact: true })).toHaveCount(1);
    await expect(bar.getByRole("navigation", { name: "Dashboard sections, kept in view", exact: true })).toBeVisible();
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
      const labelBox = await tab.locator(".tab-label-with-badge").boundingBox();
      expect(Math.abs((labelBox.y + labelBox.height / 2) - (box.y + box.height / 2))).toBeLessThanOrEqual(2);
    }
    const monthJump = await bar.locator(".mobile-month-jump").boundingBox();
    expect(Math.abs(monthJump.x + monthJump.width - box.x - box.width)).toBeLessThanOrEqual(10);
    await expect(bar.locator(".mobile-month-jump-label")).toHaveText("Oct 2025");
    await bar.locator(".mobile-context-trigger").click();
    await expect(page.getByRole("dialog", { name: "View and scope" })).toBeVisible();
  });

  test("desktop Summary keeps Plan and Simple in its floating bar", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await reseedDemo(page);
    await page.goto("/summary?view=person-tim&month=2025-10", { waitUntil: "domcontentloaded" });
    await expect.poll(() => page.evaluate(() => window.__MONIES_MAP_ROUTE_WORK__?.usable ?? false), { timeout: 60_000 }).toBe(true);
    await page.evaluate(() => window.scrollTo({ top: 600, behavior: "instant" }));
    const bar = page.locator(".mobile-context-sticky-wrap.is-desktop-visible");
    await expect(bar).toBeVisible();
    const switcher = bar.getByRole("radiogroup", { name: "Show this period" });
    await switcher.getByRole("radio", { name: "Simple" }).check();
    await expect(page.locator(".summary-lead-group[data-lead-view=simple]")).toBeVisible();
    await switcher.getByRole("radio", { name: "Plan" }).check();
    await expect(page.locator(".summary-lead-group[data-lead-view=plan]")).toBeVisible();
    await expect(switcher.getByRole("radio", { name: "Plan" })).toBeChecked();
    for (const width of [1280, 900, 761]) {
      await page.setViewportSize({ width, height: 800 });
      const barBox = await bar.boundingBox();
      const tabsBox = await bar.locator(".desktop-floating-tabs").boundingBox();
      const switchBox = await switcher.boundingBox();
      const monthBox = await bar.locator(".mobile-month-choice").boundingBox();
      expect(switchBox.x).toBeGreaterThanOrEqual(tabsBox.x + tabsBox.width);
      expect(monthBox.x).toBeGreaterThanOrEqual(switchBox.x + switchBox.width);
      expect(monthBox.x + monthBox.width).toBeLessThanOrEqual(barBox.x + barBox.width + 1);
    }

    await page.goto("/month?view=person-tim&month=2025-10", { waitUntil: "domcontentloaded" });
    await expect.poll(() => page.evaluate(() => window.__MONIES_MAP_ROUTE_WORK__?.usable ?? false), { timeout: 60_000 }).toBe(true);
    await page.evaluate(() => window.scrollTo({ top: 600, behavior: "instant" }));
    const monthBar = page.locator(".mobile-context-sticky-wrap.is-desktop-visible");
    await expect(monthBar.getByRole("radiogroup", { name: "Show this period" }).getByRole("radio", { name: "Plan" })).toBeChecked();
    await expect(monthBar.locator(".mobile-month-choice")).toContainText("Oct 2025");
  });

  // The Month bar once cut its scope to "Direct + Shar…" beside Plan | Simple
  // and the month (95f91554). The bar grows to its controls instead.
  test("desktop Month bar shows the whole scope at 1280, 1440 and 1920 px", async ({ page }) => {
    await reseedDemo(page);
    for (const width of [1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/month?view=person-tim&month=2025-10&scope=direct_plus_shared", { waitUntil: "domcontentloaded" });
      await expect.poll(() => page.evaluate(() => window.__MONIES_MAP_ROUTE_WORK__?.usable ?? false), { timeout: 60_000 }).toBe(true);
      await page.evaluate(() => window.scrollTo({ top: 900, behavior: "instant" }));
      const bar = page.locator(".mobile-context-sticky-wrap.is-desktop-visible");
      await expect(bar).toBeVisible();
      const scope = bar.locator(".mobile-context-scope");
      await expect(scope).toHaveText("Direct + Shared");
      const fits = await scope.evaluate((element) => element.scrollWidth <= element.clientWidth + 1 && getComputedStyle(element).textOverflow !== "ellipsis");
      expect(fits, `scope fits at ${width}px`).toBe(true);
      // One line, inside the bar, the bar inside the window.
      const scopeBox = await scope.boundingBox();
      const barBox = await bar.boundingBox();
      expect(scopeBox.height).toBeLessThan(24);
      expect(scopeBox.x + scopeBox.width).toBeLessThanOrEqual(barBox.x + barBox.width);
      expect(barBox.x + barBox.width).toBeLessThanOrEqual(width - 22 + 1);
      await expect(bar.getByRole("radiogroup", { name: "Show this period" })).toBeVisible();
      await expect(bar.locator(".mobile-month-choice")).toContainText("Oct 2025");
    }
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
      // One lucide chevron, on the island's solid chrome surface (not see-through).
      await expect(toBottom.locator("svg path")).toHaveAttribute("d", "m6 9 6 6 6-6");
      expect(await toBottom.evaluate((element) => element.textContent.trim())).toBe("");
      await expect(toBottom).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      expect(await isOnTop(toBottom)).toBe(true);
      expect(directionBox.y + directionBox.height).toBeGreaterThan(viewport.height - 160);
      await page.evaluate(() => window.scrollTo({ top: 220, behavior: "instant" }));
      const toTop = page.getByRole("button", { name: "Go to top" });
      await expect(toTop).toBeVisible();
      await expect(toTop.locator("svg path")).toHaveAttribute("d", "m18 15-6-6-6 6");
      await toTop.click();
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(1);

      await scrollTo(page, 420);
      await expect(toBottom).toBeVisible();
      await toBottom.click();
      await expect.poll(() => page.evaluate(() => Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight - 2)).toBe(true);
    });
  }

  // The direction button never hides behind what floats at the bottom of a
  // phone: the island with its context row on top, the From Ask chip, or the
  // Splits group bar.
  for (const [name, path, cover] of [
    ["the stacked island", `${ENTRIES.replace("direct_plus_shared", "direct")}&entry_type=expense`, ".mobile-context-sticky-wrap"],
    ["the From Ask chip", `${ENTRIES}&from_ask=1&entry_search=shortcut`, ".entries-ask-chip.is-floating"],
    ["the Splits group bar", "/splits?view=person-tim&month=2025-10&split_group=split-group-none", ".splits-group-bar"]
  ]) {
    test(`phone direction button stays clear of ${name}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width: 390, height: 844 });
      await reseedDemo(page);
      await seedLongEntries(page);
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expect.poll(() => page.evaluate(() => window.__MONIES_MAP_ROUTE_WORK__?.usable ?? false), { timeout: 60_000 }).toBe(true);
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await page.mouse.wheel(0, 260);
      const button = page.locator(".scroll-direction-fab");
      await expect(button).toBeVisible();
      await expect(page.locator(cover)).toBeVisible();
      expect(overlaps(await button.boundingBox(), await page.locator(cover).boundingBox())).toBe(false);
      expect(await isOnTop(button)).toBe(true);
    });
  }

  test("a narrow desktop window keeps the floating bar clear of the Ask field and the add button", async ({ page }) => {
    await openLongEntries(page, { width: 900, height: 800 });
    await scrollTo(page, 420);
    const bar = page.locator(".mobile-context-sticky-wrap.is-desktop-visible");
    await expect(bar).toBeVisible();
    const barBox = await bar.boundingBox();
    for (const selector of [".ask-dock-field", ".entries-fab"]) {
      const other = page.locator(selector).first();
      await expect(other).toBeVisible();
      expect(overlaps(barBox, await other.boundingBox())).toBe(false);
      expect(await isOnTop(other)).toBe(true);
    }
    await page.mouse.wheel(0, 200);
    const button = page.locator(".scroll-direction-fab");
    await expect(button).toBeVisible();
    expect(overlaps(barBox, await button.boundingBox())).toBe(false);
  });
});
