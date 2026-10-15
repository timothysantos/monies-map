// Investment statement imports name their account everywhere an import is
// listed: the Done card (account, saved value and date, no row counts), the
// "File imported" notice with the earlier imports under it, and Recent imports
// with its account filter. Two sanitized StashAway statements (value only, no
// rows) go into a demo household; rolling one back removes its value and the
// filter stops listing it. Hidden money hides the amount on the Done card.
// Set INVESTMENT_LABELS_SHOT_DIR to also save screenshots
// (docs/audits/investment-import-labels).
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { postJson, reseedDemo } from "./helpers.js";

const ACCOUNT = "Alex Sample Holder StashAway";
const LABEL = `${ACCOUNT} - Tim`;
const SHOT_DIR = process.env.INVESTMENT_LABELS_SHOT_DIR;

async function readFixtureText(month) {
  return readFile(new URL(`../fixtures/pdf-statement-text/stashaway-${month}-2026-real-sanitized.pdf-text.txt`, import.meta.url), "utf8");
}

async function writePdf(page, text, pdfPath) {
  const lines = text.split("__PDF_LAYOUT_TEXT__")[0].split("\n").map((line) => line.trim()).filter(Boolean);
  const escape = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const pdfPage = await page.context().newPage();
  await pdfPage.setContent(`<html><body style="font-family: Helvetica, Arial, sans-serif; font-size: 9px; line-height: 1.5;">${
    lines.map((line) => `<div style="white-space: pre;">${escape(line)}</div>`).join("")
  }</body></html>`);
  await pdfPage.pdf({ path: pdfPath, format: "A3" });
  await pdfPage.close();
}

async function shot(page, name) {
  if (SHOT_DIR) {
    await mkdir(SHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), fullPage: true });
  }
}

async function seedHousehold(page, { showMoney = true } = {}) {
  if (showMoney) {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  }
  await reseedDemo(page);
  // An account with no imports, for the filter's negative case.
  await postJson(page, "/api/accounts/create", { name: "Spare Savings", institution: "OCBC", kind: "bank", currency: "SGD", openingBalanceMinor: 0, ownerPersonId: "person-tim", isJoint: false });
  await postJson(page, "/api/accounts/create", { name: ACCOUNT, institution: "StashAway", kind: "investment", currency: "SGD", openingBalanceMinor: 0, ownerPersonId: "person-tim", isJoint: false });
}

async function importMonth(page, testInfo, month) {
  const pdfPath = testInfo.outputPath(`stashaway-${month}-2026-real.pdf`);
  await writePdf(page, await readFixtureText(month), pdfPath);
  await page.goto("/imports?view=person-tim", { waitUntil: "domcontentloaded" });
  await page.locator("input[type=file]").setInputFiles(pdfPath);
  await expect(page.locator('[data-import-target="investment-statement"]')).toBeVisible({ timeout: 60_000 });
  await page.locator(".import-commit-bar .import-commit-button").click();
  await expect(page.locator(".import-done-card")).toBeVisible({ timeout: 60_000 });
}

async function openRecentImports(page) {
  const toggle = page.locator(".import-history-toggle");
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
  }
}

test("desktop: the Done card, the notice and Recent imports name the StashAway account, its value and its statement date; rollback removes it from the filter", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await seedHousehold(page);

  await importMonth(page, testInfo, "aug");
  await importMonth(page, testInfo, "sep");

  const done = page.locator(".import-done-card");
  await expect(done).toContainText(`into ${LABEL}, covering 30 Sep 2026, is done`);
  await expect(done.locator(".import-done-account")).toContainText(LABEL);
  await expect(done).toContainText(`Saved ${ACCOUNT}'s value: $15,357.71 on 30 Sep 2026`);
  await expect(done).not.toContainText("rows added");
  await expect(done).not.toContainText("entries confirmed");
  await expect(done.getByRole("button", { name: "Roll back this import" })).toBeVisible();
  await shot(page, "after-done-card-desktop");

  // The notice under Recent imports names the account, with the earlier import in the same words.
  const notice = page.locator(".import-history-refreshing.is-success");
  await expect(notice).toContainText(`into ${LABEL}. Recent imports have been updated.`, { timeout: 60_000 });
  await expect(page.locator(".import-history-earlier li").first()).toHaveText(
    new RegExp(`^${LABEL} · 31 Aug 2026 · stashaway-aug-2026-real`)
  );

  await openRecentImports(page);
  await page.locator(".import-history-filter select").selectOption({ label: LABEL });
  const cards = page.locator(".import-history-list .import-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText(LABEL);
  await expect(cards.first()).toContainText("1 statement value saved");
  await expect(cards.first()).toContainText("30 Sep 2026");
  await expect(cards.first()).not.toContainText("0 transactions");
  await shot(page, "after-recent-imports-filtered-desktop");

  // Another account's filter does not list them.
  await page.locator(".import-history-filter select").selectOption({ label: "Spare Savings - Tim" });
  await expect(page.getByText("No imports match this account filter.")).toBeVisible();
  await page.locator(".import-history-filter select").selectOption({ label: LABEL });

  // Rolling one back removes its value, and the filter stops listing it.
  const sepCard = cards.filter({ hasText: "30 Sep 2026" });
  await sepCard.getByRole("button", { name: "Rollback import" }).click();
  await page.getByRole("button", { name: "Confirm rollback" }).click();
  await expect(cards).toHaveCount(1, { timeout: 60_000 });
  await expect(cards.first()).toContainText("31 Aug 2026");
  const pill = (await (await page.request.get("/api/summary-account-pills?view=household")).json()).accountPills.find((item) => item.accountName === ACCOUNT);
  expect(pill.investmentValue).toEqual({ valueMinor: 1_570_659, asOfDate: "2026-08-31" });
});

test("desktop: with money hidden, the Done card names the account and date but not the amount", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await seedHousehold(page, { showMoney: false });

  await importMonth(page, testInfo, "mar");

  const done = page.locator(".import-done-card");
  await expect(done).toContainText(`into ${LABEL}`);
  await expect(done).toContainText(`Saved ${ACCOUNT}'s value:`);
  await expect(done).toContainText("on 31 Mar 2026");
  expect(await done.innerText()).not.toMatch(/\d{1,3},\d{3}\.\d{2}/);
});
