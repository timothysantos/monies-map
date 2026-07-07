import { expect, test } from "@playwright/test";

import { loadEntriesPage, loadSplitsPage, postJson, reseedDemo } from "./helpers";

test("editing an existing split expense keeps the row in place and persists the change", async ({ page }) => {
  const updatedNote = `Updated split note ${Date.now()}`;

  await page.goto("/");
  await reseedDemo(page);
  await page.goto("/splits?view=person-tim&month=2025-10&split_group=split-group-baby-river");

  await page.locator(".split-activity-card").filter({ hasText: "Family support" }).first().click();
  const inlineEditor = page.locator(".split-inline-editor-card").first();
  await inlineEditor.locator("textarea").nth(1).fill(updatedNote);
  await inlineEditor.getByRole("button", { name: "Done editing split" }).click();
  const syncDialog = page.getByRole("dialog", { name: "Update connected note?" });
  if (await syncDialog.isVisible().catch(() => false)) {
    await syncDialog.getByRole("button", { name: "Save only this" }).click();
  }

  await expect(page.locator(".split-activity-card").filter({ hasText: "Family support" }).filter({ hasText: updatedNote })).toBeVisible();
  await expect.poll(async () => {
    const data = await loadSplitsPage(page, { view: "person-tim", month: "2025-10" });
    return data.splitsPage.activity.find((item) => item.description === "Family support")?.note ?? "";
  }).toBe(updatedNote);
});

test("editing a linked split note can update the connected entry note", async ({ page }) => {
  const month = "2026-04";
  const description = `Playwright split linked note ${Date.now()}`;
  const entryNote = "entry current note";
  const syncedNote = "split note copied to entry";

  await page.goto("/");
  await reseedDemo(page);

  const entry = await postJson(page, "/api/entries/create", {
    date: `${month}-24`,
    description,
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 2550,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim",
    note: entryNote
  });
  const splitData = await postJson(page, "/api/splits/expenses/from-entry", {
    entryId: entry.entryId,
    splitGroupId: null
  });

  await page.goto(`/splits?view=person-tim&month=${month}&editing_split_expense=${splitData.splitExpenseId}`);
  const editDialog = page.getByRole("dialog", { name: "Edit split" });
  await expect(editDialog).toBeVisible();
  await editDialog.getByRole("textbox", { name: "Note", exact: true }).fill(syncedNote);
  await editDialog.getByRole("button", { name: "Save expense" }).click();

  const syncDialog = page.getByRole("dialog", { name: "Update connected note?" });
  await expect(syncDialog).toBeVisible();
  await expect(syncDialog).toContainText(syncedNote);
  await expect(syncDialog).toContainText(entryNote);
  await syncDialog.getByRole("button", { name: "Update both" }).click();
  await expect(syncDialog).toBeHidden({ timeout: 60_000 });

  const splitsData = await loadSplitsPage(page, { view: "person-tim", month });
  const updatedSplit = splitsData.splitsPage.activity.find((item) => item.id === splitData.splitExpenseId);
  expect(updatedSplit?.note).toBe(syncedNote);

  const entriesData = await loadEntriesPage(page, { view: "person-tim", month });
  const updatedEntry = entriesData.monthPage.entries.find((item) => item.id === entry.entryId);
  expect(updatedEntry?.note).toBe(syncedNote);
});

test("editing a linked split category can update the connected entry category", async ({ page }) => {
  const month = "2026-04";
  const description = `Playwright split linked category ${Date.now()}`;

  await page.goto("/");
  await reseedDemo(page);

  const entry = await postJson(page, "/api/entries/create", {
    date: `${month}-24`,
    description,
    accountName: "UOB One",
    categoryName: "Food & Drinks",
    amountMinor: 2550,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });
  const splitData = await postJson(page, "/api/splits/expenses/from-entry", {
    entryId: entry.entryId,
    splitGroupId: null
  });

  await page.goto(`/splits?view=person-tim&month=${month}&editing_split_expense=${splitData.splitExpenseId}`);
  const editDialog = page.getByRole("dialog", { name: "Edit split" });
  await expect(editDialog).toBeVisible();
  await editDialog.locator("select").nth(2).selectOption("Groceries");
  await editDialog.getByRole("button", { name: "Save expense" }).click();

  const syncDialog = page.getByRole("dialog", { name: "Update connected entry category?" });
  await expect(syncDialog).toBeVisible();
  await expect(syncDialog).toContainText("Food & Drinks");
  await expect(syncDialog).toContainText("Groceries");
  await syncDialog.getByRole("button", { name: "Update both" }).click();
  await expect(syncDialog).toBeHidden({ timeout: 60_000 });

  const splitsData = await loadSplitsPage(page, { view: "person-tim", month });
  const updatedSplit = splitsData.splitsPage.activity.find((item) => item.id === splitData.splitExpenseId);
  expect(updatedSplit?.categoryName).toBe("Groceries");

  const entriesData = await loadEntriesPage(page, { view: "person-tim", month });
  const updatedEntry = entriesData.monthPage.entries.find((item) => item.id === entry.entryId);
  expect(updatedEntry?.categoryName).toBe("Groceries");
});
