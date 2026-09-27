import { expect, test } from "@playwright/test";

import { gotoPageAfterApi, reseedDemo } from "./helpers";

test("money values start hidden, reveal together, and cover individual activity", async ({ page }) => {
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
  await expect(page.locator(".totals-visibility-toggle--header")).toBeHidden();
  await expect(page.locator(".totals-visibility-toggle--summary")).toBeVisible();
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
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoPageAfterApi(
    page,
    "/entries?view=person-tim&month=2026-05&scope=direct_plus_shared",
    "/api/entries-page",
    () => page.getByRole("heading", { name: "Entries", exact: true })
  );
  await expect(page.locator(".entries-totals-strip")).toContainText("••••");
  await expect(page.locator(".entry-row-amount").first()).toContainText("••••");
  await expect(page.locator(".totals-visibility-toggle--entries")).toBeVisible();
  const entriesToggleBox = await page.locator(".totals-visibility-toggle--entries").boundingBox();
  const entriesFabBox = await page.locator(".entries-fab:not(.splits-fab)").boundingBox();
  expect(entriesToggleBox.y + entriesToggleBox.height).toBeLessThanOrEqual(entriesFabBox.y - 8);

  await page.getByRole("button", { name: "Show money totals" }).click();
  await expect(page.locator(".entry-row-amount").first()).not.toContainText("••••");
  await page.getByRole("button", { name: "Hide money totals" }).click();
  await expect(page.locator(".entry-row-amount").first()).toContainText("••••");

  await page.setViewportSize({ width: 1280, height: 720 });
  await gotoPageAfterApi(
    page,
    "/imports?view=household&month=2026-05",
    "/api/imports-page",
    () => page.getByLabel("CSV content")
  );
  const csvSource = page.getByLabel("CSV content");
  await expect(page.locator(".import-privacy-notice")).toBeVisible();
  await expect(csvSource).toHaveClass(/is-screened/);
  await expect(csvSource).toHaveCSS("-webkit-text-security", "disc");
  await page.getByRole("button", { name: "Show money totals" }).click();
  await expect(csvSource).not.toHaveClass(/is-screened/);
  await page.getByRole("button", { name: "Hide money totals" }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await gotoPageAfterApi(
    page,
    "/splits?view=person-tim&month=2026-05&split_group=split-group-none",
    "/api/splits-page",
    () => page.locator(".totals-visibility-toggle--splits")
  );
  await expect(page.locator(".split-group-pill-content").first()).toContainText("Balance hidden");
  await expect(page.locator(".split-activity-card").first()).toContainText("••••");
  await expect(page.locator(".totals-visibility-toggle--splits")).toBeVisible();
  const splitsToggleBox = await page.locator(".totals-visibility-toggle--splits").boundingBox();
  const splitsFabBox = await page.locator(".splits-fab").boundingBox();
  expect(splitsToggleBox.y + splitsToggleBox.height).toBeLessThanOrEqual(splitsFabBox.y - 8);

  await gotoPageAfterApi(
    page,
    "/month?view=household&month=2026-05&scope=direct_plus_shared",
    "/api/month-page",
    () => page.locator(".totals-visibility-toggle--month")
  );
  await expect(page.locator(".totals-visibility-toggle--month")).toBeVisible();
});

// A page that loaded with totals hidden used to keep "••••" in its money
// check-in after totals were revealed, until a reload. Revealing shows the
// real sentence at once; hiding masks it again.
test("revealing totals after a hidden load shows the real money check-in on every page", async ({ page }) => {
  await page.route("**/api/ai-assist/financial-insight", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ ok: false })
  }));
  await reseedDemo(page);

  const pages = [
    ["/summary?view=household&month=2026-05&scope=direct_plus_shared&summary_start=2026-05&summary_end=2026-05", "/api/summary-page", "Summary", ".financial-insight-summary"],
    ["/month?view=person-tim&month=2026-05&scope=direct_plus_shared", "/api/month-page", "Month", ".financial-insight-month"],
    ["/entries?view=household&month=2026-05&scope=direct_plus_shared", "/api/entries-page", "Entries", ".financial-insight-entries"],
    ["/splits?view=person-tim&month=2025-10&split_group=split-group-baby-river", "/api/splits-page", "Splits", ".financial-insight-splits"]
  ];
  for (const [path, api, heading, insightClass] of pages) {
    await gotoPageAfterApi(page, path, api, () => page.getByRole("heading", { name: heading, exact: true }));
    const insight = page.locator(insightClass);
    await expect(insight, heading).toContainText("Reveal money totals to read this insight.");

    await page.getByRole("button", { name: "Show money totals" }).first().click();
    const narrative = insight.locator(".financial-insight-narrative");
    await expect(narrative, heading).toBeVisible();
    await expect(narrative, heading).not.toContainText("••••");
    await expect(narrative, heading).toContainText(/\$\d/);
    await insight.getByRole("button", { name: "Read full insight" }).click();
    await expect(insight, heading).not.toContainText("••••");
    await insight.getByRole("button", { name: "Show less" }).click();

    await page.getByRole("button", { name: "Hide money totals" }).first().click();
    await expect(insight, heading).toContainText("Reveal money totals to read this insight.");
    await expect(narrative, heading).toHaveCount(0);
    await expect(insight, heading).not.toContainText("$");
  }
});

test("entry and split editors include a local money visibility toggle", async ({ page }) => {
  await reseedDemo(page);

  await gotoPageAfterApi(
    page,
    "/entries?view=person-tim&month=2026-05&scope=direct_plus_shared",
    "/api/entries-page",
    () => page.getByRole("heading", { name: "Entries", exact: true })
  );
  await expect(page.getByRole("button", { name: "Show money totals" }).first()).toBeVisible();

  await page.locator(".entry-row").first().click();
  const entryEditor = page.locator(".entry-inline-editor").first();
  await expect(entryEditor).toBeVisible();
  const entryAmountInput = entryEditor.getByLabel("Amount");
  await expect(entryAmountInput).toHaveCSS("-webkit-text-security", "disc");
  await entryEditor.locator(".totals-visibility-toggle--form").click();
  await expect(entryAmountInput).not.toHaveCSS("-webkit-text-security", "disc");

  await page.getByRole("button", { name: "Hide money totals" }).first().click();
  await page.setViewportSize({ width: 1280, height: 720 });
  await gotoPageAfterApi(
    page,
    "/splits?view=person-tim&month=2025-10&split_group=split-group-baby-river",
    "/api/splits-page",
    () => page.getByRole("heading", { name: "Splits", exact: true })
  );

  await page.locator(".split-activity-card").filter({ hasText: "Family support" }).first().click();
  const splitEditor = page.locator(".split-inline-editor-card").first();
  await expect(splitEditor).toBeVisible();
  const splitAmountInput = splitEditor.locator(".table-edit-input-money").first();
  await expect(splitAmountInput).toHaveCSS("-webkit-text-security", "disc");
  await splitEditor.locator(".totals-visibility-toggle--form").first().click();
  await expect(splitAmountInput).not.toHaveCSS("-webkit-text-security", "disc");
});
