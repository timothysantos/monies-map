import { expect, test } from "@playwright/test";

import { loadEntriesPage, loadSplitsPage, postJson, reseedDemo } from "./helpers";

// A group settle-up closes its batch, and that settled activity keeps its
// facts. Editing or deleting it (from the archived batch, or through a linked
// entry) is refused in place with the reason and an "Undo settle-up" action;
// after the undo the person's change saves.

const month = "2026-05";

async function createSettledGroup(page, stamp) {
  const groupName = `Lock trip ${stamp}`;
  const expenseDescription = `Settled villa dinner ${stamp}`;
  const linkedDescription = `Settled trip groceries ${stamp}`;
  const group = await postJson(page, "/api/splits/groups/create", { name: groupName, currency: "SGD", expenseSource: "mixed" });
  const expense = await postJson(page, "/api/splits/expenses/create", {
    groupId: group.groupId,
    date: `${month}-16`,
    description: expenseDescription,
    categoryName: "Food & Drinks",
    payerPersonName: "Tim",
    amountMinor: 6000,
    splitAmountMinor: 3000,
    currency: "SGD",
    paymentMethod: "cash",
    paymentStatus: "recorded"
  });
  const entry = await postJson(page, "/api/entries/create", {
    date: `${month}-16`,
    description: linkedDescription,
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 4000,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });
  const linked = await postJson(page, "/api/splits/expenses/from-entry", { entryId: entry.entryId, splitGroupId: group.groupId });
  const settlement = await postJson(page, "/api/splits/settlements/create", {
    groupId: group.groupId,
    date: `${month}-17`,
    fromPersonName: "Joyce",
    toPersonName: "Tim",
    amountMinor: 5000,
    currency: "SGD",
    paymentMethod: "cash",
    paymentStatus: "recorded"
  });
  const data = await loadSplitsPage(page, { view: "person-tim", month });
  const batchId = data.splitsPage.activity.find((item) => item.id === expense.splitExpenseId)?.batchId;
  return {
    groupId: group.groupId,
    groupName,
    expenseDescription,
    linkedDescription,
    expenseId: expense.splitExpenseId,
    entryId: entry.entryId,
    linkedSplitId: linked.splitExpenseId,
    settlementId: settlement.settlementId,
    batchId
  };
}

async function splitRow(page, id) {
  const data = await loadSplitsPage(page, { view: "person-tim", month });
  return data.splitsPage.activity.find((item) => item.id === id);
}

function isLockResponse(response, path) {
  return response.url().includes(path) && response.status() === 409;
}

async function openSettledBatch(page, settled) {
  await page.goto(`/splits?view=person-tim&month=${month}&split_group=${settled.groupId}`);
  const trigger = page.locator(".split-archive-trigger");
  await expect(trigger).toBeEnabled({ timeout: 60_000 });
  await trigger.click();
  const archive = page.getByRole("dialog", { name: "Archived batches" });
  await archive.getByRole("button", { name: /Joyce fully settled up with Tim/ }).click();
  const batch = page.getByRole("dialog", { name: `${settled.groupName} settled batch` });
  await expect(batch).toContainText(settled.expenseDescription);
  return batch;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await page.goto("/");
  await reseedDemo(page);
});

test("editing an expense in a settled group batch is refused in place, and saves after Undo settle-up", async ({ page }) => {
  const settled = await createSettledGroup(page, Date.now());
  const batch = await openSettledBatch(page, settled);
  await batch.locator(".split-activity-card").filter({ hasText: settled.expenseDescription }).getByRole("button", { name: "Edit split" }).click();

  const editor = page.getByRole("dialog", { name: "Edit split" });
  await editor.getByRole("textbox", { name: /Expense total/ }).fill("80");
  await editor.getByRole("textbox", { name: /Tim share amount/ }).fill("40");
  const refused = page.waitForResponse((response) => isLockResponse(response, "/api/splits/expenses/update"));
  await editor.getByRole("button", { name: "Save expense" }).click();
  const refusal = await (await refused).json();
  expect(refusal).toMatchObject({ ok: false, code: "split_settlement_locked", batchId: settled.batchId });
  expect(refusal.checkpointId).toBeUndefined();

  // The person sees why, and the one way forward, inside the editor.
  const lock = editor.locator(".settlement-lock-error");
  await expect(lock).toContainText(`This split expense is part of the ${settled.groupName} settle-up of ${month}-17`);
  await expect(lock).toContainText("Undo the settle-up before changing its amount and shares");
  await expect(lock).not.toContainText("$");
  await expect(lock.getByRole("button", { name: "Undo simplification" })).toHaveCount(0);
  // Nothing was saved: the expense is still settled at its old amount.
  const before = await splitRow(page, settled.expenseId);
  expect(before.totalAmountMinor).toBe(6000);
  expect(before.batchClosedAt).toBe(`${month}-17`);

  await lock.getByRole("button", { name: "Undo settle-up" }).click();
  await expect(editor.locator(".settlement-lock-undone")).toContainText("Settle-up undone. Its activity is open again");
  await expect.poll(async () => (await splitRow(page, settled.expenseId)).batchClosedAt ?? null).toBeNull();

  const saved = page.waitForResponse((response) => response.url().includes("/api/splits/expenses/update") && response.ok());
  await editor.getByRole("button", { name: "Save expense" }).click();
  await saved;
  await expect(editor).toBeHidden();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(async () => (await splitRow(page, settled.expenseId)).totalAmountMinor).toBe(8000);
  // Back in the open group list, with the settle-up kept as a payment.
  const card = page.locator(".split-activity-card").filter({ hasText: settled.expenseDescription }).first();
  await expect(card).toContainText("$80.00");
  const settleUp = await splitRow(page, settled.settlementId);
  expect(settleUp.batchClosedAt ?? null).toBeNull();
  expect(settleUp.totalAmountMinor).toBe(5000);
});

test("deleting the settle-up of a settled batch is refused in the delete dialog", async ({ page }) => {
  const settled = await createSettledGroup(page, Date.now());
  const batch = await openSettledBatch(page, settled);
  await batch.locator(".split-activity-card").filter({ hasText: "Joyce paid Tim" }).getByRole("button", { name: "Edit split" }).click();

  await page.getByRole("dialog", { name: "Edit split" }).getByRole("button", { name: "Delete" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete split row" });
  const refused = page.waitForResponse((response) => isLockResponse(response, "/api/splits/settlements/delete"));
  await dialog.getByRole("button", { name: "Delete split row" }).click();
  await refused;

  await expect(dialog.locator(".settlement-lock-error")).toContainText("This split settle-up is part of the");
  await expect(dialog.locator(".settlement-lock-error")).toContainText("Undo the settle-up before deleting it");
  await expect(dialog.getByRole("button", { name: "Undo settle-up" })).toBeVisible();
  const after = await splitRow(page, settled.settlementId);
  expect(after?.totalAmountMinor).toBe(5000);
  expect(after?.batchClosedAt).toBe(`${month}-17`);
});

test("Undo settle-up in the archived batch opens its activity again", async ({ page }) => {
  const settled = await createSettledGroup(page, Date.now());
  const batch = await openSettledBatch(page, settled);

  const undone = page.waitForResponse((response) => response.url().includes("/api/splits/batches/reopen") && response.ok());
  await batch.getByRole("button", { name: "Undo settle-up" }).click();
  await undone;

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Settle-up undone. Its activity is open again." })).toBeVisible();
  await expect(page.locator(".split-archive-trigger")).toBeDisabled();
  await expect(page.locator(".split-activity-card").filter({ hasText: settled.expenseDescription }).first()).toBeVisible();
  // Tim lent 30.00 and 20.00; Joyce's 50.00 settle-up still counts against it.
  const data = await loadSplitsPage(page, { view: "person-tim", month });
  expect(data.splitsPage.groups.find((group) => group.id === settled.groupId)?.balanceMinor).toBe(0);
  expect(data.splitsPage.activity.filter((item) => item.groupId === settled.groupId).every((item) => !item.batchClosedAt)).toBe(true);
});

test("an entry amount edit whose split is in a settled group batch is refused, and saves after Undo settle-up", async ({ page }) => {
  const settled = await createSettledGroup(page, Date.now());
  await page.goto(`/entries?view=person-tim&month=${month}`);
  const row = page.locator(".entry-row").filter({ hasText: settled.linkedDescription }).first();
  await expect(row).toBeVisible({ timeout: 60_000 });

  await row.click();
  const editor = page.locator(".entry-inline-editor").first();
  const amountInput = editor.getByRole("textbox", { name: /^Amount/ });
  await amountInput.fill("45.50");
  await amountInput.blur();
  const refused = page.waitForResponse((response) => isLockResponse(response, "/api/entries/update"));
  await editor.getByRole("button", { name: "Done editing entry" }).click();
  const refusal = await (await refused).json();
  expect(refusal).toMatchObject({ code: "split_settlement_locked", batchId: settled.batchId });

  const lock = page.locator(".settlement-lock-error");
  await expect(lock).toContainText(`This entry's split expense is part of the ${settled.groupName} settle-up of ${month}-17`);
  await expect(lock).toContainText("Undo the settle-up first");
  const entryBefore = (await loadEntriesPage(page, { view: "household", month })).monthPage.entries.find((item) => item.id === settled.entryId);
  expect(entryBefore?.amountMinor).toBe(4000);
  expect((await splitRow(page, settled.linkedSplitId)).totalAmountMinor).toBe(4000);

  await lock.getByRole("button", { name: "Undo settle-up" }).click();
  await expect(page.locator(".settlement-lock-undone")).toContainText("Settle-up undone");
  const saved = page.waitForResponse((response) => response.url().includes("/api/entries/update") && response.ok());
  await editor.getByRole("button", { name: "Done editing entry" }).click();
  await saved;
  await expect.poll(async () => (await splitRow(page, settled.linkedSplitId)).totalAmountMinor).toBe(4550);
  const entryAfter = (await loadEntriesPage(page, { view: "household", month })).monthPage.entries.find((item) => item.id === settled.entryId);
  expect(entryAfter?.amountMinor).toBe(4550);
});
