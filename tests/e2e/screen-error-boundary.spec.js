import { expect, test } from "@playwright/test";

import { reseedDemo } from "./helpers";

// A response the Splits screen cannot draw: the page loads, then rendering
// throws. Without a boundary React unmounts the whole app to a blank page.
async function breakSplitsPage(page) {
  await page.route("**/api/splits-page*", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.splitsPage = { ...body.splitsPage, groups: 42, activity: 42 };
    await route.fulfill({ response, json: body });
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await reseedDemo(page);
});

test("a screen that crashes shows a fallback inside the app, and other pages still open", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await breakSplitsPage(page);

  await page.goto("/splits?view=person-tim&month=2025-10");
  const fallback = page.getByRole("alert").filter({ hasText: "This page hit a problem" });
  await expect(fallback).toBeVisible();
  await expect(fallback).toContainText("Your saved data is not affected");
  await expect(fallback.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(fallback.getByRole("button", { name: "Reload app" })).toBeVisible();

  // The app frame survives: navigation works and the next page draws normally.
  await page.getByRole("link", { name: "Summary" }).first().click();
  await expect(page).toHaveURL(/\/summary|\/\?|\/$/);
  await expect(fallback).toHaveCount(0);
  await expect(page.locator("article.panel").first()).toBeVisible();
  expect(pageErrors, "the crash is contained, not an uncaught page error").toEqual([]);
});

test("Try again reloads the page data and recovers once the data is good", async ({ page }) => {
  await breakSplitsPage(page);
  await page.goto("/splits?view=person-tim&month=2025-10");
  const fallback = page.getByRole("alert").filter({ hasText: "This page hit a problem" });
  await expect(fallback).toBeVisible();

  await page.unroute("**/api/splits-page*");
  const refetched = page.waitForResponse((response) => response.url().includes("/api/splits-page"));
  await fallback.getByRole("button", { name: "Try again" }).click();
  await refetched;
  await expect(fallback).toHaveCount(0);
  await expect(page.locator("article.panel-splits")).toBeVisible();
});

test("Try again with data that is still broken keeps the fallback instead of blanking the app", async ({ page }) => {
  await breakSplitsPage(page);
  await page.goto("/splits?view=person-tim&month=2025-10");
  const fallback = page.getByRole("alert").filter({ hasText: "This page hit a problem" });
  await expect(fallback).toBeVisible();

  await fallback.getByRole("button", { name: "Try again" }).click();
  await expect(fallback).toBeVisible();
  await expect(page.getByRole("link", { name: "Summary" }).first()).toBeVisible();
});

test("switching person on the crashed page draws the new view once it loads", async ({ page }) => {
  await page.route("**/api/splits-page*view=person-tim*", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.splitsPage = { ...body.splitsPage, groups: 42, activity: 42 };
    await route.fulfill({ response, json: body });
  });
  await page.goto("/splits?view=person-tim&month=2025-10");
  const fallback = page.getByRole("alert").filter({ hasText: "This page hit a problem" });
  await expect(fallback).toBeVisible();

  await page.getByRole("button", { name: "Joyce", exact: true }).first().click();
  await expect(page).toHaveURL(/view=person-joyce/);
  await expect(fallback).toHaveCount(0);
  await expect(page.locator("article.panel-splits")).toBeVisible();
});
