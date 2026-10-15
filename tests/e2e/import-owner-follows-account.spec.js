// An import's owner follows the account the rows land on: Joyce's own OCBC 360
// activity export shows Joyce as the owner (header chip and every row) even
// when it is opened from Tim's view, and the owner Joyce's account carries
// is what the saved entries get. A person's explicit owner choice still wins.
import { expect, test } from "@playwright/test";

import { postJson, reseedDemo } from "./helpers.js";

const JOYCE_OCBC_360 = new URL("../fixtures/ocbc-activity/TransactionHistory_20261015085450-ocbc-360-partner-sanitized.csv", import.meta.url);

test.beforeEach(async ({ page }) => {
  await reseedDemo(page);
  // The Imports form starts on the first account by name. Here that is Tim's,
  // as it is for the owner, so the form's own default owner is Tim and only
  // the file's account says the rows are Joyce's.
  await postJson(page, "/api/accounts/create", {
    kind: "bank",
    name: "AAA Tim Everyday",
    institution: "Aardvark Bank",
    ownerPersonId: "person-tim",
    currency: "SGD",
    openingBalanceMinor: 0
  });
  // The demo has no OCBC 360; Joyce's own account is the one the export names.
  await postJson(page, "/api/accounts/create", {
    kind: "bank",
    name: "OCBC 360",
    institution: "OCBC",
    ownerPersonId: "person-joyce",
    currency: "SGD",
    openingBalanceMinor: 0
  });
});

async function openJoyceExportAs(page, view) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/imports?view=${view}`, { waitUntil: "domcontentloaded" });
  await page.locator("input[type=file]").setInputFiles(JOYCE_OCBC_360.pathname);
  await expect(page.locator(".import-file-card")).toBeVisible({ timeout: 60_000 });
}

// The owner picked on each previewed row, in order.
async function rowOwners(page) {
  return page.locator("table tbody tr select.table-edit-input")
    .evaluateAll((selects) => selects.map((select) => select.value).filter((value) => value === "Tim" || value === "Joyce"));
}

for (const view of ["person-tim", "household"]) {
  test(`Joyce's OCBC 360 export is Joyce's import when opened from ${view}`, async ({ page }) => {
    await openJoyceExportAs(page, view);

    await expect(page.locator(".import-file-card")).toContainText("OCBC 360");
    await expect(page.locator(".import-file-card .lsd-chip.is-person", { hasText: "Joyce" })).toHaveCount(1);
    await expect(page.locator(".import-file-card .lsd-chip.is-person", { hasText: "Tim" })).toHaveCount(0);

    const owners = await rowOwners(page);
    expect(owners).toHaveLength(4);
    expect(new Set(owners)).toEqual(new Set(["Joyce"]));
  });
}

test("an owner picked on a row beats the account's owner, and the header chip stops naming one person", async ({ page }) => {
  await openJoyceExportAs(page, "person-tim");
  await expect.poll(() => rowOwners(page)).toHaveLength(4);
  const firstOwner = page.locator("table tbody tr").first().locator("select.table-edit-input").last();
  await firstOwner.selectOption("Tim");
  await expect(firstOwner).toHaveValue("Tim");
  // Rows now belong to two people: the card does not claim one.
  await expect(page.locator(".import-file-card .lsd-chip.is-person", { hasText: /^(Tim|Joyce)$/ })).toHaveCount(0);
  expect((await rowOwners(page)).filter((value) => value === "Tim")).toHaveLength(1);
});
