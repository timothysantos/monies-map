import { expect, test } from "@playwright/test";

import { gotoPageAfterApi, reseedDemo } from "./helpers";

// When Entries cannot load the month the person moved to, the previous
// month's rows must never stand in for it and the page must not claim the
// month is empty. The shared page error with "Try loading again" takes their
// place; the refresh notice is only for pages whose own rows are on screen.
//
// The race below is real: another tab saves an entry in October while this
// tab is still loading October. The cross-tab handler and the Entries
// refresh each clear the October cache, which cancels the shell's own load
// of the page, so only the Entries owner learns that October failed.

const failWith500 = (route) => route.fulfill({
  status: 500,
  contentType: "application/json",
  body: JSON.stringify({ ok: false, error: "Entries exploded" })
});

async function readRouteWork(page) {
  return page.evaluate(() => window.__MONIES_MAP_ROUTE_WORK__ ?? null);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("monies-map:money-totals-visible", "true");
    window.__MONIES_MAP_WARMUP_MODE__ = "off";
  });
  await page.goto("/");
  await reseedDemo(page);
});

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

for (const layout of ["desktop", "mobile"]) {
  test(`${layout}: a month that fails to load shows the page error with a retry, never the previous month's rows`, async ({ page }) => {
    if (layout === "mobile") {
      await page.setViewportSize({ width: 390, height: 844 });
    }
    await gotoPageAfterApi(page, "/entries?view=person-tim&month=2026-05", "/api/entries-page", () => page.locator(".entry-row").first());
    const mayRowCount = await page.locator(".entry-row").count();
    expect(mayRowCount).toBeGreaterThan(0);

    const description = `Draft kept through a failed load ${Date.now()}`;
    if (layout === "desktop") {
      // An open new-entry draft must survive the failure itself.
      await page.getByRole("button", { name: "+ Add entry" }).first().click();
      await page.locator(".entry-composer").getByLabel("Description").fill(description);
    }

    const other = await page.context().newPage();
    await other.goto("/entries?view=person-tim&month=2026-05");

    let failOctober = true;
    let octoberRequests = 0;
    await page.route("**/api/entries-page**", async (route) => {
      if (new URL(route.request().url()).searchParams.get("month") !== "2025-10") {
        await route.continue().catch(() => {});
        return;
      }
      octoberRequests += 1;
      if (!failOctober) {
        await route.continue().catch(() => {});
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await failWith500(route).catch(() => {});
    });

    await page.getByRole("button", { name: /previous/i }).first().click();
    await expect(page).toHaveURL(/month=2025-10/);
    await expect.poll(() => octoberRequests).toBeGreaterThan(0);
    // Another tab saves an October entry while October is still loading.
    await other.evaluate(() => {
      localStorage.setItem("monies-map-app-sync", JSON.stringify({
        type: "entry-mutation", ts: Date.now(), month: "2025-10", invalidateEntries: true, invalidateMonth: false, invalidateSummary: false
      }));
    });

    const alert = page.getByRole("alert").filter({ hasText: "The Entries page could not load." });
    await expect(alert).toBeVisible({ timeout: 20_000 });
    await expect(alert).toContainText("Your saved data is not affected.");
    await expect(alert).toContainText("Entries exploded");
    await expect(page.locator(".period-range-segment")).toHaveText("Oct 2025");
    // May's rows and totals are not passed off as October's, and October is
    // not called empty.
    await expect(page.locator(".entry-row:not(.entry-composer):visible")).toHaveCount(0);
    await expect(page.locator(".entries-totals-strip:visible")).toHaveCount(0);
    await expect(page.getByText("No entries match this view.")).toHaveCount(0);
    // It is a load failure, not a refresh of rows that are on screen.
    await expect(page.locator(".refresh-failure-notice")).toHaveCount(0);
    if (layout === "desktop") {
      await expect(page.locator(".entry-composer").getByLabel("Description")).toHaveValue(description);
    }

    const retry = alert.getByRole("button", { name: "Try loading again" });
    await expect(retry).toHaveClass(/dialog-primary/);
    failOctober = false;
    await retry.click();

    await expect(alert).toHaveCount(0);
    await expect(page.locator(".entry-row:not(.entry-composer):visible").first()).toBeVisible();
    await expect(page.locator(".period-range-segment")).toHaveText("Oct 2025");
    // The shell recovers with the list: the route's own page is current
    // again. October landing resets the composer draft as any month change
    // does; the still-open composer keeps the desktop route busy.
    await expect.poll(async () => (await readRouteWork(page))?.ready, { timeout: 20_000 }).toBe(true);
    await expect.poll(async () => (await readRouteWork(page))?.reason).toBe(layout === "desktop" ? "busy" : "usable");

    await other.close();
  });
}
