import { expect, test } from "@playwright/test";

import { loadSplitsPage, reseedDemo } from "./helpers";

test("deleting an existing split expense removes it from the current group and persisted page data", async ({ page }) => {
  await page.goto("/");
  await reseedDemo(page);
  await page.goto("/splits?view=person-tim&month=2025-10&split_group=split-group-none");

  await page.locator(".split-activity-card").filter({ hasText: "October groceries" }).first().click();
  await page.locator(".split-inline-editor-card").first().getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete split row" }).click();

  await expect(page.getByText("October groceries", { exact: true })).toHaveCount(0);
  await expect.poll(async () => {
    const data = await loadSplitsPage(page, { view: "person-tim", month: "2025-10" });
    return data.splitsPage.activity.some((item) => item.description === "October groceries");
  }).toBe(false);
});
