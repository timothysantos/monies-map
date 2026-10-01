// The Imports page as three steps: bring files, review one (a statement card
// by card), see what changed. Uses the sanitized two-card UOB statement
// (tests/fixtures/pdf-statement-text/uob-card-two-card-may-2026-sanitized)
// printed to a real PDF, with OpenAI and Buyandship recorded on the wrong
// card.
import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

import { postJson, reseedDemo } from "./helpers.js";

const ONE_CARD = "UOB One Card";
const LADYS_CARD = "UOB Lady's Card";

// The review must stay short: a resolved card is one line, rows and the
// breakdown are behind disclosures. Measured 2026-10-01 at 1,959 px
// (desktop, 1280 wide) and 3,271 px (phone, 390 wide) for this statement;
// the old page was about 9,900 and 23,800.
const PAGE_HEIGHT_BUDGET = { desktop: 2_300, phone: 3_800 };

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
  for (const [name, openingBalanceMinor] of [[ONE_CARD, 15000], [LADYS_CARD, -1250]]) {
    await postJson(page, "/api/accounts/create", { name, institution: "UOB", kind: "credit_card", currency: "SGD", openingBalanceMinor, ownerPersonId: "person-tim", isJoint: false });
  }
  for (const [accountName, date, description, amountMinor] of [
    [ONE_CARD, "2026-04-11", "HONG KONG ZHAI DIM SUM", 1140],
    [LADYS_CARD, "2026-04-30", "Don Don Donki", 1890],
    [LADYS_CARD, "2026-04-20", "OpenAI", 2949],
    [LADYS_CARD, "2026-05-05", "Buyandship", 1313],
    [LADYS_CARD, "2026-05-14", "Sabai Sabai - Valley P", 2049]
  ]) {
    await postJson(page, "/api/entries/create", { accountName, date, description, amountMinor, categoryName: "Other", entryType: "expense", ownershipType: "direct", ownerName: "Tim" });
  }
}

// The bank's own activity export for One Card: two rows the May statement
// already has (worded differently) and one after it.
async function writeActivityCsv(path) {
  await writeFile(path, [
    "date,description,amount,account,category",
    `2026-04-21,OPENAI *CHATGPT SUBSCR,-29.49,${ONE_CARD},Other`,
    `2026-05-09,BUS/MRT 123456 SINGAPORE,-3.94,${ONE_CARD},Other`,
    `2026-05-15,GRAB RIDES SINGAPORE,-12.30,${ONE_CARD},Other`
  ].join("\n"));
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
});

test("a statement and an activity export dropped together are reviewed in order, statement first", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await setUpWrongCardLedger(page);
  const pdfPath = testInfo.outputPath("eStatement_UOB_Cards_12May2026.pdf");
  const csvPath = testInfo.outputPath("one-card-activity.csv");
  await writeStatementPdf(page, pdfPath);
  await writeActivityCsv(csvPath);

  await page.goto("/imports");
  await page.locator("input[type=file]").setInputFiles([csvPath, pdfPath]);

  // The statement is listed first even though it was picked second.
  const queue = page.locator(".import-intake-row");
  await expect(queue).toHaveCount(2);
  await expect(queue.nth(0)).toContainText("eStatement_UOB_Cards_12May2026");
  await expect(queue.nth(0)).toContainText("Review this first");
  await expect(queue.nth(1)).toContainText("one-card-activity");

  await queue.nth(0).getByRole("button", { name: "Review" }).click();
  const stepper = page.locator(".import-stepper");
  await expect(stepper.locator(".is-current")).toContainText("2 · Review");
  // Bring files folds to one line while the statement is in review.
  await expect(page.locator(".import-intake-section")).toHaveCount(0);
  await expect(stepper.getByRole("button", { name: "Change" })).toBeVisible();

  const ladysCard = page.locator(".statement-reconciliation-row").filter({ hasText: `${LADYS_CARD} • May 2026` });
  await ladysCard.getByRole("button", { name: "Move 2 entries to UOB One Card" }).click();
  await expect(page.locator(".statement-review-actions .pill")).toHaveText("Both cards balance");
  await page.locator(".import-commit-bar .import-commit-button").click();

  // Done: what changed on each card, and the next file in the queue.
  const done = page.locator(".import-done-card");
  await expect(done).toContainText("UOB card statement · May 2026 saved", { timeout: 30_000 });
  await expect(done).toContainText("Every card balanced");
  await expect(done.locator(".import-done-account").filter({ hasText: ONE_CARD })).toContainText("2 entries moved here");
  await expect(done.locator(".import-done-account").filter({ hasText: LADYS_CARD })).toContainText("1 entry stays for the next statement");
  await expect(stepper.locator(".is-current")).toContainText("3 · Done");

  await done.getByRole("button", { name: "Review next: one-card-activity.csv" }).click();
  await page.getByRole("button", { name: "Preview import" }).click();
  const summary = page.locator(".import-preview-status-row");
  // Both reworded rows are already on the confirmed May statement; only the
  // ride after it is new.
  await expect(summary).toContainText("1 row will import");
  await expect(summary).toContainText("2 rows already covered");
});

test("Fix it for me applies the fixes a statement proves, and asking first turns it off", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await setUpWrongCardLedger(page);
  const pdfPath = testInfo.outputPath("eStatement_UOB_Cards_12May2026.pdf");
  await writeStatementPdf(page, pdfPath);

  await page.goto("/imports");
  await page.locator("input[type=file]").setInputFiles(pdfPath);
  const ladysCard = page.locator(".statement-reconciliation-row").filter({ hasText: `${LADYS_CARD} • May 2026` });
  await ladysCard.getByLabel("Do this for me next time when the statement proves it").check();
  await page.locator(".import-commit-bar").getByRole("button", { name: "Start over" }).click();

  await page.locator("input[type=file]").setInputFiles(pdfPath);
  await expect(page.locator(".statement-auto-applied")).toContainText("Fixes for 2 entries were applied for you because this statement proves them.");
  await expect(page.locator(".statement-review-actions .pill")).toHaveText("Both cards balance");
  await expect(ladysCard.getByText("2 entries will move to UOB One Card when you commit.")).toBeVisible();
  // Undo keeps it undone: the refresh does not re-apply it.
  await ladysCard.getByRole("button", { name: "Undo" }).click();
  await expect(ladysCard.getByRole("button", { name: "Move 2 entries to UOB One Card" })).toBeVisible();

  await page.locator(".statement-auto-applied").getByRole("button", { name: "Ask me first next time" }).click();
  await page.locator(".import-commit-bar").getByRole("button", { name: "Start over" }).click();
  await page.locator("input[type=file]").setInputFiles(pdfPath);
  await expect(ladysCard.getByRole("button", { name: "Move 2 entries to UOB One Card" })).toBeVisible();
  await expect(page.locator(".statement-auto-applied")).toHaveCount(0);
});

for (const [name, viewport] of [["desktop", { width: 1280, height: 900 }], ["phone", { width: 390, height: 844 }]]) {
  test(`a two-card statement review stays within its ${name} page height`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    await setUpWrongCardLedger(page);
    const pdfPath = testInfo.outputPath("eStatement_UOB_Cards_12May2026.pdf");
    await writeStatementPdf(page, pdfPath);
    await page.goto("/imports");
    await page.locator("input[type=file]").setInputFiles(pdfPath);
    await expect(page.locator(".statement-review")).toBeVisible({ timeout: 30_000 });

    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(height).toBeLessThanOrEqual(PAGE_HEIGHT_BUDGET[name]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // The commit stays reachable without scrolling to the end.
    await expect(page.locator(".import-commit-bar .import-commit-button")).toBeInViewport();
  });
}
