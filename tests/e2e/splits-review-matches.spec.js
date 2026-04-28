import { expect, test } from "@playwright/test";

import {
  loadEntriesPage,
  loadSplitsPage,
  reseedDemo
} from "./helpers";

test("review matches links a split expense into entries and hides already-linked fixtures from review", async ({ page }) => {
  await page.goto("/");
  await reseedDemo(page);
  await page.goto("/entries?view=person-tim&month=2025-10");
  await expect(page.getByRole("heading", { name: "Entries" })).toBeVisible();

  const beforeEntries = await loadEntriesPage(page, { view: "person-tim", month: "2025-10" });
  const beforeLinkedEntry = beforeEntries.monthPage.entries.find((entry) => entry.id === "txn-import-split-pantry-match");
  expect(beforeLinkedEntry).toBeTruthy();
  expect(beforeLinkedEntry?.linkedSplitExpenseId).toBeFalsy();

  const beforeSplits = await loadSplitsPage(page, { view: "person-tim", month: "2025-10" });
  expect(beforeSplits.splitsPage.matches.some((match) => match.splitRecordId === "split-expense-baby-river-family")).toBe(false);
  const pantryMatch = beforeSplits.splitsPage.matches.find((match) => match.splitRecordId === "split-expense-nongroup-pantry-match");
  expect(pantryMatch).toBeTruthy();
  expect(beforeSplits.splitsPage.matches.some((match) => match.splitRecordId === "split-settlement-nongroup-transfer-match")).toBe(true);

  await page.goto("/splits?view=person-tim&month=2025-10&split_mode=matches");
  await expect(page.getByRole("heading", { name: "Matches" })).toBeVisible();
  await expect(page.getByText(pantryMatch?.transactionDescription ?? "", { exact: true })).toBeVisible();
  await expect(page.getByText("Joyce paynow settle up", { exact: true })).toBeVisible();
  await expect(page.getByText("Baby River family support import", { exact: true })).toHaveCount(0);

  const pantryMatchCard = page.locator(".split-match-card").filter({ hasText: pantryMatch?.transactionDescription ?? "" }).first();
  await pantryMatchCard.getByRole("button", { name: "Match" }).click();

  await expect.poll(async () => {
    const data = await loadSplitsPage(page, { view: "person-tim", month: "2025-10" });
    return data.splitsPage.matches.some((match) => match.splitRecordId === "split-expense-nongroup-pantry-match");
  }).toBe(false);

  const afterSplits = await loadSplitsPage(page, { view: "person-tim", month: "2025-10" });
  const linkedExpense = afterSplits.splitsPage.activity.find((item) => item.id === "split-expense-nongroup-pantry-match");
  expect(linkedExpense?.linkedTransactionId).toBe("txn-import-split-pantry-match");

  const afterEntries = await loadEntriesPage(page, { view: "person-tim", month: "2025-10" });
  const linkedEntry = afterEntries.monthPage.entries.find((entry) => entry.id === "txn-import-split-pantry-match");
  expect(linkedEntry).toBeTruthy();
  expect(linkedEntry?.ownershipType).toBe("shared");
  expect(linkedEntry?.linkedSplitExpenseId).toBe("split-expense-nongroup-pantry-match");

  await page.goto("/splits?view=person-tim&month=2025-10&split_group=split-group-none");
  const pantryCard = page.locator(".split-activity-card").filter({ hasText: "Tracked in splits before the imported grocery charge was reviewed." }).first();
  await pantryCard.click();

  const inlineEditor = page.locator(".split-inline-editor-card").first();
  await expect(inlineEditor.getByRole("button", { name: "View entry" })).toBeVisible();
  await inlineEditor.getByRole("button", { name: "View entry" }).click();

  await expect(page).toHaveURL(/\/entries\?/);
  await expect(page).toHaveURL(/editing_entry=txn-import-split-pantry-match/);
  await expect(page.locator(".entry-inline-editor")).toBeVisible();
  await expect(page.getByLabel("Description")).toHaveValue(pantryMatch?.transactionDescription ?? "");
  await expect(page.locator(".entry-chip-shared").first()).toContainText("Shared");
  await expect(page.getByRole("button", { name: "View split" })).toBeVisible();
});

test("review matches links a settlement and the linked entry can be opened from splits history", async ({ page }) => {
  await page.goto("/");
  await reseedDemo(page);

  const beforeSplits = await loadSplitsPage(page, { view: "person-tim", month: "2025-10" });
  const settlementMatch = beforeSplits.splitsPage.matches.find((match) => match.splitRecordId === "split-settlement-nongroup-transfer-match");
  expect(settlementMatch).toBeTruthy();

  await page.goto("/splits?view=person-tim&month=2025-10&split_mode=matches");

  const settlementMatchCard = page.locator(".split-match-card").filter({ hasText: settlementMatch?.transactionDescription ?? "" }).first();
  await expect(settlementMatchCard).toBeVisible();
  await settlementMatchCard.getByRole("button", { name: "Match" }).click();

  await expect.poll(async () => {
    const data = await loadSplitsPage(page, { view: "person-tim", month: "2025-10" });
    return data.splitsPage.matches.some((match) => match.splitRecordId === "split-settlement-nongroup-transfer-match");
  }).toBe(false);

  await page.goto("/splits?view=person-tim&month=2025-10&split_group=split-group-none");
  const settlementCard = page.locator(".split-activity-card").filter({ hasText: "Cash float settle-up waiting for the imported transfer row." }).first();
  await settlementCard.click();

  const inlineEditor = page.locator(".split-inline-editor-card").first();
  await expect(inlineEditor.getByRole("button", { name: "View entry" })).toBeVisible();
  await inlineEditor.getByRole("button", { name: "View entry" }).click();

  await expect(page).toHaveURL(/\/entries\?/);
  await expect(page).toHaveURL(/editing_entry=txn-import-split-settlement-match/);
  await expect(page.locator(".entry-inline-editor")).toBeVisible();
  await expect(page.getByLabel("Description")).toHaveValue(settlementMatch?.transactionDescription ?? "");
});

test("archived linked split history can still open the linked entry", async ({ page }) => {
  await page.goto("/");
  await reseedDemo(page);

  await page.goto("/splits?view=household&month=2025-10");
  await expect(page.getByRole("heading", { name: "Splits" })).toBeVisible();
  await page.getByRole("button", { name: /Okaeri/ }).click();
  await page.locator(".split-archive-trigger").click();

  const archiveDialog = page.getByRole("dialog");
  await expect(archiveDialog).toContainText("Archived batches");
  await archiveDialog.getByRole("button", { name: /fully settled up with Tim/i }).click();

  await expect(archiveDialog).toContainText("October dining");
  const archivedDiningCard = archiveDialog.locator(".split-activity-card").filter({ hasText: "October dining" }).first();
  await archivedDiningCard.getByRole("button", { name: "View entry" }).click();

  await expect(page).toHaveURL(/\/entries\?/);
  await expect(page).toHaveURL(/editing_entry=txn-import-split-okaeri-linked/);
  await expect(page.locator(".entry-inline-editor")).toBeVisible();
  await expect(page.getByLabel("Description")).toHaveValue("October dining imported from Citi");
});
