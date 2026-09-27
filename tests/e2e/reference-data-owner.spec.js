import { expect, test } from "@playwright/test";

import { postJson, reseedDemo } from "./helpers";

// H12a: reference data (accounts, categories) has one owner. A cross-tab
// refresh keeps the last good data on screen, never blanks the shell or
// drops a draft, and a refresh superseded by a newer one never shows the
// reference-data error screen.

const ENTRIES_URL = "/entries?view=household&month=2026-05";

async function waitUsable(page) {
  await expect.poll(() => page.evaluate(() => window.__MONIES_MAP_ROUTE_WORK__?.usable ?? false), { timeout: 30_000 }).toBe(true);
}

// Records, in the page, whether a given selector ever appeared.
async function watchFor(page, selector) {
  await page.evaluate((target) => {
    window.__seen = window.__seen ?? {};
    window.__seen[target] = Boolean(document.querySelector(target));
    new MutationObserver(() => {
      if (document.querySelector(target)) window.__seen[target] = true;
    }).observe(document.body, { childList: true, subtree: true });
  }, selector);
  return () => page.evaluate((target) => window.__seen[target], selector);
}

function broadcastShellRefresh(page) {
  return page.evaluate(() => {
    localStorage.setItem("monies-map-app-sync", JSON.stringify({ type: "app-shell-refresh", ts: Date.now() }));
  });
}

async function categoryOptions(page) {
  return page.locator("select option").allTextContents();
}

test("a cross-tab refresh updates reference data without blanking the shell or dropping a draft", async ({ page }) => {
  await reseedDemo(page);
  const other = await page.context().newPage();
  await page.goto(ENTRIES_URL);
  await waitUsable(page);
  await other.goto(ENTRIES_URL);
  await waitUsable(other);

  await other.getByRole("button", { name: "+ Add entry" }).first().click();
  const description = other.getByLabel("Description");
  await description.fill("Draft kept across refresh");
  const sawLoading = await watchFor(other, ".app-loading-panel");
  const sawError = await watchFor(other, ".app-loading-panel-error");

  const renamed = `Groceries renamed ${Date.now()}`;
  await postJson(page, "/api/categories/update", { categoryId: "cat-groceries", name: renamed });
  await broadcastShellRefresh(page);

  await expect.poll(() => categoryOptions(other), { timeout: 15_000 }).toContain(renamed);
  await expect(description).toHaveValue("Draft kept across refresh");
  expect(await sawLoading()).toBe(false);
  expect(await sawError()).toBe(false);
  await other.close();
});

test("two quick cross-tab refreshes never flash the error screen, and the newest data wins", async ({ page }) => {
  await reseedDemo(page);
  const other = await page.context().newPage();
  await page.goto(ENTRIES_URL);
  await other.goto(ENTRIES_URL);
  await waitUsable(other);
  // The entry composer lists categories from reference data.
  await other.getByRole("button", { name: "+ Add entry" }).first().click();

  // Hold the first refresh's request so the second overtakes it.
  let held = 0;
  await other.route("**/api/reference-data", async (route) => {
    held += 1;
    if (held === 1) {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
    }
    await route.continue().catch(() => {});
  });
  const sawError = await watchFor(other, ".app-loading-panel-error");

  const first = `Groceries first ${Date.now()}`;
  await postJson(page, "/api/categories/update", { categoryId: "cat-groceries", name: first });
  await broadcastShellRefresh(page);
  await expect.poll(() => held).toBe(1);
  const second = `Groceries second ${Date.now()}`;
  await postJson(page, "/api/categories/update", { categoryId: "cat-groceries", name: second });
  await broadcastShellRefresh(page);

  await expect.poll(() => categoryOptions(other), { timeout: 15_000 }).toContain(second);
  await other.waitForTimeout(2_000);
  expect(await categoryOptions(other)).toContain(second);
  expect(await categoryOptions(other)).not.toContain(first);
  expect(await sawError()).toBe(false);
  await other.close();
});
