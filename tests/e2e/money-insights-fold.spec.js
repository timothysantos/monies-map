import { expect, test } from "@playwright/test";

import { gotoPageAfterApi, postJson, reseedDemo } from "./helpers";

// On a phone the Money insights fold to one row (financial-insight.jsx,
// InsightFoldRow). Folded is the default; the choice is remembered in this
// browser. A To do headline stays in the row, so a warning is never hidden.
const PHONE = { width: 390, height: 664 };
const OPEN_KEY = "monies-map:money-insights-phone";

const SUMMARY = ["/summary?view=household&month=2026-05&scope=direct_plus_shared&summary_start=2026-05&summary_end=2026-05", "/api/summary-page", "Summary"];
const MONTH = ["/month?view=person-tim&month=2026-05&scope=direct_plus_shared", "/api/month-page", "Month"];

async function open(page, [path, api]) {
  await gotoPageAfterApi(page, path, api, () => page.locator(".financial-insight").first());
}

const foldRow = (page) => page.locator(".financial-insight .financial-insight-fold");

async function waitUsable(page) {
  await expect.poll(() => page.evaluate(() => window.__MONIES_MAP_ROUTE_WORK__?.usable ?? false), { timeout: 30_000 }).toBe(true);
}

async function seedTripSplits(page) {
  const { groupId } = await postJson(page, "/api/splits/groups/create", { name: "Tokyo trip", currency: "JPY", expenseSource: "cash" });
  await postJson(page, "/api/splits/expenses/create", {
    groupId, date: "2026-05-12", description: "Shinjuku hotel", categoryName: "Travel", payerPersonName: "Tim",
    amountMinor: 1_200_000, splitBasisPoints: 2500, currency: "JPY", paymentMethod: "cash", paymentStatus: "recorded"
  });
  return [`/splits?view=person-tim&month=2026-05&split_group=${groupId}`, "/api/splits-page", "Splits"];
}

test.describe("money insights fold on a phone", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await reseedDemo(page);
  });

  test("Summary folds to one short row with the count and opens to the full block", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await open(page, SUMMARY);
    const row = foldRow(page);
    await expect(row).toHaveAttribute("aria-expanded", "false");
    await expect(row).toContainText("Household money insights");
    await expect(row).toContainText(/\d+ insights?$/);
    const section = page.locator(".financial-insight");
    expect((await section.boundingBox()).height).toBeLessThanOrEqual(64);
    expect((await row.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await expect(page.locator(".financial-insight .checkin-fact")).toBeHidden();

    await row.click();
    await expect(row).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".financial-insight .checkin-fact")).toBeVisible();
    await expect(page.getByRole("button", { name: "See all insights" })).toBeVisible();
    await expect.poll(async () => (await section.boundingBox()).height).toBeGreaterThan(120);

    await row.click();
    await expect(row).toHaveAttribute("aria-expanded", "false");
    expect((await section.boundingBox()).height).toBeLessThanOrEqual(64);
  });

  test("Splits folds to one row that keeps the To do headline in view", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await open(page, await seedTripSplits(page));
    const row = foldRow(page);
    await expect(row).toHaveAttribute("aria-expanded", "false");
    await expect(row.locator(".checkin-chip")).toHaveText("To do");
    await expect(row.locator(".financial-insight-peek-fact")).toContainText("Joyce owes you JP¥9,000");
    expect((await page.locator(".financial-insight").boundingBox()).height).toBeLessThanOrEqual(64);
    // One line: the headline is truncated, never wrapped.
    expect((await row.locator(".financial-insight-peek-fact").boundingBox()).height).toBeLessThan(26);
    await row.click();
    await expect(page.locator(".financial-insight-content .checkin-fact")).toContainText("Joyce owes you JP¥9,000");
  });

  test("Month shows its To do headline when folded and the choice survives a reload", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await open(page, MONTH);
    const row = foldRow(page);
    await expect(row.locator(".checkin-chip")).toHaveText("To do");
    await expect(row.locator(".financial-insight-peek-fact")).toContainText(/\bbills? (?:you )?planned\b|\bplanned at\b/);
    await row.click();
    await expect(row).toHaveAttribute("aria-expanded", "true");
    expect(await page.evaluate((key) => window.localStorage.getItem(key), OPEN_KEY)).toBe("true");

    await page.reload();
    await waitUsable(page);
    await expect(foldRow(page)).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".financial-insight .checkin-fact")).toBeVisible();

    await foldRow(page).click();
    await page.reload();
    await waitUsable(page);
    await expect(foldRow(page)).toHaveAttribute("aria-expanded", "false");
  });

  test("hidden money folds to the eyebrow and a count, with no amounts or headline", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "false"));
    await open(page, MONTH);
    const row = foldRow(page);
    await expect(row).toBeVisible();
    await expect(row.locator(".checkin-chip")).toHaveCount(0);
    const text = (await row.innerText()).replace(/\s+/g, " ").trim();
    expect(text).toMatch(/^Tim's money insights \d+ insights?$/i);
    expect(text).not.toMatch(/\$|owe|short|over|under/i);
    expect((await page.locator(".financial-insight").boundingBox()).height).toBeLessThanOrEqual(64);
  });

  test("desktop starts expanded on a first visit, can fold, and remembers it apart from the phone", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page, MONTH);
    const row = foldRow(page);
    await expect(row).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".financial-insight .checkin-fact")).toBeVisible();
    await expect(page.getByRole("button", { name: "See all insights" })).toBeVisible();

    await row.click();
    await expect(row).toHaveAttribute("aria-expanded", "false");
    await expect(row.locator(".checkin-chip")).toHaveText("To do");
    await expect(page.locator(".financial-insight .checkin-fact")).toBeHidden();
    expect((await page.locator(".financial-insight").boundingBox()).height).toBeLessThanOrEqual(64);
    // The desktop choice is its own key; the phone's key is untouched.
    expect(await page.evaluate(() => [localStorage.getItem("monies-map:money-insights-desktop"), localStorage.getItem("monies-map:money-insights-phone")])).toEqual(["false", null]);

    await page.reload();
    await waitUsable(page);
    await expect(foldRow(page)).toHaveAttribute("aria-expanded", "false");
    // Narrowing to a phone: still its own default (folded), and opening it
    // there leaves the desktop choice alone.
    await page.setViewportSize(PHONE);
    await expect(foldRow(page)).toHaveAttribute("aria-expanded", "false");
    await foldRow(page).click();
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(foldRow(page)).toHaveAttribute("aria-expanded", "false");
  });

  test("a phone fold choice does not change desktop", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await open(page, MONTH);
    await foldRow(page).click();
    await expect(foldRow(page)).toHaveAttribute("aria-expanded", "true");
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(foldRow(page)).toHaveAttribute("aria-expanded", "true");
    await foldRow(page).click();
    await page.setViewportSize(PHONE);
    await expect(foldRow(page)).toHaveAttribute("aria-expanded", "true");
  });

  test("Splits folds and opens on desktop too", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page, await seedTripSplits(page));
    const row = foldRow(page);
    await expect(row).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".financial-insight .checkin-fact")).toContainText("Joyce owes you JP¥9,000");
    await row.click();
    await expect(row.locator(".financial-insight-peek-fact")).toContainText("Joyce owes you JP¥9,000");
    await expect(page.locator(".financial-insight .checkin-fact")).toBeHidden();
  });

  test("without usable storage the phone block still renders folded and toggles", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.addInitScript(() => {
      const realGet = Storage.prototype.getItem;
      const realSet = Storage.prototype.setItem;
      Storage.prototype.getItem = function (key) {
        if (key.startsWith("monies-map:money-insights-")) throw new Error("blocked");
        return realGet.call(this, key);
      };
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith("monies-map:money-insights-")) throw new Error("blocked");
        return realSet.call(this, key, value);
      };
    });
    await open(page, MONTH);
    await expect(foldRow(page)).toHaveAttribute("aria-expanded", "false");
    await foldRow(page).click();
    await expect(foldRow(page)).toHaveAttribute("aria-expanded", "true");
  });
});
