import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { postJson, reseedDemo } from "./helpers";

// The real Oct 2026 HSBC statement's browser OCR (sanitized), damaged the way
// it fails in practice: Etsy's dates unreadable, so its line is no row while
// its 29.92 was read. The statement's purchases are 218.35.
const OCT_OCR = "tests/fixtures/hsbc-ocr/browser-2026/hsbc-visa-revolution-oct-2026.browser.tsv";

async function octOcrWithEtsyDatesUnreadable({ dccAmountUnreadable = false } = {}) {
  let tsv = (await readFile(OCT_OCR, "utf8"))
    .replace(/\t03Oct$/m, "\t~")
    .replace(/\t010ct$/m, "\t~");
  if (dccAmountUnreadable) {
    tsv = tsv.replace(/\t0\.30$/m, "\t0.3");
  }
  return tsv;
}

async function openImportsWithHsbcCard(page) {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await page.goto("/");
  await reseedDemo(page);
  await postJson(page, "/api/accounts/create", {
    name: "HSBC Visa Revolution",
    institution: "HSBC",
    kind: "credit_card",
    openingBalanceMinor: 0,
    currency: "SGD",
    ownerPersonId: "",
    isJoint: false
  });
  await page.goto("/imports?view=person-tim&month=2026-10");
  await expect(page.getByRole("heading", { name: "Import and certify", exact: true })).toBeVisible({ timeout: 30_000 });
}

async function uploadOcrPackage(page, tsv) {
  await page.locator("input[type=\"file\"]").setInputFiles({
    name: "hsbc-visa-revolution-oct-2026.hsbc-ocr.tsv",
    mimeType: "text/tab-separated-values",
    buffer: Buffer.from(`__OCR_TSV__\n${tsv}`)
  });
}

async function addRecoveryRow(page, row) {
  const preview = page.waitForResponse((response) => response.url().includes("/api/imports/preview") && response.ok());
  await row.getByRole("button", { name: "Add row" }).click();
  await preview;
}

test("a dropped statement row whose amount OCR read is added after checking it, then the import commits", async ({ page }) => {
  await openImportsWithHsbcCard(page);
  await uploadOcrPackage(page, await octOcrWithEtsyDatesUnreadable());

  const recovery = page.locator(".import-statement-recovery");
  await expect(recovery).toBeVisible({ timeout: 60_000 });
  await expect(recovery).toContainText("The rows don't add up to the statement yet");
  const totals = recovery.locator(".import-statement-recovery-totals");
  await expect(totals).toContainText("Statement purchases$218.35");
  await expect(totals).toContainText("Rows found$188.43");
  await expect(totals).toContainText("Difference$29.92");
  const missingRow = recovery.locator(".import-statement-recovery-row");
  await expect(missingRow).toHaveCount(1);
  await expect(missingRow).toContainText("Possible missing row");
  await expect(missingRow).toContainText("Etsy WWW.ETSY.COM · $29.92");

  // Hard block: the commit button is disabled and offers no Commit anyway.
  const commitButton = page.locator(".import-commit-button").first();
  await expect(commitButton).toBeDisabled();
  await expect(page.locator(".import-blocker-list")).toContainText("Make the rows add up to the statement");

  await addRecoveryRow(page, missingRow);
  await expect(recovery).toHaveCount(0);
  await expect(page.locator(".import-blocker-list li").filter({ hasText: "Make the rows add up to the statement" })).toHaveCount(0);
  await expect(commitButton).toBeEnabled();

  const commit = page.waitForResponse((response) => response.url().includes("/api/imports/commit") && response.ok(), { timeout: 60_000 });
  await commitButton.click();
  const committed = await commit;
  const body = await committed.json();
  expect(JSON.stringify(body)).not.toContain("error");
  // All seven statement rows, Etsy included, reach the ledger.
  await expect(page.getByText("7 rows added · 0 entries confirmed")).toBeVisible({ timeout: 30_000 });
});

test("a wrong typed amount keeps the import blocked until the rows add up", async ({ page }) => {
  await openImportsWithHsbcCard(page);
  await uploadOcrPackage(page, await octOcrWithEtsyDatesUnreadable({ dccAmountUnreadable: true }));

  const recovery = page.locator(".import-statement-recovery");
  await expect(recovery).toBeVisible({ timeout: 60_000 });
  await expect(recovery.locator(".import-statement-recovery-totals")).toContainText("Difference$30.22");
  // Etsy's 29.92 is not the difference, so it is not offered; the unread DCC
  // FEE asks for its amount.
  await expect(recovery).not.toContainText("Possible missing row");
  const unread = recovery.locator(".import-statement-recovery-row").filter({ hasText: "Amount not readable" });
  await expect(unread).toContainText("DCC FEE");
  await expect(unread.getByRole("button", { name: "Add row" })).toBeDisabled();

  await unread.getByRole("textbox").fill("0.31");
  await addRecoveryRow(page, unread);
  await expect(recovery.locator(".import-statement-recovery-totals")).toContainText("Difference$29.91");
  await expect(recovery).not.toContainText("Possible missing row");
  await expect(page.locator(".import-commit-button").first()).toBeDisabled();

  // Correcting the typed amount in Edit rows makes Etsy's 29.92 exact.
  await page.getByRole("button", { name: "Edit rows" }).click();
  const dccRowIndex = await page.locator(".import-preview-table tbody tr").evaluateAll((rows) => rows.findIndex((row) => {
    const values = Array.from(row.querySelectorAll("input")).map((input) => input.value);
    return values[0] === "2026-10-03" && values[1] === "DCC FEE";
  }));
  expect(dccRowIndex).toBeGreaterThanOrEqual(0);
  await page.locator(".import-preview-table tbody tr").nth(dccRowIndex).locator("input").nth(2).fill("0.30");
  await expect(recovery.locator(".import-statement-recovery-totals")).toContainText("Difference$29.92");
  const missingRow = recovery.locator(".import-statement-recovery-row").filter({ hasText: "Possible missing row" });
  await expect(missingRow).toContainText("Etsy WWW.ETSY.COM · $29.92");

  await addRecoveryRow(page, missingRow);
  await expect(recovery).toHaveCount(0);
  await expect(page.locator(".import-commit-button").first()).toBeEnabled({ timeout: 30_000 });
});

test("hidden money keeps the recovery amounts masked", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "false"));
  await page.goto("/");
  await reseedDemo(page);
  await postJson(page, "/api/accounts/create", {
    name: "HSBC Visa Revolution",
    institution: "HSBC",
    kind: "credit_card",
    openingBalanceMinor: 0,
    currency: "SGD",
    ownerPersonId: "",
    isJoint: false
  });
  await page.goto("/imports?view=person-tim&month=2026-10");
  await expect(page.getByRole("heading", { name: "Import and certify", exact: true })).toBeVisible({ timeout: 30_000 });
  await uploadOcrPackage(page, await octOcrWithEtsyDatesUnreadable());

  const recovery = page.locator(".import-statement-recovery");
  await expect(recovery).toBeVisible({ timeout: 60_000 });
  await expect(recovery).not.toContainText("$");
  await expect(recovery.locator(".import-statement-recovery-totals dd").first()).toHaveText("••••");
});
