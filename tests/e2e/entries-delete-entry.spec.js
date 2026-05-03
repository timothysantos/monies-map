import { expect, test } from "@playwright/test";

import { loadEntriesPage, postJson, reseedDemo } from "./helpers";

test("entries can delete a manually created row from the inline editor", async ({ page }) => {
  const description = `Playwright delete entry ${Date.now()}`;

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
  await page.locator(".entry-row").filter({ hasText: description }).first().click();
  await page.getByRole("button", { name: "Delete entry" }).click();

  await expect(page.locator(".entry-row").filter({ hasText: description })).toHaveCount(0);

  const entriesData = await loadEntriesPage(page, { view: "person-tim", month: "2026-04" });
  expect(entriesData.monthPage.entries.some((item) => item.description === description)).toBe(false);
});
