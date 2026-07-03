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

test("category quick-save keeps the collapsed row on the saved category without a page refresh", async ({ page }) => {
  const description = `Playwright quick category ${Date.now()}`;
  const month = "2026-05";

  await reseedDemo(page);

  await postJson(page, "/api/entries/create", {
    date: `${month}-24`,
    description,
    accountName: "UOB One",
    categoryName: "Other",
    amountMinor: 57940,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim",
    note: "card ending: 6360"
  });

  await page.goto(`/entries?view=person-tim&month=${month}`);
  await expect(page.getByRole("heading", { name: /Entries/ })).toBeVisible();

  const entryRow = page.locator(".entry-row").filter({ hasText: description });
  await expect(entryRow).toHaveCount(1);
  await expect(entryRow.first().locator(".entry-row-category")).toContainText("Other");

  await entryRow.first().click();
  const entryEditor = page.locator(".entry-edit-grid").first();
  await expect(entryEditor).toBeVisible();
  await entryEditor.locator("select").first().selectOption("Travel");

  await expect(page.getByText("Save this category?")).toBeVisible();
  const updateResponse = page.waitForResponse((response) => response.url().includes("/api/entries/update") && response.ok());
  await page.getByRole("button", { name: "Save category" }).click();
  await updateResponse;

  await expect(entryRow.first()).not.toHaveClass(/is-inline-editing/);
  await expect(entryRow.first().locator(".entry-row-category")).toContainText("Travel");
  await expect(entryRow.first().locator(".entry-row-category")).not.toContainText("Other");

  const afterSave = await loadEntriesPage(page, { view: "person-tim", month });
  const afterSaveEntry = afterSave.monthPage.entries.find((entry) => entry.description === description);
  expect(afterSaveEntry?.categoryName).toBe("Travel");
});

test("date group refresh reloads entries without leaving the page", async ({ page }) => {
  const description = `Playwright date refresh ${Date.now()}`;
  const month = "2026-06";

  await reseedDemo(page);
  await postJson(page, "/api/entries/create", {
    date: `${month}-01`,
    description,
    accountName: "Citi Rewards",
    categoryName: "Taxi",
    amountMinor: 205,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });

  await page.goto(`/entries?view=person-tim&month=${month}`);
  await expect(page.getByRole("heading", { name: /Entries/ })).toBeVisible();
  await expect(page.locator(".entry-row").filter({ hasText: description })).toHaveCount(1);

  const refreshButton = page.getByRole("button", { name: "Refresh rows for 1 Jun 2026" });
  await expect(refreshButton).toBeVisible();
  const refreshResponse = page.waitForResponse((response) => response.url().includes("/api/entries-page") && response.ok());
  await refreshButton.click();
  await refreshResponse;

  await expect(page).toHaveURL(/\/entries/);
  await expect(page.locator(".entry-row").filter({ hasText: description })).toHaveCount(1);
  await expect(page.locator(".entries-page-loading")).toHaveCount(0);
});

test("expanded entry closes on the first cancel or outside click", async ({ page }) => {
  const description = `Playwright close edit ${Date.now()}`;
  const month = "2026-06";

  await reseedDemo(page);
  await postJson(page, "/api/entries/create", {
    date: `${month}-01`,
    description,
    accountName: "Citi Rewards",
    categoryName: "Taxi",
    amountMinor: 910,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });

  await page.goto(`/entries?view=person-tim&month=${month}`);
  await expect(page.getByRole("heading", { name: /Entries/ })).toBeVisible();
  const entryRow = page.locator(".entry-row").filter({ hasText: description }).first();

  await entryRow.click();
  await expect(entryRow).toHaveClass(/is-inline-editing/);
  await entryRow.getByRole("button", { name: "Cancel editing entry" }).click();
  await expect(entryRow).not.toHaveClass(/is-inline-editing/);

  await entryRow.click();
  await expect(entryRow).toHaveClass(/is-inline-editing/);
  await page.locator(".entries-date-head").filter({ hasText: "1 Jun 2026" }).click();
  await expect(entryRow).not.toHaveClass(/is-inline-editing/);
});
