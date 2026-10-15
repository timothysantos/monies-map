// The wrong-card Apple Pay scenario for browser tests, from the sanitized
// fixture tests/fixtures/uob-card-activity/wrong-card-oct-2026-sanitized.json:
// three Apple Pay entries dated 2026-10-11 on UOB Lady's Card for purchases
// paid with UOB One Card, whose 14 Oct activity file holds the same three
// rows. The Lady's Card mid-cycle file (13 Jul to 13 Oct) does not list them.
import { readFile, writeFile } from "node:fs/promises";

import { expect } from "@playwright/test";

import { postJson, reseedDemo } from "./helpers.js";

export const ONE_CARD = "UOB One Card";
export const LADYS_CARD = "UOB Lady's Card";
const SHORTCUT_TOKEN = "mm_e2e_key";

const fixture = JSON.parse(await readFile(new URL("../fixtures/uob-card-activity/wrong-card-oct-2026-sanitized.json", import.meta.url), "utf8"));
export const ONE_CARD_ROWS = fixture.oneCardActivity14Oct;
export const LADYS_ROWS = fixture.ladysMidCycle13Oct;

export const APPLE_PAY_ENTRIES = [
  { description: "Cold Storage-Star Vist", amount: "1.80", date: "2026-10-11" },
  { description: "CS Fresh", amount: "9.70", date: "2026-10-11" },
  { description: "FairPrice finest", amount: "7.84", date: "2026-10-11" }
];

// The generic CSV the Imports page reads: the purchase day travels in the
// note, as the bank's own export prints it.
export function toCsv(fixtureRows) {
  return [
    "date,description,amount,account,category,note",
    ...fixtureRows.map((row) => `${row.date},${row.description},-${row.expense},${row.account},${row.category},${row.note}`)
  ].join("\n");
}

export async function writeCsv(path, fixtureRows) {
  await writeFile(path, toCsv(fixtureRows));
}

async function enableShortcut(page) {
  const settings = await (await page.request.get("/api/settings-page?view=household")).json();
  const activeIds = settings.settingsPage.accounts.filter((account) => account.isActive).map((account) => account.id);
  await postJson(page, "/api/settings/shortcuts/save", { apiKey: SHORTCUT_TOKEN, defaultAccountPriorityIds: activeIds });
}

export async function saveApplePayEntry(page, { accountName = LADYS_CARD, description, amount, date }) {
  const response = await page.request.post("/api/shortcuts/entries/create", {
    headers: { "X-Monies-Shortcut-Token": SHORTCUT_TOKEN },
    data: { amount, description, accountName, date, categoryName: "Groceries", requestId: `e2e-wrong-card-${Date.now()}-${Math.round(Math.random() * 1e6)}` }
  });
  const body = await response.json();
  expect(response.ok(), JSON.stringify(body)).toBeTruthy();
  return body.entryId;
}

// Imports a file straight through the API, as an earlier import.
export async function importFileThroughApi(page, fixtureRows, sourceLabel) {
  const { preview } = await postJson(page, "/api/imports/preview", {
    sourceLabel, sourceType: "csv", csv: toCsv(fixtureRows), ownershipType: "direct", ownerName: "Tim"
  });
  const { importId } = await postJson(page, "/api/imports/commit", {
    sourceLabel, sourceType: "csv", parserKey: "generic_csv", rows: preview.previewRows.filter((row) => row.commitStatus === "included")
  });
  return importId;
}

// Both cards, the three stray Apple Pay entries on Lady's Card, and (unless
// told otherwise) the One Card activity file already imported.
export async function setUpWrongCardApplePay(page, { entries = APPLE_PAY_ENTRIES, importOneCardFile = true } = {}) {
  await reseedDemo(page);
  for (const name of [ONE_CARD, LADYS_CARD]) {
    await postJson(page, "/api/accounts/create", {
      name, institution: "UOB", kind: "credit_card", currency: "SGD", openingBalanceMinor: 0, ownerPersonId: "person-tim", isJoint: false
    });
  }
  await enableShortcut(page);
  const entryIds = [];
  for (const entry of entries) {
    entryIds.push(await saveApplePayEntry(page, entry));
  }
  const oneCardImportId = importOneCardFile ? await importFileThroughApi(page, ONE_CARD_ROWS, "CC_TXN_History_14Oct2026-onecard") : null;
  return { entryIds, oneCardImportId };
}

// The entries now on Lady's Card in October, as the Entries page reports them.
export async function ladysCardEntries(page) {
  const response = await page.request.get("/api/entries-page?view=household&month=2026-10");
  const body = await response.json();
  expect(response.ok(), JSON.stringify(body).slice(0, 300)).toBeTruthy();
  return body.monthPage.entries.filter((entry) => entry.accountName === LADYS_CARD);
}

export async function accountBalanceMinor(page, accountName) {
  const settings = await (await page.request.get("/api/settings-page?view=household")).json();
  return settings.settingsPage.accounts.find((account) => account.name === accountName).balanceMinor;
}

export const expenseTotalMinor = (fixtureRows) => fixtureRows.reduce((sum, row) => sum + Math.round(Number(row.expense) * 100), 0);

// Drops a CSV on Imports and takes it through the column check to its
// review, the way a person does with a plain CSV.
export async function uploadAndPreview(page, csvPath) {
  await page.goto("/imports");
  await page.locator("input[type=file]").setInputFiles(csvPath);
  await page.getByRole("button", { name: "Preview import" }).click();
  await expect(page.locator(".import-preview-status-row")).toBeVisible({ timeout: 60_000 });
}
