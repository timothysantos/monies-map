import { expect, test } from "@playwright/test";

import { loadEntriesPage, loadSplitsPage, loadSummaryPage, postJson, reseedDemo } from "./helpers";

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

function nonGroupBalance(splitsData) {
  return splitsData.splitsPage.groups.find((group) => group.id === "split-group-none").balanceMinor;
}

test("editing a linked entry's amount in a person view moves the viewer's split share", async ({ page }) => {
  const description = `Linked share follows amount ${Date.now()}`;

  // Money is hidden by default; this scenario asserts visible dollar amounts.
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await page.goto("/");
  await reseedDemo(page);
  const expensesBefore = await timMonthExpenses(page);
  const { entryId, splitExpenseId } = await createLinkedEntry(page, description);
  const balanceBefore = nonGroupBalance(await loadSplitsPage(page, { view: "person-tim", month }));

  // Load Splits first so its page cache holds the old share.
  await page.goto(`/splits?view=person-tim&month=${month}&split_group=split-group-none`);
  const splitCard = page.locator(".split-activity-card").filter({ hasText: description }).first();
  await expect(splitCard).toBeVisible({ timeout: 60_000 });
  await expect(splitCard).toContainText("$60.00");

  await page.getByRole("link", { name: "Entries", exact: true }).click();
  await expect(page).toHaveURL(/\/entries\?/);
  const row = page.locator(".entry-row").filter({ hasText: description }).first();
  await expect(row).toBeVisible({ timeout: 60_000 });
  await expect(row).toContainText("$30.00");

  await row.click();
  const editor = page.locator(".entry-inline-editor").first();
  await expect(editor).toBeVisible();
  const amountInput = editor.getByRole("textbox", { name: /^Amount/ });
  await expect(amountInput).toHaveValue("60");
  await amountInput.fill("80.50");
  await amountInput.blur();
  const entryUpdate = page.waitForResponse((response) => response.url().includes("/api/entries/update") && response.ok());
  await editor.getByRole("button", { name: "Done editing entry" }).click();
  await entryUpdate;

  // The saved row shows Tim's new half, never the stale $30.00 or the total.
  const savedRow = page.locator(".entry-row").filter({ hasText: description }).first();
  await expect(savedRow).toContainText("$40.25");
  await expect(savedRow).not.toContainText("$30.00");
  await expect(savedRow.locator(".entry-chip-split")).toContainText("50%");

  const entriesData = await loadEntriesPage(page, { view: "person-tim", month });
  const savedEntry = entriesData.monthPage.entries.find((item) => item.id === entryId);
  expect(savedEntry?.amountMinor).toBe(4025);
  expect(savedEntry?.totalAmountMinor).toBe(8050);
  expect(savedEntry?.linkedSplitShares).toEqual([
    expect.objectContaining({ personId: "person-tim", ratioBasisPoints: 5000, amountMinor: 4025 }),
    expect.objectContaining({ personId: "person-joyce", ratioBasisPoints: 5000, amountMinor: 4025 })
  ]);

  const splitsData = await loadSplitsPage(page, { view: "person-tim", month });
  const savedSplit = splitsData.splitsPage.activity.find((item) => item.id === splitExpenseId);
  expect(savedSplit?.totalAmountMinor).toBe(8050);
  expect(savedSplit?.viewerAmountMinor).toBe(4025);
  // Joyce owes Tim her half: 40.25 now instead of 30.00.
  expect(nonGroupBalance(splitsData) - balanceBefore).toBe(4025 - 3000);

  // Tim's Summary month total counts his new share, not the old one or the total.
  expect(await timMonthExpenses(page) - expensesBefore).toBe(4025);

  // Splits, reached in-app, shows the new split instead of its cached page.
  await page.getByRole("link", { name: "Splits", exact: true }).click();
  await expect(page).toHaveURL(/\/splits\?/);
  const refreshedCard = page.locator(".split-activity-card").filter({ hasText: description }).first();
  await expect(refreshedCard).toContainText("$80.50", { timeout: 30_000 });
  await expect(refreshedCard).toContainText("$40.25");
});

test("a household edit of a linked entry keeps the total on the row and moves each person's share", async ({ page }) => {
  const description = `Linked household amount ${Date.now()}`;

  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await page.goto("/");
  await reseedDemo(page);
  const { entryId } = await createLinkedEntry(page, description);

  await page.goto(`/entries?view=household&month=${month}&entries_scope=direct_plus_shared&editing_entry=${entryId}`);
  const editor = page.locator(".entry-inline-editor").first();
  await expect(editor).toBeVisible({ timeout: 60_000 });
  const amountInput = editor.getByRole("textbox", { name: /^Amount/ });
  await expect(amountInput).toHaveValue("60");
  await amountInput.fill("70.01");
  await amountInput.blur();
  const entryUpdate = page.waitForResponse((response) => response.url().includes("/api/entries/update") && response.ok());
  await editor.getByRole("button", { name: "Done editing entry" }).click();
  await entryUpdate;

  const householdRow = page.locator(".entry-row").filter({ hasText: description }).first();
  await expect(householdRow).toContainText("$70.01");
  await expect(householdRow).not.toContainText("Updating");

  // The odd cent goes to the second person, as when the split was created.
  await page.goto(`/entries?view=person-joyce&month=${month}&entries_scope=shared`);
  const joyceRow = page.locator(".entry-row").filter({ hasText: description }).first();
  await expect(joyceRow).toBeVisible({ timeout: 60_000 });
  await expect(joyceRow).toContainText("$35.01");
  await expect(joyceRow.locator(".entry-chip-split")).toContainText("50%");
  const timData = await loadEntriesPage(page, { view: "person-tim", month });
  expect(timData.monthPage.entries.find((item) => item.id === entryId)?.amountMinor).toBe(3500);
});

test("after a description edit in a person view, the amount field still shows the linked entry's total", async ({ page }) => {
  const description = `Linked amount field ${Date.now()}`;

  await page.goto("/");
  await reseedDemo(page);
  const { entryId } = await createLinkedEntry(page, description);

  await page.goto(`/entries?view=person-tim&month=${month}&entries_scope=direct_plus_shared&editing_entry=${entryId}`);
  const editor = page.locator(".entry-inline-editor").first();
  await expect(editor).toBeVisible({ timeout: 60_000 });
  await editor.getByRole("textbox", { name: "Description" }).fill(`${description} renamed`);
  const amountInput = editor.getByRole("textbox", { name: /^Amount/ });
  await expect(amountInput).toHaveValue("60");

  // Tabbing through the untouched amount field and saving keeps the total.
  await amountInput.focus();
  await amountInput.blur();
  await expect(amountInput).toHaveValue("60");
  const entryUpdate = page.waitForResponse((response) => response.url().includes("/api/entries/update") && response.ok());
  await editor.getByRole("button", { name: "Done editing entry" }).click();
  const saved = await entryUpdate;
  expect(saved.request().postDataJSON().amountMinor).toBe(6000);

  const savedRow = page.locator(".entry-row").filter({ hasText: `${description} renamed` }).first();
  await expect(savedRow).not.toContainText("Updating");
  await savedRow.click();
  await expect(page.locator(".entry-inline-editor").first().getByRole("textbox", { name: /^Amount/ })).toHaveValue("60");

  const entriesData = await loadEntriesPage(page, { view: "person-tim", month });
  const savedEntry = entriesData.monthPage.entries.find((item) => item.id === entryId);
  expect(savedEntry?.totalAmountMinor).toBe(6000);
  expect(savedEntry?.amountMinor).toBe(3000);
});
