import { expect, test } from "@playwright/test";

import { gotoPageAfterApi, loadEntriesPage, postJson, reseedDemo } from "./helpers";

test("category-filtered entry remains visible until the category edit is explicitly saved", async ({ page }) => {
  const description = `Playwright reclassify entry ${Date.now()}`;
  const month = "2026-05";

  await reseedDemo(page);

  await postJson(page, "/api/entries/create", {
    date: `${month}-24`,
    description,
    accountName: "UOB One",
    categoryName: "Other",
    amountMinor: 3210,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });

  const entryRow = page.locator(".entry-row").filter({ hasText: description });
  await gotoPageAfterApi(
    page,
    `/entries?view=person-tim&month=${month}&entry_category=Other`,
    "/api/entries-page",
    () => entryRow
  );
  await expect(entryRow).toHaveCount(1);

  await entryRow.first().click();
  const entryEditor = page.locator(".entry-edit-grid").first();
  await expect(entryEditor).toBeVisible();
  await entryEditor.locator("select").first().selectOption("Groceries");

  await expect(page.getByText("Save this category?")).toBeVisible();
  await expect(page.locator(".entry-row").filter({ hasText: description })).toHaveCount(1);

  const beforeSave = await loadEntriesPage(page, { view: "person-tim", month });
  const beforeSaveEntry = beforeSave.monthPage.entries.find((entry) => entry.description === description);
  expect(beforeSaveEntry?.categoryName).toBe("Other");

  const updateResponse = page.waitForResponse((response) => response.url().includes("/api/entries/update") && response.ok());
  await page.getByRole("button", { name: "Save category" }).click();
  await updateResponse;

  await expect(page.locator(".entry-row").filter({ hasText: description })).toHaveCount(0);
  const afterSave = await loadEntriesPage(page, { view: "person-tim", month });
  const afterSaveEntry = afterSave.monthPage.entries.find((entry) => entry.description === description);
  expect(afterSaveEntry?.categoryName).toBe("Groceries");
});
