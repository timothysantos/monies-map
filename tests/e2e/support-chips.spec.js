import { devices, expect, test } from "@playwright/test";

import { loadEntriesPage, postJson, reseedDemo } from "./helpers";

// Tappable Support chips (design.md, "Tappable chips"): a chip for a field
// you can change opens the same picker or editor as its Detail row (date →
// the date picker, wallet → the wallet picker, owner → the owner picker,
// paid by → the paid-by picker, shares → the share editor, paid using → its
// picker). A field the statement certified shows a lock and opens nothing,
// and a state chip (provisional, certified) is never an editor. Each
// tappable chip is a 44 x 44 px target named "Change <field>, <value>".
//
// Tagged @webkit: `npm run test:e2e:webkit` runs the phone cases in WebKit
// on the iPhone 13 profile.

const MONTH = "2026-05";
const { defaultBrowserType: _browser, ...iPhone13 } = devices["iPhone 13"];

async function createManualEntry(page, patch = {}) {
  const { entryId } = await postJson(page, "/api/entries/create", {
    date: `${MONTH}-24`,
    description: `Chip entry ${Date.now()}`,
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 3_210,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim",
    ...patch
  });
  return entryId;
}

// A savings account with one certified purchase: the statement import locks
// its bank facts (as in lead-support-detail-sheets.spec.js).
async function createCertifiedPurchase(page) {
  const accountName = `Chip Savings ${Date.now()}`;
  const { accountId } = await postJson(page, "/api/accounts/create", {
    name: accountName, institution: "Synthetic Test Bank", kind: "bank", openingBalanceMinor: 0, currency: "SGD", ownerPersonId: "", isJoint: false
  });
  const { entryId } = await postJson(page, "/api/entries/create", {
    accountId, accountName, ownershipType: "direct", ownerName: "Tim",
    date: `${MONTH}-21`, description: "NTUC FAIRPRICE", categoryName: "Groceries", amountMinor: 1_250, entryType: "expense"
  });
  const statementCheckpoints = [{
    accountId, accountName, detectedAccountName: accountName, checkpointMonth: MONTH,
    statementStartDate: `${MONTH}-01`, statementEndDate: `${MONTH}-31`, statementBalanceMinor: -1_250, note: "Chip checkpoint"
  }];
  const preview = await postJson(page, "/api/imports/preview", {
    sourceLabel: "Chip statement", sourceType: "pdf",
    rows: [{ date: `${MONTH}-21`, description: "NTUC FAIRPRICE", expense: "12.50", accountId, account: accountName, category: "Groceries" }],
    defaultAccountName: accountName, ownershipType: "direct", ownerName: "Tim", statementCheckpoints
  });
  const previewRows = preview.preview.previewRows;
  expect(previewRows.map((row) => row.reconciliationTargetTransactionId)).toEqual([entryId]);
  await postJson(page, "/api/imports/commit", {
    sourceLabel: "Chip statement", sourceType: "pdf", parserKey: "uob_savings_pdf",
    rows: previewRows.filter((row) => row.commitStatus === "included"),
    statementCheckpoints, statementControlRows: previewRows, statementReconciliations: preview.preview.statementReconciliations
  });
  return { entryId, accountName };
}

async function openEditSheet(page, entryId) {
  await page.goto(`/entries?view=person-tim&month=${MONTH}&editing_entry=${entryId}`);
  const sheet = page.locator('.entry-mobile-sheet[aria-label="Edit entry"]');
  await expect(sheet).toBeVisible({ timeout: 60_000 });
  return sheet;
}

function picker(page, title) {
  return page.locator(".mobile-select-dialog").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
}

async function chipText(chip) {
  return (await chip.locator(".lsd-chip").innerText()).trim();
}

async function expectTapTarget(locator) {
  const rect = await locator.boundingBox();
  expect(rect.width).toBeGreaterThanOrEqual(44);
  expect(rect.height).toBeGreaterThanOrEqual(44);
}

test.describe("tappable Support chips on a phone", { tag: "@webkit" }, () => {
  test.use(iPhone13);

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await reseedDemo(page);
  });

  test("Edit entry: date, wallet and owner chips open their pickers and save; the state chip is not an editor", async ({ page }) => {
    const entryId = await createManualEntry(page);
    const sheet = await openEditSheet(page, entryId);
    const lead = sheet.locator(".lsd-card");

    // Date: a date field over the chip, named for what it changes.
    const dateChip = lead.locator('[data-chip="date"]');
    const dateField = dateChip.locator("input[type='date']");
    await expect(dateField).toHaveAccessibleName(`Change date, ${await chipText(dateChip)}`);
    await expect(dateField).toHaveValue(`${MONTH}-24`);
    await expectTapTarget(dateField);
    await dateField.fill(`${MONTH}-20`);
    await expect(dateChip.locator(".lsd-chip")).toHaveText("Wed 20 May");

    // Wallet: the same picker sheet as the Wallet row, which unfolds.
    const walletChip = lead.getByRole("button", { name: "Change wallet, UOB One" });
    await expectTapTarget(walletChip);
    await expect(sheet.locator('[data-row="wallet"]')).toHaveCount(0);
    await walletChip.tap();
    const wallets = picker(page, "Wallet");
    await expect(wallets).toBeVisible();
    await wallets.getByRole("button", { name: /^Citi Rewards/ }).tap();
    await expect(wallets).toHaveCount(0);
    await expect(lead.locator('[data-chip="wallet"] .lsd-chip')).toHaveText("Citi Rewards");
    await expect(sheet.locator('[data-row="wallet"]')).toContainText("Citi Rewards");
    await expect(sheet.locator('[data-row="date"]')).toContainText("20 May");

    // Owner: the Owner row's picker.
    const ownerChip = lead.getByRole("button", { name: "Change owner, Tim" });
    await expectTapTarget(ownerChip);
    await ownerChip.tap();
    const owners = picker(page, "Owner");
    await expect(owners).toBeVisible();
    await owners.getByRole("button", { name: "Joyce", exact: true }).tap();
    await expect(owners).toHaveCount(0);
    await expect(lead.locator('[data-chip="owner"] .lsd-chip')).toHaveText("Joyce");

    // The bank state chip is a plain pill: no button, no field, and a tap
    // opens nothing.
    const state = lead.locator('[data-chip="state"]');
    await expect(state).toHaveText("Manual provisional");
    expect(await state.evaluate((element) => element.tagName)).toBe("SPAN");
    await expect(state.locator("button, input")).toHaveCount(0);
    await state.tap();
    await expect(page.locator(".mobile-select-dialog")).toHaveCount(0);

    const saved = page.waitForResponse((response) => response.url().includes("/api/entries/update") && response.ok());
    await sheet.getByRole("button", { name: "Save", exact: true }).tap();
    await saved;
    await expect(sheet).toHaveCount(0);
    const payload = await loadEntriesPage(page, { view: "person-tim", month: MONTH });
    const entry = payload.monthPage.entries.find((item) => item.id === entryId) ?? null;
    // Joyce's entry may leave Tim's view; read it from the household view then.
    const household = entry ?? (await loadEntriesPage(page, { view: "household", month: MONTH })).monthPage.entries.find((item) => item.id === entryId);
    expect(household).toMatchObject({ date: `${MONTH}-20`, accountName: "Citi Rewards", ownerName: "Joyce" });
  });

  test("Edit entry: a certified entry's date and wallet chips show a lock and open nothing", async ({ page }) => {
    const { entryId, accountName } = await createCertifiedPurchase(page);
    const sheet = await openEditSheet(page, entryId);
    const lead = sheet.locator(".lsd-card");

    for (const key of ["date", "wallet"]) {
      const chip = lead.locator(`[data-chip="${key}"]`);
      await expect(chip).toHaveClass(/is-locked/);
      await expect(chip.locator(".lsd-chip-lock")).toHaveCount(1);
      await expect(chip.locator(".lsd-sr-only")).toHaveText(", locked by the statement");
      await expect(chip.locator("input, button")).toHaveCount(0);
      expect(await chip.evaluate((element) => element.closest("button, label"))).toBeNull();
      await chip.tap();
      await expect(page.locator(".mobile-select-dialog")).toHaveCount(0);
    }
    await expect(lead.locator('[data-chip="wallet"]')).toContainText(accountName);
    await expect(lead.getByRole("button", { name: /^Change (date|wallet),/ })).toHaveCount(0);
    // The owner is not a bank fact: its chip still opens the owner picker.
    await lead.getByRole("button", { name: "Change owner, Tim" }).tap();
    await expect(picker(page, "Owner")).toBeVisible();
  });

  test("Ask: the draft card's date, wallet and owner chips open their rows' pickers", async ({ page }) => {
    await page.goto(`/entries?view=person-tim&month=${MONTH}`);
    await page.locator(".entries-fab:not(.splits-fab)").tap();
    const card = page.locator('[data-ask-card="draft"]');
    await expect(card).toBeVisible({ timeout: 60_000 });

    const dateChip = card.locator('[data-chip="date"]');
    const dateField = dateChip.locator("input[type='date']");
    await expect(dateField).toHaveAccessibleName(`Change date, ${await chipText(dateChip)}`);
    await expectTapTarget(dateField);
    await dateField.fill("2026-04-20");
    await expect(page.locator('[data-ask-row="date"]')).toContainText("20 Apr 2026");

    const walletChip = card.getByRole("button", { name: /^Change wallet, / });
    await expectTapTarget(walletChip);
    await walletChip.tap();
    const wallets = picker(page, "Wallet");
    await expect(wallets).toBeVisible();
    await wallets.getByRole("button", { name: /^Citi Rewards/ }).tap();
    await expect(wallets).toHaveCount(0);
    await expect(card.locator('[data-chip="wallet"] .lsd-chip')).toHaveText("Citi Rewards");

    // The owner row folds into More details; the chip unfolds it.
    const ownerChip = card.getByRole("button", { name: /^Change owner, / });
    await ownerChip.tap();
    const owners = picker(page, "Owner");
    await expect(owners).toBeVisible();
    await owners.getByRole("button", { name: "Joyce", exact: true }).tap();
    await expect(card.locator('[data-chip="owner"] .lsd-chip')).toHaveText("Joyce");
    await expect(page.locator('[data-ask-row="owner"]')).toContainText("Joyce");
  });

  test("Create split expense: date, paid by, shares and paid using chips open their editors", async ({ page }) => {
    await page.goto(`/splits?view=person-tim&month=2025-10&split_group=split-group-none&split_action=add-expense`);
    const dialog = page.getByRole("dialog", { name: "Create split expense" });
    await expect(dialog).toBeVisible({ timeout: 60_000 });
    const lead = dialog.locator(".lsd-card");

    const dateChip = lead.locator('[data-chip="date"]');
    const dateField = dateChip.locator("input[type='date']");
    await expect(dateField).toHaveAccessibleName(`Change date, ${await chipText(dateChip)}`);
    await dateField.fill("2025-10-03");
    await expect(dateChip.locator(".lsd-chip")).toHaveText("Fri 3 Oct 2025");

    const payerChip = lead.getByRole("button", { name: /^Change paid by, / });
    await expectTapTarget(payerChip);
    const payerBefore = await chipText(lead.locator('[data-chip="payer"]'));
    await payerChip.tap();
    const payers = picker(page, "Paid by");
    await expect(payers).toBeVisible();
    const otherPayer = payerBefore.endsWith("Tim") ? "Joyce" : "Tim";
    await payers.getByRole("button", { name: otherPayer, exact: true }).tap();
    await expect(lead.locator('[data-chip="payer"] .lsd-chip')).toHaveText(`Paid by ${otherPayer}`);

    // Shares: the same share editor the share rows open.
    await expect(dialog.locator(".split-share-editor")).toHaveCount(0);
    const sharesChip = lead.getByRole("button", { name: /^Change shares, / });
    await expect(sharesChip).toHaveAttribute("aria-expanded", "false");
    await sharesChip.tap();
    await expect(dialog.locator(".split-share-editor")).toBeVisible();
    await expect(sharesChip).toHaveAttribute("aria-expanded", "true");
    await expect(dialog.locator('[data-row="share-percent"] input')).toBeVisible();

    const paymentChip = lead.getByRole("button", { name: /^Change paid using, / });
    await paymentChip.tap();
    const payments = picker(page, "Paid using");
    await expect(payments).toBeVisible();
    await payments.getByRole("button", { name: "Card", exact: true }).tap();
    await expect(lead.locator('[data-chip="paymentMethod"] .lsd-chip')).toHaveText("Card");
  });
});

test.describe("tappable Support chips on a wide screen", () => {
  test.beforeEach(async ({ page }) => {
    await reseedDemo(page);
  });

  test("the inline editor's wallet chip moves focus to the Wallet field; the keyboard reaches every chip", async ({ page }) => {
    const entryId = await createManualEntry(page);
    await page.goto(`/entries?view=person-tim&month=${MONTH}&editing_entry=${entryId}`);
    const card = page.locator(".entry-edit-card.is-inline");
    await expect(card).toBeVisible({ timeout: 60_000 });
    const walletChip = card.getByRole("button", { name: "Change wallet, UOB One" });
    await walletChip.focus();
    await page.keyboard.press("Enter");
    expect(await page.evaluate(() => document.activeElement?.closest("[data-row]")?.getAttribute("data-row"))).toBe("wallet");
    await expect(card.locator('[data-row="wallet"] select')).toBeFocused();
    const ownerChip = card.getByRole("button", { name: "Change owner, Tim" });
    await ownerChip.click();
    await expect(card.locator('[data-row="owner"] select')).toBeFocused();
    await expect(card.getByLabel(/^Change date, /)).toHaveAttribute("type", "date");
  });
});
