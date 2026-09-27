import { expect, test } from "@playwright/test";

import { loadSplitsPage, postJson, reseedDemo } from "./helpers";

const month = "2026-05";
const sourceLabel = "Rollback linked split";

// A manual 32.10 expense added to splits, promoted by a CSV row of the same
// amount, then corrected to 35.00 in Entries (the split follows).
async function prepareCorrectedPromotion(page) {
  const entry = await postJson(page, "/api/entries/create", {
    date: `${month}-18`,
    description: "COLD STORAGE",
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 3210,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });
  const split = await postJson(page, "/api/splits/expenses/from-entry", { entryId: entry.entryId, splitGroupId: null });
  const csv = ["date,description,amount,account,category,note", `${month}-19,COLD STORAGE SINGAPORE,-32.10,UOB One,Groceries,`].join("\n");
  const preview = await postJson(page, "/api/imports/preview", { sourceLabel, sourceType: "csv", csv, ownershipType: "direct", ownerName: "Tim" });
  expect(preview.preview.previewRows[0].reconciliationTargetTransactionId).toBe(entry.entryId);
  await postJson(page, "/api/imports/commit", { sourceLabel, sourceType: "csv", parserKey: "generic_csv", rows: preview.preview.previewRows });
  await postJson(page, "/api/entries/update", {
    entryId: entry.entryId,
    date: `${month}-18`,
    description: "COLD STORAGE SINGAPORE",
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 3500,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim",
    note: ""
  });
  return { entryId: entry.entryId, splitExpenseId: split.splitExpenseId };
}

function splitCard(page) {
  return page.locator(".split-activity-copy", { hasText: "COLD STORAGE" }).locator("xpath=..");
}

test("rolling back an import brings the linked split back to the entry's restored amount in Splits", async ({ page }) => {
  // Money is hidden by default; this scenario asserts visible dollar amounts.
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await page.goto("/");
  await reseedDemo(page);
  const { splitExpenseId } = await prepareCorrectedPromotion(page);

  // Splits is loaded (and cached) before the rollback.
  await page.goto(`/splits?view=person-tim&month=${month}`);
  await expect(splitCard(page)).toContainText("You paid $35.00", { timeout: 60_000 });
  await expect(splitCard(page)).toContainText("$17.50");

  await page.getByRole("link", { name: "Imports" }).click();
  const importCard = page.locator(".import-card").filter({ hasText: sourceLabel });
  await expect(importCard).toBeVisible({ timeout: 60_000 });
  await importCard.getByRole("button", { name: "Rollback import" }).click();
  const rolledBack = page.waitForResponse((response) => response.url().includes("/api/imports/rollback") && response.ok());
  await page.getByRole("button", { name: "Confirm rollback" }).click();
  await rolledBack;
  await expect(importCard).toContainText(/rolled_back/i);

  // Back in Splits without a reload: the split follows the restored entry.
  await page.getByRole("link", { name: "Splits" }).click();
  await expect(splitCard(page)).toContainText("You paid $32.10", { timeout: 30_000 });
  await expect(splitCard(page)).toContainText("$16.05");
  const splitsData = await loadSplitsPage(page, { view: "person-tim", month });
  const activity = splitsData.splitsPage.activity.find((item) => item.id === splitExpenseId);
  expect(activity.totalAmountMinor).toBe(3210);
  expect(activity.viewerAmountMinor).toBe(1605);
});

test("a rollback that would move a split in a simplified settlement is refused in the confirm popover", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await page.goto("/");
  await reseedDemo(page);
  const { splitExpenseId } = await prepareCorrectedPromotion(page);
  await postJson(page, "/api/splits/checkpoints/create", { viewerPersonId: "person-tim", date: `${month}-20`, currency: "SGD" });

  await page.goto(`/imports?view=person-tim&month=${month}`);
  const importCard = page.locator(".import-card").filter({ hasText: sourceLabel });
  await expect(importCard).toBeVisible({ timeout: 60_000 });
  await importCard.getByRole("button", { name: "Rollback import" }).click();
  const refused = page.waitForResponse((response) => response.url().includes("/api/imports/rollback"));
  await page.getByRole("button", { name: "Confirm rollback" }).click();
  expect((await refused).status()).toBe(409);

  const popover = page.locator(".delete-popover");
  await expect(popover).toContainText("Rolling back this import would change the amount and shares of a split expense in the simplified settlement");
  await expect(popover).toContainText("Undo the simplification first");
  await expect(importCard).toContainText(/completed/i);
  const splitsData = await loadSplitsPage(page, { view: "person-tim", month });
  expect(splitsData.splitsPage.activity.find((item) => item.id === splitExpenseId).totalAmountMinor).toBe(3500);
});
