// Working through a batch of import files: a commit opens the next file
// waiting, with what the last commit changed (and its rollback) above the
// new review, and "Skip for now" sends the file in review to the end of the
// queue. Uses the sanitized two-card UOB statement printed to a real PDF
// (tests/fixtures/pdf-statement-text/uob-card-two-card-may-2026-sanitized)
// and two card activity CSVs.
import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";

import { dropFiles, loadImportsPage, openPasteRowsAndDefaults } from "./helpers.js";
import { LADYS_CARD, ONE_CARD, setUpWrongCardLedger, writeStatementPdf } from "./uob-wrong-card-statement.js";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await page.setViewportSize({ width: 1280, height: 800 });
});

// The statement and, after it, a ride on One Card and a coffee on Lady's
// Card that the statement does not cover.
async function writeFiles(page, testInfo, { withLadysCsv = true } = {}) {
  const pdfPath = testInfo.outputPath("eStatement_UOB_Cards_12May2026.pdf");
  const oneCardCsv = testInfo.outputPath("one-card-activity.csv");
  const ladysCsv = testInfo.outputPath("ladys-card-activity.csv");
  await writeStatementPdf(page, pdfPath);
  await writeFile(oneCardCsv, ["date,description,amount,account,category", `2026-05-15,GRAB RIDES SINGAPORE,-12.30,${ONE_CARD},Other`].join("\n"));
  await writeFile(ladysCsv, ["date,description,amount,account,category", `2026-05-20,KOPI TIAM,-4.20,${LADYS_CARD},Other`].join("\n"));
  return withLadysCsv ? [pdfPath, oneCardCsv, ladysCsv] : [pdfPath, oneCardCsv];
}

const bar = (page) => page.getByRole("navigation", { name: "Import progress" });
const chips = (page) => bar(page).locator(".import-file-chip");
const commitButton = (page) => page.locator(".import-commit-bar .import-commit-button");
const compactSummary = (page) => page.locator(".import-done-card.is-compact");
const fullDoneCard = (page) => page.locator(".import-done-card:not(.is-compact)");

// Opens the statement and balances it: Move puts OpenAI and Buyandship on
// One Card, so nothing asks before the commit.
async function openBalancedStatement(page) {
  await chips(page).filter({ hasText: "UOB cards May" }).click();
  const ladysCard = page.locator(".statement-reconciliation-row").filter({ hasText: `${LADYS_CARD} • May 2026` });
  await ladysCard.getByRole("button", { name: "Move 2 entries to UOB One Card" }).click({ timeout: 30_000 });
  await expect(page.locator(".statement-review-actions .pill")).toHaveText("Both cards balance");
}

test("a commit opens the next file under the last commit's summary, whose rollback leaves that review alone", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await setUpWrongCardLedger(page);
  const files = await writeFiles(page, testInfo);

  await page.goto("/imports");
  await page.locator("input[type=file]").setInputFiles(files);
  await openBalancedStatement(page);

  // Another file waits, so the commit says it opens the next one.
  await expect(commitButton(page)).toHaveText("Commit and open next");
  await commitButton(page).click();

  // The next file opens; the statement's summary stays above it.
  await expect(chips(page).filter({ hasText: "one-card-activity.csv" })).toHaveAttribute("aria-current", "step", { timeout: 30_000 });
  await expect(compactSummary(page)).toContainText("UOB card statement · May 2026 saved");
  await expect(compactSummary(page)).toContainText("Every card balanced");
  await expect(compactSummary(page).getByRole("button", { name: "Roll back this import" })).toBeVisible();
  await expect(fullDoneCard(page)).toHaveCount(0);
  await expect(chips(page).first()).toHaveClass(/is-done/);
  await expect(bar(page)).toContainText("File 2 of 3");

  await page.getByRole("button", { name: "Preview import" }).click();
  await expect(page.locator(".import-preview-status-row")).toContainText("1 row will import", { timeout: 30_000 });
  await expect(commitButton(page)).toHaveText("Commit and open next");

  // Rolling the statement back keeps the activity file's review as it is.
  await compactSummary(page).getByRole("button", { name: "Roll back this import" }).click();
  await page.getByRole("button", { name: "Confirm rollback" }).click();
  await expect(compactSummary(page)).toHaveCount(0, { timeout: 30_000 });
  await expect.poll(async () => (await loadImportsPage(page)).importsPage.recentImports
    .some((item) => item.sourceLabel.includes("eStatement_UOB_Cards_12May2026") && item.status === "completed"), { timeout: 30_000 }).toBe(false);
  await expect(chips(page).filter({ hasText: "one-card-activity.csv" })).toHaveAttribute("aria-current", "step");
  await expect(page.locator(".import-preview-status-row")).toContainText("1 row will import");
  await expect(commitButton(page)).toHaveText("Commit and open next");
  await expect(commitButton(page)).toBeEnabled();
  // The rolled-back statement leaves the file chips and the count.
  await expect(chips(page)).toHaveText(["one-card-activity.csv", "ladys-card-activity.csv"]);
  await expect(bar(page)).toContainText("File 1 of 2");

  await commitButton(page).click();
  await expect(chips(page).filter({ hasText: "ladys-card-activity.csv" })).toHaveAttribute("aria-current", "step", { timeout: 30_000 });
  // A CSV opened from the queue is named by its file.
  await expect(compactSummary(page)).toContainText("one-card-activity.csv saved");
  await expect(compactSummary(page)).toContainText("1 row added");

  // The last file: today's commit words, no skip, and the full Done card
  // once it is committed.
  await page.getByRole("button", { name: "Preview import" }).click();
  await expect(commitButton(page)).toHaveText("Commit import to ledger", { timeout: 30_000 });
  await expect(page.locator(".import-commit-bar").getByRole("button", { name: "Skip for now" })).toHaveCount(0);
  await commitButton(page).click();
  await expect(fullDoneCard(page)).toContainText("ladys-card-activity.csv saved", { timeout: 30_000 });
  await expect(fullDoneCard(page)).toContainText("1 row added");
  await expect(compactSummary(page)).toHaveCount(0);
  await expect(page.locator(".import-stepper .is-current")).toContainText("3 · Done");
  await expect(page.locator(".import-commit-bar")).toHaveCount(0);
});

test("a failed commit opens nothing and keeps the review", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await setUpWrongCardLedger(page);
  const files = await writeFiles(page, testInfo, { withLadysCsv: false });
  await page.goto("/imports");
  await page.locator("input[type=file]").setInputFiles(files);
  await openBalancedStatement(page);

  await page.route("**/api/imports/commit", (route) => route.fulfill({ status: 500, json: { error: "The commit broke in this test." } }));
  await commitButton(page).click();
  await expect(page.getByText("The commit broke in this test.").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".statement-review-actions .pill")).toHaveText("Both cards balance");
  await expect(chips(page).filter({ hasText: "UOB cards May" })).toHaveAttribute("aria-current", "step");
  await expect(chips(page).filter({ hasText: "one-card-activity.csv" })).not.toHaveAttribute("aria-current", "step");
  await expect(page.locator(".import-done-card")).toHaveCount(0);
  await expect(commitButton(page)).toHaveText("Commit and open next");
  await expect(commitButton(page)).toBeEnabled();
});

test("a failed refresh after a commit keeps the commit, opens the next file and offers a retry", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await setUpWrongCardLedger(page);
  const files = await writeFiles(page, testInfo, { withLadysCsv: false });
  await page.goto("/imports");
  await page.locator("input[type=file]").setInputFiles(files);
  await openBalancedStatement(page);

  let committed = false;
  page.on("response", (response) => {
    if (response.url().includes("/api/imports/commit") && response.ok()) {
      committed = true;
    }
  });
  await page.route("**/api/imports-page*", (route) => (committed
    ? route.fulfill({ status: 500, json: { error: "Refresh broke in this test." } })
    : route.continue()));
  await commitButton(page).click();

  await expect(page.locator(".refresh-failure-notice")).toContainText("This page could not refresh.", { timeout: 30_000 });
  await expect(chips(page).filter({ hasText: "one-card-activity.csv" })).toHaveAttribute("aria-current", "step");
  await expect(compactSummary(page)).toContainText("UOB card statement · May 2026 saved");
  await expect(page.getByText("Import commit failed")).toHaveCount(0);
  await expect(page.getByText("Refresh broke in this test.")).toHaveCount(0);
  await page.unroute("**/api/imports-page*");
});

test("Skip for now sends the file in review to the end of the queue and opens the next", async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  await setUpWrongCardLedger(page);
  const files = await writeFiles(page, testInfo);
  await page.goto("/imports");
  await page.locator("input[type=file]").setInputFiles(files);
  await chips(page).filter({ hasText: "UOB cards May" }).click();
  await expect(page.locator(".statement-review")).toBeVisible({ timeout: 30_000 });

  await page.locator(".import-commit-bar").getByRole("button", { name: "Skip for now" }).click();
  // Nothing was changed, so it does not ask.
  await expect(page.locator(".import-file-switch-warning")).toHaveCount(0);
  await expect(chips(page)).toHaveText(["one-card-activity.csv", "ladys-card-activity.csv", "UOB cards May"]);
  await expect(chips(page).filter({ hasText: "one-card-activity.csv" })).toHaveAttribute("aria-current", "step");
  await expect(page.locator(".statement-review")).toHaveCount(0);

  // The skipped statement reopens from its chip without the file.
  await chips(page).filter({ hasText: "UOB cards May" }).click();
  await expect(page.locator(".statement-review")).toBeVisible({ timeout: 30_000 });
  await expect(chips(page).filter({ hasText: "UOB cards May" })).toHaveAttribute("aria-current", "step");
});

test("Skip for now asks first when the file in review has changes, and Cancel keeps the review", async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  await setUpWrongCardLedger(page);
  const files = await writeFiles(page, testInfo, { withLadysCsv: false });
  await page.goto("/imports");
  await page.locator("input[type=file]").setInputFiles(files);
  await openBalancedStatement(page);

  const skip = page.locator(".import-commit-bar").getByRole("button", { name: "Skip for now" });
  await skip.click();
  const question = page.locator(".import-file-switch-warning");
  await expect(question).toContainText("Opening one-card-activity.csv drops your changes to this file.");
  await question.getByRole("button", { name: "Cancel" }).click();
  await expect(question).toHaveCount(0);
  await expect(page.locator(".statement-review-actions .pill")).toHaveText("Both cards balance");
  await expect(chips(page).filter({ hasText: "UOB cards May" })).toHaveAttribute("aria-current", "step");
  await expect(chips(page)).toHaveText(["UOB cards May", "one-card-activity.csv"]);

  await skip.click();
  await page.locator(".import-file-switch-warning").getByRole("button", { name: "Open anyway" }).click();
  await expect(chips(page)).toHaveText(["one-card-activity.csv", "UOB cards May"]);
  await expect(chips(page).filter({ hasText: "one-card-activity.csv" })).toHaveAttribute("aria-current", "step");
});

test("a plain CSV opened from the queue is named by its file, unless a label was typed", async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  await setUpWrongCardLedger(page);
  const [, oneCardCsv, ladysCsv] = await writeFiles(page, testInfo);
  await page.goto("/imports");
  await page.locator("input[type=file]").setInputFiles([oneCardCsv, ladysCsv]);
  await expect(page.locator(".import-intake-row")).toHaveCount(2, { timeout: 30_000 });

  // A label typed before the file opens is kept.
  await openPasteRowsAndDefaults(page);
  await page.getByLabel("Source label").fill("Grab rides");
  await page.locator(".import-intake-row").filter({ hasText: "one-card-activity.csv" }).getByRole("button", { name: "Review" }).click();
  await expect(page.getByLabel("Source label")).toHaveValue("Grab rides");
  await page.getByRole("button", { name: "Preview import" }).click();
  await expect(commitButton(page)).toHaveText("Commit and open next", { timeout: 30_000 });
  await commitButton(page).click();
  await expect(compactSummary(page)).toContainText("Grab rides saved", { timeout: 30_000 });

  // The next one opens under its own file name.
  await expect(chips(page).filter({ hasText: "ladys-card-activity.csv" })).toHaveAttribute("aria-current", "step");
  await openPasteRowsAndDefaults(page);
  await expect(page.getByLabel("Source label")).toHaveValue("ladys-card-activity.csv");
  await page.getByRole("button", { name: "Preview import" }).click();
  await expect(commitButton(page)).toHaveText("Commit import to ledger", { timeout: 30_000 });
  await commitButton(page).click();
  await expect(fullDoneCard(page)).toContainText("ladys-card-activity.csv saved", { timeout: 30_000 });
  await expect(page.getByText("Imported CSV saved")).toHaveCount(0);
});

test("the queue's Review button asks first when the file in review has changes, and Cancel keeps the review", async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  await setUpWrongCardLedger(page);
  const files = await writeFiles(page, testInfo, { withLadysCsv: false });
  await page.goto("/imports");
  await page.locator("input[type=file]").setInputFiles(files);
  await openBalancedStatement(page);

  await page.locator(".import-stepper").getByRole("button", { name: "Change" }).click();
  const review = page.locator(".import-intake-row").filter({ hasText: "one-card-activity.csv" }).getByRole("button", { name: "Review" });
  await review.click();
  const question = page.locator(".import-file-switch-warning");
  await expect(question).toContainText("Opening one-card-activity.csv drops your changes to this file.");
  await question.getByRole("button", { name: "Cancel" }).click();
  await expect(question).toHaveCount(0);
  await expect(page.locator(".statement-review-actions .pill")).toHaveText("Both cards balance");
  await expect(chips(page).filter({ hasText: "UOB cards May" })).toHaveAttribute("aria-current", "step");

  await review.click();
  await page.locator(".import-file-switch-warning").getByRole("button", { name: "Open anyway" }).click();
  await expect(chips(page).filter({ hasText: "one-card-activity.csv" })).toHaveAttribute("aria-current", "step", { timeout: 30_000 });
  await expect(page.locator(".statement-review")).toHaveCount(0);
});

test("a file dropped on its own while a queued file is in review takes its place, and Skip for now keeps both", async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  await setUpWrongCardLedger(page);
  const [pdfPath, oneCardCsv, ladysCsv] = await writeFiles(page, testInfo);
  await page.goto("/imports");
  await page.locator("input[type=file]").setInputFiles([pdfPath, oneCardCsv]);
  await chips(page).filter({ hasText: "UOB cards May" }).click();
  await expect(page.locator(".statement-review")).toBeVisible({ timeout: 30_000 });

  // One more file on its own, dropped on the page: it opens, and the
  // statement waits again.
  await dropFiles(page, ".panel-head", [{ path: ladysCsv, name: "ladys-card-activity.csv", type: "text/csv" }]);
  await expect(page.locator(".import-upload-status")).toContainText("ladys-card-activity.csv is loaded.", { timeout: 30_000 });
  await expect(chips(page).filter({ hasText: "UOB cards May" })).not.toHaveAttribute("aria-current", "step");
  const statementRow = page.locator(".import-intake-row").filter({ hasText: "eStatement_UOB_Cards_12May2026.pdf" });
  await expect(statementRow).not.toHaveClass(/is-active/);
  await expect(statementRow.getByRole("button", { name: "Review" })).toBeEnabled();

  // Skip for now queues the dropped file and opens the statement.
  await page.getByRole("button", { name: "Preview import" }).click();
  await expect(page.locator(".import-commit-bar")).toBeVisible({ timeout: 30_000 });
  await page.locator(".import-commit-bar").getByRole("button", { name: "Skip for now" }).click();
  await expect(page.locator(".statement-review")).toBeVisible({ timeout: 30_000 });
  await expect(chips(page)).toHaveText(["UOB cards May", "one-card-activity.csv", "ladys-card-activity.csv"]);
  await expect(chips(page).filter({ hasText: "UOB cards May" })).toHaveAttribute("aria-current", "step");
});
