import { expect, test } from "@playwright/test";

import {
  loadMonthPage,
  loadSummaryPage,
  postJson,
  reseedDemo
} from "./helpers";

test.describe("summary workflow", () => {
  test.beforeEach(async ({ page }) => {
    await reseedDemo(page);
  });

  test("summary month note edits refresh the summary and month DTOs", async ({ page }) => {
    const editedNote = `Playwright summary note ${Date.now()}`;
    const summaryBefore = await loadSummaryPage(page, { view: "household", month: "2026-04" });
    const targetMonth = summaryBefore.summaryPage.rangeEndMonth;

    await postJson(page, "/api/month-note/update", {
      month: targetMonth,
      personScope: "household",
      note: editedNote
    });

    const summaryPage = await loadSummaryPage(page, { view: "household", month: targetMonth });
    const summaryMonth = summaryPage.summaryPage.months.find((month) => month.month === targetMonth);
    expect(summaryMonth?.note).toBe(editedNote);

    const monthPage = await loadMonthPage(page, { view: "household", month: targetMonth });
    expect(monthPage.monthPage.monthNote).toBe(editedNote);
  });

  test("summary controls stay usable on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    const summaryBefore = await loadSummaryPage(page, { view: "household", month: "2026-04" });
    const targetMonth = summaryBefore.summaryPage.months[0].month;

    await page.goto(`/summary?view=household&month=${targetMonth}&scope=direct_plus_shared&summary_start=2025-06&summary_end=${targetMonth}`);
    await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Spending Mix" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Intent vs Outcome" })).toBeVisible();
    await expect(page.getByText("Range overall")).toBeVisible();
    await expect(page.getByText("Total spend")).toBeVisible();
  });
});
