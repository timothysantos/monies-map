import { expect, test } from "@playwright/test";

import { gotoPageAfterApi, loadSummaryPage, reseedDemo } from "./helpers";

// The change note under Spending Mix's total (design.md "Change notes"): the
// range's complete months against the same number of months before them, from
// the Summary page's own `spendChange`. Nothing is estimated: without that
// history there is no note, and hidden money shows no arrow or percent.

const VIEW = "household";

async function open(page, start, end) {
  await gotoPageAfterApi(
    page,
    `/summary?view=${VIEW}&month=${end}&summary_start=${start}&summary_end=${end}`,
    "/api/summary-page",
    () => page.getByRole("heading", { name: "Spending mix" })
  );
  await expect.poll(() => page.evaluate(() => window.__MONIES_MAP_ROUTE_WORK__?.usable ?? false), { timeout: 45_000 }).toBe(true);
}

test.describe("Spending Mix change note", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await reseedDemo(page);
  });

  test("a range with history before it shows its change in the money tone, from the page's own totals", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    // The seed's complete months run 2025-06 to 2025-10: two months with the
    // two before them.
    const start = "2025-09";
    const end = "2025-10";
    const { summaryPage } = await loadSummaryPage(page, { view: VIEW, month: end, summaryStart: start, summaryEnd: end });
    const change = summaryPage.spendChange;
    expect(change, "the page carries the comparison").toBeTruthy();
    expect(change.months).toBeGreaterThan(0);
    expect(change.previousMinor).toBeGreaterThanOrEqual(10_000);
    const percent = Math.round((Math.abs(change.currentMinor - change.previousMinor) / change.previousMinor) * 100);
    await open(page, start, end);
    const note = page.locator("[data-change-note]");
    if (percent === 0) {
      await expect(note).toHaveCount(0);
      return;
    }
    const up = change.currentMinor > change.previousMinor;
    const words = change.months === 1 ? "vs the month before" : `vs the ${change.months} months before`;
    await expect(note).toHaveText(`${up ? "▲" : "▼"} ${percent}% ${words}${change.partial ? " (full months only)" : ""}`);
    // Spending up is rose, spending down is mint.
    await expect(note.locator("b")).toHaveClass(up ? /money-short/ : /money-in/);
  });

  test("the earliest months have nothing before them: no comparison and no note", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    const first = "2025-06";
    const { summaryPage } = await loadSummaryPage(page, { view: VIEW, month: first, summaryStart: first, summaryEnd: first });
    expect(summaryPage.spendChange).toBeUndefined();
    await open(page, first, first);
    await expect(page.locator(".summary-mix-total-amount")).toBeVisible();
    await expect(page.locator("[data-change-note]")).toHaveCount(0);
  });

  test("with money hidden there is no arrow and no percent", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "false"));
    await open(page, "2025-09", "2025-10");
    await expect(page.locator(".summary-mix-total-amount")).toContainText("••••");
    await expect(page.locator("[data-change-note]")).toHaveCount(0);
    expect(await page.locator(".spending-mix-card").innerText()).not.toMatch(/[▲▼]/);
  });
});
