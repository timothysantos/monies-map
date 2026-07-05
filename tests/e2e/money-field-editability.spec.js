import { expect, test } from "@playwright/test";

import {
  gotoPageAfterApi,
  loadEntriesPage,
  loadImportsPage,
  loadMonthPage,
  loadSettingsPage,
  loadSplitsPage,
  postJson,
  reseedDemo
} from "./helpers";

function formatMoney(minor) {
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: "SGD"
  }).format(minor / 100);
}

async function openEntryEditor(page, description) {
  const entryRow = page.locator(".entry-row").filter({ hasText: description }).first();
  await expect(entryRow).toBeVisible();
  await entryRow.click();
  const editor = page.locator(".entry-edit-grid").first();
  await expect(editor).toBeVisible();
  return editor;
}

async function openMonthBudgetEditor(page, label) {
  const row = page.locator("tr").filter({ hasText: label }).first();
  await expect(row).toBeVisible();
  await row.getByText(label).first().click();
  const editorRow = page.locator(".month-inline-action-row").first();
  await expect(editorRow.getByRole("button", { name: "Save" })).toBeVisible();
  return row;
}

async function replaceInputValue(input, nextValue) {
  const currentValue = await input.inputValue();
  await input.click();
  await input.press("End");
  for (let index = 0; index < currentValue.length + 2; index += 1) {
    await input.press("Backspace");
  }
  await input.type(nextValue);
}

test.describe("money field editability", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await reseedDemo(page);
  });

  test("entry amount replaces the formatted value by typing and persists", async ({ page }) => {
    const description = `Playwright entry amount ${Date.now()}`;
    await postJson(page, "/api/entries/create", {
      date: "2026-05-24",
      description,
      accountName: "UOB One",
      categoryName: "Groceries",
      amountMinor: 3210,
      entryType: "expense",
      ownershipType: "direct",
      ownerName: "Tim"
    });

    await page.goto("/entries?view=person-tim&month=2026-05");
    const editor = await openEntryEditor(page, description);
    const amountInput = editor.getByLabel("Amount");
    await page.route("**/api/entries/update", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await route.continue();
    });
    await amountInput.fill("48.76");
    await expect(amountInput).toHaveValue("48.76");
    const saveButton = page.getByRole("button", { name: "Done editing entry" });
    const updateResponse = page.waitForResponse((response) => response.url().includes("/api/entries/update") && response.ok());
    await saveButton.click();
    await expect(saveButton).toBeDisabled();
    await expect(saveButton).toContainText("Saving");
    await updateResponse;

    await expect.poll(async () => {
      const entriesPage = await loadEntriesPage(page, { view: "person-tim", month: "2026-05" });
      return entriesPage.monthPage.entries.find((entry) => entry.description === description)?.amountMinor ?? 0;
    }).toBe(4876);
  });

  test("entries still allow note edits and persist them after save", async ({ page }) => {
    const description = `Playwright note edit ${Date.now()}`;
    await postJson(page, "/api/entries/create", {
      date: "2026-05-24",
      description,
      accountName: "UOB One",
      categoryName: "Groceries",
      amountMinor: 3210,
      entryType: "expense",
      ownershipType: "direct",
      ownerName: "Tim"
    });

    await page.goto("/entries?view=person-tim&month=2026-05");
    const editor = await openEntryEditor(page, description);

    const noteInput = page.getByRole("textbox", { name: "Note" });
    await noteInput.fill("receipt captured and itemized");

    const saveButton = page.getByRole("button", { name: "Done editing entry" });
    const updateResponse = page.waitForResponse((response) => response.url().includes("/api/entries/update") && response.ok());
    await saveButton.click();
    await updateResponse;

    await expect.poll(async () => {
      const entriesPage = await loadEntriesPage(page, { view: "person-tim", month: "2026-05" });
      return entriesPage.monthPage.entries.find((entry) => entry.description === description)?.note ?? "";
    }).toBe("receipt captured and itemized");
  });

  test("month budget amount replaces the formatted value by typing and persists", async ({ page }) => {
    const month = await loadMonthPage(page, { view: "person-tim", month: "2026-05", scope: "direct_plus_shared" });
    const entertainmentRow = month.monthPage.planSections
      .find((section) => section.key === "budget_buckets")
      ?.rows.find((row) => row.label === "Entertainment");
    expect(entertainmentRow).toBeTruthy();

    await page.goto("/month?view=person-tim&month=2026-05&scope=direct_plus_shared");
    const row = await openMonthBudgetEditor(page, "Entertainment");
    const amountInput = row.locator(".table-edit-input-money");
    await replaceInputValue(amountInput, "88.40");
    await expect(amountInput).toHaveValue("88.40");
    await page.locator(".month-inline-action-row").first().getByRole("button", { name: "Save" }).click();
    await expect(row).toContainText("$88.40");

    const after = await loadMonthPage(page, { view: "person-tim", month: "2026-05", scope: "direct_plus_shared" });
    const updatedRow = after.monthPage.planSections
      .find((section) => section.key === "budget_buckets")
      ?.rows.find((nextRow) => nextRow.label === "Entertainment");
    expect(updatedRow?.plannedMinor).toBe(8840);
  });

  test("split expense amount and split percent replace their formatted values by typing", async ({ page }) => {
    await page.goto("/splits?view=person-tim&month=2025-10&split_group=split-group-baby-river");
    await page.locator(".split-activity-card").filter({ hasText: "Family support" }).first().click();
    const inlineEditor = page.locator(".split-inline-editor-card").first();
    await expect(inlineEditor).toBeVisible();

    const moneyInputs = inlineEditor.locator(".table-edit-input-money");
    const amountInput = moneyInputs.nth(0);
    const percentInput = moneyInputs.nth(1);
    const exactAmountInput = moneyInputs.nth(2);
    await page.route("**/api/splits/expenses/update", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await route.continue();
    });

    await replaceInputValue(amountInput, "99.99");
    await expect(amountInput).toHaveValue("99.99");

    await replaceInputValue(percentInput, "60");
    await expect(percentInput).toHaveValue("60");

    await replaceInputValue(exactAmountInput, "8.");
    await expect(exactAmountInput).toHaveValue("8.");
    await exactAmountInput.type("01");
    await expect(exactAmountInput).toHaveValue("8.01");

    const saveButton = inlineEditor.getByRole("button", { name: "Done editing split" });
    const saveResponse = page.waitForResponse((response) => response.url().includes("/api/splits/expenses/update") && response.ok());
    await saveButton.click();
    await expect(saveButton).toBeDisabled();
    await expect(saveButton).toContainText("Saving");
    await saveResponse;

    await expect.poll(async () => {
      const splitsPage = await loadSplitsPage(page, { view: "person-tim", month: "2025-10" });
      return splitsPage.splitsPage.activity.find((item) => item.description === "Family support")?.totalAmountMinor ?? 0;
    }).toBe(9999);
  });

  test("import preview amount replaces the formatted value by typing before commit", async ({ page }) => {
    await gotoPageAfterApi(
      page,
      "/imports?view=person-tim&month=2025-10",
      "/api/imports-page",
      () => page.getByRole("heading", { name: "Import and certify", exact: true })
    );
    await expect(page.getByRole("heading", { name: "Import and certify", exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Source label")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel("Source label")).toBeVisible({ timeout: 30_000 });

    await page.getByLabel("Source label").fill(`Playwright import ${Date.now()}`);
    await page.getByLabel("Default owner").selectOption("Tim");
    await page.getByLabel("CSV content").fill(
      [
        "category,account,note,amount,date,description",
        "Groceries,UOB One,Playwright import row,-111.11,2025-10-17,Playwright groceries import"
      ].join("\n")
    );

    await page.getByRole("button", { name: "Preview import" }).click();
    const amountInput = page.locator(".import-preview-table .import-amount-input").first();
    await expect(amountInput).toBeVisible();
    await amountInput.fill("-222.22");
    await expect(amountInput).toHaveValue("-222.22");
    await page.getByRole("button", { name: "Commit import" }).first().click();

    await expect.poll(async () => {
      const importsPage = await loadImportsPage(page);
      return importsPage.importsPage.recentImports.some((item) => item.sourceLabel?.includes("Playwright import"));
    }).toBe(true);
  });

  test("settings money fields replace the formatted value by typing and persist", async ({ page }) => {
    await gotoPageAfterApi(
      page,
      "/settings?view=person-tim",
      "/api/settings-page",
      () => page.getByRole("heading", { name: "Settings" })
    );
    await page.locator("button").filter({ hasText: "Accounts" }).first().click();

    await page.locator(".settings-account-row").filter({ hasText: "UOB One" }).first().getByRole("button", { name: "Edit account" }).click();
    const accountDialog = page.locator(".settings-account-dialog");
    const openingBalance = accountDialog.getByLabel("Opening balance");
    await replaceInputValue(openingBalance, "1234.56");
    await expect(openingBalance).toHaveValue("1234.56");
    await accountDialog.getByRole("button", { name: "Save account" }).click();
    await expect(page.locator(".settings-account-row").filter({ hasText: "UOB One" }).first()).toContainText(formatMoney(123456));

    await page.locator(".settings-account-row").filter({ hasText: "UOB One" }).first().getByRole("button", { name: "Reconcile" }).click();
    const reconciliationDialog = page.locator(".settings-reconciliation-dialog");
    await expect(reconciliationDialog.getByRole("heading", { name: "Statement checkpoint" })).toBeVisible();
    await reconciliationDialog.getByLabel("Statement month").fill("2026-05");
    await reconciliationDialog.getByLabel("Statement start date").fill("2026-05-01");
    await reconciliationDialog.getByLabel("Statement end date").fill("2026-05-31");
    const statementBalance = reconciliationDialog.getByLabel("Statement ending balance");
    await replaceInputValue(statementBalance, "2345.67");
    await expect(statementBalance).toHaveValue("2345.67");
    await reconciliationDialog.getByRole("button", { name: "Save checkpoint" }).click();

    await expect.poll(async () => {
      const settingsPage = await loadSettingsPage(page);
      const account = settingsPage.settingsPage.accounts.find((item) => item.name === "UOB One");
      return account?.checkpointHistory?.find((item) => item.month === "2026-05")?.statementBalanceMinor ?? null;
    }).toBe(-234567);
  });

});
