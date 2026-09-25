import { expect, test } from "@playwright/test";

import { gotoPageAfterApi, reseedDemo } from "./helpers";

// 01:30 on 1 October in Singapore, still 30 September in UTC. New drafts must
// default to the household's day, not the UTC day.
const EARLY_SINGAPORE_MORNING = new Date("2026-09-30T17:30:00Z");

test.use({ timezoneId: "Asia/Singapore" });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await reseedDemo(page);
  await page.clock.setFixedTime(EARLY_SINGAPORE_MORNING);
});

test("new split expenses and settlements default to the Singapore day", async ({ page }) => {
  await page.goto("/splits?view=person-tim&month=2025-10&split_group=split-group-none");

  await page.getByRole("button", { name: "+ Add expense" }).first().click();
  const expenseDialog = page.getByRole("dialog");
  await expect(expenseDialog.locator("input[type='date']").first()).toHaveValue("2026-10-01");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  await page.locator("article.panel-splits .panel-head .split-settle-header").click();
  const settlementDialog = page.getByRole("dialog");
  await expect(settlementDialog).toContainText("Record payment for this group only");
  await expect(settlementDialog.locator("input[type='date']").first()).toHaveValue("2026-10-01");
});

test("a shortcut link without a date opens the entry on the Singapore day", async ({ page }) => {
  await gotoPageAfterApi(
    page,
    "/entries?view=person-tim&month=2026-04&action=add-expense&amount=4.50&merchant=Kopi",
    "/api/entries-page",
    () => page.locator(".entry-composer")
  );
  await expect(page.locator(".entry-composer input[type='date']").first()).toHaveValue("2026-10-01");
});
