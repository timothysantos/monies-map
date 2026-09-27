import { expect, test } from "@playwright/test";

import { gotoPageAfterApi, postJson, reseedDemo } from "./helpers";

// Entries has one data owner. A refresh of the previous month (started by an
// edit here or in another tab) that finishes after the person has moved to
// another month must not replace the new month's entries.

async function waitUsable(page) {
  await expect.poll(() => page.evaluate(() => window.__MONIES_MAP_ROUTE_WORK__?.usable ?? false), { timeout: 30_000 }).toBe(true);
}

test("a late refresh of the previous month never replaces the entries of the month the person moved to", async ({ page }) => {
  await reseedDemo(page);
  await page.addInitScript(() => {
    window.localStorage.setItem("monies-map:money-totals-visible", "true");
    window.__MONIES_MAP_WARMUP_MODE__ = "off";
  });
  const mayOnly = `Playwright May-only entry ${Date.now()}`;
  await postJson(page, "/api/entries/create", {
    date: "2026-05-24",
    description: mayOnly,
    accountName: "UOB One",
    categoryName: "Other",
    amountMinor: 4321,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });

  const mayRow = page.locator(".entry-row").filter({ hasText: mayOnly });
  await gotoPageAfterApi(page, "/entries?view=person-tim&month=2026-05", "/api/entries-page", () => mayRow);
  await waitUsable(page);
  const other = await page.context().newPage();
  await other.goto("/entries?view=person-tim&month=2026-05");

  let holdMay = false;
  let heldMay = 0;
  let releaseMay;
  const mayHeld = new Promise((resolve) => { releaseMay = resolve; });
  await page.route("**/api/entries-page**", async (route) => {
    if (holdMay && new URL(route.request().url()).searchParams.get("month") === "2026-05") {
      heldMay += 1;
      await mayHeld;
    }
    await route.continue().catch(() => {});
  });

  // Another tab changed a May entry: this tab refreshes May's entries.
  holdMay = true;
  await other.evaluate(() => {
    localStorage.setItem("monies-map-app-sync", JSON.stringify({
      type: "entry-mutation", ts: Date.now(), month: "2026-05", invalidateEntries: true, invalidateMonth: false, invalidateSummary: false
    }));
  });
  await expect.poll(() => heldMay).toBe(1);

  // Meanwhile the person moves to the previous detail month (October), which loads at once.
  await page.getByRole("button", { name: /previous/i }).first().click();
  await expect(page).toHaveURL(/month=2025-10/);
  await expect(mayRow).toHaveCount(0);
  await waitUsable(page);

  // The stale May refresh lands now; October must stay on screen and usable.
  releaseMay();
  await page.waitForTimeout(1_500);
  await expect(page).toHaveURL(/month=2025-10/);
  await expect(page.locator(".period-range-segment")).toHaveText("Oct 2025");
  await expect(mayRow).toHaveCount(0);
  await expect(page.locator(".entry-row").first()).toBeVisible();
  expect(await page.evaluate(() => window.__MONIES_MAP_ROUTE_WORK__?.usable)).toBe(true);

  await other.close();
});
