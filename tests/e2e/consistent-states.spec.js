import { expect, test } from "@playwright/test";

import { gotoPageAfterApi, reseedDemo } from "./helpers";

// Loading, empty and error states share one presentation (src/client/ui-states.jsx):
// failures are announced as alerts with one clear retry, and empty sections say
// what is missing instead of showing a bare dash.

const failWith500 = (route) => route.fulfill({
  status: 500,
  contentType: "application/json",
  body: JSON.stringify({ ok: false, error: "Month exploded" })
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await page.goto("/");
  await reseedDemo(page);
});

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("a page that fails after navigating shows the page error in place of the previous page, and retry recovers", async ({ page }) => {
  await gotoPageAfterApi(
    page,
    "/summary?view=person-tim&month=2026-05",
    "/api/summary-page",
    () => page.getByRole("heading", { name: "Summary", exact: true })
  );

  let fail = true;
  let monthRequests = 0;
  await page.route("**/api/month-page**", (route) => {
    monthRequests += 1;
    return fail ? failWith500(route) : route.continue();
  });
  await page.getByRole("link", { name: "Month", exact: true }).first().click();

  const alert = page.getByRole("alert").filter({ hasText: "This page could not finish loading." });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("Your saved data is not affected.");
  await expect(alert).toContainText("Month exploded");
  // The Summary figures must not stay on screen under the Month tab.
  await expect(page.getByRole("heading", { name: "Summary", exact: true })).toHaveCount(0);
  // The previous page is hidden, not unmounted, so a draft on it survives.
  await expect(page.locator(".route-page-body article.panel")).toHaveCount(1);
  await expect(page.locator(".route-page-body article.panel")).toBeHidden();
  // The shell stays usable around the error.
  await expect(page.getByRole("link", { name: "Summary", exact: true }).first()).toBeVisible();

  const retry = alert.getByRole("button", { name: "Try loading again" });
  await expect(retry).toHaveClass(/dialog-primary/);
  const requestsBeforeRetry = monthRequests;
  // While the retry is in flight the panel stays up: the Summary figures
  // must not come back under the Month tab.
  let releaseRetry;
  const retryHeld = new Promise((resolve) => { releaseRetry = resolve; });
  fail = false;
  await page.route("**/api/month-page**", async (route) => {
    monthRequests += 1;
    await retryHeld;
    await route.continue();
  });
  await retry.click();
  await expect(alert.getByRole("button", { name: "Working..." })).toBeDisabled();
  await expect(page.getByRole("heading", { name: "Summary", exact: true })).toHaveCount(0);
  releaseRetry();
  await expect(page.getByRole("heading", { name: "Month", exact: true })).toBeVisible();
  await expect(alert).toHaveCount(0);
  expect(monthRequests).toBeGreaterThan(requestsBeforeRetry);
});

test("a first-load page failure uses the shared error panel: an alert, plain wording, one styled retry", async ({ page }) => {
  await page.route("**/api/month-page**", failWith500);
  await page.goto("/month?view=person-tim&month=2026-05&scope=direct_plus_shared");

  const alert = page.getByRole("alert").filter({ hasText: "This page could not finish loading." });
  await expect(alert).toBeVisible({ timeout: 30_000 });
  await expect(alert.locator(".app-loading-error-copy")).toHaveText("Your saved data is not affected. Try again in a moment.");
  // The technical reason stays available, in the smaller issue line.
  await expect(alert.locator(".app-loading-issue-inline")).toContainText("Month exploded");
  await expect(alert.getByRole("button")).toHaveCount(1);
  await expect(alert.getByRole("button", { name: "Try loading again" })).toHaveClass(/dialog-primary/);
});

test("empty Settings sections explain what is missing instead of showing a dash", async ({ page }) => {
  await page.route("**/api/settings-page**", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.settingsPage = { ...body.settingsPage, unresolvedTransfers: [], recentAuditEvents: [] };
    await route.fulfill({ response, json: body });
  });
  await gotoPageAfterApi(
    page,
    "/settings",
    "/api/settings-page",
    () => page.getByRole("heading", { name: "Settings", exact: true })
  );

  for (const [title, emptyCopy] of [
    ["Unresolved transfers", "No transfers need review right now."],
    ["Recent balance activity", "No balance activity recorded yet."]
  ]) {
    const toggle = page.locator(".settings-section-toggle").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
    if ((await toggle.getAttribute("aria-expanded")) !== "true") {
      await toggle.click();
    }
    const section = toggle.locator("xpath=..");
    await expect(section.locator(".empty-state")).toHaveText(emptyCopy);
    await expect(section.getByText("—", { exact: true })).toHaveCount(0);
  }
});
