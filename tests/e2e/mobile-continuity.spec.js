import { expect, test } from "@playwright/test";

import { gotoPageAfterApi, reseedDemo } from "./helpers";

const mobileViewport = { width: 390, height: 844 };

test.describe("mobile continuity", () => {
  test.beforeEach(async ({ page }) => {
    await reseedDemo(page);
    await page.setViewportSize(mobileViewport);
  });

  test("summary page stays readable on mobile", async ({ page }) => {
    await gotoPageAfterApi(
      page,
      "/summary?view=household&month=2026-04&scope=direct_plus_shared&summary_start=2025-06&summary_end=2026-04",
      "/api/summary-page",
      () => page.getByRole("heading", { name: "Summary" })
    );
    await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "Spending Mix" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "Intent vs Outcome" })).toBeVisible({ timeout: 60_000 });
  });

  test("month page stays readable on mobile", async ({ page }) => {
    await gotoPageAfterApi(
      page,
      "/month?view=person-tim&month=2026-04&scope=direct_plus_shared",
      "/api/month-page",
      () => page.getByRole("heading", { name: "Month" })
    );
    await expect(page.getByRole("heading", { name: "Month" })).toBeVisible({ timeout: 60_000 });
  });

  test("splits page stays readable on mobile", async ({ page }) => {
    await gotoPageAfterApi(
      page,
      "/splits?view=person-tim&month=2026-04&scope=direct_plus_shared",
      "/api/splits-page",
      () => page.getByRole("button", { name: "Non-group expenses" })
    );
    await expect(page.getByRole("button", { name: "Non-group expenses" })).toBeVisible({ timeout: 60_000 });
  });

  test("imports page stays readable on mobile", async ({ page }) => {
    await gotoPageAfterApi(
      page,
      "/imports",
      "/api/imports-page",
      () => page.getByRole("heading", { name: "Import and certify", exact: true })
    );
    await expect(page.getByRole("heading", { name: "Import and certify", exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Source label")).toBeVisible({ timeout: 60_000 });
  });

  test("settings page stays readable on mobile", async ({ page }) => {
    await gotoPageAfterApi(
      page,
      "/settings",
      "/api/settings-page",
      () => page.getByRole("heading", { name: "Settings" })
    );
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("button", { name: /People/ })).toBeVisible({ timeout: 60_000 });
  });
});
