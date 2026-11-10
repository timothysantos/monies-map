import { expect, test } from "@playwright/test";

// The 2026-11-11 black screen: nothing was drawn when the app could not
// start. These run against the built app (index.html's boot guard, the
// storage-safe first-screen modules).

test("the app draws with the browser's storage blocked", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() { throw new DOMException("The operation is insecure.", "SecurityError"); }
    });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Summary", exact: true })).toBeVisible();
});

test("the app draws when the browser's storage is full", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException("The quota has been exceeded.", "QuotaExceededError"); };
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Summary", exact: true })).toBeVisible();
});

// An old page whose script a deploy removed: the entry script's file is gone
// (the built file in production, main.jsx in the dev server the suite uses).
async function serveGoneEntryScript(page, { times }) {
  let served = 0;
  await page.route("**/", async (route) => {
    if (route.request().resourceType() !== "document") return route.continue();
    const response = await route.fetch();
    const html = await response.text();
    served += 1;
    const body = served <= times ? html.replace(/src="(?:\/assets\/index-[^"]+\.js|\/src\/client\/main\.jsx[^"]*)"/, 'src="/assets/index-gone.js"') : html;
    return route.fulfill({ response, body });
  });
  return () => served;
}

test("a page whose script is gone reloads once and then shows the app", async ({ page }) => {
  const served = await serveGoneEntryScript(page, { times: 1 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Summary", exact: true })).toBeVisible({ timeout: 15000 });
  expect(served()).toBe(2);
});

test("a page whose script stays gone shows the card, with Reload app, instead of an empty page", async ({ page }) => {
  const served = await serveGoneEntryScript(page, { times: 99 });
  await page.goto("/");
  const card = page.locator("[data-boot-card]");
  await expect(card).toContainText("This page needs a fresh copy of the app.");
  await expect(card).toContainText("Your saved data is not affected. Reload the app to continue.");
  await expect(card.getByRole("button", { name: "Reload app" })).toBeVisible();
  expect(served()).toBe(2);
});
