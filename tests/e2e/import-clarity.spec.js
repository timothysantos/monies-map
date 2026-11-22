// What the import preview tells the person before a save, and what it points
// at after one: where a file with no account in it is going and why, rows a
// file lists twice, and the doubles and one-sided transfers to look at.
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

import { postJson, reseedDemo } from "./helpers.js";

const fixture = (path) => fileURLToPath(new URL(`../fixtures/${path}`, import.meta.url));
const UOB_REPEATED = fixture("uob-current-transactions/CC_TXN_History-onecard-repeated-block-nov-2026-sanitized.xls");
const CITI_ACTIVITY = readFileSync(fixture("citibank-activity/ACCT_349_19_10_2026-sanitized.csv"));
const UOB_ACCOUNT = "UOB One Card (new)";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await reseedDemo(page);
});

async function chooseDefaultAccount(page, namePattern) {
  await page.goto("/imports?view=household");
  await page.getByRole("button", { name: "Paste rows or set defaults" }).click();
  const select = page.getByLabel("Default account");
  const label = await select.locator("option").filter({ hasText: namePattern }).first().textContent();
  await select.selectOption({ label });
}

test("a Citi activity file says the account was read from the file's name, or is the one chosen", async ({ page }) => {
  test.setTimeout(180_000);
  await chooseDefaultAccount(page, /^Citi Rewards/);
  await page.locator("input[type=file]").first().setInputFiles({
    name: "tim_citirewards_midcycle_ACCT_349_19_10_2026.csv", mimeType: "text/csv", buffer: CITI_ACTIVITY
  });
  const mapping = page.locator("[data-import-target='account-mapping']");
  await expect(mapping).toBeVisible({ timeout: 60_000 });
  await expect(mapping.locator("[data-account-guess='file_name']")).toContainText("was read from the file's name");
  await mapping.scrollIntoViewIfNeeded();
  await mapping.screenshot({ path: "test-results/import-clarity/account-reason-file-name.png" });

  // The same file with a name that says nothing: the chosen account, said so.
  await chooseDefaultAccount(page, /^Citi Rewards/);
  await page.locator("input[type=file]").first().setInputFiles({
    name: "ACCT_349_19_10_2026.csv", mimeType: "text/csv", buffer: CITI_ACTIVITY
  });
  await expect(mapping.locator("[data-account-guess='selected_account']")).toContainText("the account chosen for this upload", { timeout: 60_000 });
  await expect(mapping.locator("[data-account-guess='file_name']")).toHaveCount(0);
});

test("a UOB card file that repeats a block says so before the save, and the save points at what to look at", async ({ page }) => {
  test.setTimeout(240_000);
  await postJson(page, "/api/accounts/create", {
    name: UOB_ACCOUNT, institution: "UOB", kind: "credit_card", currency: "SGD", openingBalanceMinor: 0, ownerPersonId: "person-tim", isJoint: false
  });
  // The after-save card reads the books check once; a known answer here.
  let checkReads = 0;
  await page.route("**/api/ledger-checkup*", async (route) => {
    checkReads += 1;
    await route.fulfill({
      json: {
        ok: true,
        generatedAt: "2026-11-22T00:00:00.000Z",
        tierCounts: { high: 1, check: 4, note: 0 },
        kindCounts: {
          duplicate_entry: { high: 1, check: 1, note: 0 },
          unmatched_transfer: { high: 0, check: 3, note: 0 },
          other_category: { high: 0, check: 9, note: 0 }
        },
        findings: [],
        clearTransferPairCount: 1
      }
    });
  });

  await chooseDefaultAccount(page, new RegExp(`^${UOB_ACCOUNT.replace(/[()]/g, "\\$&")}`));
  await page.locator("input[type=file]").first().setInputFiles(UOB_REPEATED);
  await expect(page.locator(".import-file-card")).toBeVisible({ timeout: 60_000 });
  const mapping = page.getByRole("combobox", { name: /^Detected:/ }).first();
  if (await mapping.isVisible().catch(() => false)) {
    const label = await mapping.locator("option").filter({ hasText: UOB_ACCOUNT }).first().textContent();
    await mapping.selectOption({ label });
  }
  const notes = page.getByText(/^This file lists \d+ transactions twice\. Each one is kept once\.$/);
  await expect(notes).toBeVisible({ timeout: 30_000 });
  await notes.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/import-clarity/listed-twice-note.png" });
  // Nothing has asked the books check yet: it is read only after a save.
  expect(checkReads).toBe(0);

  const commit = page.locator(".import-commit-bar .import-commit-button");
  await expect(commit).toBeEnabled({ timeout: 30_000 });
  await commit.click();

  const card = page.locator("[data-import-target='after-import-check']");
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card.getByRole("heading")).toHaveText("5 things to look at in your books");
  await expect(card).toContainText("2 payments may be recorded twice.");
  await expect(card).toContainText("3 transfers have no matching other side yet. 1 pair is clear enough to link in one step.");
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: "test-results/import-clarity/after-save-card.png" });

  await card.getByRole("button", { name: "Check my books" }).click();
  await expect(page).toHaveURL(/\/check/);
});

test("a failed books check after a save shows no card and no error", async ({ page }) => {
  test.setTimeout(240_000);
  await postJson(page, "/api/accounts/create", {
    name: UOB_ACCOUNT, institution: "UOB", kind: "credit_card", currency: "SGD", openingBalanceMinor: 0, ownerPersonId: "person-tim", isJoint: false
  });
  await page.route("**/api/ledger-checkup*", (route) => route.fulfill({ status: 500, body: "no" }));
  await chooseDefaultAccount(page, new RegExp(`^${UOB_ACCOUNT.replace(/[()]/g, "\\$&")}`));
  await page.locator("input[type=file]").first().setInputFiles(UOB_REPEATED);
  await expect(page.locator(".import-file-card")).toBeVisible({ timeout: 60_000 });
  const mapping = page.getByRole("combobox", { name: /^Detected:/ }).first();
  if (await mapping.isVisible().catch(() => false)) {
    const label = await mapping.locator("option").filter({ hasText: UOB_ACCOUNT }).first().textContent();
    await mapping.selectOption({ label });
  }
  const commit = page.locator(".import-commit-bar .import-commit-button");
  await expect(commit).toBeEnabled({ timeout: 30_000 });
  const checked = page.waitForResponse((response) => response.url().includes("/api/ledger-checkup"));
  await commit.click();
  await checked;
  // The save stands; the failed check adds nothing and raises no error.
  await expect(page.locator(".import-done-card").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("[data-import-target='after-import-check']")).toHaveCount(0);
});
