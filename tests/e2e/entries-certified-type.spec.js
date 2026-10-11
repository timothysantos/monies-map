import { expect, test } from "@playwright/test";

import { loadEntriesPage, postJson, reseedDemo } from "./helpers";

// A statement-certified entry keeps its bank facts locked in the editor, but
// its type can switch within the direction the statement certified: income
// and transfer in, or expense and transfer out.

const accountName = "Certified Type Savings";
const month = "2026-05";

async function certifiedSavings(page) {
  const { accountId } = await postJson(page, "/api/accounts/create", {
    name: accountName,
    institution: "Synthetic Test Bank",
    kind: "bank",
    openingBalanceMinor: 0,
    currency: "SGD",
    ownerPersonId: "",
    isJoint: false
  });
  const entry = (input) => postJson(page, "/api/entries/create", { accountId, accountName, ownershipType: "direct", ownerName: "Tim", ...input });
  const { entryId: creditId } = await entry({ date: "2026-05-20", description: "OWN ACCOUNT TRANSFER", categoryName: "Other", amountMinor: 53_400, entryType: "income" });
  const { entryId: purchaseId } = await entry({ date: "2026-05-21", description: "NTUC FAIRPRICE", categoryName: "Groceries", amountMinor: 1_250, entryType: "expense" });

  const statementCheckpoints = [{
    accountId,
    accountName,
    detectedAccountName: accountName,
    checkpointMonth: month,
    statementStartDate: "2026-05-01",
    statementEndDate: "2026-05-31",
    statementBalanceMinor: 53_400 - 1_250,
    note: "Certified type checkpoint"
  }];
  const preview = await postJson(page, "/api/imports/preview", {
    sourceLabel: "Certified type statement",
    sourceType: "pdf",
    rows: [
      { date: "2026-05-20", description: "OWN ACCOUNT TRANSFER", income: "534.00", accountId, account: accountName, category: "Other" },
      { date: "2026-05-21", description: "NTUC FAIRPRICE", expense: "12.50", accountId, account: accountName, category: "Groceries" }
    ],
    defaultAccountName: accountName,
    ownershipType: "direct",
    ownerName: "Tim",
    statementCheckpoints
  });
  const previewRows = preview.preview.previewRows;
  expect(previewRows.map((row) => row.reconciliationTargetTransactionId)).toEqual([creditId, purchaseId]);
  await postJson(page, "/api/imports/commit", {
    sourceLabel: "Certified type statement",
    sourceType: "pdf",
    parserKey: "uob_savings_pdf",
    rows: previewRows.filter((row) => row.commitStatus === "included"),
    statementCheckpoints,
    statementControlRows: previewRows,
    statementReconciliations: preview.preview.statementReconciliations
  });
  return { creditId, purchaseId };
}

async function openEditor(page, entryId) {
  await page.goto(`/entries?view=person-tim&month=${month}&editing_entry=${entryId}`);
  const editor = page.locator(".entry-inline-editor");
  await expect(editor).toHaveCount(1, { timeout: 60_000 });
  return editor;
}

// The editor's selects sit inside a <label> with a <span> heading, so their
// accessible name also carries the selected option; find them by heading.
function editorSelect(editor, heading) {
  return editor.locator("label").filter({ has: editor.page().locator(":scope > span", { hasText: new RegExp(`^${heading}$`) }) }).locator("select");
}

async function savedEntry(page, entryId) {
  const payload = await loadEntriesPage(page, { view: "person-tim", month });
  return payload.monthPage.entries.find((entry) => entry.id === entryId);
}

test("a certified credit switches from Income to Transfer in, and its other bank facts stay locked", async ({ page }) => {
  await page.goto("/");
  await reseedDemo(page);
  const { creditId } = await certifiedSavings(page);
  const editor = await openEditor(page, creditId);

  await expect(editor.locator(".entry-edit-lock-message")).toHaveText(
    "This row is statement certified. Description, date, posted date, wallet and amount are locked to the saved statement. Type can switch between Income and Transfer in, and you can change the note, category, owner or splits."
  );
  const type = editorSelect(editor, "Type");
  await expect(type).toBeEnabled();
  await expect(type.locator("option")).toHaveText(["Income", "Transfer"]);
  await expect(editor.getByRole("textbox", { name: "Description" })).toHaveAttribute("readonly", "");

  await type.selectOption("transfer");
  // The direction the statement certified is a locked row, not a choice.
  const direction = editor.locator("[data-row='transferDirection']");
  await expect(direction).toHaveClass(/is-locked/);
  await expect(direction).toContainText("Transfer in");
  await expect(direction.locator("select")).toHaveCount(0);

  const update = page.waitForResponse((response) => response.url().includes("/api/entries/update"));
  await editor.getByRole("button", { name: "Done editing entry" }).click();
  expect((await update).ok()).toBe(true);
  await expect(editor).toHaveCount(0);

  const saved = await savedEntry(page, creditId);
  expect({ entryType: saved.entryType, transferDirection: saved.transferDirection, amountMinor: saved.amountMinor, bankCertificationStatus: saved.bankCertificationStatus }).toEqual({
    entryType: "transfer",
    transferDirection: "in",
    amountMinor: 53_400,
    bankCertificationStatus: "statement_certified"
  });
});

test("a certified purchase offers only Expense and Transfer", async ({ page }) => {
  await page.goto("/");
  await reseedDemo(page);
  const { purchaseId } = await certifiedSavings(page);
  const editor = await openEditor(page, purchaseId);

  await expect(editor.locator(".entry-edit-lock-message")).toContainText("Type can switch between Expense and Transfer out,");
  const type = editorSelect(editor, "Type");
  await expect(type.locator("option")).toHaveText(["Expense", "Transfer"]);
  await type.selectOption("transfer");
  await expect(editor.locator("[data-row='transferDirection']")).toContainText("Transfer out");
  await expect(editor.locator("[data-row='transferDirection']")).toHaveClass(/is-locked/);
});
