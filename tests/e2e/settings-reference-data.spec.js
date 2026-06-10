import { expect, test } from "@playwright/test";

import {
  gotoPageAfterApi,
  loadAppShell,
  loadEntriesPage,
  loadMonthPage,
  loadSettingsPage,
  loadSummaryAccountPills,
  loadSummaryPage,
  postJson,
  reseedDemo
} from "./helpers";

function uniqueLabel(prefix) {
  return `${prefix} ${Date.now()}`;
}

async function openSettingsPage(page) {
  await gotoPageAfterApi(
    page,
    "/settings?view=person-tim",
    "/api/settings-page",
    () => page.getByRole("heading", { name: "Settings" })
  );
}

test.describe("settings reference data", () => {
  test.beforeEach(async ({ page }) => {
    await reseedDemo(page);
  });

  test("category rule CRUD stays inside the settings page DTO", async ({ page }) => {
    const before = await loadSettingsPage(page);
    const shell = await loadAppShell(page);
    const targetCategory = shell.categories[0];
    const rulePattern = uniqueLabel("Playwright category rule");

    await postJson(page, "/api/category-match-rules/save", {
      pattern: rulePattern,
      categoryId: targetCategory.id,
      priority: 75,
      isActive: true,
      note: "Created by Playwright"
    });

    const afterCreate = await loadSettingsPage(page);
    const createdRule = afterCreate.settingsPage.categoryMatchRules.find((rule) => rule.pattern === rulePattern);
    expect(createdRule).toBeTruthy();
    expect(afterCreate.settingsPage.categoryMatchRules.length).toBe(before.settingsPage.categoryMatchRules.length + 1);

    await postJson(page, "/api/category-match-rules/delete", {
      ruleId: createdRule.id
    });

    const afterDelete = await loadSettingsPage(page);
    expect(afterDelete.settingsPage.categoryMatchRules.find((rule) => rule.pattern === rulePattern)).toBeUndefined();
    expect(afterDelete.settingsPage.categoryMatchRules.length).toBe(before.settingsPage.categoryMatchRules.length);
  });

  test("category rule save shows pending state and keeps the dialog stable", async ({ page }) => {
    const before = await loadSettingsPage(page);
    const shell = await loadAppShell(page);
    const targetCategory = shell.categories[0];
    const rulePattern = uniqueLabel("Playwright rule save");

    await openSettingsPage(page);
    await page.getByRole("button", { name: /Category matching/ }).click();
    await page.locator("#settings-category-rules").getByRole("button", { name: "+ Add match rule" }).click();
    const dialog = page.locator(".settings-account-dialog");
    await expect(dialog).toBeVisible();

    await page.route("**/api/category-match-rules/save", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          rule: {
            id: `rule-${Date.now()}`,
            pattern: rulePattern,
            categoryId: targetCategory.id,
            priority: 75,
            isActive: true,
            note: "Created by Playwright"
          }
        })
      });
    });

    await dialog.getByRole("textbox", { name: "Merchant text" }).fill(rulePattern);
    const saveButton = dialog.locator("button.dialog-primary");
    await saveButton.click();
    await expect(saveButton).toBeDisabled();
    await expect(saveButton).toContainText("Saving");

    await expect(dialog).toHaveCount(0);
  });

  test("account rename updates shell metadata plus summary and entries downstream DTOs", async ({ page }) => {
    const beforeShell = await loadAppShell(page);
    const beforeSummaryPills = await loadSummaryAccountPills(page, { view: "household" });
    const visiblePill = beforeSummaryPills.accountPills[0];
    const targetAccount = beforeShell.accounts.find((account) => account.id === visiblePill?.accountId) ?? beforeShell.accounts[0];
    const renamedAccount = uniqueLabel(`${targetAccount.name} renamed`);
    const createdDescription = uniqueLabel("Playwright account rename");

    await postJson(page, "/api/entries/create", {
      date: "2026-04-24",
      description: createdDescription,
      accountName: targetAccount.name,
      categoryName: beforeShell.categories[0].name,
      amountMinor: 4321,
      entryType: "expense",
      ownershipType: "direct",
      ownerName: "Tim"
    });

    await postJson(page, "/api/accounts/update", {
      accountId: targetAccount.id,
      name: renamedAccount,
      institution: targetAccount.institution,
      kind: targetAccount.kind,
      currency: targetAccount.currency,
      openingBalanceMinor: targetAccount.openingBalanceMinor ?? 0,
      ownerPersonId: targetAccount.isJoint ? null : (targetAccount.ownerPersonId ?? null),
      isJoint: targetAccount.isJoint
    });

    const afterShell = await loadAppShell(page);
    expect(afterShell.accounts.find((account) => account.id === targetAccount.id)?.name).toBe(renamedAccount);

    const summaryPage = await loadSummaryAccountPills(page, { view: "household" });
    expect(
      summaryPage.accountPills.some((pill) => pill.accountId === targetAccount.id && pill.accountName === renamedAccount)
    ).toBe(true);

    const entriesPage = await loadEntriesPage(page, { view: "person-tim", month: "2026-04" });
    expect(
      entriesPage.monthPage.entries.some((entry) => entry.description === createdDescription && entry.accountName === renamedAccount)
    ).toBe(true);
  });

  test("category rename refreshes shell metadata plus month and summary downstream DTOs", async ({ page }) => {
    const beforeShell = await loadAppShell(page);
    const targetCategory = beforeShell.categories.find((category) => !category.isSystem) ?? beforeShell.categories[0];
    const renamedCategory = uniqueLabel(`${targetCategory.name} renamed`);
    const createdDescription = uniqueLabel("Playwright category rename");
    const targetAccount = beforeShell.accounts.find((account) => account.isActive) ?? beforeShell.accounts[0];

    await postJson(page, "/api/entries/create", {
      date: "2026-04-25",
      description: createdDescription,
      accountName: targetAccount.name,
      categoryName: targetCategory.name,
      amountMinor: 5432,
      entryType: "expense",
      ownershipType: "direct",
      ownerName: "Tim"
    });

    await postJson(page, "/api/categories/update", {
      categoryId: targetCategory.id,
      name: renamedCategory,
      slug: targetCategory.slug,
      iconKey: targetCategory.iconKey,
      colorHex: targetCategory.colorHex
    });

    const afterShell = await loadAppShell(page);
    expect(afterShell.categories.find((category) => category.id === targetCategory.id)?.name).toBe(renamedCategory);

    const monthPage = await loadMonthPage(page, { view: "person-tim", month: "2026-04" });
    expect(
      monthPage.monthPage.entries.some((entry) => entry.description === createdDescription && entry.categoryName === renamedCategory)
    ).toBe(true);

    const summaryPage = await loadSummaryPage(page, { view: "person-tim", month: "2026-04" });
    const aprilDonut = summaryPage.summaryPage.categoryShareByMonth.find((month) => month.month === "2026-04");
    expect(aprilDonut?.data.some((item) => item.label === renamedCategory)).toBe(true);
  });

  test("edit person submits from Enter in the name field", async ({ page }) => {
    const before = await loadAppShell(page);
    const targetPerson = before.household.people[0];
    const renamedPerson = uniqueLabel(`${targetPerson.name} updated`);

    await openSettingsPage(page);
    await page.getByRole("button", { name: /People/ }).click();
    await page.getByLabel("Edit person").first().click();

    const nameField = page.getByLabel("Display name");
    await nameField.fill(renamedPerson);
    await nameField.press("Enter");

    await expect(page.getByRole("dialog", { name: "Edit person" })).toBeHidden();

    const after = await loadAppShell(page);
    expect(after.household.people.find((person) => person.id === targetPerson.id)?.name).toBe(renamedPerson);
  });
});
