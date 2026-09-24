import { expect, test } from "@playwright/test";

import { reseedDemo } from "./helpers";

// Contracts for the shell chrome that H11 moves out of App.jsx: loading and
// error screens, route tabs with the "More pages" menu, the month and range
// pickers, and the login registration dialog. They pin behaviour and focus,
// so the extraction can be proven behaviour-preserving.

async function waitUsable(page) {
  await expect.poll(() => page.evaluate(() => window.__MONIES_MAP_ROUTE_WORK__?.usable ?? false), { timeout: 30_000 }).toBe(true);
}

test.describe("loading and error screens", () => {
  test.beforeEach(async ({ page }) => {
    await reseedDemo(page);
  });

  test("an app shell failure shows its error and retry recovers", async ({ page }) => {
    let fail = true;
    await page.route("**/api/app-shell**", (route) => (fail
      ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false, error: "Shell exploded" }) })
      : route.continue()));
    await page.goto("/summary?view=household&month=2026-05");
    const panel = page.locator(".app-loading-panel-error");
    await expect(panel).toBeVisible();
    await expect(panel.locator(".app-loading-error-copy")).not.toBeEmpty();
    fail = false;
    await panel.getByRole("button").click();
    await expect(page.getByRole("heading", { name: "Summary", exact: true })).toBeVisible();
    await expect(panel).toHaveCount(0);
  });

  test("a reference data failure shows its own error and retry recovers", async ({ page }) => {
    let fail = true;
    await page.route("**/api/reference-data**", (route) => (fail
      ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false, error: "Reference exploded" }) })
      : route.continue()));
    await page.goto("/summary?view=household&month=2026-05");
    const panel = page.locator(".app-loading-panel-error");
    await expect(panel).toBeVisible();
    await expect(panel.locator(".app-loading-diagnosis")).toBeVisible();
    fail = false;
    await panel.getByRole("button").click();
    await expect(page.getByRole("heading", { name: "Summary", exact: true })).toBeVisible();
  });

  test("a slow shell shows the loading panel until the page renders", async ({ page }) => {
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    await page.route("**/api/app-shell**", async (route) => {
      await held;
      await route.continue();
    });
    await page.goto("/summary?view=household&month=2026-05");
    await expect(page.locator(".app-loading-panel")).toBeVisible();
    await expect(page.locator(".app-loading-panel")).not.toHaveClass(/app-loading-panel-error/);
    release();
    await expect(page.getByRole("heading", { name: "Summary", exact: true })).toBeVisible();
    await expect(page.locator(".app-loading-panel")).toHaveCount(0);
  });
});

test.describe("route tabs and the More pages menu", () => {
  test("desktop tabs keep the view and month, and mark the active route", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await reseedDemo(page);
    await page.goto("/summary?view=person-tim&month=2026-05");
    await waitUsable(page);
    const tabs = page.getByRole("navigation", { name: /./ }).first();
    await tabs.getByRole("link", { name: "Month", exact: true }).click();
    await expect(page).toHaveURL(/\/month\?.*view=person-tim/);
    await expect(page).toHaveURL(/month=2026-05/);
    await expect(tabs.getByRole("link", { name: "Month", exact: true })).toHaveClass(/is-active/);
    await expect(tabs.getByRole("link", { name: "Summary", exact: true })).not.toHaveClass(/is-active/);
  });

  test("the More pages menu opens by keyboard, lists the secondary pages and navigates", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await reseedDemo(page);
    await page.goto("/summary?view=household&month=2026-05");
    await waitUsable(page);
    const trigger = page.getByRole("button", { name: "More pages" });
    await expect(trigger).not.toHaveClass(/is-active/);
    await trigger.focus();
    await page.keyboard.press("Enter");
    const menu = page.locator(".tab-overflow-popover");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("link")).toHaveText(["Imports", "Settings", "FAQ"]);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await trigger.click();
    await menu.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page).toHaveURL(/\/settings/);
    await expect(page.getByRole("button", { name: "More pages" })).toHaveClass(/is-active/);
  });
});

test.describe("month and range pickers", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await reseedDemo(page);
  });

  test("the month picker switches years, picks a month by keyboard, closes and returns focus", async ({ page }) => {
    await page.goto("/month?view=household&month=2026-05&scope=direct_plus_shared");
    await waitUsable(page);
    const trigger = page.locator(".period-range-segment");
    await expect(trigger).toHaveText("May 2026");
    await trigger.click();
    const picker = page.locator(".period-picker-popover");
    await expect(picker).toBeVisible();
    await expect(picker.locator(".period-picker-head strong")).toHaveText("Month");
    await expect(picker.getByRole("tablist", { name: "Available years" }).getByRole("button")).toHaveText(["2025", "2026"]);
    await expect(picker.locator(".period-picker-year.is-active")).toHaveText("2026");
    await expect(picker.locator(".period-picker-month.is-active")).toHaveText("May");

    await picker.getByRole("button", { name: "2025", exact: true }).click();
    await expect(picker.locator(".period-picker-month")).toHaveText(["Jun", "Jul", "Aug", "Sep", "Oct"]);
    await picker.getByRole("button", { name: "Aug", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(picker).toHaveCount(0);
    await expect(page).toHaveURL(/month=2025-08/);
    await expect(trigger).toHaveText("Aug 2025");
    await expect(trigger).toBeFocused();
  });

  test("the summary range pickers disable months outside the range and stay open while choosing", async ({ page }) => {
    await page.goto("/summary?view=household&month=2026-05&scope=direct_plus_shared&summary_start=2025-08&summary_end=2025-10");
    await waitUsable(page);
    const [startTrigger, endTrigger] = [page.locator(".period-range-segment").nth(0), page.locator(".period-range-segment").nth(1)];
    await expect(startTrigger).toHaveText("Aug 2025");
    await expect(endTrigger).toHaveText("Oct 2025");

    await startTrigger.click();
    const picker = page.locator(".period-picker-popover");
    await expect(picker.locator(".period-picker-head strong")).toHaveText("Start month");
    await expect(picker.getByRole("tablist", { name: "Available start years" })).toBeVisible();
    await picker.getByRole("button", { name: "2025", exact: true }).click();
    await expect(picker.getByRole("button", { name: "Sep", exact: true })).toBeEnabled();
    await expect(picker.getByRole("button", { name: "Oct", exact: true })).toBeEnabled();
    await picker.getByRole("button", { name: "Jul", exact: true }).click();
    await expect(page).toHaveURL(/summary_start=2025-07/);
    await expect(picker).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    await expect(startTrigger).toBeFocused();
    await expect(startTrigger).toHaveText("Jul 2025");

    await endTrigger.click();
    await expect(picker.locator(".period-picker-head strong")).toHaveText("End month");
    await picker.getByRole("button", { name: "2025", exact: true }).click();
    await expect(picker.getByRole("button", { name: "Jun", exact: true })).toBeDisabled();
    await expect(picker.getByRole("button", { name: "Jul", exact: true })).toBeEnabled();
    await picker.getByRole("button", { name: "Sep", exact: true }).click();
    await expect(page).toHaveURL(/summary_end=2025-09/);
    await expect(endTrigger).toHaveText(/^Sept? 2025$/);
  });

  test("on Splits the period controls are passive", async ({ page }) => {
    await page.goto("/splits?view=person-tim&month=2026-05");
    await waitUsable(page);
    await expect(page.locator(".period-nav-cluster")).toHaveClass(/is-passive/);
    await expect(page.getByRole("button", { name: /previous/i }).first()).toBeDisabled();
  });
});

test.describe("login registration", () => {
  test("an unlinked login is asked to pick a profile, and saving links it and opens that view", async ({ browser }) => {
    const context = await browser.newContext({ extraHTTPHeaders: { "Cf-Access-Authenticated-User-Email": "new.viewer@example.com" } });
    const page = await context.newPage();
    await reseedDemo(page);
    await page.goto("/summary?view=household&month=2026-05");
    const dialog = page.getByRole("dialog", { name: "Set up this login" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("new.viewer@example.com");
    const profile = dialog.getByLabel("Household profile");
    const name = dialog.getByLabel("Display name");
    await expect(profile.locator("option")).toHaveText(["Tim", "Joyce"]);
    await profile.selectOption({ label: "Joyce" });
    await expect(name).toHaveValue("Joyce");
    await name.fill("Joyce T");
    await dialog.getByRole("button", { name: "Save login" }).click();
    await expect(dialog).toHaveCount(0);
    // Only Splits switches to the linked person; other routes keep their view.
    await expect(page).toHaveURL(/view=household/);
    await page.goto("/splits?month=2026-05");
    await expect(page).toHaveURL(/view=person-joyce/);
    await page.reload();
    await waitUsable(page);
    await expect(page.getByRole("dialog", { name: "Set up this login" })).toHaveCount(0);
    await context.close();
  });

  test("a failed save keeps the dialog and its draft, with the error shown", async ({ browser }) => {
    const context = await browser.newContext({ extraHTTPHeaders: { "Cf-Access-Authenticated-User-Email": "second.viewer@example.com" } });
    const page = await context.newPage();
    await reseedDemo(page);
    await page.route("**/api/login-identities/register", (route) => route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ ok: false, error: "That profile is taken." }) }));
    await page.goto("/summary?view=household&month=2026-05");
    const dialog = page.getByRole("dialog", { name: "Set up this login" });
    await dialog.getByLabel("Display name").fill("Kept draft");
    await dialog.getByRole("button", { name: "Save login" }).click();
    await expect(dialog.locator(".form-error")).toHaveText("That profile is taken.");
    await expect(dialog.getByLabel("Display name")).toHaveValue("Kept draft");
    await expect(dialog.getByRole("button", { name: "Save login" })).toBeEnabled();
    await context.close();
  });
});
