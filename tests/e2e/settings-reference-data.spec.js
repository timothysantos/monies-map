import { expect, test } from "@playwright/test";

import {
  gotoPageAfterApi,
  loadAppShell,
  loadEntriesPage,
  loadMonthPage,
  loadReferenceData,
  loadSettingsPage,
  loadSummaryAccountPills,
  loadSummaryPage,
  postJson,
  reseedDemo
} from "./helpers";

function uniqueLabel(prefix) {
  return `${prefix} ${Date.now()}`;
}

function shortcutHeaders(apiKey) {
  return {
    "X-Monies-Shortcut-Token": apiKey,
    "X-Monies-Shortcut-Nonce": `pw-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    "X-Monies-Shortcut-Timestamp": String(Date.now())
  };
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
    const referenceData = await loadReferenceData(page);
    const targetCategory = referenceData.categories[0];
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
    const referenceData = await loadReferenceData(page);
    const targetCategory = referenceData.categories[0];
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

  test("duplicate rule issue ignore action stays aligned with readable summary copy", async ({ page }) => {
    const referenceData = await loadReferenceData(page);
    const targetCategory = referenceData.categories[0];
    const uniquePattern = uniqueLabel("Playwright duplicate layout");

    await postJson(page, "/api/category-match-rules/save", {
      pattern: uniquePattern,
      categoryId: targetCategory.id,
      priority: 40,
      isActive: true,
      note: "Layout test first rule"
    });
    await postJson(page, "/api/category-match-rules/save", {
      pattern: `${uniquePattern} cafe`,
      categoryId: targetCategory.id,
      priority: 80,
      isActive: true,
      note: "Layout test second rule"
    });

    await openSettingsPage(page);
    await page.getByRole("button", { name: /Category matching/ }).click();
    const issueSummary = page.locator(".settings-duplicate-rule-summary").filter({ hasText: uniquePattern }).first();
    await expect(issueSummary).toBeVisible();

    const layout = await issueSummary.evaluate((row) => {
      const copy = row.querySelector("p");
      const button = row.querySelector("button");
      const rowBox = row.getBoundingClientRect();
      const copyBox = copy?.getBoundingClientRect();
      const buttonBox = button?.getBoundingClientRect();
      return {
        copyWidth: copyBox?.width ?? 0,
        buttonText: button?.textContent?.trim() ?? "",
        buttonTop: (buttonBox?.top ?? rowBox.top) - rowBox.top,
        buttonLeft: (buttonBox?.left ?? rowBox.left) - rowBox.left,
        overflows: row.scrollWidth > row.clientWidth + 1 || row.scrollHeight > row.clientHeight + 1
      };
    });

    expect(layout.copyWidth).toBeGreaterThan(240);
    expect(layout.buttonText).toBe("Ignore");
    expect(layout.buttonTop).toBeLessThan(8);
    expect(layout.buttonLeft).toBeGreaterThan(layout.copyWidth);
    expect(layout.overflows).toBe(false);

    await issueSummary.getByRole("button", { name: "Ignore" }).click();
    await expect(issueSummary).toHaveCount(0);
  });

  test("unresolved transfers can open entries in a new tab and be managed in settings", async ({ page }) => {
    const stamp = Date.now();
    const outDescription = `Playwright settings transfer out ${stamp}`;
    const inDescription = `Playwright settings transfer in ${stamp}`;
    const amountMinor = 91234;

    await postJson(page, "/api/entries/create", {
      date: "2026-07-08",
      description: outDescription,
      accountName: "UOB One",
      categoryName: "Transfer",
      amountMinor,
      entryType: "transfer",
      transferDirection: "out",
      ownershipType: "direct",
      ownerName: "Tim"
    });
    await postJson(page, "/api/entries/create", {
      date: "2026-07-08",
      description: inDescription,
      accountName: "Citi Rewards",
      categoryName: "Transfer",
      amountMinor,
      entryType: "transfer",
      transferDirection: "in",
      ownershipType: "direct",
      ownerName: "Tim"
    });

    await openSettingsPage(page);
    await page.getByRole("button", { name: /Unresolved transfers/ }).click();
    const transferRow = page.locator(".settings-transfer-row").filter({ hasText: outDescription });
    await expect(transferRow).toBeVisible();

    const popupPromise = page.waitForEvent("popup");
    await transferRow.getByRole("button", { name: "Open in entries" }).click();
    const popup = await popupPromise;
    await popup.waitForLoadState("domcontentloaded");
    const popupUrl = new URL(popup.url());
    expect(popupUrl.pathname).toBe("/entries");
    expect(popupUrl.searchParams.get("month")).toBe("2026-07");
    await popup.close();

    await transferRow.getByRole("button", { name: "Manage transfer" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Transfer details" })).toBeVisible();
    await expect(dialog).toContainText(inDescription);
    await dialog.getByRole("button", { name: "Use match" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(transferRow).toHaveCount(0);
  });

  test("account rename updates reference data plus summary and entries downstream DTOs", async ({ page }) => {
    const beforeReferenceData = await loadReferenceData(page);
    const beforeSummaryPills = await loadSummaryAccountPills(page, { view: "household" });
    const visiblePill = beforeSummaryPills.accountPills[0];
    const targetAccount = beforeReferenceData.accounts.find((account) => account.id === visiblePill?.accountId) ?? beforeReferenceData.accounts[0];
    const renamedAccount = uniqueLabel(`${targetAccount.name} renamed`);
    const createdDescription = uniqueLabel("Playwright account rename");

    await postJson(page, "/api/entries/create", {
      date: "2026-04-24",
      description: createdDescription,
      accountName: targetAccount.name,
      categoryName: beforeReferenceData.categories[0].name,
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

    const afterReferenceData = await loadReferenceData(page);
    expect(afterReferenceData.accounts.find((account) => account.id === targetAccount.id)?.name).toBe(renamedAccount);

    const summaryPage = await loadSummaryAccountPills(page, { view: "household" });
    expect(
      summaryPage.accountPills.some((pill) => pill.accountId === targetAccount.id && pill.accountName === renamedAccount)
    ).toBe(true);

    const entriesPage = await loadEntriesPage(page, { view: "person-tim", month: "2026-04" });
    expect(
      entriesPage.monthPage.entries.some((entry) => entry.description === createdDescription && entry.accountName === renamedAccount)
    ).toBe(true);
  });

  test("shortcut settings provide API key auth and default account fallback", async ({ page }) => {
    const referenceData = await loadReferenceData(page);
    const activeAccounts = referenceData.accounts.filter((account) => account.isActive);
    expect(activeAccounts.length).toBeGreaterThan(0);
    const targetAccount = activeAccounts.find((account) => account.kind === "credit_card") ?? activeAccounts[0];
    const otherAccounts = activeAccounts.filter((account) => account.id !== targetAccount.id);
    const targetCategory = referenceData.categories.find((category) => category.name === "Food & Drinks")
      ?? referenceData.categories.find((category) => category.name !== "Other")
      ?? referenceData.categories[0];
    const apiKey = `mm_playwright_${Date.now()}`;
    const description = uniqueLabel("Apple Shortcut fallback");

    await postJson(page, "/api/settings/shortcuts/save", {
      apiKey,
      defaultAccountPriorityIds: [targetAccount.id, ...otherAccounts.map((account) => account.id)],
      defaultParams: `categoryName=${encodeURIComponent(targetCategory.name)}&ownerName=Tim&view=person-tim`
    });

    const settingsPage = await loadSettingsPage(page);
    expect(settingsPage.settingsPage.shortcutSettings.apiKey).toBe(apiKey);
    expect(settingsPage.settingsPage.shortcutSettings.apiKeySource).toBe("app");
    expect(settingsPage.settingsPage.shortcutSettings.defaultAccountPriorityIds[0]).toBe(targetAccount.id);
    expect(settingsPage.settingsPage.shortcutSettings.defaultParams).toContain("ownerName=Tim");

    const response = await page.request.post("/api/shortcuts/entries/create", {
      headers: shortcutHeaders(apiKey),
      data: {
        date: "2026-04-27",
        description,
        amount: "12.34"
      }
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    const created = await response.json();
    expect(created.ok).toBe(true);
    expect(created.entryId).toBeTruthy();
    expect(created.openUrl).toContain(`/entries`);
    expect(created.openUrl).toContain(`entry_wallet=${encodeURIComponent(targetAccount.id)}`);

    const entriesPage = await loadEntriesPage(page, { view: "person-tim", month: "2026-04" });
    expect(
      entriesPage.monthPage.entries.some((entry) => (
        entry.description === description
        && entry.accountName === targetAccount.name
        && entry.categoryName === targetCategory.name
        && entry.amountMinor === 1234
      ))
    ).toBe(true);

    await gotoPageAfterApi(
      page,
      `/entries?view=person-tim&month=2026-04&action=add-expense&date=2026-04-27&amount=7.89&merchant=Shortcut%20URL%20priority`,
      "/api/entries-page",
      () => page.locator(".entry-composer")
    );
    await expect(page.locator(".entry-composer")).toBeVisible();
    await page.locator(".entry-composer").getByRole("button", { name: "Create entry" }).click();
    await expect(page.locator(".entry-composer")).toHaveCount(0);
    const entriesAfterUrlCreate = await loadEntriesPage(page, { view: "person-tim", month: "2026-04" });
    expect(entriesAfterUrlCreate.monthPage.entries.some((entry) => (
      entry.description === "Shortcut URL priority"
      && entry.accountName === targetAccount.name
      && entry.amountMinor === 789
    ))).toBe(true);
  });

  test("category rename refreshes reference data plus month and summary downstream DTOs", async ({ page }) => {
    const beforeReferenceData = await loadReferenceData(page);
    const targetCategory = beforeReferenceData.categories.find((category) => !category.isSystem) ?? beforeReferenceData.categories[0];
    const renamedCategory = uniqueLabel(`${targetCategory.name} renamed`);
    const createdDescription = uniqueLabel("Playwright category rename");
    const targetAccount = beforeReferenceData.accounts.find((account) => account.isActive) ?? beforeReferenceData.accounts[0];

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

    const afterReferenceData = await loadReferenceData(page);
    expect(afterReferenceData.categories.find((category) => category.id === targetCategory.id)?.name).toBe(renamedCategory);

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
