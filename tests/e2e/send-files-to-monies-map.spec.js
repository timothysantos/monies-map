// "Send to Monies Map" (DOMAIN.md "Waiting File"): files posted to the
// share-sheet endpoint wait; opening Imports puts them in the intake queue,
// marked "Sent from your phone", statement first; Remove deletes one for
// good; reviewing and committing each takes it out of the store. Uses the
// near-real sanitised UOB One April 2026 statement (a real PDF) and the UOB
// One activity XLS from early May. Settings shows the address and key.
import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { reseedDemo } from "./helpers.js";

const FIXTURES = new URL("../fixtures/", import.meta.url);
const STATEMENT = { name: "eStatement_UOB_One_Apr2026.pdf", mimeType: "application/pdf", path: new URL("locked-pdf/uob-one-savings-apr-2026.plain.pdf", FIXTURES) };
const ACTIVITY = { name: "ACC_TXN_History_04052026210351.xls", mimeType: "application/vnd.ms-excel", path: new URL("uob-current-transactions/ACC_TXN_History_04052026210351.xls", FIXTURES) };
const SEND_PATH = "/api/shortcuts/files/send";
// Set to a folder to also save screenshots of the queue and the Settings row.
const SHOT_DIR = process.env.WAITING_FILES_SHOT_DIR;

const intakeRows = (page) => page.locator(".import-intake-row");
const commitButton = (page) => page.locator(".import-commit-bar .import-commit-button");

async function makeKey(page) {
  const response = await page.request.post("/api/settings/file-intake/new-key");
  expect(response.ok()).toBeTruthy();
  return (await response.json()).key;
}

async function send(page, key, file, buffer) {
  const response = await page.request.post(SEND_PATH, {
    headers: { "X-Monies-Files-Key": key },
    multipart: { file: { name: file.name, mimeType: file.mimeType, buffer: buffer ?? await readFile(file.path) } }
  });
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

async function waitingFiles(page) {
  const response = await page.request.get("/api/imports-page");
  return (await response.json()).importsPage.waitingFiles;
}

// Commits the file in review, answering "Commit anyway" when the demo
// ledger does not match the statement's total.
async function commitInReview(page, label) {
  await expect(commitButton(page)).toHaveText(label, { timeout: 60_000 });
  await expect(commitButton(page)).toBeEnabled();
  await commitButton(page).click();
  const anyway = page.getByRole("button", { name: "Commit anyway" });
  if (await anyway.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await anyway.click();
  }
}

async function shot(page, name) {
  if (SHOT_DIR) {
    await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), fullPage: false });
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await reseedDemo(page);
});

test("files sent from the phone wait in the queue, Remove deletes one, and each commit takes its file away", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const key = await makeKey(page);
  // Two shares, activity first: the queue still puts the statement first.
  await send(page, key, ACTIVITY);
  await send(page, key, STATEMENT);
  const extra = await send(page, key, { name: "notes.csv", mimeType: "text/csv" }, Buffer.from("date,description,amount\n2026-05-20,KOPI TIAM,-4.20\n"));
  expect(extra.message).toBe("Got it. The file is waiting in Monies Map; open Imports to review it.");
  // The same file again is not kept twice.
  const repeat = await send(page, key, STATEMENT);
  expect(repeat.files[0].result).toBe("already_received");

  await page.goto("/imports");
  await expect(intakeRows(page)).toHaveCount(3, { timeout: 60_000 });
  await expect(intakeRows(page).nth(0)).toContainText(STATEMENT.name);
  await expect(intakeRows(page).nth(0)).toContainText("Review this first");
  for (let index = 0; index < 3; index += 1) {
    await expect(intakeRows(page).nth(index).locator(".import-intake-arrival")).toHaveText(/^Sent from your phone, \d{1,2} [A-Z][a-z]{2}$/);
  }
  await shot(page, "imports-waiting-desktop-1440");

  // Remove deletes the stored file, not just the row.
  const notes = intakeRows(page).filter({ hasText: "notes.csv" });
  await notes.getByRole("button", { name: "Remove" }).click();
  await expect(intakeRows(page)).toHaveCount(2);
  expect((await waitingFiles(page)).map((file) => file.fileName).sort()).toEqual([ACTIVITY.name, STATEMENT.name]);

  // Review and commit both, in the queue's order.
  await intakeRows(page).nth(0).getByRole("button", { name: "Review" }).click();
  await commitInReview(page, "Commit and open next");
  await expect(page.locator(".import-done-card.is-compact")).toBeVisible({ timeout: 60_000 });
  expect((await waitingFiles(page)).map((file) => file.fileName)).toEqual([ACTIVITY.name]);
  await commitInReview(page, /^Commit/);
  await expect(page.locator(".import-done-card:not(.is-compact)")).toBeVisible({ timeout: 60_000 });
  expect(await waitingFiles(page)).toEqual([]);

  // Opening Imports again finds nothing waiting.
  await page.goto("/imports");
  await expect(page.locator(".import-dropzone")).toBeVisible({ timeout: 30_000 });
  await expect(intakeRows(page)).toHaveCount(0);
});

test("on a phone the sent files show how they arrived; Settings shows the address and key", async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const key = await makeKey(page);
  await send(page, key, STATEMENT);
  await send(page, key, ACTIVITY);
  await page.goto("/imports");
  await expect(intakeRows(page)).toHaveCount(2, { timeout: 60_000 });
  await expect(intakeRows(page).first().locator(".import-intake-arrival")).toBeVisible();
  await intakeRows(page).first().scrollIntoViewIfNeeded();
  // Nothing runs past the right edge.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await shot(page, "imports-waiting-phone-390");

  for (const [width, height, name] of [[390, 844, "settings-key-phone-390"], [1440, 900, "settings-key-desktop-1440"]]) {
    await page.setViewportSize({ width, height });
    await page.goto("/settings");
    const section = page.locator("#settings-file-intake");
    await section.getByRole("button", { name: /Send files to Monies Map/ }).first().click();
    await expect(section.getByRole("textbox", { name: "Address" })).toHaveValue(/\/api\/shortcuts\/files\/send$/);
    await expect(section.getByRole("textbox", { name: "Key" })).toHaveAttribute("type", "password");
    await expect(section.getByRole("button", { name: "Make a new key" })).toBeVisible();
    await section.scrollIntoViewIfNeeded();
    await shot(page, name);
  }
  // The key on the page is the one the endpoint takes.
  await expect(page.locator("#settings-file-intake").getByRole("textbox", { name: "Key" })).toHaveValue(key);
});
