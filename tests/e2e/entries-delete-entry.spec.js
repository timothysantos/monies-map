import { expect, test } from "@playwright/test";

import { loadEntriesPage, postJson, reseedDemo } from "./helpers";

test("entries can delete a manually created row from the inline editor", async ({ page }) => {
  const description = `Playwright delete entry ${Date.now()}`;
  const month = "2026-05";
  let deleteRequestCount = 0;

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

  page.on("request", (request) => {
    if (request.url().includes("/api/entries/delete")) {
      deleteRequestCount += 1;
    }
  });

  await page.locator(".entry-row").filter({ hasText: description }).first().click();

  await page.getByRole("button", { name: "Delete entry" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete entry?" });
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(200);
  expect(deleteRequestCount).toBe(0);

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".entry-row").filter({ hasText: description })).toHaveCount(1);

  await page.locator(".entry-row").filter({ hasText: description }).first().click();
  await page.getByRole("button", { name: "Delete entry" }).click();
  await expect(dialog).toBeVisible();
  const deleteResponse = page.waitForResponse((response) => response.url().includes("/api/entries/delete") && response.ok());
  await dialog.getByRole("button", { name: "Delete entry" }).click();
  await deleteResponse;

  await expect(page.locator(".entry-row").filter({ hasText: description })).toHaveCount(0);
  expect(deleteRequestCount).toBe(1);

  const entriesData = await loadEntriesPage(page, { view: "person-tim", month });
  expect(entriesData.monthPage.entries.some((item) => item.description === description)).toBe(false);
});
