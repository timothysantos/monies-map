import { expect, test } from "@playwright/test";

import { loadEntriesPage, loadSplitsPage, postJson, reseedDemo } from "./helpers";

async function selectSplitGroupIfPrompted(page, label = "Non-group expenses") {
  const dialog = page.getByRole("dialog", { name: "Add to splits" });
  const pickerVisible = await dialog.waitFor({ state: "visible", timeout: 1_500 }).then(() => true).catch(() => false);
  if (!pickerVisible) {
    return;
  }

  await dialog.locator("select").selectOption({ label });
}

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
  await selectSplitGroupIfPrompted(page);

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

test("add to splits refreshes split groups and forces group selection when multiple groups exist", async ({ page }) => {
  const description = `Playwright split picker refresh ${Date.now()}`;

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

  await postJson(page, "/api/splits/groups/create", { name: "Holiday" });
  await postJson(page, "/api/splits/groups/create", { name: "Home" });

  await page.getByRole("button", { name: "Add to splits" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("select")).toBeVisible();
  await expect(dialog.locator("select")).toContainText("Non-group expenses");
  await expect(dialog.locator("select")).toContainText("Holiday");
  await expect(dialog.locator("select")).toContainText("Home");

  await dialog.locator("select").selectOption({ label: "Holiday" });
  await expect(page.getByRole("button", { name: "View split" })).toBeVisible();
});

test("equal split amounts keep the rounded cent on the remainder share", async ({ page }) => {
  const description = `Playwright split rounding ${Date.now()}`;

  await page.goto("/");
  await reseedDemo(page);

  await postJson(page, "/api/entries/create", {
    date: "2026-04-24",
    description,
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 13999,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });

  await page.goto("/entries?view=person-tim&month=2026-04");
  await page.locator(".entry-row").filter({ hasText: description }).first().click();
  await page.getByRole("button", { name: "Add to splits" }).click();
  await selectSplitGroupIfPrompted(page);

  const entriesData = await loadEntriesPage(page, { view: "person-tim", month: "2026-04" });
  const createdEntry = entriesData.monthPage.entries.find((item) => item.description === description);
  expect(createdEntry?.splits).toEqual([
    expect.objectContaining({ personId: "person-tim", amountMinor: 6999 }),
    expect.objectContaining({ personId: "person-joyce", amountMinor: 7000 })
  ]);

  const splitsData = await loadSplitsPage(page, { view: "person-tim", month: "2026-04" });
  const createdSplit = splitsData.splitsPage.activity.find((item) => item.description === description);
  expect(createdSplit?.viewerAmountMinor).toBe(7000);
});
