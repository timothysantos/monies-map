import { expect, test } from "@playwright/test";

import { reseedDemo } from "./helpers";

// H12b: Summary page data has one owner. A note save whose refresh overlaps
// another tab's Summary change still succeeds (guard: H06's lease recovery
// already covered the cancellation), and switching people while a range
// change is loading only ever shows the newer person.

const SUMMARY_URL = "/summary?view=household&month=2026-05";

async function waitUsable(page) {
  await expect.poll(() => page.evaluate(() => window.__MONIES_MAP_ROUTE_WORK__?.usable ?? false), { timeout: 30_000 }).toBe(true);
}

test("another tab's Summary change during a note save neither fails the save nor loses the note", async ({ page }) => {
  await reseedDemo(page);
  const other = await page.context().newPage();
  await other.goto(SUMMARY_URL);
  await page.goto(SUMMARY_URL);
  await waitUsable(page);

  let hold = false;
  let held = 0;
  await page.route("**/api/summary-page**", async (route) => {
    if (hold) {
      held += 1;
      await new Promise((resolve) => setTimeout(resolve, 1_500));
    }
    await route.continue().catch(() => {});
  });

  const note = `Saved while another tab changed Summary ${Date.now()}`;
  await page.locator(".summary-note-trigger").first().click();
  const dialog = page.getByRole("dialog", { name: "Monthly Note" });
  await dialog.locator("textarea").fill(note);
  hold = true;
  await dialog.locator("button[type=submit]").click();
  // The save's own refresh is in flight; now another tab reports a Summary change.
  await expect.poll(() => held).toBe(1);
  await other.evaluate(() => {
    localStorage.setItem("monies-map-app-sync", JSON.stringify({
      type: "summary-mutation",
      ts: Date.now(),
      month: "2026-05",
      invalidateMonth: false,
      invalidateSummary: true,
      refreshShell: false
    }));
  });

  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator(".summary-note-trigger").filter({ hasText: note })).toBeVisible();
  hold = false;
  await other.close();
});

test("switching to Tim while a household range change is still loading shows only Tim's Summary", async ({ page }) => {
  await reseedDemo(page);
  // Desktop warmup would already have cached the adjacent range.
  await page.addInitScript(() => { window.__MONIES_MAP_WARMUP_MODE__ = "off"; });
  let holdHousehold = false;
  let releaseHousehold;
  const householdHeld = new Promise((resolve) => { releaseHousehold = resolve; });
  let heldRequests = 0;
  await page.route("**/api/summary-page**", async (route) => {
    if (holdHousehold && new URL(route.request().url()).searchParams.get("view") === "household") {
      heldRequests += 1;
      await householdHeld;
    }
    await route.continue().catch(() => {});
  });
  await page.goto(SUMMARY_URL);
  await waitUsable(page);

  holdHousehold = true;
  // Narrow the range to start in Oct 2025: a household request that is held.
  await page.locator(".period-range-segment").first().click();
  const picker = page.locator(".period-picker-popover");
  await picker.getByRole("button", { name: "2025", exact: true }).click();
  await picker.getByRole("button", { name: "Oct", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect.poll(() => heldRequests).toBe(1);
  await page.getByRole("button", { name: "Tim", exact: true }).first().click();
  await expect(page).toHaveURL(/view=person-tim/);
  await waitUsable(page);
  await expect(page.locator(".panel-context")).toContainText("Tim");
  releaseHousehold();
  await page.waitForTimeout(1_000);
  await expect(page).toHaveURL(/view=person-tim/);
  await expect(page.locator(".panel-context")).toContainText("Tim");
  await expect(page.locator(".panel-context")).not.toContainText("Household");
});
