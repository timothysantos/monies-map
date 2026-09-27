import { expect, test } from "@playwright/test";

import { loadSplitsPage, postJson, reseedDemo } from "./helpers";

async function openSplitsWithDeletedExpense(page, description) {
  // Money is hidden by default; these scenarios assert visible amounts.
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await page.goto("/");
  await reseedDemo(page);
  const created = await postJson(page, "/api/splits/expenses/create", {
    date: "2025-10-15",
    description,
    categoryName: "Groceries",
    payerPersonName: "Tim",
    amountMinor: 4200,
    splitBasisPoints: 5000,
    groupId: null,
    note: "Kept through delete and restore"
  });
  await postJson(page, "/api/splits/expenses/delete", { splitExpenseId: created.splitExpenseId });

  await page.goto("/splits?view=person-tim&month=2025-10&split_group=split-group-none");
  await expect(page.locator("article.panel-splits")).toBeVisible();
  await expect(page.locator(".split-activity-card").filter({ hasText: description })).toHaveCount(0);

  await page.getByRole("button", { name: "Activity history" }).click();
  const dialog = page.getByRole("dialog", { name: "Split activity history" });
  await expect(dialog).toBeVisible();
  return { dialog, splitExpenseId: created.splitExpenseId };
}

test("a deleted split expense is restored from the activity history view", async ({ page }) => {
  const description = `History restore ${Date.now()}`;
  const { dialog, splitExpenseId } = await openSplitsWithDeletedExpense(page, description);

  const deletedRow = dialog.locator(".split-history-row").filter({ hasText: description });
  await expect(deletedRow).toHaveCount(1);
  await expect(deletedRow).toContainText(/Non-group expenses · \$42\.00 · deleted · \d{4}-\d{2}-\d{2}/);

  const restoreRequest = page.waitForRequest((request) => request.url().includes("/api/splits/activity-history/restore"));
  await deletedRow.getByRole("button", { name: "Restore" }).click();
  expect((await restoreRequest).postDataJSON()).toEqual({ recordKind: "expense", recordId: splitExpenseId });
  await expect(dialog).toHaveCount(0);

  // The restored card keeps its original amount, shares and note.
  const card = page.locator(".split-activity-card").filter({ hasText: description });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("You paid $42.00");
  await expect(card).toContainText("Kept through delete and restore");
  await expect(card.locator(".split-activity-trailing")).toContainText("you lent");
  await expect(card.locator(".split-activity-amount-line > span").first()).toHaveText("$21.00");

  // History records the restore and no longer offers to restore this record.
  await page.getByRole("button", { name: "Activity history" }).click();
  const historyRows = dialog.locator(".split-history-row").filter({ hasText: description });
  await expect(historyRows.filter({ hasText: "· restored ·" })).toHaveCount(1);
  await expect(historyRows.getByRole("button", { name: "Restore" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close" }).click();

  await page.reload();
  await expect(page.locator(".split-activity-card").filter({ hasText: description })).toHaveCount(1);
  const data = await loadSplitsPage(page, { view: "person-tim", month: "2025-10" });
  expect(data.splitsPage.activity.filter((item) => item.id === splitExpenseId)).toEqual([
    expect.objectContaining({ description, totalAmountMinor: 4200, viewerAmountMinor: 2100, note: "Kept through delete and restore" })
  ]);
});

test("a restore rejected because another tab already restored the split is shown and not duplicated", async ({ page }) => {
  const description = `History race ${Date.now()}`;
  const { dialog, splitExpenseId } = await openSplitsWithDeletedExpense(page, description);
  const deletedRow = dialog.locator(".split-history-row").filter({ hasText: description });
  await expect(deletedRow.getByRole("button", { name: "Restore" })).toBeVisible();

  // Another tab restores it while this history view is still open.
  await postJson(page, "/api/splits/activity-history/restore", { recordKind: "expense", recordId: splitExpenseId });

  const restoreResponse = page.waitForResponse((response) => response.url().includes("/api/splits/activity-history/restore"));
  await deletedRow.getByRole("button", { name: "Restore" }).click();
  expect((await restoreResponse).status()).toBe(400);

  // The refusal is visible where the person clicked, and the list catches up.
  await expect(dialog.getByRole("alert")).toHaveText("This split is already active.");
  await expect(dialog.locator(".split-history-row").filter({ hasText: description }).getByRole("button", { name: "Restore" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close" }).click();

  await expect(page.locator(".split-activity-card").filter({ hasText: description })).toHaveCount(1);
  const data = await loadSplitsPage(page, { view: "person-tim", month: "2025-10" });
  expect(data.splitsPage.activity.filter((item) => item.description === description)).toHaveLength(1);
});

test("a deleted settle-up is restored from the activity history view", async ({ page }) => {
  await page.goto("/");
  await reseedDemo(page);
  const { groupId } = await postJson(page, "/api/splits/groups/create", { name: `Restore trip ${Date.now()}`, currency: "SGD", expenseSource: "mixed" });
  await postJson(page, "/api/splits/expenses/create", {
    groupId,
    date: "2025-10-15",
    description: "Trip groceries",
    categoryName: "Groceries",
    payerPersonName: "Tim",
    amountMinor: 6000,
    splitAmountMinor: 3000,
    currency: "SGD",
    paymentMethod: "cash",
    paymentStatus: "recorded"
  });
  const { settlementId } = await postJson(page, "/api/splits/settlements/create", {
    groupId,
    date: "2025-10-16",
    fromPersonName: "Joyce",
    toPersonName: "Tim",
    amountMinor: 3000,
    currency: "SGD",
    paymentMethod: "cash",
    paymentStatus: "recorded"
  });
  // A settle-up can only be deleted once it is undone.
  const settled = await loadSplitsPage(page, { view: "person-tim", month: "2025-10" });
  const { batchId } = settled.splitsPage.activity.find((item) => item.id === settlementId);
  await postJson(page, "/api/splits/batches/reopen", { batchId });
  await postJson(page, "/api/splits/settlements/delete", { settlementId });

  await page.goto(`/splits?view=person-tim&month=2025-10&split_group=${groupId}`);
  await expect(page.locator("article.panel-splits")).toBeVisible();
  await page.getByRole("button", { name: "Activity history" }).click();
  const dialog = page.getByRole("dialog", { name: "Split activity history" });
  const deletedRow = dialog.locator(".split-history-row").filter({ hasText: "· deleted ·" }).filter({ hasText: "Settlement" });
  await expect(deletedRow).toHaveCount(1);

  const restoreResponse = page.waitForResponse((response) => response.url().includes("/api/splits/activity-history/restore"));
  await deletedRow.getByRole("button", { name: "Restore" }).click();
  const response = await restoreResponse;
  expect(response.request().postDataJSON()).toEqual({ recordKind: "settlement", recordId: settlementId });
  expect(response.status()).toBe(200);
  await expect(dialog).toHaveCount(0);

  await page.getByRole("button", { name: "Activity history" }).click();
  const settlementRows = dialog.locator(".split-history-row").filter({ hasText: "Settlement" });
  await expect(settlementRows.filter({ hasText: "· restored ·" })).toHaveCount(1);
  await expect(settlementRows.getByRole("button", { name: "Restore" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close" }).click();

  const data = await loadSplitsPage(page, { view: "person-tim", month: "2025-10" });
  expect(data.splitsPage.activity.filter((item) => item.id === settlementId)).toEqual([
    expect.objectContaining({ kind: "settlement", batchId })
  ]);
  expect(data.splitsPage.activity.find((item) => item.id === settlementId).batchClosedAt).toBeFalsy();
  expect(data.splitsPage.groups.find((group) => group.id === groupId).balanceMinor).toBe(0);
});
