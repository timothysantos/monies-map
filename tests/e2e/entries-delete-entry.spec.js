import { expect, test } from "@playwright/test";

import { loadEntriesPage, postJson, reseedDemo } from "./helpers";

test("entries can delete a manually created row from the inline editor", async ({ page }) => {
  const description = `Playwright delete entry ${Date.now()}`;
  const month = "2026-05";

  await reseedDemo(page);

  await postJson(page, "/api/entries/create", {
    date: `${month}-24`,
    description,
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 2550,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });

  await page.goto(`/entries?view=person-tim&month=${month}`);
  await expect(page.getByRole("heading", { name: /Entries/ })).toBeVisible();
  await page.locator(".entry-row").filter({ hasText: description }).first().click();
  const deleteResponse = page.waitForResponse((response) => response.url().includes("/api/entries/delete") && response.ok());
  await page.getByRole("button", { name: "Delete entry" }).click();
  await deleteResponse;

  await expect(page.locator(".entry-row").filter({ hasText: description })).toHaveCount(0);

  const entriesData = await loadEntriesPage(page, { view: "person-tim", month });
  expect(entriesData.monthPage.entries.some((item) => item.description === description)).toBe(false);
});
