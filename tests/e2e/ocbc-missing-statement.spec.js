// Joyce's OCBC 365 card, the real Oct 2026 case: the ledger stops at an
// earlier saved statement and the months between were never imported, so the
// statement's previous balance does not meet the ledger. The statement card
// says whose card it is, which card it is, and names the missing statements.
// The statement is the sanitized real Sep 2026 OCBC 365 PDF text
// (tests/fixtures/pdf-statement-text/ocbc-365-card-sep-2026-real-sanitized),
// its spaced layout printed to a real PDF so the browser parses it as a
// user's file.
import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { postJson, reseedDemo } from "./helpers.js";

async function writeOcbcStatementPdf(page, path) {
  const text = await readFile(new URL("../fixtures/pdf-statement-text/ocbc-365-card-sep-2026-real-sanitized.pdf-text.txt", import.meta.url), "utf8");
  const lines = text.split("__PDF_SPACED_LAYOUT_TEXT__")[1].trim().split("\n");
  const escape = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const pdfPage = await page.context().newPage();
  await pdfPage.setContent(`<html><body style="font-family: Helvetica, Arial, sans-serif; font-size: 10px; line-height: 1.6;">${
    lines.map((line) => `<div style="white-space: pre;">${escape(line)}</div>`).join("")
  }</body></html>`);
  await pdfPage.pdf({ path, format: "A4" });
  await pdfPage.close();
}

test("a statement after months that were never imported names them, and the card shows its owner and number", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await page.goto("/");
  await reseedDemo(page);
  const { accountId } = await postJson(page, "/api/accounts/create", {
    name: "OCBC 365 Credit Card",
    institution: "OCBC",
    kind: "credit_card",
    currency: "SGD",
    openingBalanceMinor: 0,
    ownerPersonId: "person-joyce",
    isJoint: false
  });
  // The last statement saved for the card is June's, which closed at zero.
  await postJson(page, "/api/accounts/reconcile", {
    accountId,
    checkpointMonth: "2026-06",
    statementStartDate: "2026-05-02",
    statementEndDate: "2026-06-01",
    statementBalanceMinor: 0
  });

  const pdfPath = testInfo.outputPath("OCBC 365 CREDIT CARD-7528-Sep-26.pdf");
  await writeOcbcStatementPdf(page, pdfPath);
  await page.goto("/imports");
  await page.locator("input[type=file]").setInputFiles(pdfPath);

  const card = page.locator(".statement-reconciliation-row").filter({ hasText: "OCBC 365 Credit Card • Sept 2026" });
  await expect(card).toBeVisible({ timeout: 60_000 });
  const title = card.locator(".statement-reconciliation-card-title strong");
  await expect(title).toHaveText("JoyceOCBC 365 Credit Card • Sept 2026 • ending 7528");
  // The owner chip wears Joyce's colour, the same one as her Entries rows.
  await expect(title.locator(".statement-card-owner")).toHaveText("Joyce");
  const chipVars = await title.locator(".statement-card-owner").evaluate((element) => element.style.getPropertyValue("--person-colour"));
  expect(chipVars.trim().toUpperCase()).toBe("#DE726D");
  // The cycle runs from the day after the previous statement date, not the
  // first row's date (24 Aug).
  await expect(page.getByText("Statement date 1 Sept 2026 · covers 2 Aug 2026 – 1 Sept 2026 · 1 card · 5 rows")).toBeVisible();

  await expect(card.locator(".statement-fix-check")).toContainText(
    "Your Jul 2026 and Aug 2026 statements aren't imported yet. Your ledger stops at the 1 Jun 2026 statement ($0.00), and this statement starts from $101.86 owed. Import them first, then this one."
  );
  await expect(card.locator(".statement-fix-check")).not.toContainText("An earlier statement may be missing");
});

test("a statement right after the last saved one keeps the general opening-balance wording", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await page.goto("/");
  await reseedDemo(page);
  const { accountId } = await postJson(page, "/api/accounts/create", {
    name: "OCBC 365 Credit Card",
    institution: "OCBC",
    kind: "credit_card",
    currency: "SGD",
    openingBalanceMinor: 0,
    ownerPersonId: "person-joyce",
    isJoint: false
  });
  // August is saved, so nothing is missing: the 101.86 gap is an entry.
  await postJson(page, "/api/accounts/reconcile", {
    accountId,
    checkpointMonth: "2026-08",
    statementStartDate: "2026-07-02",
    statementEndDate: "2026-08-01",
    statementBalanceMinor: 0
  });

  const pdfPath = testInfo.outputPath("OCBC 365 CREDIT CARD-7528-Sep-26.pdf");
  await writeOcbcStatementPdf(page, pdfPath);
  await page.goto("/imports");
  await page.locator("input[type=file]").setInputFiles(pdfPath);

  const card = page.locator(".statement-reconciliation-row").filter({ hasText: "OCBC 365 Credit Card • Sept 2026" });
  await expect(card.locator(".statement-fix-check")).toContainText(
    "The balance before this statement is off by $101.86. An earlier statement may be missing, or an earlier entry is off.",
    { timeout: 60_000 }
  );
  await expect(card.locator(".statement-fix-check")).not.toContainText("imported yet");
});
