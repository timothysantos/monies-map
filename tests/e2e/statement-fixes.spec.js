// The statement check finds purchases recorded on the wrong card, the user
// approves the move, the check closes, the commit writes it, and rolling the
// import back undoes it. The statement is the sanitized two-card UOB PDF text
// (tests/fixtures/pdf-statement-text/uob-card-two-card-may-2026-sanitized),
// printed to a real PDF so the browser parses it as a user's file.
import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { postJson, reseedDemo } from "./helpers.js";

const ONE_CARD = "UOB One Card";
const LADYS_CARD = "UOB Lady's Card";

async function writeStatementPdf(page, path) {
  const text = (await readFile(new URL("../fixtures/pdf-statement-text/uob-card-two-card-may-2026-sanitized.pdf-text.txt", import.meta.url), "utf8"))
    .split("__PDF_LAYOUT_TEXT__")[0];
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const pdfPage = await page.context().newPage();
  await pdfPage.setContent(`<html><body><pre style="font-family: Helvetica, Arial, sans-serif; font-size: 11px; line-height: 1.55; white-space: pre-wrap;">${escaped}</pre></body></html>`);
  await pdfPage.pdf({ path, format: "A4", printBackground: true });
  await pdfPage.close();
}

async function setUpWrongCardLedger(page) {
  await reseedDemo(page);
  const createAccount = async (name, openingBalanceMinor) => (await postJson(page, "/api/accounts/create", {
    name,
    institution: "UOB",
    kind: "credit_card",
    currency: "SGD",
    openingBalanceMinor,
    ownerPersonId: "person-tim",
    isJoint: false
  })).accountId;
  const oneCardId = await createAccount(ONE_CARD, 15000);
  const ladysCardId = await createAccount(LADYS_CARD, -1250);
  const entry = async (accountId, date, description, amountMinor, categoryName) => (await postJson(page, "/api/entries/create", {
    accountId,
    date,
    description,
    amountMinor,
    categoryName,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  })).entryId;
  await entry(oneCardId, "2026-04-11", "HONG KONG ZHAI DIM SUM", 1140, "Food & Drinks");
  await entry(ladysCardId, "2026-04-30", "Don Don Donki", 1890, "Groceries");
  const openaiId = await entry(ladysCardId, "2026-04-20", "OpenAI", 2949, "Subscriptions MO");
  const buyandshipId = await entry(ladysCardId, "2026-05-05", "Buyandship", 1313, "Shopping");
  await entry(ladysCardId, "2026-05-14", "Sabai Sabai - Valley P", 2049, "Food & Drinks");
  return { oneCardId, ladysCardId, openaiId, buyandshipId };
}

async function entryAccountName(page, entryId) {
  const response = await page.request.get("/api/entries-page?view=household&month=2026-04");
  const payload = await response.json();
  const entries = payload.monthPage?.entries ?? [];
  return entries.find((item) => item.id === entryId)?.accountName;
}

test("a wrong-card purchase is found, moved on approval, committed and undone by rollback", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const { openaiId } = await setUpWrongCardLedger(page);
  const pdfPath = testInfo.outputPath("eStatement_UOB_Cards_12May2026.pdf");
  await writeStatementPdf(page, pdfPath);

  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await page.goto("/imports");
  await page.locator("input[type=file]").setInputFiles(pdfPath);

  const oneCard = page.locator(".statement-reconciliation-row").filter({ hasText: `${ONE_CARD} • May 2026` });
  const ladysCard = page.locator(".statement-reconciliation-row").filter({ hasText: `${LADYS_CARD} • May 2026` });
  await expect(ladysCard.getByText("2 entries belong on UOB One Card")).toBeVisible({ timeout: 30_000 });
  await expect(ladysCard.getByText("They are on UOB Lady's Card in your ledger, but this statement lists them under UOB One Card. Moving them takes $42.62 off UOB Lady's Card's difference and the statement closes.")).toBeVisible();
  const fixRows = ladysCard.locator(".statement-fix-row");
  await expect(fixRows).toHaveCount(2);
  await expect(fixRows.nth(0)).toContainText("OpenAI");
  await expect(fixRows.nth(0)).toContainText("Bought 20 Apr 2026, posted 22 Apr 2026");
  await expect(fixRows.nth(0)).toContainText("$29.49");
  await expect(fixRows.nth(1)).toContainText("Buyandship");
  await expect(fixRows.nth(1)).toContainText("$13.13");
  await expect(oneCard.getByText("2 rows here are already in your ledger on UOB Lady's Card.", { exact: false })).toBeVisible();
  // Sabai Sabai is after the statement: shown as staying provisional, not
  // offered as a fix.
  await expect(ladysCard.getByText("1 entry after this statement stays provisional for the next one:")).toBeVisible();
  await expect(ladysCard.locator(".statement-fix-later")).toContainText("Sabai Sabai - Valley P");
  await expect(ladysCard.locator(".pill").first()).toHaveText("Fix ready");

  // Committing before the move asks first, and cancelling writes nothing.
  await page.locator(".import-commit-button").first().click();
  const warning = page.locator(".import-commit-warning");
  await expect(warning).toContainText("UOB Lady's Card doesn't match the statement yet.");
  await warning.getByRole("button", { name: "Cancel" }).click();
  await expect(warning).toHaveCount(0);
  expect(await entryAccountName(page, openaiId)).toBe(LADYS_CARD);

  // Approving the move refreshes the check: both cards close, nothing is
  // saved yet, and the approval can be undone.
  await ladysCard.getByRole("button", { name: "Move 2 entries to UOB One Card" }).click();
  await expect(ladysCard.getByText("2 entries will move to UOB One Card when you commit.")).toBeVisible();
  await expect(oneCard.locator(".pill").first()).toHaveText("Resolved");
  await expect(ladysCard.locator(".pill").first()).toHaveText("Resolved");
  expect(await entryAccountName(page, openaiId)).toBe(LADYS_CARD);
  await ladysCard.getByRole("button", { name: "Undo" }).click();
  await expect(ladysCard.getByRole("button", { name: "Move 2 entries to UOB One Card" })).toBeVisible();
  await expect(ladysCard.locator(".pill").first()).toHaveText("Fix ready");
  await ladysCard.getByRole("button", { name: "Move 2 entries to UOB One Card" }).click();
  await expect(ladysCard.getByText("2 entries will move to UOB One Card when you commit.")).toBeVisible();

  // Both cards close, so the commit does not ask.
  const commitResponse = page.waitForResponse((response) => response.url().includes("/api/imports/commit"));
  await page.locator(".import-commit-button").first().click();
  expect((await commitResponse).ok()).toBe(true);
  await expect(page.getByText("eStatement_UOB_Cards_12May2026 committed successfully.", { exact: false })).toBeVisible({ timeout: 30_000 });
  expect(await entryAccountName(page, openaiId)).toBe(ONE_CARD);

  // Rolling the statement back puts the entries back on Lady's Card.
  await page.getByRole("button", { name: "Rollback import" }).first().click();
  const rollbackResponse = page.waitForResponse((response) => response.url().includes("/api/imports/rollback"));
  await page.getByRole("button", { name: "Confirm rollback" }).click();
  expect((await rollbackResponse).ok()).toBe(true);
  await expect.poll(() => entryAccountName(page, openaiId)).toBe(LADYS_CARD);
});

test("editing a row after the statement check asks for a fresh check before committing", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await setUpWrongCardLedger(page);
  const pdfPath = testInfo.outputPath("eStatement_UOB_Cards_12May2026.pdf");
  await writeStatementPdf(page, pdfPath);
  await page.goto("/imports");
  await page.locator("input[type=file]").setInputFiles(pdfPath);
  const ladysCard = page.locator(".statement-reconciliation-row").filter({ hasText: `${LADYS_CARD} • May 2026` });
  await ladysCard.getByRole("button", { name: "Move 2 entries to UOB One Card" }).click();
  await expect(ladysCard.getByText("2 entries will move to UOB One Card when you commit.")).toBeVisible();

  await page.getByRole("button", { name: "Edit rows" }).click();
  const description = page.locator(".import-description-input").first();
  await description.fill("SHAW THEATRES SINGAPORE (edited)");
  await page.locator(".import-commit-button").first().click();
  const warning = page.locator(".import-commit-warning");
  await expect(warning).toContainText("You changed rows after the statement check ran. Refresh the check before committing.");
  const previewResponse = page.waitForResponse((response) => response.url().includes("/api/imports/preview"));
  await warning.getByRole("button", { name: "Refresh check" }).click();
  expect((await previewResponse).ok()).toBe(true);
  // The approved moves survive the refresh.
  await expect(ladysCard.getByText("2 entries will move to UOB One Card when you commit.")).toBeVisible();
  await expect(page.locator(".import-commit-warning")).toHaveCount(0);
});
