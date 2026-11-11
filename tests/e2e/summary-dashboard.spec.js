import { expect, test } from "@playwright/test";

import { reseedDemo } from "./helpers";

// Summary as a dashboard (design.md "Summary dashboard layout"): 12 columns
// from a 1,100px window, two from 760px, one on a phone; the month list and
// the accounts start as a glance and open in place; the page is much shorter.
// Arrange cards keeps working with the grid (summary-arrange.spec.js).

const box = (locator) => locator.evaluate((element) => {
  const rect = element.getBoundingClientRect();
  return { x: rect.x, y: rect.y + window.scrollY, right: rect.right, bottom: rect.bottom + window.scrollY, width: rect.width, height: rect.height };
});

async function openSummary(page) {
  await page.goto("/?view=household");
  await expect(page.locator(".summary-cards-arrange button")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".summary-intent .summary-intent-tile").first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => window.__MONIES_MAP_ROUTE_WORK__?.usable ?? false), { timeout: 45_000 }).toBe(true);
}

test.describe("Summary dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await reseedDemo(page);
  });

  test("1440: the lead and Money insights share a row, Intent vs Outcome is two thirds wide, and Spending Mix is near the top", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openSummary(page);
    const grid = await box(page.locator(".summary-grid"));
    const lead = await box(page.locator(".summary-lead-slot"));
    const insights = await box(page.locator('[data-summary-card="insights"]'));
    expect(lead.width / grid.width).toBeGreaterThan(0.64);
    expect(lead.width / grid.width).toBeLessThan(0.69);
    expect(insights.x).toBeGreaterThanOrEqual(lead.right);
    expect(insights.y).toBe(lead.y);
    expect(insights.right).toBeLessThanOrEqual(grid.right + 1);
    const plan = await box(page.locator('[data-summary-card="plan"]'));
    expect(plan.width / grid.width).toBeGreaterThan(0.64);
    expect(plan.y).toBeGreaterThanOrEqual(lead.y + lead.height);
    // Spending Mix and Subscriptions and bills are half a row each, side by side.
    const mix = await box(page.locator('[data-summary-card="mix"]'));
    expect(mix.width / grid.width).toBeGreaterThan(0.45);
    expect(mix.width / grid.width).toBeLessThan(0.55);
    expect(mix.y).toBeLessThan(1800);
    const subs = page.locator('[data-summary-card="subs"]');
    if (await subs.count() && await subs.evaluate((element) => element.childElementCount > 0)) {
      expect((await box(subs)).y).toBe(mix.y);
      expect((await box(subs)).x).toBeGreaterThanOrEqual(mix.right);
    }
    // The page is up to 1,400px wide, with the usual gutters.
    expect(grid.width).toBeGreaterThan(1250);
    expect(grid.width).toBeLessThanOrEqual(1400);
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(sideways).toBeLessThanOrEqual(1);
  });

  test("1024: two columns, the lead and the long cards take the whole row", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await openSummary(page);
    const grid = await box(page.locator(".summary-grid"));
    const columns = await page.locator(".summary-grid").evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length);
    expect(columns).toBe(2);
    const lead = await box(page.locator(".summary-lead-slot"));
    expect(lead.width).toBeGreaterThan(grid.width - 2);
    const plan = await box(page.locator('[data-summary-card="plan"]'));
    expect(plan.width).toBeGreaterThan(grid.width - 2);
  });

  test("390: one column, every card the full width, and the page is much shorter", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openSummary(page);
    const grid = await box(page.locator(".summary-grid"));
    const slots = await page.locator(".summary-grid > *").evaluateAll((elements) => elements
      .filter((element) => element.getBoundingClientRect().height > 0)
      .map((element) => ({ x: Math.round(element.getBoundingClientRect().x), width: Math.round(element.getBoundingClientRect().width) })));
    expect(slots.length).toBeGreaterThan(3);
    for (const slot of slots) {
      expect(slot.x).toBe(Math.round(grid.x));
      expect(slot.width).toBe(Math.round(grid.width));
    }
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(height, "Summary at 390 is under 9,000px (it was about 19,000 with a long list of charges)").toBeLessThan(9000);
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(sideways).toBeLessThanOrEqual(1);
  });

  test("the month list starts as the latest 6 months and Open the details shows every month card", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openSummary(page);
    const tiles = page.locator(".summary-intent .summary-intent-tile");
    await expect(tiles).toHaveCount(6);
    await expect(page.locator(".summary-intent-month")).toHaveCount(0);
    // Each tile names its month and what it spent.
    await expect(tiles.first()).toContainText(/^[A-Z][a-z]{2} \d{4}/);
    const opener = page.getByRole("button", { name: "Open the details" });
    await expect(opener).toHaveAttribute("aria-expanded", "false");
    await opener.click();
    await expect(page.locator(".summary-intent-month").first()).toBeVisible();
    expect(await page.locator(".summary-intent-month").count()).toBeGreaterThanOrEqual(6);
    // The same button now says Details and folds them again.
    const closer = page.locator(".summary-intent").getByRole("button", { name: "Details", exact: true }).last();
    await expect(closer).toHaveAttribute("aria-expanded", "true");
    // A tile opens its month.
    await page.reload();
    await expect(tiles.first()).toBeVisible({ timeout: 30_000 });
    await tiles.first().click();
    await expect(page).toHaveURL(/\/month\?/);
  });

  test("a link that targets one month opens the month cards at once", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?view=household#month-2026-05");
    await expect(page.locator(".summary-intent-month").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".summary-intent .summary-intent-tile")).toHaveCount(6);
  });

  test("the accounts show their first 3 rows, and Show all lists the rest", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openSummary(page);
    const rows = page.locator(".summary-accounts .summary-wallet-row");
    await expect(rows).toHaveCount(3);
    const more = page.locator(".summary-accounts-more");
    await expect(more).toHaveText(/^Show all \d+ ›$/);
    const total = Number((await more.innerText()).match(/\d+/)[0]);
    expect(total).toBeGreaterThan(3);
    await more.click();
    await expect(rows).toHaveCount(total);
    await expect(more).toHaveText("Show fewer");
    await more.click();
    await expect(rows).toHaveCount(3);
  });

  test("hiding a card leaves no hole: its row-mate grows to fill the row", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openSummary(page);
    await page.locator(".summary-cards-arrange button").click();
    const dialog = page.getByRole("dialog", { name: "Arrange cards" });
    await dialog.locator('[data-card="accounts"] .summary-cards-name').click();
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(page.locator(".summary-accounts")).toHaveCount(0);
    const grid = await box(page.locator(".summary-grid"));
    // Every row of shown cards ends at the grid's right edge.
    const rows = await page.locator(".summary-grid > *").evaluateAll((elements) => elements
      .map((element) => element.getBoundingClientRect())
      .filter((rect) => rect.height > 0)
      .reduce((byTop, rect) => {
        const key = String(Math.round(rect.top));
        byTop[key] = Math.max(byTop[key] ?? 0, rect.right);
        return byTop;
      }, {}));
    expect(Object.keys(rows).length).toBeGreaterThan(2);
    for (const right of Object.values(rows)) expect(Math.abs(right - grid.right)).toBeLessThanOrEqual(1);
  });
});
