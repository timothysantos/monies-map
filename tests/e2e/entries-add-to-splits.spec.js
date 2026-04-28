import { expect, test } from "@playwright/test";

import { loadEntriesPage, loadSplitsPage, postJson, reseedDemo } from "./helpers";

test("entries can add a direct expense to splits and jump into the created split", async ({ page }) => {
  const description = `Playwright add to splits ${Date.now()}`;

  await page.goto("/");
  await reseedDemo(page);

  const entry = await postJson(page, "/api/entries/create", {
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

  await page.getByRole("button", { name: "Add to splits" }).click();
  const dialog = page.getByRole("dialog");
  const pickerVisible = await dialog.locator("select").isVisible({ timeout: 1_500 }).catch(() => false);
  if (pickerVisible) {
    await dialog.locator("select").selectOption({ label: "Non-group expenses" });
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }

  await expect(page.getByRole("button", { name: "View split" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete split" })).toBeVisible();

  const entriesData = await loadEntriesPage(page, { view: "person-tim", month: "2026-04" });
  const createdEntry = entriesData.monthPage.entries.find((item) => item.description === description);
  expect(createdEntry).toBeTruthy();
  expect(createdEntry?.ownershipType).toBe("shared");
  expect(createdEntry?.linkedSplitExpenseId).toBeTruthy();

  const splitsData = await loadSplitsPage(page, { view: "person-tim", month: "2026-04" });
  const createdSplit = splitsData.splitsPage.activity.find((item) => item.description === description);
  expect(createdSplit).toBeTruthy();
  expect(createdSplit?.linkedTransactionId).toBe(entry.entryId);

  await page.getByRole("button", { name: "View split" }).click();
  await page.waitForURL(new RegExp(`/splits\\?.*editing_split_expense=${createdEntry.linkedSplitExpenseId}`));
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").getByLabel("Description")).toHaveValue(description);
});
