import { expect, test } from "@playwright/test";

import { reseedDemo } from "./helpers";

const mobileViewport = { width: 390, height: 844 };

async function gotoPageAfterApi(page, path, apiPath) {
  const pageReady = page.waitForResponse((response) => (
    response.url().includes(apiPath) && response.ok()
  ), { timeout: 60_000 });
  await page.goto(path);
  await pageReady;
}

test.describe("mobile continuity", () => {
  test.beforeEach(async ({ page }) => {
    await reseedDemo(page);
    await page.setViewportSize(mobileViewport);
  });

  test("summary page stays readable on mobile", async ({ page }) => {
    await gotoPageAfterApi(
      page,
      "/summary?view=household&month=2026-04&scope=direct_plus_shared&summary_start=2025-06&summary_end=2026-04",
      "/api/summary-page"
    );
    await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "Spending Mix" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "Intent vs Outcome" })).toBeVisible({ timeout: 60_000 });
  });

  test("month page stays readable on mobile", async ({ page }) => {
    await gotoPageAfterApi(
      page,
      "/month?view=person-tim&month=2026-04&scope=direct_plus_shared",
      "/api/month-page"
    );
    await expect(page.getByRole("heading", { name: "Month" })).toBeVisible({ timeout: 60_000 });
  });

  test("splits page stays readable on mobile", async ({ page }) => {
    await gotoPageAfterApi(
      page,
      "/splits?view=person-tim&month=2026-04&scope=direct_plus_shared",
      "/api/splits-page"
    );
    await expect(page.getByRole("button", { name: "Non-group expenses" })).toBeVisible({ timeout: 60_000 });
  });

  test("imports page stays readable on mobile", async ({ page }) => {
    await gotoPageAfterApi(page, "/imports", "/api/imports-page");
    await expect(page.getByRole("heading", { name: "Import and certify", exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Source label")).toBeVisible({ timeout: 60_000 });
  });

  test("settings page stays readable on mobile", async ({ page }) => {
    await gotoPageAfterApi(page, "/settings", "/api/settings-page");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("button", { name: /People/ })).toBeVisible({ timeout: 60_000 });
  });
});
