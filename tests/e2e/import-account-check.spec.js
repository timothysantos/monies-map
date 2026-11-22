// The Imports page's account check: a card whose saved statement is off by
// exactly one hand-added entry names that entry, and removing it (after the
// confirm) brings the card back to Matched. Settings' statement history says
// the same thing in the same words.
import { expect, test } from "@playwright/test";

import { expectFits } from "./fit-check.js";
import { seedStressHousehold, STRESS } from "./fit-stress-fixture.js";
import { postJson, reseedDemo } from "./helpers.js";

const CARD = "Check Test Card";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
});

// A card with a $20.00 lunch the statement lists and a $7.50 entry it does
// not: the November statement says $20.00 owed, the entries come to $27.50.
async function setUpCardOffBySevenFifty(page, { seed = reseedDemo, ownerName = "Tim" } = {}) {
  await seed(page);
  const { accountId } = await postJson(page, "/api/accounts/create", {
    name: CARD,
    institution: "UOB",
    kind: "credit_card",
    currency: "SGD",
    openingBalanceMinor: 0,
    ownerPersonId: "person-tim",
    isJoint: false
  });
  const entry = (date, description, amountMinor) => postJson(page, "/api/entries/create", {
    accountId,
    date,
    description,
    amountMinor,
    categoryName: "Food & Drinks",
    entryType: "expense",
    ownershipType: "direct",
    ownerName
  });
  await entry("2026-10-20", "Lunch on the statement", 2000);
  await entry("2026-10-27", "Lixin Fishball", 750);
  await postJson(page, "/api/accounts/reconcile", {
    accountId,
    checkpointMonth: "2026-11",
    statementStartDate: "2026-10-13",
    statementEndDate: "2026-11-12",
    statementBalanceMinor: 2000
  });
  return accountId;
}

async function openAccountCheck(page) {
  await page.goto("/imports?view=household");
  const inbox = page.locator(".import-inbox-section");
  await expect(inbox).toBeVisible({ timeout: 30_000 });
  const toggle = inbox.locator(".import-inbox-fold-toggle");
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
  }
  const check = inbox.locator(".import-account-check");
  await expect(check).toBeVisible();
  return check;
}

test("the account check names the entry the statement does not list, and removing it balances the card", async ({ page }) => {
  test.setTimeout(120_000);
  const accountId = await setUpCardOffBySevenFifty(page);

  const check = await openAccountCheck(page);
  // Something needs a look, so the list is open without a click.
  await expect(check).toHaveAttribute("open", "");
  const row = check.locator(".import-account-check-row").filter({ hasText: CARD });
  await expect(row.locator(".import-account-check-statement")).toHaveText("Statement to 12 Nov 2026");
  await expect(row.locator(".import-account-check-balance")).toHaveText("Off by $7.50");
  await expect(row.locator(".import-account-check-entries")).toHaveText("Entries up to 27 Oct 2026");
  await expect(row.locator(".import-account-check-detail")).toContainText("Lixin Fishball on 27 Oct 2026 ($7.50) is not on the statement.");
  // The entry the statement does list is never offered for removal.
  await expect(row).not.toContainText("Lunch on the statement");
  await row.scrollIntoViewIfNeeded();
  await check.screenshot({ path: "test-results/import-clarity/account-check-off-desktop.png" });

  // Nothing is removed without the confirm.
  await row.getByRole("button", { name: "Remove this entry" }).click();
  const confirm = page.getByRole("button", { name: "Remove", exact: true });
  await expect(confirm).toBeVisible();
  const before = await (await page.request.get("/api/settings-page?view=household")).json();
  expect(before.settingsPage.accounts.find((account) => account.id === accountId).latestCheckpointDeltaMinor).toBe(-750);
  await confirm.click();

  await expect(row.locator(".import-account-check-balance")).toHaveText("Matched", { timeout: 30_000 });
  await expect(row.locator(".import-account-check-detail")).toHaveCount(0);
  const after = await (await page.request.get("/api/settings-page?view=household")).json();
  expect(after.settingsPage.accounts.find((account) => account.id === accountId).latestCheckpointDeltaMinor).toBe(0);
});

// The phone fit check (docs/code-spec.md), with the heavy household: long
// names and many accounts, at the three phone sizes.
for (const size of [{ width: 320, height: 568 }, { width: 375, height: 557 }, { width: 390, height: 844 }]) {
  test(`on a ${size.width}x${size.height} phone the account check fits the screen`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize(size);
    await setUpCardOffBySevenFifty(page, { seed: seedStressHousehold, ownerName: STRESS.tim });
    const check = await openAccountCheck(page);
    const row = check.locator(".import-account-check-row").filter({ hasText: CARD });
    await row.scrollIntoViewIfNeeded();
    await expect(row.locator(".import-account-check-balance")).toHaveText("Off by $7.50");
    await expect(row.getByRole("button", { name: "Remove this entry" })).toBeVisible();
    await expectFits(page, { root: ".import-account-check" });
    if (size.width === 390) {
      await page.screenshot({ path: "test-results/import-clarity/account-check-off-phone.png", fullPage: false });
    }
  });
}

test("Settings' statement history says Off by and names the entry in the same words", async ({ page }) => {
  test.setTimeout(120_000);
  await setUpCardOffBySevenFifty(page);
  await page.goto("/settings?view=household");
  const accountsToggle = page.locator(".settings-section-toggle").filter({ has: page.getByRole("heading", { name: "Accounts", exact: true }) });
  if ((await accountsToggle.getAttribute("aria-expanded")) !== "true") {
    await accountsToggle.click();
  }
  await page.locator(".settings-account-card").filter({ hasText: CARD }).getByRole("button", { name: "Reconcile" }).click();
  const history = page.locator(".settings-account-history .settings-checkpoint-row").first();
  await expect(history.locator(".settings-account-health")).toHaveText("Off by $7.50");
  await expect(history).toContainText("Lixin Fishball on 27 Oct 2026 ($7.50) is not on the statement.");
  await expect(history.getByRole("button", { name: "Compare statement" })).toBeVisible();
  // The old developer word is gone.
  await expect(history).not.toContainText("Delta");
  await history.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/import-clarity/settings-history-off.png", fullPage: false });
});
