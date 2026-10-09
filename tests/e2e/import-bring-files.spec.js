// The Bring files step stays short: the drop zone and the intake queue come
// first, the Import inbox folds to "Still missing: N of M" once files are
// queued (ticking off the lines the queued files match), paste rows and
// defaults sit behind one link, a file in review folds Bring files (a CSV
// keeps its column mapping), Recent imports starts closed, and a file
// dropped anywhere on the page joins the intake.
import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";

import { dropFiles, openPasteRowsAndDefaults, reseedDemo } from "./helpers.js";
import { writeStatementPdf } from "./uob-wrong-card-statement.js";

const OCBC_ACTIVITY = new URL("../fixtures/ocbc-activity/TransactionHistory_20260628140517-ocbc-360-sanitized.csv", import.meta.url);

// The inbox is planned from today's date; the tests pin one so the counts
// and the matching statement do not move with the calendar.
function expectedFile({ id, institution, accountName, periodMonth = "2026-05", priority = "required", sourceType = "pdf_statement", coveredAccounts }) {
  return {
    id,
    institution,
    accountId: id,
    accountName,
    ownerLabel: "Tim",
    sourceType,
    priority,
    periodMonth,
    label: `${accountName} ${periodMonth} ${sourceType === "pdf_statement" ? "statement" : "activity"}`,
    detail: `Download the ${periodMonth} ${sourceType === "pdf_statement" ? "PDF statement" : "activity export"}.`,
    supportedFileTypes: [sourceType === "pdf_statement" ? "PDF" : "CSV"],
    reviewOrder: 1,
    ...(coveredAccounts ? { coveredAccounts } : {})
  };
}

const UOB_FILES = [
  expectedFile({ id: "uob-cards-2026-05", institution: "UOB", accountName: "UOB One Card + UOB Lady's Card", coveredAccounts: [
    { accountId: "uob-one-card", accountName: "UOB One Card" },
    { accountId: "uob-ladys-card", accountName: "UOB Lady's Card" }
  ] }),
  expectedFile({ id: "uob-one-card-2026-06-activity", institution: "UOB", accountName: "UOB One Card", periodMonth: "2026-06", priority: "optional", sourceType: "activity_export" })
];
const OCBC_FILES = [
  expectedFile({ id: "ocbc-360-2026-05", institution: "OCBC", accountName: "OCBC 360 Account" }),
  expectedFile({ id: "ocbc-360-2026-04", institution: "OCBC", accountName: "OCBC 360 Account", periodMonth: "2026-04" })
];
const PINNED_INBOX = {
  generatedAt: "2026-06-10T00:00:00.000Z",
  currentMonth: "2026-06",
  summary: {
    activeAccountCount: 3,
    currentAccountCount: 0,
    staleAccountCount: 3,
    requiredFileCount: 3,
    optionalFileCount: 1,
    institutionCount: 2,
    pendingSplitMatchCount: 0
  },
  sessions: [
    {
      institution: "UOB",
      status: "needs_files",
      requiredFileCount: 1,
      optionalFileCount: 1,
      portalUrl: "https://pib.uob.com.sg/",
      downloadInstructions: ["Open UOB Personal Internet Banking."],
      accounts: [],
      expectedFiles: UOB_FILES
    },
    {
      institution: "OCBC",
      status: "needs_files",
      requiredFileCount: 2,
      optionalFileCount: 0,
      portalUrl: "https://internet.ocbc.com/",
      downloadInstructions: ["Open OCBC Digital Banking."],
      accounts: [],
      expectedFiles: OCBC_FILES
    }
  ],
  reviewQueue: [...OCBC_FILES.slice(1), ...UOB_FILES.slice(0, 1), OCBC_FILES[0], UOB_FILES[1]],
  cleanup: { pendingSplitMatchCount: 0, status: "clear", detail: "" }
};

async function pinImportInbox(page) {
  await page.route("**/api/imports-page**", async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    json.importsPage.importInbox = PINNED_INBOX;
    await route.fulfill({ response, json });
  });
}

async function openImports(page) {
  await page.goto("/imports?view=household", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Import inbox", exact: true })).toBeVisible({ timeout: 60_000 });
}

// A plain CSV with no bank parser: it needs its columns mapped.
async function writeGenericCsv(path) {
  await writeFile(path, [
    "date,description,amount,account,category",
    "2026-05-02,NTUC FAIRPRICE TAMPINES,-54.20,Imported card,Groceries",
    "2026-05-05,GRAB RIDES SINGAPORE,-12.30,Imported card,Transport",
    "2026-05-09,KOPITIAM BEDOK,-8.60,Imported card,Food & Drinks"
  ].join("\n"));
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await reseedDemo(page);
});

test("the drop zone and queue come first, and the inbox folds to what is still missing once files are queued", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await pinImportInbox(page);
  const pdfPath = testInfo.outputPath("eStatement_UOB_Cards_12May2026.pdf");
  await writeStatementPdf(page, pdfPath);
  await openImports(page);

  // Nothing queued: the inbox is open, every bank folded to one row.
  const inbox = page.locator(".import-inbox-section");
  const inboxToggle = inbox.locator(".import-inbox-fold-toggle");
  await expect(inbox.locator(".import-inbox-fold-summary")).toHaveText("Still missing: 3 of 3");
  await expect(inboxToggle).toHaveText("Hide");
  await expect(inboxToggle).toHaveAttribute("aria-expanded", "true");
  const banks = inbox.locator(".import-inbox-session");
  await expect(banks).toHaveCount(2);
  await expect(banks.nth(0).locator(":scope > summary")).toContainText("UOB");
  await expect(banks.nth(0).locator(":scope > summary")).toContainText("Still missing: 1 of 1");
  await expect(banks.nth(1).locator(":scope > summary")).toContainText("OCBC");
  await expect(banks.nth(1).locator(":scope > summary")).toContainText("Still missing: 2 of 2");
  await expect(banks.nth(0).locator(".import-inbox-file-row").first()).toBeHidden();

  // The inbox says where the files go; no empty preview card waits below.
  await expect(inbox).toContainText("collect the listed files, then drop them here.");
  await expect(page.getByText("No preview yet.")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Preview rows" })).toHaveCount(0);

  // Order: drop zone, queue, inbox.
  const top = async (selector) => (await page.locator(selector).boundingBox()).y;
  expect(await top(".import-dropzone")).toBeLessThan(await top(".import-intake-section"));
  expect(await top(".import-intake-section")).toBeLessThan(await top(".import-inbox-section"));

  // The UOB statement matches its checklist line; the OCBC June activity
  // export matches nothing (the checklist wants OCBC statements).
  await page.locator("input[type=file]").setInputFiles([pdfPath, OCBC_ACTIVITY.pathname]);
  await expect(page.locator(".import-intake-row")).toHaveCount(2, { timeout: 30_000 });
  await expect(page.locator(".import-intake-summary")).toHaveText("2 files · 1 matches a file you need · 1 not on your checklist");

  await expect(inbox.locator(".import-inbox-fold-summary")).toHaveText("Still missing: 2 of 3");
  await expect(inboxToggle).toHaveText("Show");
  await expect(inboxToggle).toHaveAttribute("aria-expanded", "false");
  await expect(banks).toHaveCount(0);
  // Folded, the inbox is one line, not a screen.
  expect((await inbox.boundingBox()).height).toBeLessThan(120);

  await inboxToggle.click();
  await expect(inboxToggle).toHaveText("Hide");
  await expect(banks.nth(0).locator(":scope > summary")).toContainText("Still missing: 0 of 1");
  await expect(banks.nth(1).locator(":scope > summary")).toContainText("Still missing: 2 of 2");
  await banks.nth(0).locator(":scope > summary").click();
  await banks.nth(1).locator(":scope > summary").click();
  const ticked = inbox.locator(".import-inbox-file-row.is-ticked");
  await expect(ticked).toHaveCount(1);
  await expect(ticked).toContainText("UOB One Card + UOB Lady's Card");
  // The unmatched OCBC file ticks no OCBC line.
  await expect(banks.nth(1).locator(".import-inbox-file-row.is-ticked")).toHaveCount(0);
  await expect(banks.nth(1).locator(".import-inbox-file-row")).toHaveCount(2);
});

test("an inbox line keeps its actions for hover and focus instead of repeating them on every line", async ({ page }) => {
  await pinImportInbox(page);
  await openImports(page);
  const bank = page.locator(".import-inbox-session").filter({ hasText: "OCBC" });
  await bank.locator(":scope > summary").click();
  const line = bank.locator(".import-inbox-file-row").first();
  const actions = line.locator(".import-inbox-file-actions");
  await expect(actions).toHaveCSS("opacity", "0");
  await line.hover();
  await expect(actions).toHaveCSS("opacity", "1");

  // "Use with import form" fills the defaults and opens them to show it.
  await expect(page.getByLabel("Source label")).toBeHidden();
  await line.getByRole("button", { name: "Use with import form" }).click();
  await expect(page.getByLabel("Source label")).toHaveValue("OCBC 360 Account 2026-05 statement");
  await expect(page.getByLabel("Batch note")).toHaveValue("Download the 2026-05 PDF statement.");

  // Keyboard: focusing the line's action shows the actions too.
  const second = bank.locator(".import-inbox-file-row").nth(1);
  await page.mouse.move(0, 0);
  await second.getByRole("button", { name: "Not available" }).focus();
  await expect(second.locator(".import-inbox-file-actions")).toHaveCSS("opacity", "1");
  await second.getByRole("button", { name: "Not available" }).click();
  await expect(second).toHaveClass(/is-snoozed/);
});

test("paste rows and defaults stay behind one link while upload status and AI consent stay in view", async ({ page }, testInfo) => {
  await openImports(page);
  const disclosure = page.getByRole("button", { name: "Paste rows or set defaults" });
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByLabel("CSV content")).toBeHidden();
  await expect(page.getByLabel("Default account")).toBeHidden();
  await expect(page.locator(".import-ai-consent")).toBeVisible();

  await disclosure.click();
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByLabel("CSV content")).toBeVisible();
  await expect(page.getByLabel("Source label")).toBeVisible();
  await expect(page.getByLabel("Default account")).toBeVisible();
  await expect(page.getByLabel("Default owner")).toBeVisible();
  await expect(page.getByLabel("Batch note")).toBeVisible();
  await disclosure.click();
  await expect(page.getByLabel("CSV content")).toBeHidden();

  // A plain CSV needs its columns mapped and the defaults: both open.
  const csvPath = testInfo.outputPath("plain-card-export.csv");
  await writeGenericCsv(csvPath);
  await page.locator("input[type=file]").setInputFiles(csvPath);
  await expect(page.locator(".import-upload-status")).toContainText("plain-card-export.csv is loaded.");
  await expect(page.getByRole("heading", { name: "Data mapping" })).toBeVisible();
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByLabel("Default account")).toBeVisible();
});

test("a CSV in review folds Bring files and keeps its column mapping usable", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await openImports(page);
  const csvPath = testInfo.outputPath("plain-card-export.csv");
  await writeGenericCsv(csvPath);
  await page.locator("input[type=file]").setInputFiles(csvPath);
  await page.getByRole("button", { name: "Preview import" }).click();
  await expect(page.locator(".import-commit-bar")).toBeVisible({ timeout: 30_000 });

  const stepper = page.locator(".import-stepper");
  await expect(stepper.locator(".is-current")).toContainText("2 · Review");
  await expect(page.locator(".import-inbox-section")).toHaveCount(0);
  await expect(page.locator(".import-intake-section")).toHaveCount(0);
  await expect(page.locator(".import-dropzone")).toHaveCount(0);
  await expect(page.getByLabel("CSV content")).toHaveCount(0);

  // The mapping stays: change a column and preview again.
  const mapping = page.locator(".import-stage-card").filter({ has: page.getByRole("heading", { name: "Data mapping" }) });
  await expect(mapping).toBeVisible();
  const categoryMapping = mapping.locator(".import-column-card").filter({ has: page.locator(".import-column-head strong", { hasText: /^category$/ }) }).locator("select");
  await categoryMapping.selectOption("ignore");
  await expect(categoryMapping).toHaveValue("ignore");
  await mapping.getByRole("button", { name: "Preview import" }).click();
  await expect(page.locator(".import-commit-bar")).toBeVisible();

  // "Change" opens Bring files again; "Hide files" folds it.
  await stepper.getByRole("button", { name: "Change" }).click();
  await expect(page.locator(".import-dropzone")).toBeVisible();
  await expect(page.locator(".import-intake-section")).toBeVisible();
  await stepper.getByRole("button", { name: "Hide files" }).click();
  await expect(page.locator(".import-dropzone")).toHaveCount(0);
  await expect(mapping).toBeVisible();
});

test("Recent imports starts closed and opens on request", async ({ page }) => {
  await openImports(page);
  const toggle = page.locator(".import-history-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".import-history-groups")).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".import-card-compact").first()).toBeVisible();
});

test("a file dropped anywhere on the page joins the intake, but not one dropped on the file in review", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await openImports(page);
  const csvPath = testInfo.outputPath("plain-card-export.csv");
  await writeGenericCsv(csvPath);
  const files = [
    { path: csvPath, name: "plain-card-export.csv", type: "text/csv" },
    { path: OCBC_ACTIVITY.pathname, name: "TransactionHistory_20260628140517.csv", type: "text/csv" }
  ];

  // Dragging over the page shows where it can go.
  await dropFiles(page, ".panel-head", files, { drop: false });
  await expect(page.locator(".import-page-drop-hint")).toHaveText("Drop files anywhere on this page");
  await dropFiles(page, ".panel-head", files);
  await expect(page.locator(".import-page-drop-hint")).toHaveCount(0);
  await expect(page.locator(".import-intake-row")).toHaveCount(2, { timeout: 30_000 });

  // Review the plain CSV, then drop the files on its preview rows: nothing
  // new is queued and the review stays.
  await page.locator(".import-intake-row").filter({ hasText: "plain-card-export.csv" }).getByRole("button", { name: "Review" }).click();
  await page.getByRole("button", { name: "Preview import" }).click();
  await expect(page.locator(".import-commit-bar")).toBeVisible({ timeout: 30_000 });
  const rowsTable = "[data-page-drop=\"off\"] table";
  await dropFiles(page, rowsTable, files, { drop: false });
  await expect(page.locator(".import-page-drop-hint")).toHaveCount(0);
  await dropFiles(page, rowsTable, files);
  await page.waitForTimeout(1_000);
  await expect(page.locator(".import-commit-bar")).toBeVisible();
  await page.locator(".import-stepper").getByRole("button", { name: "Change" }).click();
  await expect(page.locator(".import-intake-row")).toHaveCount(2);
});

test("once files are queued the drop zone is one slim line and the first Review fits the first screen", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await pinImportInbox(page);
  const pdfPath = testInfo.outputPath("eStatement_UOB_Cards_12May2026.pdf");
  const csvPath = testInfo.outputPath("plain-card-export.csv");
  await writeStatementPdf(page, pdfPath);
  await writeGenericCsv(csvPath);
  await openImports(page);

  // Nothing queued: the full drop zone with its notes beside it.
  const dropzone = page.locator(".import-dropzone");
  await expect(dropzone).toContainText("Drop a CSV, PDF, or XLS here");
  await expect(dropzone).not.toHaveClass(/is-slim/);
  const trustHint = page.getByText("Statement imports are only trustworthy when date coverage is complete");
  await expect(trustHint).toBeVisible();

  await page.locator("input[type=file]").setInputFiles([pdfPath, OCBC_ACTIVITY.pathname, csvPath]);
  await expect(page.locator(".import-intake-row")).toHaveCount(3, { timeout: 30_000 });

  // One slim line; the upload status and the AI consent stay in view.
  await expect(dropzone).toHaveClass(/is-slim/);
  await expect(dropzone).toHaveText("Drop more files, or Select file");
  expect((await dropzone.boundingBox()).height).toBeLessThan(64);
  await expect(page.locator(".import-upload-status")).toContainText("3 files added to the intake queue.");
  await expect(page.locator(".import-ai-consent")).toBeVisible();
  // The notes wait behind "Paste rows or set defaults".
  await expect(trustHint).toBeHidden();
  await expect(page.getByText("PDF statements and supported current-transaction XLS files are converted")).toBeHidden();
  await openPasteRowsAndDefaults(page);
  await expect(trustHint).toBeVisible();
  await expect(page.getByText("PDF statements and supported current-transaction XLS files are converted")).toBeVisible();
  await page.getByRole("button", { name: "Paste rows or set defaults" }).click();

  // The queue's first Review button is fully on the first screen.
  await page.evaluate(() => window.scrollTo(0, 0));
  const review = page.locator(".import-intake-row").first().getByRole("button", { name: "Review" });
  const box = await review.boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(800);

  // "Select file" still opens the file picker.
  const chooser = page.waitForEvent("filechooser");
  await dropzone.getByRole("button", { name: "Select file" }).click();
  expect((await chooser).isMultiple()).toBe(true);
});

test("a plain CSV dropped on its own is named by its file, unless a label was typed", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await openImports(page);
  const csvPath = testInfo.outputPath("plain-card-export.csv");
  const otherPath = testInfo.outputPath("second-card-export.csv");
  await writeGenericCsv(csvPath);
  await writeGenericCsv(otherPath);

  await page.locator("input[type=file]").setInputFiles(csvPath);
  await expect(page.locator(".import-upload-status")).toContainText("plain-card-export.csv is loaded.");
  await openPasteRowsAndDefaults(page);
  await expect(page.getByLabel("Source label")).toHaveValue("plain-card-export.csv");

  // A typed label stays when the next file is dropped.
  await page.getByLabel("Source label").fill("Card run");
  await page.locator("input[type=file]").setInputFiles(otherPath);
  await expect(page.locator(".import-upload-status")).toContainText("second-card-export.csv is loaded.");
  await expect(page.getByLabel("Source label")).toHaveValue("Card run");
});

test("queued files wait for review in a butter status that opens the queue", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const pdfPath = testInfo.outputPath("eStatement_UOB_Cards_12May2026.pdf");
  const csvPath = testInfo.outputPath("plain-card-export.csv");
  await writeStatementPdf(page, pdfPath);
  await writeGenericCsv(csvPath);
  await openImports(page);

  // A single plain CSV ready to map keeps the mint Ready status.
  await page.locator("input[type=file]").setInputFiles(csvPath);
  const status = page.locator(".import-upload-status");
  await expect(status).toHaveClass(/is-success/);
  await expect(status).toContainText("Ready");
  await expect(page.getByRole("button", { name: /Waiting for review/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Start over" }).first().click();

  await page.locator("input[type=file]").setInputFiles([pdfPath, OCBC_ACTIVITY.pathname, csvPath]);
  await expect(page.locator(".import-intake-row")).toHaveCount(3, { timeout: 30_000 });
  const waiting = page.getByRole("button", { name: "Waiting for review 3 files added to the intake queue." });
  await expect(waiting).toHaveClass(/is-waiting/);
  expect(await waiting.evaluate((element) => {
    const root = getComputedStyle(document.documentElement);
    const probe = document.createElement("span");
    probe.style.backgroundColor = root.getPropertyValue("--pastel-butter");
    probe.style.color = root.getPropertyValue("--pastel-butter-ink");
    document.body.append(probe);
    const expected = getComputedStyle(probe);
    const result = getComputedStyle(element).backgroundColor === expected.backgroundColor
      && getComputedStyle(element.querySelector("strong")).color === expected.color;
    probe.remove();
    return result;
  })).toBe(true);

  // It opens the queue: the first Review button takes focus, below the bar.
  await waiting.click();
  const firstReview = page.locator(".import-intake-row").first().getByRole("button", { name: "Review" });
  await expect(firstReview).toBeFocused();
  await expect(firstReview).toBeInViewport();
  await expect.poll(async () => {
    const queue = await page.locator(".import-intake-section").boundingBox();
    const surface = await page.locator(".import-batch-bar-surface").boundingBox();
    return queue.y >= surface.y + surface.height - 1;
  }).toBe(true);

  // With the queue cleared there is nothing waiting to point at.
  await page.getByRole("button", { name: "Clear queue" }).click();
  await expect(page.locator(".import-upload-status.is-waiting")).toHaveCount(0);
});
