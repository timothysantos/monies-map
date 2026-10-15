// A StashAway statement imported in the browser, at desktop and phone widths:
// the sanitized real statements (tests/fixtures/pdf-statement-text/
// stashaway-*) have their raw text items printed to a real PDF, so the
// browser reads them like a user's file. Two months go into a demo household
// with an investment account, Summary shows the newest month's closing balance
// as a statement figure, and hidden money hides it. A deposit pairs with the
// bank's payment as one transfer.
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { loadEntriesPage, postJson, reseedDemo } from "./helpers.js";

const ACCOUNT = "Alex Sample Holder StashAway";
const PAYMENT = "FAST PAYMENT STASHAWAY 00 XYZ00X";
// Set to a folder to also save the before/after screenshots (docs/audits/stashaway-import).
const SHOT_DIR = process.env.STASHAWAY_SHOT_DIR;

async function readFixtureText(month) {
  return readFile(new URL(`../fixtures/pdf-statement-text/stashaway-${month}-2026-real-sanitized.pdf-text.txt`, import.meta.url), "utf8");
}

async function writePdf(page, text, pdfPath) {
  // One text item per line, in reading order: the view the parser reads.
  const lines = text.split("__PDF_LAYOUT_TEXT__")[0].split("\n").map((line) => line.trim()).filter(Boolean);
  const escape = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const pdfPage = await page.context().newPage();
  await pdfPage.setContent(`<html><body style="font-family: Helvetica, Arial, sans-serif; font-size: 9px; line-height: 1.5;">${
    lines.map((line) => `<div style="white-space: pre;">${escape(line)}</div>`).join("")
  }</body></html>`);
  await pdfPage.pdf({ path: pdfPath, format: "A3" });
  await pdfPage.close();
}

async function seedHousehold(page, { investment = true } = {}) {
  await reseedDemo(page);
  await postJson(page, "/api/accounts/create", { name: "OCBC 360", institution: "OCBC", kind: "bank", currency: "SGD", openingBalanceMinor: 0, ownerPersonId: "person-tim", isJoint: false });
  if (investment) {
    await postJson(page, "/api/accounts/create", { name: ACCOUNT, institution: "StashAway", kind: "investment", currency: "SGD", openingBalanceMinor: 0, ownerPersonId: "person-tim", isJoint: false });
  }
}

async function shot(page, name) {
  if (SHOT_DIR) {
    await mkdir(SHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), fullPage: true });
  }
}

async function showMoney(page) {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
}

async function openStatementText(page, testInfo, name, text, { view = "person-tim" } = {}) {
  const pdfPath = testInfo.outputPath(`${name}.pdf`);
  await writePdf(page, text, pdfPath);
  await page.goto(`/imports?view=${view}`, { waitUntil: "domcontentloaded" });
  await page.locator("input[type=file]").setInputFiles(pdfPath);
  return page.locator('[data-import-target="investment-statement"]');
}

async function openStatement(page, testInfo, month, options) {
  return openStatementText(page, testInfo, `stashaway-${month}-2026-real`, await readFixtureText(month), options);
}

const commitButton = (page) => page.locator(".import-commit-bar .import-commit-button");

async function importMonth(page, testInfo, month, expectedWorth) {
  const card = await openStatement(page, testInfo, month);
  await expect(card).toContainText(expectedWorth, { timeout: 60_000 });
  await expect(commitButton(page)).toHaveText("Save statement value");
  await commitButton(page).click();
  await expect(page.locator(".import-done-card")).toBeVisible({ timeout: 60_000 });
}

for (const device of [{ label: "desktop", width: 1280, height: 800 }, { label: "phone", width: 390, height: 844 }]) {
  test(`${device.label}: two months saved in turn, Summary shows the newest closing balance as a statement figure, and hidden money hides it`, async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: device.width, height: device.height });
    await showMoney(page);
    await seedHousehold(page);
    await page.goto("/summary?view=household");
    const before = page.locator(".summary-wallet-row").filter({ hasText: ACCOUNT });
    await expect(before).toBeVisible({ timeout: 60_000 });
    await expect(before.locator(".summary-wallet-health")).not.toContainText("Worth");
    await shot(page, `before-summary-${device.label}`);

    await importMonth(page, testInfo, "aug", "Alex Sample Holder StashAway was worth $15,706.59 on 31 Aug 2026, from the statement");
    await page.goto("/summary?view=household");
    await expect(page.locator(".summary-wallet-row").filter({ hasText: ACCOUNT }).locator(".summary-wallet-health")).toHaveText("$15,706.59 on 31 Aug 2026, as the statement says", { timeout: 60_000 });

    const card = await openStatement(page, testInfo, "sep");
    await expect(card).toContainText("Alex Sample Holder StashAway was worth $15,357.71 on 30 Sep 2026, from the statement", { timeout: 60_000 });
    // It starts where August ended: no notice about a gap, and no rows to add.
    await expect(card).not.toContainText("A statement may be missing in between");
    await expect(page.locator(".import-commit-bar-summary")).toHaveText("1 statement value will be saved");
    await shot(page, `after-import-preview-${device.label}`);
    if (SHOT_DIR) {
      await card.screenshot({ path: path.join(SHOT_DIR, `after-investment-statement-box-${device.label}.png`) });
    }
    await expect(commitButton(page)).toHaveText("Save statement value");
    await commitButton(page).click();
    await expect(page.locator(".import-done-card")).toBeVisible({ timeout: 60_000 });

    await page.goto("/summary?view=household");
    const row = page.locator(".summary-wallet-row").filter({ hasText: ACCOUNT });
    await expect(row.locator(".summary-wallet-health")).toHaveText("$15,357.71 on 30 Sep 2026, as the statement says", { timeout: 60_000 });
    await shot(page, `after-summary-${device.label}`);

    // Hidden money: no figure and no words that carry it.
    await page.getByRole("button", { name: "Hide money totals" }).click();
    const hiddenRow = page.locator(".summary-wallet-row").filter({ hasText: ACCOUNT });
    await expect(hiddenRow).toBeVisible({ timeout: 60_000 });
    await expect(hiddenRow.locator(".summary-wallet-health")).toHaveCount(0);
    expect(await hiddenRow.innerText()).not.toMatch(/15,357|Worth|statement/);
  });
}

test("desktop: a StashAway account the app does not know yet is created from the import as an investment account", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await showMoney(page);
  await seedHousehold(page, { investment: false });

  const card = await openStatement(page, testInfo, "sep");
  await expect(card).toBeVisible({ timeout: 60_000 });
  await shot(page, "before-no-account-desktop");
  const mapping = page.locator('[data-import-target="account-mapping"]');
  await expect(mapping).toBeVisible();
  await mapping.getByRole("button", { name: "Create account" }).click();

  const dialog = page.getByRole("dialog", { name: "Create account" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Display name")).toHaveValue(ACCOUNT);
  await expect(dialog.getByLabel("Institution")).toHaveValue("StashAway");
  await expect(dialog.locator(".lsd-chip").filter({ hasText: "Investment" })).toBeVisible();
  await shot(page, "after-create-account-dialog-desktop");
  await dialog.locator(".lsd-bottom").getByRole("button", { name: "Create account" }).click();
  await expect(dialog).toHaveCount(0);

  await expect(page.locator('[data-import-target="investment-statement"]')).toContainText("was worth $15,357.71 on 30 Sep 2026", { timeout: 60_000 });
  await commitButton(page).click();
  await expect(page.locator(".import-done-card")).toBeVisible({ timeout: 60_000 });
  const created = (await (await page.request.get("/api/summary-account-pills?view=household")).json()).accountPills.find((pill) => pill.accountName === ACCOUNT);
  expect(created.investmentValue).toEqual({ valueMinor: 1_535_771, asOfDate: "2026-09-30" });
  expect(created.balanceMinor).toBe(0);
});

test("desktop: a deposit pairs with the bank payment as one transfer, and the same statement again says what it replaces", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await showMoney(page);
  await seedHousehold(page);
  await postJson(page, "/api/entries/create", {
    date: "2026-09-01",
    description: PAYMENT,
    amountMinor: 50_000,
    entryType: "expense",
    accountName: "OCBC 360",
    categoryName: "Investments",
    ownershipType: "direct",
    ownerName: "Tim"
  });
  // September with an inferred $500.00 deposit on 2 September (see the parser tests).
  const text = (await readFixtureText("sep")).split("__PDF_LAYOUT_TEXT__")[0]
    .replace(/(\$15,706\.59\n \n)(?:\$0\.00|-)(\n \n-\$337\.62\n \n-\$11\.26\n \n)\$15,357\.71/g, (match, before, after) => `${before}$500.00${after}$15,857.71`)
    .replace("04\n \nSep 2026\n \nCurrency Conversion to SGD", "02\n \nSep 2026\n \nDeposit\n \n-\n \n$500.00\n\n04\n \nSep 2026\n \nCurrency Conversion to SGD");

  const card = await openStatementText(page, testInfo, "stashaway-sep-2026-with-deposit", text);
  await expect(card).toContainText("Alex Sample Holder StashAway was worth $15,857.71 on 30 Sep 2026, from the statement", { timeout: 60_000 });
  await expect(card).toContainText("$500.00 put in on 2 Sep 2026 is the OCBC 360 payment of 1 Sep 2026. They are saved as one transfer, not two.");
  await shot(page, "after-deposit-preview-desktop");
  await expect(page.locator(".import-commit-bar-summary")).toHaveText("1 row will import · 1 statement value will be saved");
  await commitButton(page).click();
  await expect(page.locator(".import-done-card")).toBeVisible({ timeout: 60_000 });

  const septemberPage = await loadEntriesPage(page, { view: "household", month: "2026-09" });
  const pair = septemberPage.monthPage.entries.filter((entry) => entry.accountName === ACCOUNT || entry.description === PAYMENT);
  expect(pair.map((entry) => [entry.accountName, entry.entryType, entry.transferDirection]).sort()).toEqual([
    [ACCOUNT, "transfer", "in"],
    ["OCBC 360", "transfer", "out"]
  ]);
  expect(pair[0].linkedTransfer?.transactionId).toBe(pair[1].id);
  expect(pair[1].linkedTransfer?.transactionId).toBe(pair[0].id);

  // The same statement again: the deposit is on the ledger already, and the value is replaced.
  await page.goto("/imports?view=person-tim", { waitUntil: "domcontentloaded" });
  await page.locator("input[type=file]").setInputFiles(testInfo.outputPath("stashaway-sep-2026-with-deposit.pdf"));
  await expect(page.locator('[data-import-target="investment-statement"]')).toContainText("This replaces the $15,857.71 saved for that month", { timeout: 60_000 });
});

test("desktop: a statement that does not start where the earlier one ended says so and still saves", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await showMoney(page);
  await seedHousehold(page);
  await importMonth(page, testInfo, "aug", "was worth $15,706.59 on 31 Aug 2026");

  const sep = (await readFixtureText("sep")).replace(/\$15,706\.59/g, "$15,606.59");
  const card = await openStatementText(page, testInfo, "stashaway-sep-2026-gap", sep);
  await expect(card).toContainText("This statement starts at $15,606.59, but the earlier statement ended at $15,706.59 on 31 Aug 2026. A statement may be missing in between.", { timeout: 60_000 });
  await shot(page, "after-earlier-statement-notice-desktop");
  // The notice does not block: the value can still be saved.
  await expect(commitButton(page)).toBeEnabled();
  await commitButton(page).click();
  await expect(page.locator(".import-done-card")).toBeVisible({ timeout: 60_000 });
});

test("desktop: a cut-short StashAway file is refused in words and nothing is previewed", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await showMoney(page);
  await seedHousehold(page);
  const text = (await readFixtureText("sep")).split("__PDF_LAYOUT_TEXT__")[0];
  const cut = text.slice(0, text.indexOf("ACCOUNT SUMMARY"));
  const truncated = testInfo.outputPath("stashaway-cut-short.pdf");
  await writePdf(page, cut, truncated);

  await page.goto("/imports?view=person-tim", { waitUntil: "domcontentloaded" });
  await page.locator("input[type=file]").setInputFiles(truncated);
  await expect(page.getByText(/StashAway statement looks cut short/)).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-import-target="investment-statement"]')).toHaveCount(0);
});
