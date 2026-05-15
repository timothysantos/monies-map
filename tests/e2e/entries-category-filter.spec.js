import { expect, test } from "@playwright/test";

import { loadEntriesPage, postJson, reseedDemo } from "./helpers";

test("category-filtered entry remains visible until the category edit is explicitly saved", async ({ page }) => {
  const description = `Playwright reclassify entry ${Date.now()}`;
  const month = "2026-05";

  await page.goto("/");
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

  await page.goto(`/entries?view=person-tim&month=${month}&entry_category=Other`);
  const entryRow = page.locator(".entry-row").filter({ hasText: description });
  await expect(entryRow).toHaveCount(1);

  await entryRow.first().click();
  const entryEditor = page.locator(".entry-edit-grid").first();
  await expect(entryEditor).toBeVisible();
  await entryEditor.locator("select").first().selectOption("Groceries");

  await expect(page.getByText("Save this category?")).toHaveCount(0);
  await expect(page.locator(".entry-row").filter({ hasText: description })).toHaveCount(1);

  const beforeSave = await loadEntriesPage(page, { view: "person-tim", month });
  const beforeSaveEntry = beforeSave.monthPage.entries.find((entry) => entry.description === description);
  expect(beforeSaveEntry?.categoryName).toBe("Other");

  await page.getByRole("button", { name: "Done editing entry" }).click();

  await expect(page.locator(".entry-row").filter({ hasText: description })).toHaveCount(0);
  const afterSave = await loadEntriesPage(page, { view: "person-tim", month });
  const afterSaveEntry = afterSave.monthPage.entries.find((entry) => entry.description === description);
  expect(afterSaveEntry?.categoryName).toBe("Groceries");
});
