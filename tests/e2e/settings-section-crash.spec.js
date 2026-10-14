// One Settings section that cannot draw its data must not take the whole
// Settings page down: the other sections stay usable and the broken one is
// replaced by the app's own "could not be shown" panel.
import { expect, test } from "@playwright/test";

import { reseedDemo } from "./helpers";

// An endpoint the browser cannot turn into a URL: the Apple Pay shortcut
// section throws while it draws (new URL), every other section does not.
async function breakShortcutSection(page) {
  await page.route("**/api/settings-page*", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.settingsPage.shortcutSettings = {
      ...body.settingsPage.shortcutSettings,
      endpointPath: "http://"
    };
    await route.fulfill({ response, json: body });
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await reseedDemo(page);
});

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("a Settings section that crashes shows the fallback in its place; the rest of Settings keeps working", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await breakShortcutSection(page);
  await page.goto("/settings?view=household");

  const fallback = page.getByRole("alert").filter({ hasText: "This page hit a problem" });
  await expect(fallback).toHaveCount(1);
  await expect(fallback.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(fallback.getByRole("button", { name: "Reload app" })).toBeVisible();

  // The page and its other sections are still there and open normally.
  await expect(page.locator("article.settings-page")).toBeVisible();
  await expect(page.getByRole("button", { name: /Apple Pay shortcut/ })).toHaveCount(0);
  const payment = page.getByRole("button", { name: /Payment ways/ });
  await expect(payment).toHaveAttribute("aria-expanded", "false");
  await payment.click();
  await expect(payment).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: /Accounts/ }).first().click();
  expect(pageErrors, "the crash is contained, not an uncaught page error").toEqual([]);
});

test("a reload with good data draws the section again", async ({ page }) => {
  await breakShortcutSection(page);
  await page.goto("/settings?view=household");
  const fallback = page.getByRole("alert").filter({ hasText: "This page hit a problem" });
  await expect(fallback).toHaveCount(1);

  await page.unroute("**/api/settings-page*");
  await page.reload();
  await expect(fallback).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Apple Pay shortcut/ })).toBeVisible();
});
