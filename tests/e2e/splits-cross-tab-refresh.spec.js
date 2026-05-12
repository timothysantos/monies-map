import { expect, test } from "@playwright/test";

import { postJson, reseedDemo } from "./helpers";

test("creating a split expense refreshes the same month in another splits tab", async ({ page }) => {
  const description = `Cross-tab split expense ${Date.now()}`;
  const secondPage = await page.context().newPage();

  await page.goto("/");
  await reseedDemo(page);

  await page.goto("/splits?view=person-tim&month=2025-10&split_group=split-group-none");
  await secondPage.goto("/splits?view=person-tim&month=2025-10&split_group=split-group-none");

  await page.locator("article.panel-splits").getByRole("button", { name: "+ Add expense" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Description").fill(description);
  await dialog.locator("input.table-edit-input-money").first().fill("18.90");
  await dialog.getByRole("button", { name: "Save expense" }).click();

  await expect(page.getByText(description, { exact: true })).toBeVisible();
  await expect(secondPage.getByText(description, { exact: true })).toBeVisible();

  await secondPage.close();
});

test("adding an entry to splits refreshes another tab that is already open on splits", async ({ page }) => {
  const description = `Cross-tab entry to splits ${Date.now()}`;
  const secondPage = await page.context().newPage();

  await page.goto("/");
  await reseedDemo(page);

  await postJson(page, "/api/entries/create", {
    date: "2026-04-24",
    description,
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 2550,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });

  await page.goto("/entries?view=person-tim&month=2026-04");
  await secondPage.goto("/splits?view=person-tim&month=2026-04&split_group=split-group-none");

  await page.locator(".entry-row").filter({ hasText: description }).first().click();
  await page.getByRole("button", { name: "Add to splits" }).click();
  const dialog = page.getByRole("dialog");
  const pickerVisible = await dialog.locator("select").isVisible({ timeout: 1_500 }).catch(() => false);
  if (pickerVisible) {
    await dialog.locator("select").selectOption({ label: "Non-group expenses" });
  }

  await expect(page.getByRole("button", { name: "View split" })).toBeVisible();
  await expect(secondPage.getByText(description, { exact: true })).toBeVisible();

  await secondPage.close();
});
