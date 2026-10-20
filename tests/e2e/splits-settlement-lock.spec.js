import { expect, test } from "@playwright/test";

import { findSplitRow, loadEntriesPage, postJson, reseedDemo } from "./helpers";

// A split record in a simplified settlement keeps its settled facts. Its row
// opens the split card read-only (View split): the reason and an "Undo
// simplification" button on top, no Save or Delete, no field to type in.
// After the undo the same card is editable in place and the change saves.
// The server still refuses a change to settled facts (the backstop), and an
// entry save that would move a settled split is refused in the entry.

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

// A settled split is in its section's rows, not the page (findSplitRow).
async function splitRow(page, splitExpenseId) {
  const { row, data } = await findSplitRow(page, { view: "person-tim", month, recordId: splitExpenseId });
  return { row, checkpoints: data.splitsPage.settlementCheckpoints };
}

function isLockResponse(response, path) {
  return response.url().includes(path) && response.status() === 409;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await page.goto("/");
  await reseedDemo(page);
});

test("a settled split opens read-only with the reason and Undo, and is editable in place after the undo", async ({ page }) => {
  const settled = await createSettledSplits(page, Date.now());
  await page.goto(`/splits?view=person-tim&month=${month}&split_group=split-group-none`);
  // Settled rows wait in their settlement's collapsed section at the end of the list.
  const section = page.locator(`[data-settlement-section="${settled.checkpointId}"]`);
  await section.locator(".split-settled-section-toggle").click({ timeout: 60_000 });
  const card = section.locator(".split-activity-card").filter({ hasText: settled.cashDescription }).first();
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card).toContainText("Included in simplified settlement");

  await card.click();
  const view = page.locator(".split-inline-editor-card");
  await expect(view).toBeVisible();
  // The reason on top, the Undo button directly under it.
  const lock = view.locator(".settlement-lock-error");
  await expect(lock).toContainText("Simplified on 20 May 2026. Undo the simplification to change it.");
  await expect(lock).not.toContainText("$");
  const undo = lock.getByRole("button", { name: "Undo simplification" });
  await expect(undo).toBeVisible();
  expect(await lock.evaluate((element) => element.nextElementSibling?.classList.contains("split-expense-card") ?? false)).toBe(true);
  // Nothing to change: no field, no Save, no Delete; Close only.
  await expect(view.getByRole("textbox")).toHaveCount(0);
  await expect(view.getByRole("button", { name: "Save expense" })).toHaveCount(0);
  await expect(view.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
  await expect(view.getByRole("button", { name: "Close", exact: true }).first()).toBeVisible();
  await expect(view.locator(".lsd-card")).toContainText("$60.00");
  expect((await splitRow(page, settled.cashSplitId)).row.totalAmountMinor).toBe(6000);

  const reopened = page.waitForResponse((response) => response.url().includes("/api/splits/checkpoints/reopen") && response.ok());
  await undo.click();
  await reopened;
  await expect.poll(async () => (await splitRow(page, settled.cashSplitId)).checkpoints.find((item) => item.id === settled.checkpointId)?.status).toBe("reopened");

  // The same card, now editable in place.
  const editor = page.locator(".split-inline-editor-card");
  await expect(editor).toBeVisible();
  await expect(editor.locator(".settlement-lock-undone")).toContainText("Simplification undone");
  await editor.getByRole("textbox", { name: /Expense total/ }).fill("80");
  const saved = page.waitForResponse((response) => response.url().includes("/api/splits/expenses/update") && response.ok());
  await editor.getByRole("button", { name: "Save expense" }).click();
  await saved;
  await expect.poll(async () => (await splitRow(page, settled.cashSplitId)).row.totalAmountMinor).toBe(8000);
  const reopenedCard = page.locator(".split-activity-card").filter({ hasText: settled.cashDescription }).first();
  await expect(reopenedCard).toContainText("$80.00");
  await expect(reopenedCard).not.toContainText("Included in simplified settlement");
});

test("a split that is not settled still opens editable, with no lock line", async ({ page }) => {
  const settled = await createSettledSplits(page, Date.now());
  // Created after the simplification, so it is not part of it.
  const lateDescription = `Late lock dinner ${Date.now()}`;
  const late = await postJson(page, "/api/splits/expenses/create", {
    groupId: null, date: `${month}-25`, description: lateDescription, categoryName: "Food & Drinks", payerPersonName: "Tim",
    amountMinor: 4000, splitAmountMinor: 2000, currency: "SGD", paymentMethod: "cash", paymentStatus: "recorded"
  });
  expect((await splitRow(page, late.splitExpenseId)).row.settlementCheckpointId).toBeUndefined();
  expect((await splitRow(page, settled.cashSplitId)).row.settlementCheckpointId).toBe(settled.checkpointId);
  await page.goto(`/splits?view=person-tim&month=${month}&split_group=split-group-none`);
  await page.locator(".split-activity-card").filter({ hasText: lateDescription }).first().click();
  const editor = page.locator(".split-inline-editor-card");
  await expect(editor).toBeVisible({ timeout: 60_000 });
  await expect(editor.locator(".settlement-lock-error")).toHaveCount(0);
  await expect(editor.getByRole("textbox", { name: /Expense total/ })).toBeEditable();
  await expect(editor.getByRole("button", { name: "Save expense" })).toBeVisible();
});

test("the server still refuses to change or delete a settled split", async ({ page }) => {
  const settled = await createSettledSplits(page, Date.now());
  const update = await page.request.post("/api/splits/expenses/update", {
    data: {
      splitExpenseId: settled.cashSplitId, groupId: null, date: `${month}-16`, description: settled.cashDescription,
      categoryName: "Food & Drinks", payerPersonName: "Tim", amountMinor: 8000, note: "", splitBasisPoints: 5000,
      splitAmountMinor: 4000, currency: "SGD", paymentMethod: "cash", paymentStatus: "recorded"
    }
  });
  expect(update.status()).toBe(409);
  expect(await update.json()).toMatchObject({ ok: false, code: "split_settlement_locked", checkpointId: settled.checkpointId });
  const removal = await page.request.post("/api/splits/expenses/delete", { data: { splitExpenseId: settled.cashSplitId } });
  expect(removal.status()).toBe(409);
  expect(await removal.json()).toMatchObject({ ok: false, code: "split_settlement_locked", checkpointId: settled.checkpointId });
  const after = await splitRow(page, settled.cashSplitId);
  expect(after.row?.totalAmountMinor).toBe(6000);
  expect(after.row?.settlementCheckpointId).toBe(settled.checkpointId);
});

test("an entry amount edit that would move a settled linked split is refused, and saves after the undo", async ({ page }) => {
  const settled = await createSettledSplits(page, Date.now());
  await page.goto(`/entries?view=person-tim&month=${month}`);
  const row = page.locator(".entry-row").filter({ hasText: settled.linkedDescription }).first();
  await expect(row).toBeVisible({ timeout: 60_000 });

  await row.locator(".entry-row-main").click();
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

test("on a phone the split sheet shows the lock and offers the undo", async ({ page }) => {
  await page.setViewportSize(PHONE);
  const settled = await createSettledSplits(page, Date.now());
  await page.goto(`/splits?view=person-tim&month=${month}&editing_split_expense=${settled.cashSplitId}`);
  const dialog = page.getByRole("dialog", { name: "View split" });
  await expect(dialog).toBeVisible({ timeout: 60_000 });

  const lock = dialog.locator(".settlement-lock-error");
  await expect(lock).toContainText("Simplified on 20 May 2026. Undo the simplification to change it.");
  const undo = lock.getByRole("button", { name: "Undo simplification" });
  await expect(undo).toBeInViewport();
  await expect(dialog.getByRole("textbox")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Save expense" })).toHaveCount(0);
  expect((await splitRow(page, settled.cashSplitId)).row.totalAmountMinor).toBe(6000);

  await undo.click();
  const editor = page.getByRole("dialog", { name: "Edit split" });
  await expect(editor.locator(".settlement-lock-undone")).toContainText("Simplification undone");
  await editor.getByRole("textbox", { name: /Expense total/ }).fill("72");
  const saved = page.waitForResponse((response) => response.url().includes("/api/splits/expenses/update") && response.ok());
  await editor.getByRole("button", { name: "Save expense" }).click();
  await saved;
  await expect(editor).toBeHidden();
  await expect.poll(async () => (await splitRow(page, settled.cashSplitId)).row.totalAmountMinor).toBe(7200);
});
