import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

import { postJson, reseedDemo } from "./helpers";

// The Imports page re-runs a statement preview when the tab regains focus, so
// a preview left open does not keep stale match results (see
// src/client/import-preview-auto-refresh.js). It waits 2 s after a preview
// lands before it will refresh.
const PREVIEW_SETTLE_GRACE_MS = 2_000;

const IKEA_ROW = ["2026-02-23", "IKEA SINGAPORE SG", "683.00", "txn date: 2026-02-20"];
const PAYMENT_ROW = ["2026-03-04", "PAYMENT VIA UOB VISA DIRECT SG", "683.00", "txn date: 2026-03-03"];

function previewInputValues(page) {
  return page.locator(".import-preview-table input").evaluateAll((inputs) => inputs.map((input) => input.value));
}

function isPreviewPost(request) {
  return request.url().includes("/api/imports/preview") && request.method() === "POST";
}

async function openHsbcMarchStatementPreview(page, testInfo) {
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

  // A browser OCR package goes through the same statement preview as a PDF.
  const tsv = await readFile("tests/fixtures/hsbc-ocr/browser-2026/hsbc-visa-revolution-mar-2026.browser.tsv", "utf8");
  const packagePath = testInfo.outputPath("hsbc-visa-revolution-mar-2026.hsbc-ocr.tsv");
  await writeFile(packagePath, `__OCR_TSV__\n${tsv}`, "utf8");

  const previewPosts = [];
  page.on("request", (request) => {
    if (isPreviewPost(request)) {
      previewPosts.push(request);
    }
  });

  await page.goto("/imports?view=person-tim&month=2026-03");
  await expect(page.getByRole("heading", { name: "Import and certify", exact: true })).toBeVisible({ timeout: 30_000 });
  const firstPreview = page.waitForResponse((response) => isPreviewPost(response.request()) && response.ok());
  await page.locator("input[type=\"file\"]").setInputFiles(packagePath);
  await firstPreview;
  await expect(page.getByText("2 rows ready for review")).toBeVisible({ timeout: 60_000 });

  const summary = page.locator(".import-preview-status-row");
  await expect(summary).toContainText("2 rows will import");
  await expect(summary).toContainText("1 statement checkpoint will refresh");
  await expect(summary).not.toContainText("certified by the statement");
  await expect.poll(() => previewInputValues(page)).toEqual([...IKEA_ROW, ...PAYMENT_ROW]);
  expect(previewPosts).toHaveLength(1);

  return { previewPosts, summary };
}

// The same card purchase entered by hand while the preview is open, as a
// Shortcut or another tab would.
async function addMatchingIkeaLedgerRow(page) {
  await postJson(page, "/api/entries/create", {
    date: "2026-02-20",
    description: "IKEA SINGAPORE SG",
    accountName: "HSBC Visa Revolution",
    categoryName: "Home",
    amountMinor: 68_300,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });
}

async function returnToTabAfterSettleGrace(page) {
  await page.waitForTimeout(PREVIEW_SETTLE_GRACE_MS + 200);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
}

test("returning to the Imports tab re-runs a stale statement preview and shows the new match", async ({ page }, testInfo) => {
  const { previewPosts, summary } = await openHsbcMarchStatementPreview(page, testInfo);
  await addMatchingIkeaLedgerRow(page);

  const refreshed = page.waitForResponse((response) => isPreviewPost(response.request()) && response.ok());
  await returnToTabAfterSettleGrace(page);
  await refreshed;

  // The refresh re-sends the current draft rows with the statement checkpoint.
  expect(previewPosts).toHaveLength(2);
  const body = previewPosts[1].postDataJSON();
  expect(body.sourceType).toBe("pdf");
  expect(body.rows.map((row) => row.description)).toEqual(["IKEA SINGAPORE SG", "PAYMENT VIA UOB VISA DIRECT SG"]);
  expect(body.statementCheckpoints).toHaveLength(1);

  // The hand-entered purchase is now certified instead of imported twice.
  await expect(summary).toContainText("1 row will import");
  await expect(summary).toContainText("1 existing row will be certified by the statement");
  await expect(summary).toContainText("1 statement checkpoint will refresh");
  await expect.poll(() => previewInputValues(page)).toEqual(PAYMENT_ROW);
  await expect(page.getByText(/Could not refresh the statement check/)).toHaveCount(0);
});

test("a statement preview with unsaved row edits is not refreshed when the tab regains focus", async ({ page }, testInfo) => {
  const { previewPosts, summary } = await openHsbcMarchStatementPreview(page, testInfo);

  const ikeaDescription = page.locator(".import-preview-table input[value=\"IKEA SINGAPORE SG\"]");
  await ikeaDescription.fill("IKEA SINGAPORE SG - study shelves");
  await addMatchingIkeaLedgerRow(page);

  await returnToTabAfterSettleGrace(page);
  await page.waitForTimeout(1_000);

  // Refreshing would replace the draft and lose the edit, so it does not run.
  expect(previewPosts).toHaveLength(1);
  await expect.poll(() => previewInputValues(page)).toEqual([
    IKEA_ROW[0], "IKEA SINGAPORE SG - study shelves", IKEA_ROW[2], IKEA_ROW[3], ...PAYMENT_ROW
  ]);
  await expect(summary).toContainText("2 rows will import");
  await expect(summary).not.toContainText("certified by the statement");
});

test("a failed auto refresh keeps the current statement preview and says so", async ({ page }, testInfo) => {
  const { previewPosts, summary } = await openHsbcMarchStatementPreview(page, testInfo);
  await page.route("**/api/imports/preview", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ error: "Preview is temporarily unavailable." })
  }));

  const failed = page.waitForResponse((response) => isPreviewPost(response.request()) && response.status() === 503);
  await returnToTabAfterSettleGrace(page);
  await failed;

  expect(previewPosts).toHaveLength(2);
  await expect(page.getByText(/Could not refresh the statement check\. Keeping the current preview\./)).toBeVisible();
  await expect.poll(() => previewInputValues(page)).toEqual([...IKEA_ROW, ...PAYMENT_ROW]);
  await expect(summary).toContainText("2 rows will import");
  await expect(page.getByRole("button", { name: /Commit/ }).first()).toBeVisible();
});
