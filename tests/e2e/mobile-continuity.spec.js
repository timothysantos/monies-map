import { expect, test } from "@playwright/test";

import { reseedDemo } from "./helpers";

const mobileViewport = { width: 390, height: 844 };

test.describe("mobile continuity", () => {
  test.beforeEach(async ({ page }) => {
    await reseedDemo(page);
    await page.setViewportSize(mobileViewport);
  });

  test("summary page stays readable on mobile", async ({ page }) => {
    await page.goto("/summary?view=household&month=2026-04&scope=direct_plus_shared&summary_start=2025-06&summary_end=2026-04");
    await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Spending Mix" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Intent vs Outcome" })).toBeVisible();
  });

  test("month page stays readable on mobile", async ({ page }) => {
    await page.goto("/month?view=person-tim&month=2026-04&scope=direct_plus_shared");
    await expect(page.getByRole("heading", { name: "Month" })).toBeVisible();
  });

  test("splits page stays readable on mobile", async ({ page }) => {
    await page.goto("/splits?view=person-tim&month=2026-04&scope=direct_plus_shared");
    await expect(page.getByRole("button", { name: "Create group" })).toBeVisible();
    await expect(page.getByRole("button", { name: "+ Add expense" })).toBeVisible();
  });

  test("imports page stays readable on mobile", async ({ page }) => {
    await page.goto("/imports");
    await expect(page.getByRole("heading", { name: "Imports", exact: true })).toBeVisible();
  });

  test("settings page stays readable on mobile", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  });
});
