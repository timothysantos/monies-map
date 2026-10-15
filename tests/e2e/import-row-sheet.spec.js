// Imports review in Lead · Support · Detail (design.md, "Imports review"):
// the file card says how many rows will import, the account is shown once, and
// on a phone the preview rows are flat rows that open an Edit row sheet which
// edits the same row the table does. Wider screens keep the table.
import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

import { pickCategory, postJson, reseedDemo } from "./helpers.js";

const UOB_ACTIVITY = fileURLToPath(new URL("../fixtures/uob-current-transactions/CC_TXN_History_06052026211223-onecard-tim-06-may.xls", import.meta.url));
const ACCOUNT = "UOB One Card (new)";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await reseedDemo(page);
  await postJson(page, "/api/accounts/create", {
    name: ACCOUNT, institution: "UOB", kind: "credit_card", currency: "SGD", openingBalanceMinor: 0, ownerPersonId: "person-tim", isJoint: false
  });
});

// The activity file with its account mapped: 89 rows ready to commit.
async function openMappedPreview(page) {
  await page.goto("/imports?view=household");
  await page.getByRole("button", { name: "Paste rows or set defaults" }).click();
  await page.getByLabel("Default account").selectOption({ label: `${ACCOUNT} - Tim` });
  await page.locator("input[type=file]").first().setInputFiles(UOB_ACTIVITY);
  await expect(page.locator(".import-file-card")).toBeVisible({ timeout: 60_000 });
  // The file's own card name is not an app account yet: map it to the new one.
  const mapping = page.getByRole("combobox", { name: /^Detected:/ }).first();
  await expect(mapping).toBeVisible({ timeout: 30_000 });
  await mapping.selectOption({ label: `${ACCOUNT} - Tim` });
  await expect(page.locator(".import-file-card")).toContainText("Account mapped", { timeout: 30_000 });
}

test("the file card counts the rows that will import and shows the account once", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await openMappedPreview(page);

  const card = page.locator(".import-file-card");
  await expect(card.locator(".lsd-amount")).toHaveText("89");
  await expect(card).toContainText("rows will import");
  await expect(card).toContainText(/Covers 13 Apr 2026 – 5 May 2026/);
  // The Account row maps it, so the card's own subtitle stays empty: the
  // account appears once.
  await expect(card.locator(".lsd-subtitle")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: /^Detected:/ })).toHaveValue(/.+/);
  // The commit bar says the same number in words.
  await expect(page.locator(".import-preview-status-row")).toContainText("89 rows will import");
});

test("on a phone a preview row opens the Edit row sheet; edits apply, Exclude row and Include row move the count", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await openMappedPreview(page);

  // The first list is the rows that will import; excluded rows wait in their own group.
  const rows = page.locator(".import-row-list-wrap").first().locator(".import-row-item");
  await expect(rows).toHaveCount(89);
  await expect(page.locator(".import-preview-table")).toHaveCount(0);
  const first = rows.first();
  await expect(first).toContainText("BUS/MRT 830924733 SINGAPORE SG");
  await expect(first).toContainText("13 Apr 2026");
  await first.click();

  const sheet = page.getByRole("dialog", { name: "Edit row" });
  await expect(sheet).toBeVisible();
  // The same fields the table has, as Detail rows.
  for (const label of ["Type", "Account", "Owner", "Note"]) {
    await expect(sheet.getByLabel(label, { exact: true })).toBeVisible();
  }
  // Category is the shared category list's row, not a native select.
  await expect(sheet.locator("[data-row='category']")).toBeVisible();
  await sheet.getByLabel("Note", { exact: true }).fill("Bus fare to work");
  await pickCategory(page, sheet.locator("[data-row='category']"), "Groceries");
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(sheet).toHaveCount(0);
  await expect(rows.first()).toContainText("Groceries");
  await rows.first().click();
  await expect(page.getByRole("dialog", { name: "Edit row" }).getByLabel("Note", { exact: true })).toHaveValue("Bus fare to work");

  // Exclude row: the row leaves the list and the card counts one fewer.
  await page.getByRole("dialog", { name: "Edit row" }).getByRole("button", { name: "Exclude row" }).click();
  await expect(page.getByRole("dialog", { name: "Edit row" })).toHaveCount(0);
  await expect(rows).toHaveCount(88);
  await expect(page.locator(".import-file-card .lsd-amount")).toHaveText("88");
  await expect(page.locator(".import-preview-status-row")).toContainText("88 rows will import");

  // Include row brings it back from the excluded group.
  const excluded = page.locator("details.import-skipped-rows");
  await excluded.locator("summary").click();
  await excluded.locator(".import-row-item").first().click();
  const skippedSheet = page.getByRole("dialog", { name: "Edit row" });
  // An excluded row is read-only until it is included again.
  await expect(skippedSheet.getByLabel("Note", { exact: true })).toHaveAttribute("readonly", "");
  await expect(skippedSheet.locator("[data-row='category']")).toBeDisabled();
  await skippedSheet.getByRole("button", { name: "Include row" }).click();
  await expect(rows).toHaveCount(89);
  await expect(page.locator(".import-file-card .lsd-amount")).toHaveText("89");
});

test("a computer keeps the editable table and no row sheet", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openMappedPreview(page);
  await expect(page.locator(".import-preview-table")).toBeVisible();
  await expect(page.locator(".import-row-item")).toHaveCount(0);
  await expect(page.locator(".import-file-card .lsd-amount")).toHaveText("89");
});
