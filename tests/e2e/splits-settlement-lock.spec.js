import { expect, test } from "@playwright/test";

import { loadEntriesPage, loadSplitsPage, postJson, reseedDemo } from "./helpers";

// A split record in a simplified settlement keeps its settled facts. Editing
// or deleting it is refused in place with the reason and an "Undo
// simplification" action; after the undo the person's change saves.

const month = "2026-05";
const PHONE = { width: 390, height: 844 };

async function createSettledSplits(page, stamp) {
  const cashDescription = `Settled lock dinner ${stamp}`;
  const linkedDescription = `Settled lock groceries ${stamp}`;
  const cash = await postJson(page, "/api/splits/expenses/create", {
    groupId: null,
    date: `${month}-16`,
    description: cashDescription,
    categoryName: "Food & Drinks",
    payerPersonName: "Tim",
    amountMinor: 6000,
    splitAmountMinor: 3000,
    currency: "SGD",
    paymentMethod: "cash",
    paymentStatus: "recorded"
  });
  const entry = await postJson(page, "/api/entries/create", {
    date: `${month}-17`,
    description: linkedDescription,
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 6000,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });
  const linked = await postJson(page, "/api/splits/expenses/from-entry", { entryId: entry.entryId, splitGroupId: null });
  const checkpoint = await postJson(page, "/api/splits/checkpoints/create", { viewerPersonId: "person-tim", date: `${month}-20`, currency: "SGD" });
  return {
    cashDescription,
    linkedDescription,
    cashSplitId: cash.splitExpenseId,
    entryId: entry.entryId,
    linkedSplitId: linked.splitExpenseId,
    checkpointId: checkpoint.checkpointId
  };
}

async function splitRow(page, splitExpenseId) {
  const data = await loadSplitsPage(page, { view: "person-tim", month });
  return {
    row: data.splitsPage.activity.find((item) => item.id === splitExpenseId),
    checkpoints: data.splitsPage.settlementCheckpoints
  };
}

function isLockResponse(response, path) {
  return response.url().includes(path) && response.status() === 409;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await page.goto("/");
  await reseedDemo(page);
});

test("a settled split edit is refused in place, and saves after Undo simplification", async ({ page }) => {
  const settled = await createSettledSplits(page, Date.now());
  await page.goto(`/splits?view=person-tim&month=${month}&split_group=split-group-none`);
  const card = page.locator(".split-activity-card").filter({ hasText: settled.cashDescription }).first();
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card).toContainText("Included in simplified settlement");

  await card.click();
  const editor = page.locator(".split-inline-editor-card").first();
  await editor.getByRole("textbox", { name: /Expense total/ }).fill("80");
  const refused = page.waitForResponse((response) => isLockResponse(response, "/api/splits/expenses/update"));
  await editor.getByRole("button", { name: "Done editing split" }).click();
  const refusal = await (await refused).json();
  expect(refusal).toMatchObject({ ok: false, code: "split_settlement_locked", checkpointId: settled.checkpointId });

  // The person sees why, and the one way forward, inside the editor.
  const lock = editor.locator(".settlement-lock-error");
  await expect(lock).toContainText(`This split expense is part of the simplified settlement of ${month}-20`);
  await expect(lock).toContainText("Undo the simplification before changing its amount");
  await expect(lock).not.toContainText("$");
  // Nothing was saved: the settlement and the expense are as they were.
  const before = await splitRow(page, settled.cashSplitId);
  expect(before.row.totalAmountMinor).toBe(6000);
  expect(before.row.settlementCheckpointId).toBe(settled.checkpointId);
  expect(before.checkpoints.find((item) => item.id === settled.checkpointId)?.status).toBe("open");

  await lock.getByRole("button", { name: "Undo simplification" }).click();
  await expect(editor.locator(".settlement-lock-undone")).toContainText("Simplification undone");
  await expect.poll(async () => (await splitRow(page, settled.cashSplitId)).checkpoints.find((item) => item.id === settled.checkpointId)?.status).toBe("reopened");

  const saved = page.waitForResponse((response) => response.url().includes("/api/splits/expenses/update") && response.ok());
  await editor.getByRole("button", { name: "Done editing split" }).click();
  await saved;
  await expect.poll(async () => (await splitRow(page, settled.cashSplitId)).row.totalAmountMinor).toBe(8000);
  const reopenedCard = page.locator(".split-activity-card").filter({ hasText: settled.cashDescription }).first();
  await expect(reopenedCard).toContainText("$80.00");
  await expect(reopenedCard).not.toContainText("Included in simplified settlement");
});

test("deleting a settled split is refused in the delete dialog", async ({ page }) => {
  const settled = await createSettledSplits(page, Date.now());
  await page.goto(`/splits?view=person-tim&month=${month}&split_group=split-group-none`);
  const card = page.locator(".split-activity-card").filter({ hasText: settled.cashDescription }).first();
  await expect(card).toBeVisible({ timeout: 60_000 });

  await card.click();
  await page.locator(".split-inline-editor-card").first().getByRole("button", { name: "Delete" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete split row" });
  const refused = page.waitForResponse((response) => isLockResponse(response, "/api/splits/expenses/delete"));
  await dialog.getByRole("button", { name: "Delete split row" }).click();
  await refused;

  await expect(dialog.locator(".settlement-lock-error")).toContainText("Undo the simplification before deleting it");
  await expect(dialog.getByRole("button", { name: "Undo simplification" })).toBeVisible();
  const after = await splitRow(page, settled.cashSplitId);
  expect(after.row?.totalAmountMinor).toBe(6000);
  expect(after.row?.settlementCheckpointId).toBe(settled.checkpointId);
});

test("an entry amount edit that would move a settled linked split is refused, and saves after the undo", async ({ page }) => {
  const settled = await createSettledSplits(page, Date.now());
  await page.goto(`/entries?view=person-tim&month=${month}`);
  const row = page.locator(".entry-row").filter({ hasText: settled.linkedDescription }).first();
  await expect(row).toBeVisible({ timeout: 60_000 });

  await row.click();
  const editor = page.locator(".entry-inline-editor").first();
  const amountInput = editor.getByRole("textbox", { name: /^Amount/ });
  await amountInput.fill("80.50");
  await amountInput.blur();
  const refused = page.waitForResponse((response) => isLockResponse(response, "/api/entries/update"));
  await editor.getByRole("button", { name: "Done editing entry" }).click();
  await refused;

  const lock = page.locator(".settlement-lock-error");
  await expect(lock).toContainText("This entry's split expense is part of the simplified settlement");
  await expect(lock).toContainText("saving would change the split's amount and shares");
  // The whole save was refused: the ledger entry kept its amount too.
  const entryBefore = (await loadEntriesPage(page, { view: "household", month })).monthPage.entries.find((item) => item.id === settled.entryId);
  expect(entryBefore?.amountMinor).toBe(6000);
  expect((await splitRow(page, settled.linkedSplitId)).row.totalAmountMinor).toBe(6000);

  await lock.getByRole("button", { name: "Undo simplification" }).click();
  await expect(page.locator(".settlement-lock-undone")).toContainText("Simplification undone");
  const saved = page.waitForResponse((response) => response.url().includes("/api/entries/update") && response.ok());
  await editor.getByRole("button", { name: "Done editing entry" }).click();
  await saved;
  await expect.poll(async () => (await splitRow(page, settled.linkedSplitId)).row.totalAmountMinor).toBe(8050);
  const entryAfter = (await loadEntriesPage(page, { view: "household", month })).monthPage.entries.find((item) => item.id === settled.entryId);
  expect(entryAfter?.amountMinor).toBe(8050);
});

test("on a phone the split dialog explains the lock and offers the undo", async ({ page }) => {
  await page.setViewportSize(PHONE);
  const settled = await createSettledSplits(page, Date.now());
  await page.goto(`/splits?view=person-tim&month=${month}&editing_split_expense=${settled.cashSplitId}`);
  const dialog = page.getByRole("dialog", { name: "Edit split" });
  await expect(dialog).toBeVisible({ timeout: 60_000 });

  await dialog.getByRole("textbox", { name: /Expense total/ }).fill("72");
  const refused = page.waitForResponse((response) => isLockResponse(response, "/api/splits/expenses/update"));
  await dialog.getByRole("button", { name: "Save expense" }).click();
  await refused;

  const lock = dialog.locator(".settlement-lock-error");
  await expect(lock).toContainText("Undo the simplification before changing its amount");
  const undo = lock.getByRole("button", { name: "Undo simplification" });
  await undo.scrollIntoViewIfNeeded();
  await expect(undo).toBeInViewport();
  expect((await splitRow(page, settled.cashSplitId)).row.totalAmountMinor).toBe(6000);

  await undo.click();
  await expect(dialog.locator(".settlement-lock-undone")).toContainText("Simplification undone");
  const saved = page.waitForResponse((response) => response.url().includes("/api/splits/expenses/update") && response.ok());
  await dialog.getByRole("button", { name: "Save expense" }).click();
  await saved;
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await splitRow(page, settled.cashSplitId)).row.totalAmountMinor).toBe(7200);
});
