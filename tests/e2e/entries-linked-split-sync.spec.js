import { expect, test } from "@playwright/test";

import { gotoPageAfterApi, loadEntriesPage, loadSplitsPage, loadSummaryPage, postJson, reseedDemo } from "./helpers";

const month = "2026-05";

async function createLinkedEntry(page, description) {
  const entry = await postJson(page, "/api/entries/create", {
    date: `${month}-22`,
    description,
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 6000,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });
  const split = await postJson(page, "/api/splits/expenses/from-entry", {
    entryId: entry.entryId,
    splitGroupId: null
  });
  return { entryId: entry.entryId, splitExpenseId: split.splitExpenseId };
}

async function timMonthExpenses(page) {
  const summaryData = await loadSummaryPage(page, { view: "person-tim", month, summaryStart: month, summaryEnd: month });
  return summaryData.summaryPage.months.find((item) => item.month === month).realExpensesMinor;
}

test("deleting a linked split from Entries shows the entry as unshared, and it can be added again", async ({ page }) => {
  const description = `Linked split delete ${Date.now()}`;

  // Money is hidden by default; this scenario asserts visible dollar amounts.
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await page.goto("/");
  await reseedDemo(page);
  const expensesBefore = await timMonthExpenses(page);
  const { entryId, splitExpenseId } = await createLinkedEntry(page, description);

  await page.goto(`/entries?view=person-tim&month=${month}&entries_scope=direct_plus_shared`);
  const row = page.locator(".entry-row").filter({ hasText: description }).first();
  await expect(row).toBeVisible({ timeout: 60_000 });
  await expect(row.locator(".entry-chip-linked-split")).toContainText("On splits");
  await expect(row).toContainText("$30.00");

  await row.click();
  const editor = page.locator(".entry-inline-editor").first();
  await expect(editor).toBeVisible();
  await editor.getByRole("button", { name: "Delete split" }).click();
  const dialog = page.locator(".entry-delete-dialog");
  await expect(dialog).toBeVisible();
  const deleted = page.waitForResponse((response) => response.url().includes("/api/splits/expenses/delete") && response.ok());
  await dialog.getByRole("button", { name: "Delete split" }).click();
  await deleted;
  await expect(dialog).toBeHidden();

  // The editor offers "Add to splits" again and the row counts the full amount.
  await expect(editor.getByRole("button", { name: "Add to splits" })).toBeVisible();
  await expect(editor.getByRole("button", { name: "View split" })).toHaveCount(0);
  await editor.getByRole("button", { name: "Cancel editing entry" }).click();
  const savedRow = page.locator(".entry-row").filter({ hasText: description }).first();
  await expect(savedRow).toContainText("$60.00");
  await expect(savedRow.locator(".entry-chip-linked-split")).toHaveCount(0);

  // A reload reads the same from the server, and no projection keeps the old link.
  await page.reload();
  const reloadedRow = page.locator(".entry-row").filter({ hasText: description }).first();
  await expect(reloadedRow).toBeVisible({ timeout: 60_000 });
  await expect(reloadedRow.locator(".entry-chip-linked-split")).toHaveCount(0);
  const entriesData = await loadEntriesPage(page, { view: "person-tim", month });
  const savedEntry = entriesData.monthPage.entries.find((item) => item.id === entryId);
  expect(savedEntry?.linkedSplitExpenseId).toBeUndefined();
  expect(savedEntry?.amountMinor).toBe(6000);
  expect(await timMonthExpenses(page) - expensesBefore).toBe(6000);
  const splitsData = await loadSplitsPage(page, { view: "person-tim", month });
  expect(splitsData.splitsPage.activity.some((item) => item.id === splitExpenseId)).toBe(false);

  // Joyce's shared entries no longer list it.
  await gotoPageAfterApi(
    page,
    `/entries?view=person-joyce&month=${month}&entries_scope=shared`,
    "/api/entries-page",
    () => page.locator(".panel").first()
  );
  await expect(page.locator(".entry-row").filter({ hasText: description })).toHaveCount(0);

  // The entry can go back to splits as a new split record.
  const readded = await postJson(page, "/api/splits/expenses/from-entry", { entryId, splitGroupId: null });
  expect(readded.splitExpenseId).not.toBe(splitExpenseId);
});

test("editing a linked entry's description and date in Entries updates its split in Splits", async ({ page }) => {
  const description = `Linked split mirror ${Date.now()}`;
  const renamed = `${description} renamed`;

  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await page.goto("/");
  await reseedDemo(page);
  const { entryId, splitExpenseId } = await createLinkedEntry(page, description);
  await postJson(page, "/api/splits/expenses/update-note", { splitExpenseId, note: "Split-only note" });

  // Load Splits first so its page cache holds the old description.
  await page.goto(`/splits?view=person-tim&month=${month}&split_group=split-group-none`);
  const splitCard = page.locator(".split-activity-card").filter({ hasText: description }).first();
  await expect(splitCard).toBeVisible({ timeout: 60_000 });

  await page.getByRole("link", { name: "Entries", exact: true }).click();
  await expect(page).toHaveURL(/\/entries\?/);
  const row = page.locator(".entry-row").filter({ hasText: description }).first();
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.click();
  const editor = page.locator(".entry-inline-editor").first();
  await expect(editor).toBeVisible();
  await editor.getByLabel("Description").fill(renamed);
  await editor.getByLabel("Date", { exact: true }).fill(`${month}-24`);
  const entryUpdate = page.waitForResponse((response) => response.url().includes("/api/entries/update") && response.ok());
  await editor.getByRole("button", { name: "Done editing entry" }).click();
  await entryUpdate;
  await expect(page.locator(".entry-row").filter({ hasText: renamed }).first()).not.toContainText("Updating");

  // Splits, reached in-app, shows the copied description instead of its cached page.
  await page.getByRole("link", { name: "Splits", exact: true }).click();
  await expect(page).toHaveURL(/\/splits\?/);
  await expect(page.locator(".split-activity-card").filter({ hasText: renamed }).first()).toBeVisible({ timeout: 30_000 });

  const splitsData = await loadSplitsPage(page, { view: "person-tim", month });
  const savedSplit = splitsData.splitsPage.activity.find((item) => item.id === splitExpenseId);
  expect(savedSplit).toMatchObject({
    date: `${month}-24`,
    description: renamed,
    paidByPersonName: "Tim",
    note: "Split-only note",
    totalAmountMinor: 6000,
    linkedTransactionId: entryId
  });
});
