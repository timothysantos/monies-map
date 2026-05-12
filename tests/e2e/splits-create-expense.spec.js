import { expect, test } from "@playwright/test";

import { loadSplitsPage, reseedDemo } from "./helpers";

test("creating a split expense shows the row immediately and persists it", async ({ page }) => {
  const description = `Playwright split expense ${Date.now()}`;
  const note = "Created from the splits test.";

  await page.goto("/");
  await reseedDemo(page);
  await page.goto("/splits?view=person-tim&month=2025-10&split_group=split-group-none");

  await page.locator("article.panel-splits").getByRole("button", { name: "+ Add expense" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Description").fill(description);
  await dialog.locator("input.table-edit-input-money").first().fill("42.00");
  await dialog.getByLabel("Note").fill(note);
  await dialog.getByRole("button", { name: "Save expense" }).click();

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText(description, { exact: true })).toBeVisible();

  await expect.poll(async () => {
    const data = await loadSplitsPage(page, { view: "person-tim", month: "2025-10" });
    const createdItem = data.splitsPage.activity.find((item) => item.description === description);
    return createdItem?.note ?? "";
  }).toBe(note);
});
