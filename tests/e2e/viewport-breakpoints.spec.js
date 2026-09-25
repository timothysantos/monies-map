import { expect, test } from "@playwright/test";

import { gotoPageAfterApi, reseedDemo } from "./helpers";

// The layout breakpoints come from src/client/use-viewport.js. These tests
// resize one open page across them and prove the layout-dependent behaviour
// switches without a reload. A marker on window would vanish on reload.

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };
// Wider than the phone breakpoint but a portrait tablet: Month uses its sheet
// here while the rest of the app keeps the desktop layout.
const PORTRAIT_TABLET = { width: 900, height: 1200 };

async function markPage(page) {
  await page.evaluate(() => {
    window.__viewportSwitchMarker = "same-page";
  });
}

async function expectSamePage(page) {
  expect(await page.evaluate(() => window.__viewportSwitchMarker)).toBe("same-page");
}

test.describe("layout breakpoint switching", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.goto("/");
    await reseedDemo(page);
  });

  test("a Month plan row opens inline on desktop and in the sheet on phone and portrait tablet", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await gotoPageAfterApi(
      page,
      "/month?view=person-tim&month=2026-05&scope=direct_plus_shared",
      "/api/month-page",
      () => page.getByRole("button", { name: "+ Add planned item" })
    );
    await markPage(page);

    const row = page.locator("tr").filter({ hasText: "Entertainment" }).first();
    const sheets = page.locator(".entry-mobile-sheet");
    const actionRow = page.locator(".month-inline-action-row");

    const openInline = async () => {
      await row.locator("td").nth(4).click();
      await expect(row.locator(".table-edit-input-money")).toBeVisible();
      await expect(sheets).toHaveCount(0);
      await actionRow.getByRole("button", { name: "Cancel" }).click();
      await expect(actionRow).toHaveCount(0);
    };
    const openSheet = async () => {
      await row.locator("td").nth(4).click();
      await expect(sheets).toHaveCount(1);
      await expect(sheets.first()).toBeVisible();
      await expect(actionRow).toHaveCount(0);
      await expect(row.locator(".table-edit-input-money")).toHaveCount(0);
      await sheets.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(sheets).toHaveCount(0);
    };

    await openInline();

    await page.setViewportSize(PHONE);
    await openSheet();

    // The Month sheet query is wider than the phone layout on purpose.
    await page.setViewportSize(PORTRAIT_TABLET);
    await openSheet();

    await page.setViewportSize(DESKTOP);
    await openInline();
    await expectSamePage(page);
  });

  test("Entries swaps its filter bar and inline editor for the phone layout and back", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    const entryRows = page.locator(".entry-row");
    await gotoPageAfterApi(
      page,
      "/entries?view=person-tim&month=2026-05",
      "/api/entries-page",
      () => entryRows.first()
    );
    await markPage(page);

    const filterStack = page.locator(".entries-filter-stack");
    const editSheet = page.locator('.entry-mobile-sheet[aria-label="Edit entry"]');
    const inlineEditor = page.locator(".entry-edit-grid");

    const expectDesktopEntries = async () => {
      await expect(filterStack).toBeVisible();
      await entryRows.first().click();
      await expect(inlineEditor.first()).toBeVisible();
      await expect(editSheet).toHaveCount(0);
      await page.getByRole("button", { name: "Cancel editing entry" }).click();
      await expect(inlineEditor).toHaveCount(0);
    };

    await expectDesktopEntries();

    await page.setViewportSize(PHONE);
    await expect(filterStack).toHaveCount(0);
    await entryRows.first().click();
    await expect(editSheet).toBeVisible();
    await editSheet.getByRole("button", { name: "Close edit entry" }).first().click();
    await expect(editSheet).toHaveCount(0);

    // A portrait tablet is past the phone breakpoint, so Entries is desktop
    // again even though Month would use its sheet at this size.
    await page.setViewportSize(PORTRAIT_TABLET);
    await expectDesktopEntries();

    await page.setViewportSize(DESKTOP);
    await expect(filterStack).toBeVisible();
    await expectSamePage(page);
  });

  test("the Summary spending chart takes its phone size on resize instead of keeping its first-render size", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    const chart = page.locator(".spending-mix-chart .recharts-responsive-container").first();
    await gotoPageAfterApi(
      page,
      "/summary?view=household&month=2026-05&scope=direct_plus_shared&summary_start=2025-06&summary_end=2026-05",
      "/api/summary-page",
      () => chart
    );
    await markPage(page);
    const chartHeight = () => chart.evaluate((element) => Math.round(element.getBoundingClientRect().height));

    // 360px is the chart's desktop height; the phone layout caps it at 280px.
    await expect.poll(chartHeight).toBe(360);
    await page.setViewportSize(PHONE);
    await expect.poll(chartHeight).toBe(280);
    // The chart follows the phone breakpoint, not Month's portrait-tablet one.
    await page.setViewportSize(PORTRAIT_TABLET);
    await expect.poll(chartHeight).toBe(360);
    await page.setViewportSize(PHONE);
    await expect.poll(chartHeight).toBe(280);
    await expectSamePage(page);
  });
});
