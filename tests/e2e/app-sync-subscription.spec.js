import { expect, test } from "@playwright/test";

import { postJson, reseedDemo } from "./helpers";

// H12d: cross-tab sync lives in useAppSyncSubscription. Both transports reach
// the same handlers: a BroadcastChannel shell refresh and a storage-event
// entry change each update the other tab without reloading it.

const ENTRIES_URL = "/entries?view=household&month=2026-05";

async function waitUsable(page) {
  await expect.poll(() => page.evaluate(() => window.__MONIES_MAP_ROUTE_WORK__?.usable ?? false), { timeout: 30_000 }).toBe(true);
}

test("a shell refresh sent over BroadcastChannel updates reference data in the other tab", async ({ page }) => {
  await reseedDemo(page);
  const other = await page.context().newPage();
  await page.goto(ENTRIES_URL);
  await other.goto(ENTRIES_URL);
  await waitUsable(other);
  await other.getByRole("button", { name: "+ Add entry" }).first().click();
  const marker = await other.evaluate(() => { window.__notReloaded = true; return true; });
  expect(marker).toBe(true);

  const renamed = `Groceries via channel ${Date.now()}`;
  await postJson(page, "/api/categories/update", { categoryId: "cat-groceries", name: renamed });
  await page.evaluate(() => {
    const channel = new BroadcastChannel("monies-map-app-sync");
    channel.postMessage({ type: "app-shell-refresh", ts: Date.now() });
    channel.close();
  });

  await expect.poll(() => other.locator("select option").allTextContents(), { timeout: 15_000 }).toContain(renamed);
  expect(await other.evaluate(() => window.__notReloaded)).toBe(true);
  await other.close();
});

test("an entry change sent through storage refreshes the other tab's Entries list", async ({ page }) => {
  await reseedDemo(page);
  const other = await page.context().newPage();
  await page.goto(ENTRIES_URL);
  await other.goto(ENTRIES_URL);
  await waitUsable(other);

  const description = `Cross-tab storage entry ${Date.now()}`;
  await postJson(page, "/api/entries/create", {
    date: "2026-05-20",
    description,
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 1234,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });
  await page.evaluate(() => {
    localStorage.setItem("monies-map-app-sync", JSON.stringify({
      type: "entry-mutation", ts: Date.now(), month: "2026-05", invalidateEntries: true, invalidateMonth: false, invalidateSummary: false
    }));
  });
  await expect(other.locator(".entry-row").filter({ hasText: description })).toBeVisible({ timeout: 15_000 });
  await other.close();
});
