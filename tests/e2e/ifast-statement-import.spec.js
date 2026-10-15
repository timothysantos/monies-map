// An iFAST Wrap statement imported in the browser, at desktop and phone
// widths: the sanitized real statements (tests/fixtures/pdf-statement-text/
// ifast-wrap-*) have their raw text items printed to a real PDF, so the
// browser reads them like a user's file. The contribution pairs with the
// bank's GIRO row as one transfer, its market value is saved and shown on
// Summary as a statement figure, and hidden money hides it.
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { loadEntriesPage, postJson, reseedDemo } from "./helpers.js";

const GIRO = "IBG GIRO COLL P0000194 IFAST FINANCIAL PL- P0000194";
// Set to a folder to also save the before/after screenshots (docs/audits/ifast-import).
const SHOT_DIR = process.env.IFAST_SHOT_DIR;

async function writeStatementPdf(page, name, pdfPath) {
  const text = await readFile(new URL(`../fixtures/pdf-statement-text/${name}-sanitized.pdf-text.txt`, import.meta.url), "utf8");
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
  await postJson(page, "/api/accounts/create", { name: "OCBC 360", institution: "OCBC", kind: "bank", currency: "SGD", openingBalanceMinor: 0, ownerPersonId: "person-joyce", isJoint: false });
  if (investment) {
    await postJson(page, "/api/accounts/create", { name: "Alex iFAST", institution: "iFAST", kind: "investment", currency: "SGD", openingBalanceMinor: 0, ownerPersonId: "person-joyce", isJoint: false });
  }
  await postJson(page, "/api/entries/create", {
    date: "2026-07-03",
    description: GIRO,
    amountMinor: 68_500,
    entryType: "expense",
    accountName: "OCBC 360",
    categoryName: "Investments",
    ownershipType: "direct",
    ownerName: "Joyce"
  });
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

async function openStatement(page, testInfo, name, { view = "person-joyce" } = {}) {
  const pdfPath = testInfo.outputPath(`${name}.pdf`);
  await writeStatementPdf(page, name, pdfPath);
  await page.goto(`/imports?view=${view}`, { waitUntil: "domcontentloaded" });
  await page.locator("input[type=file]").setInputFiles(pdfPath);
  return page.locator('[data-import-target="investment-statement"]');
}

const commitButton = (page) => page.locator(".import-commit-bar .import-commit-button");

for (const device of [{ label: "desktop", width: 1280, height: 800 }, { label: "phone", width: 390, height: 844 }]) {
  test(`${device.label}: the July statement pairs with the GIRO row, saves its value and Summary shows it as a statement figure`, async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: device.width, height: device.height });
    await showMoney(page);
    await seedHousehold(page);
    if (SHOT_DIR) {
      await page.goto("/summary?view=household");
      await expect(page.locator(".summary-wallet-row").filter({ hasText: "Alex iFAST" })).toBeVisible({ timeout: 60_000 });
      await shot(page, `before-summary-${device.label}`);
    }

    const card = await openStatement(page, testInfo, "ifast-wrap-jul-2026-real");
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(card).toContainText("Alex iFAST was worth $1,374.67 on 31 Jul 2026, from the statement");
    await expect(card).toContainText("$685.00 put in on 8 Jul 2026 is the OCBC 360 payment of 3 Jul 2026. They are saved as one transfer, not two.");
    await shot(page, `after-import-preview-${device.label}`);
    if (SHOT_DIR) {
      await card.screenshot({ path: path.join(SHOT_DIR, `after-investment-statement-box-${device.label}.png`) });
    }
    await expect(page.locator(".import-commit-bar-summary")).toHaveText("1 row will import · 1 statement value will be saved");

    await expect(commitButton(page)).toHaveText("Commit import to ledger");
    await commitButton(page).click();
    await expect(page.locator(".import-done-card")).toBeVisible({ timeout: 60_000 });

    // One transfer: the investment account's entry and the bank's GIRO row share a group.
    const julyPage = await loadEntriesPage(page, { view: "household", month: "2026-07" });
    const july = julyPage.monthPage.entries;
    const pair = july.filter((entry) => entry.accountName === "Alex iFAST" || entry.description === GIRO);
    expect(pair.map((entry) => [entry.accountName, entry.entryType, entry.transferDirection]).sort()).toEqual([
      ["Alex iFAST", "transfer", "in"],
      ["OCBC 360", "transfer", "out"]
    ]);
    expect(pair[0].linkedTransfer?.transactionId).toBe(pair[1].id);
    expect(pair[1].linkedTransfer?.transactionId).toBe(pair[0].id);

    await page.goto("/summary?view=household");
    const row = page.locator(".summary-wallet-row").filter({ hasText: "Alex iFAST" });
    await expect(row).toBeVisible({ timeout: 60_000 });
    await expect(row.locator(".summary-wallet-health")).toHaveText("Worth $1,374.67 on 31 Jul 2026, from its statement");
    await shot(page, `after-summary-${device.label}`);

    // Hidden money: no figure and no words that carry it.
    await page.getByRole("button", { name: "Hide money totals" }).click();
    const hiddenRow = page.locator(".summary-wallet-row").filter({ hasText: "Alex iFAST" });
    await expect(hiddenRow).toBeVisible({ timeout: 60_000 });
    await expect(hiddenRow.locator(".summary-wallet-health")).toHaveCount(0);
    expect(await hiddenRow.innerText()).not.toMatch(/1,374|Worth|statement/);
  });
}

test("desktop: a month with no contribution saves only the value, and a revised statement says what it replaces", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await showMoney(page);
  await seedHousehold(page);

  const card = await openStatement(page, testInfo, "ifast-wrap-sep-2026-real");
  await expect(card).toContainText("Alex iFAST was worth $2,023.90 on 30 Sep 2026", { timeout: 60_000 });
  await expect(commitButton(page)).toHaveText("Save statement value");
  await commitButton(page).click();
  await expect(page.locator(".import-done-card")).toBeVisible({ timeout: 60_000 });

  // The same statement again: nothing new to add, and it says it replaces the saved value.
  await page.goto("/imports?view=person-joyce", { waitUntil: "domcontentloaded" });
  await page.locator("input[type=file]").setInputFiles(testInfo.outputPath("ifast-wrap-sep-2026-real.pdf"));
  await expect(page.locator('[data-import-target="investment-statement"]')).toContainText("This replaces the $2,023.90 saved for that month", { timeout: 60_000 });
  const alex = (await (await page.request.get("/api/summary-account-pills?view=household")).json()).accountPills.find((pill) => pill.accountName === "Alex iFAST");
  expect(alex.investmentValue).toEqual({ valueMinor: 202_390, asOfDate: "2026-09-30" });
  expect(alex.balanceMinor).toBe(0);
});

test("desktop: an iFAST account the app does not know yet is created from the import as an investment account", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await showMoney(page);
  await seedHousehold(page, { investment: false });

  const card = await openStatement(page, testInfo, "ifast-wrap-jul-2026-real");
  await expect(card).toBeVisible({ timeout: 60_000 });
  await shot(page, "before-no-account-desktop");
  const mapping = page.locator('[data-import-target="account-mapping"]');
  await expect(mapping).toBeVisible();
  await mapping.getByRole("button", { name: "Create account" }).click();

  const dialog = page.getByRole("dialog", { name: "Create account" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Display name")).toHaveValue("Alex iFAST");
  await expect(dialog.getByLabel("Institution")).toHaveValue("iFAST");
  await expect(dialog.locator(".lsd-chip").filter({ hasText: "Investment" })).toBeVisible();
  await shot(page, "after-create-account-dialog-desktop");
  await dialog.locator(".lsd-bottom").getByRole("button", { name: "Create account" }).click();
  await expect(dialog).toHaveCount(0);

  await expect(page.locator('[data-import-target="investment-statement"]')).toContainText("is the OCBC 360 payment of 3 Jul 2026", { timeout: 60_000 });
  await commitButton(page).click();
  await expect(page.locator(".import-done-card")).toBeVisible({ timeout: 60_000 });
  const pills = (await (await page.request.get("/api/summary-account-pills?view=household")).json()).accountPills;
  const created = pills.find((pill) => pill.accountName === "Alex iFAST");
  expect(created.investmentValue).toEqual({ valueMinor: 137_467, asOfDate: "2026-07-31" });
  expect(created.balanceMinor).toBe(68_500);
});

test("desktop: a cut-short iFAST file is refused in words and nothing is previewed", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await showMoney(page);
  await seedHousehold(page);
  const truncated = testInfo.outputPath("ifast-cut-short.pdf");
  const text = await readFile(new URL("../fixtures/pdf-statement-text/ifast-wrap-jul-2026-real-sanitized.pdf-text.txt", import.meta.url), "utf8");
  const firstPage = text.split("__PDF_LAYOUT_TEXT__")[0].split("\n").map((line) => line.trim()).filter(Boolean);
  const cut = firstPage.slice(0, firstPage.findIndex((line) => line === "INVESTMENT TRANSACTION"));
  const pdfPage = await page.context().newPage();
  await pdfPage.setContent(`<html><body style="font-size: 9px;">${cut.map((line) => `<div style="white-space: pre;">${line.replace(/&/g, "&amp;")}</div>`).join("")}</body></html>`);
  await pdfPage.pdf({ path: truncated, format: "A3" });
  await pdfPage.close();

  await page.goto("/imports?view=person-joyce", { waitUntil: "domcontentloaded" });
  await page.locator("input[type=file]").setInputFiles(truncated);
  await expect(page.getByText(/iFAST statement looks cut short/)).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-import-target="investment-statement"]')).toHaveCount(0);
});
