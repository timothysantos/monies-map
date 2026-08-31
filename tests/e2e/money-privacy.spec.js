import { expect, test } from "@playwright/test";

import { gotoPageAfterApi, reseedDemo } from "./helpers";

test("money totals start hidden, reveal together, and leave transaction amounts visible", async ({ page }) => {
  await reseedDemo(page);

  await gotoPageAfterApi(
    page,
    "/summary?view=household&month=2026-05&scope=direct_plus_shared&summary_start=2026-05&summary_end=2026-05",
    "/api/summary-page",
    () => page.getByRole("heading", { name: "Summary", exact: true })
  );

  const toggle = page.getByRole("button", { name: "Show money totals" });
  await expect(toggle).toBeVisible();
  await expect(page.locator(".metric strong").first()).toHaveText("••••");
  await expect(page.locator(".financial-insight-summary")).toContainText("Reveal money totals to read this insight.");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(toggle).toBeVisible();
  const mobileWidth = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth
  }));
  expect(mobileWidth.documentWidth).toBeLessThanOrEqual(mobileWidth.viewportWidth + 1);
  await page.setViewportSize({ width: 1280, height: 720 });

  await toggle.click();
  await expect(page.getByRole("button", { name: "Hide money totals" })).toBeVisible();
  await expect(page.locator(".metric strong").first()).not.toHaveText("••••");
  await expect(page.locator(".financial-insight-summary")).not.toContainText("Reveal money totals to read this insight.");

  await page.reload();
  await expect(page.getByRole("button", { name: "Hide money totals" })).toBeVisible();

  await page.getByRole("button", { name: "Hide money totals" }).click();
  await gotoPageAfterApi(
    page,
    "/entries?view=person-tim&month=2026-05&scope=direct_plus_shared",
    "/api/entries-page",
    () => page.getByRole("heading", { name: "Entries", exact: true })
  );
  await expect(page.locator(".entries-totals-strip")).toContainText("••••");
  await expect(page.locator(".entry-row strong").first()).not.toHaveText("••••");

  await gotoPageAfterApi(
    page,
    "/splits?view=person-tim&month=2026-05&split_group=split-group-none",
    "/api/splits-page",
    () => page.getByRole("heading", { name: "Splits", exact: true })
  );
  await expect(page.locator(".split-group-pill-content").first()).toContainText("Balance hidden");
  await expect(page.locator(".split-activity-card").first()).not.toContainText("••••");
});
