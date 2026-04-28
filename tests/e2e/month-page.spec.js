import { expect, test, devices } from "@playwright/test";

function formatMoney(minor) {
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: "SGD"
  }).format(minor / 100);
}

async function reseedDemo(page) {
  let lastText = "";
  let lastOk = false;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await page.request.post("/api/demo/reseed");
    lastOk = response.ok();
    lastText = await response.text();
    if (lastOk) {
      return;
    }
    if (
      !lastText.includes("worker restarted mid-request")
      && !lastText.includes("UNIQUE constraint failed: households.id")
    ) {
      break;
    }
  }

  expect(lastOk, lastText).toBeTruthy();
}

async function loadMonthPageData(page, { view = "person-tim", month = "2026-04", scope = "direct_plus_shared" } = {}) {
  const response = await page.request.get(`/api/month-page?view=${view}&month=${month}&scope=${scope}`);
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

async function loadSummaryPageData(page, { view = "person-tim", month = "2026-04", scope = "direct_plus_shared", summaryStart = "2025-06", summaryEnd = "2026-04" } = {}) {
  const response = await page.request.get(
    `/api/summary-page?view=${view}&month=${month}&scope=${scope}&summary_start=${summaryStart}&summary_end=${summaryEnd}`
  );
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

async function postJson(page, path, body) {
  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await page.request.post(path, {
        data: body
      });
      const responseText = await response.text();
      if (!response.ok()) {
        if (responseText.includes("worker restarted mid-request") && attempt === 0) {
          continue;
        }
        expect(response.ok(), responseText).toBeTruthy();
      }
      return responseText ? JSON.parse(responseText) : {};
    } catch (error) {
      lastError = error;
      if (attempt === 0 && String(error?.message ?? error).includes("worker restarted mid-request")) {
        continue;
      }
      throw error;
    }
  }

  throw lastError ?? new Error(`POST ${path} failed`);
}

function findBudgetRow(monthPageData, label) {
  const budgetSection = monthPageData.monthPage.planSections.find((section) => section.key === "budget_buckets");
  const row = budgetSection?.rows.find((item) => item.label === label);
  if (!row) {
    throw new Error(`Budget row not found: ${label}`);
  }
  return row;
}

async function openBudgetRowEditor(page, label) {
  const row = page.locator("tr").filter({ hasText: label }).first();
  await expect(row).toBeVisible();
  await row.getByText(label).first().click();
  await expect(page.locator(".month-inline-action-row").first().getByRole("button", { name: "Save" })).toBeVisible();
  return row;
}

test.describe("month page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await reseedDemo(page);
  });

  test("desktop keeps person-owned rows stable across scopes and only shows delete while editing", async ({ page }) => {
    const expectedPlannedValues = new Map();
    const rowLabels = ["Public Transport", "Food", "Sports & Hobbies"];

    for (const scope of ["direct", "shared", "direct_plus_shared"]) {
      const data = await loadMonthPageData(page, { scope });
      for (const label of rowLabels) {
        const row = findBudgetRow(data, label);
        const previous = expectedPlannedValues.get(label);
        if (previous == null) {
          expectedPlannedValues.set(label, row.plannedMinor);
        } else {
          expect(row.plannedMinor, `${label} planned amount should stay stable in ${scope}`).toBe(previous);
        }
      }
    }

    await page.goto("/month?view=person-tim&month=2026-04&scope=direct_plus_shared");

    const publicTransportRow = page.locator("tr").filter({ hasText: "Public Transport" }).first();
    await expect(publicTransportRow.getByText("Delete")).toHaveCount(0);
    await expect(page.locator(".month-inline-action-row")).toHaveCount(0);

    await publicTransportRow.getByText("Public Transport").first().click();
    const actionRow = page.locator(".month-inline-action-row").first();
    await expect(actionRow.getByRole("button", { name: "Save" })).toBeVisible();
    await expect(actionRow.getByRole("button", { name: "Cancel" })).toBeVisible();
    await expect(actionRow.getByText("Delete")).toBeVisible();
    const actionButtons = actionRow.locator(".month-inline-edit-actions > button");
    await expect(actionButtons).toHaveCount(3);
    await expect(actionButtons.nth(0)).toContainText("Delete");
    await expect(actionButtons.nth(1)).toContainText("Cancel");
    await expect(actionButtons.nth(2)).toContainText("Save");

    await actionRow.getByRole("button", { name: "Cancel" }).click();
    await expect(publicTransportRow.getByText("Delete")).toHaveCount(0);
    await expect(page.locator(".month-inline-action-row")).toHaveCount(0);

    for (const [label, plannedMinor] of expectedPlannedValues.entries()) {
      const row = page.locator("tr").filter({ hasText: label }).first();
      await expect(row).toContainText(formatMoney(plannedMinor));
    }
  });

  test("planned item actuals only appear when they are backed by linked current-month entries", async ({ page }) => {
    const data = await loadMonthPageData(page);
    const plannedRows = data.monthPage.planSections
      .find((section) => section.key === "planned_items")
      ?.rows ?? [];

    const phantomActuals = plannedRows.filter((row) => row.actualMinor > 0 && (row.linkedEntryIds?.length ?? 0) === 0);
    expect(phantomActuals).toEqual([]);

    for (const row of plannedRows.filter((item) => item.linkedEntryIds?.length)) {
      expect(row.actualEntryIds?.length ?? 0, `${row.label} should expose actual entry ids for drilldown`).toBeGreaterThan(0);
      expect(row.actualMinor, `${row.label} should derive actual from linked entries`).toBeGreaterThan(0);
    }
  });

  test("desktop editing a budget row updates month and summary planning totals", async ({ page }) => {
    const beforeMonth = await loadMonthPageData(page);
    const beforeSummary = await loadSummaryPageData(page);
    const entertainmentRow = findBudgetRow(beforeMonth, "Entertainment");
    const nextPlannedMinor = entertainmentRow.plannedMinor + 500;
    const deltaMinor = nextPlannedMinor - entertainmentRow.plannedMinor;
    const beforeSummaryMonth = beforeSummary.summaryPage.months.find((month) => month.month === "2026-04");
    expect(beforeSummaryMonth).toBeTruthy();

    await page.goto("/month?view=person-tim&month=2026-04&scope=direct_plus_shared");
    const row = await openBudgetRowEditor(page, "Entertainment");
    await row.locator(".table-edit-input-money").fill("75.00");
    await page.locator(".month-inline-action-row").first().getByRole("button", { name: "Save" }).click();
    await expect(row.getByText("$75.00")).toBeVisible();

    const afterMonth = await loadMonthPageData(page);
    const updatedEntertainmentRow = findBudgetRow(afterMonth, "Entertainment");
    expect(updatedEntertainmentRow.plannedMinor).toBe(nextPlannedMinor);

    const afterSummary = await loadSummaryPageData(page);
    const afterSummaryMonth = afterSummary.summaryPage.months.find((month) => month.month === "2026-04");
    expect(afterSummaryMonth).toBeTruthy();
    expect(afterSummaryMonth.estimatedExpensesMinor).toBe(beforeSummaryMonth.estimatedExpensesMinor + deltaMinor);

    await page.goto("/summary?view=person-tim&month=2026-04&scope=direct_plus_shared&summary_start=2025-06&summary_end=2026-04");
    const aprCard = page.locator(".plan-row-card").filter({ hasText: "Apr 2026" }).first();
    await expect(aprCard).toContainText(formatMoney(afterSummaryMonth.estimatedExpensesMinor));
    await expect(aprCard).toContainText("Income");
  });

  test("desktop entries switches person view and scope from the shell controls", async ({ page }) => {
    const directDescription = `Playwright direct scope ${Date.now()}`;
    const sharedDescription = `Playwright shared scope ${Date.now()}`;
    await postJson(page, "/api/entries/create", {
      date: "2026-04-24",
      description: directDescription,
      accountName: "UOB One",
      categoryName: "Groceries",
      amountMinor: 4321,
      entryType: "expense",
      ownershipType: "direct",
      ownerName: "Tim"
    });
    await postJson(page, "/api/entries/create", {
      date: "2026-04-24",
      description: sharedDescription,
      accountName: "UOB One",
      categoryName: "Groceries",
      amountMinor: 1234,
      entryType: "expense",
      ownershipType: "shared",
      splitBasisPoints: 5000
    });

    await page.goto("/");
    await page.getByRole("link", { name: "Entries" }).click();

    await expect(page.locator(".panel-context")).toContainText("Viewing entries for Household");
    const householdScopeToggle = page.locator(".desktop-scope-toggle");
    await expect(householdScopeToggle).toBeVisible();
    await expect(householdScopeToggle.getByRole("button")).toHaveCount(1);
    await expect(householdScopeToggle).toContainText("Combined");
    await expect(page.getByText(directDescription, { exact: true })).toBeVisible();
    await expect(page.getByText(sharedDescription, { exact: true })).toBeVisible();

    await page.locator(".context-block .pill-row").getByRole("button", { name: "Tim" }).click();
    await expect(page).toHaveURL(/view=person-tim/);
    await expect(page).toHaveURL(/entry_person=Tim/);
    await expect(page.locator(".panel-context")).toContainText("Viewing entries for Tim");

    const scopeToggle = page.locator(".desktop-scope-toggle");
    await expect(scopeToggle).toBeVisible();
    await expect(page.getByText(directDescription, { exact: true })).toBeVisible();
    await scopeToggle.getByRole("button", { name: "Shared", exact: true }).click();
    await expect(page).toHaveURL(/entries_scope=shared/);
    await expect(scopeToggle.getByRole("button", { name: "Shared", exact: true })).toHaveClass(/is-active/);
    await expect(page.getByText(sharedDescription, { exact: true })).toBeVisible();
    await expect(page.getByText(directDescription, { exact: true })).toHaveCount(0);

    await page.locator(".context-block .pill-row").getByRole("button", { name: "Household" }).click();
    await expect(page).toHaveURL(/view=household/);
    await expect(page).not.toHaveURL(/entry_person=/);
    await expect(page.locator(".panel-context")).toContainText("Viewing entries for Household");
    await expect(page.locator(".desktop-scope-toggle").getByRole("button")).toHaveCount(1);
    await expect(page.getByText(directDescription, { exact: true })).toBeVisible();
    await expect(page.getByText(sharedDescription, { exact: true })).toBeVisible();
  });

  test("mobile month page supports add and edit sheets plus category editing above the sheet", async ({ browser }) => {
    const context = await browser.newContext({ ...devices["iPhone 12 Pro"] });
    const page = await context.newPage();
    await page.goto("/");

    await page.goto("/month?view=person-tim&month=2026-04&scope=direct_plus_shared");

    await page.getByRole("button", { name: "+ Add budget bucket" }).click();
    const addSheet = page.locator('.entry-mobile-sheet[aria-label="+ Add budget bucket"]');
    await expect(addSheet).toBeVisible();
    await expect(addSheet.locator('input[value="Food & Drinks"]')).toBeVisible();

    await addSheet.getByRole("button", { name: "Edit Food & Drinks" }).click();
    await expect(page.getByText("Edit category")).toBeVisible();
    await expect(addSheet).toBeVisible();
    await page.keyboard.press("Escape");

    await addSheet.getByText("Last month's total:").click();
    await expect(page.getByText("Budget default")).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(addSheet).toHaveCount(0);

    await page.locator("tr").filter({ hasText: "Public Transport" }).first().click();
    const editSheet = page.locator('.entry-mobile-sheet[aria-label="Edit budget bucket"]');
    await expect(editSheet).toBeVisible();
    await expect(editSheet.locator('input[value="Public Transport"]')).toBeVisible();
    await expect(editSheet.locator('input[value="60.00"]')).toBeVisible();

    await page.getByRole("button", { name: "Done" }).click();
    await expect(editSheet).toHaveCount(0);

    await context.close();
  });

  test("mobile planned item matching uses the bottom sheet flow", async ({ browser }) => {
    const context = await browser.newContext({ ...devices["iPhone 12 Pro"] });
    const page = await context.newPage();
    await page.goto("/");

    const saveResult = await postJson(page, "/api/month-plan/save", {
      rowId: `mobile-plan-link-${Date.now()}`,
      month: "2026-04",
      sectionKey: "planned_items",
      categoryName: "Entertainment",
      label: "Mobile date night",
      planDate: "2026-04-18",
      accountName: "UOB One",
      plannedMinor: 5000,
      note: "Mobile matching flow.",
      ownershipType: "direct",
      ownerName: "Tim"
    });
    const rowId = saveResult.row?.id ?? saveResult.id ?? saveResult.rowId;
    expect(rowId).toBeTruthy();

    await postJson(page, "/api/entries/create", {
      date: "2026-04-18",
      description: "Mobile dinner charge",
      accountName: "UOB One",
      categoryName: "Entertainment",
      amountMinor: 1600,
      entryType: "expense",
      ownershipType: "direct",
      ownerName: "Tim"
    });

    await page.goto("/month?view=person-tim&month=2026-04&scope=direct_plus_shared");
    const row = page.locator("tr").filter({ hasText: "Mobile date night" }).first();
    await row.getByRole("button", { name: "Link entries" }).click();

    const sheet = page.locator('.entry-mobile-sheet[aria-label="Match planned item"]');
    await expect(sheet).toBeVisible();
    await expect(page.locator(".planned-link-dialog")).toHaveCount(0);
    await expect(sheet).toContainText("Mobile dinner charge");

    await sheet.getByRole("button", { name: "Same account" }).click();
    await expect(sheet).toContainText("Mobile dinner charge");
    await sheet.getByPlaceholder("Filter descriptions in this list").fill("zzz");
    await expect(sheet).toContainText("No matching expense entries fit the current filters.");

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(sheet).toHaveCount(0);

    await context.close();
  });

  test("mobile entries sticky context trigger switches view and scope and hides scope for household", async ({ browser }) => {
    const directDescription = `Playwright mobile direct ${Date.now()}`;
    const sharedDescription = `Playwright mobile shared ${Date.now()}`;

    const context = await browser.newContext({ ...devices["iPhone 12 Pro"] });
    const page = await context.newPage();
    await page.goto("/");
    await postJson(page, "/api/entries/create", {
      date: "2026-04-24",
      description: directDescription,
      accountName: "UOB One",
      categoryName: "Groceries",
      amountMinor: 4321,
      entryType: "expense",
      ownershipType: "direct",
      ownerName: "Tim"
    });
    await postJson(page, "/api/entries/create", {
      date: "2026-04-24",
      description: sharedDescription,
      accountName: "UOB One",
      categoryName: "Groceries",
      amountMinor: 1234,
      entryType: "expense",
      ownershipType: "shared",
      splitBasisPoints: 5000
    });
    await page.getByRole("link", { name: "Entries" }).click();

    const stickyBar = page.locator(".mobile-context-sticky-wrap");
    const trigger = stickyBar.locator(".mobile-context-trigger");
    await expect(stickyBar).toBeVisible();
    await expect(trigger).toContainText("Household");
    await expect(trigger).toContainText("View");
    await expect(trigger).not.toContainText("Direct");
    await expect(page.getByText(directDescription, { exact: true })).toBeVisible();
    await expect(page.getByText(sharedDescription, { exact: true })).toBeVisible();

    await trigger.click();
    const dialog = page.locator(".mobile-context-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('section[aria-label="Scope"]')).toHaveCount(0);

    await dialog.getByRole("button", { name: "Tim" }).click();
    await expect(page).toHaveURL(/view=person-tim/);
    await expect(page).toHaveURL(/entry_person=Tim/);
    await expect(dialog.locator('section[aria-label="Scope"]')).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Direct + Shared" })).toHaveClass(/is-active/);

    await dialog.getByRole("button", { name: "Shared", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/entries_scope=shared/);
    await expect(trigger).toContainText("Tim");
    await expect(trigger).toContainText("Shared");
    await expect(page.getByText(sharedDescription, { exact: true })).toBeVisible();
    await expect(page.getByText(directDescription, { exact: true })).toHaveCount(0);

    await trigger.click();
    const reopenedDialog = page.locator(".mobile-context-dialog");
    await expect(reopenedDialog).toBeVisible();
    await reopenedDialog.getByRole("button", { name: "Household" }).click();
    await expect(reopenedDialog).toHaveCount(0);
    await expect(page).toHaveURL(/view=household/);
    await expect(page).not.toHaveURL(/entry_person=/);
    await expect(trigger).toContainText("Household");
    await expect(trigger).not.toContainText("Shared");
    await expect(trigger).not.toContainText("Direct");
    await expect(page.getByText(directDescription, { exact: true })).toBeVisible();
    await expect(page.getByText(sharedDescription, { exact: true })).toBeVisible();

    await context.close();
  });

  test("desktop actual drilldown opens only the entries that make up a planned item's actual total", async ({ page }) => {
    const saveResult = await postJson(page, "/api/month-plan/save", {
      rowId: `actual-drilldown-${Date.now()}`,
      month: "2026-04",
      sectionKey: "planned_items",
      categoryName: "Entertainment",
      label: "Actual drilldown item",
      planDate: "2026-04-18",
      accountName: "UOB One",
      plannedMinor: 5000,
      note: "Actual drilldown coverage.",
      ownershipType: "direct",
      ownerName: "Tim"
    });
    const rowId = saveResult.row?.id ?? saveResult.id ?? saveResult.rowId;
    expect(rowId).toBeTruthy();

    const firstEntry = await postJson(page, "/api/entries/create", {
      date: "2026-04-18",
      description: "Actual drilldown dinner",
      accountName: "UOB One",
      categoryName: "Entertainment",
      amountMinor: 1100,
      entryType: "expense",
      ownershipType: "direct",
      ownerName: "Tim"
    });
    const secondEntry = await postJson(page, "/api/entries/create", {
      date: "2026-04-18",
      description: "Actual drilldown dessert",
      accountName: "UOB One",
      categoryName: "Entertainment",
      amountMinor: 400,
      entryType: "expense",
      ownershipType: "direct",
      ownerName: "Tim"
    });
    await postJson(page, "/api/entries/create", {
      date: "2026-04-18",
      description: "Actual drilldown unrelated",
      accountName: "UOB One",
      categoryName: "Entertainment",
      amountMinor: 900,
      entryType: "expense",
      ownershipType: "direct",
      ownerName: "Tim"
    });
    await postJson(page, "/api/month-plan/links", {
      rowId,
      month: "2026-04",
      transactionIds: [firstEntry.entryId, secondEntry.entryId]
    });

    await page.goto("/month?view=person-tim&month=2026-04&scope=direct_plus_shared");
    const row = page.locator("tr").filter({ hasText: "Actual drilldown item" }).first();
    await row.locator(".month-actual-drilldown").click();

    await expect(page).toHaveURL(/\/entries\?/);
    await expect(page).toHaveURL(/entry_id=/);
    await expect(page.getByText("Actual drilldown dinner")).toBeVisible();
    await expect(page.getByText("Actual drilldown dessert")).toBeVisible();
    await expect(page.getByText("Actual drilldown unrelated")).toHaveCount(0);
  });

  test("new direct ledger expense updates the matching budget bucket actual in direct and direct+shared scopes", async ({ page }) => {
    const beforeDirectMonth = await loadMonthPageData(page, { scope: "direct" });
    const beforeSharedMonth = await loadMonthPageData(page, { scope: "shared" });
    const beforeCombinedMonth = await loadMonthPageData(page, { scope: "direct_plus_shared" });

    await postJson(page, "/api/entries/create", {
      date: "2026-04-20",
      description: "Playwright month food expense",
      accountName: "UOB One",
      categoryName: "Food & Drinks",
      amountMinor: 1234,
      entryType: "expense",
      ownershipType: "direct",
      ownerName: "Tim"
    });

    const directMonth = await loadMonthPageData(page, { scope: "direct" });
    const sharedMonth = await loadMonthPageData(page, { scope: "shared" });
    const combinedMonth = await loadMonthPageData(page, { scope: "direct_plus_shared" });

    expect(findBudgetRow(directMonth, "Food").actualMinor).toBe(findBudgetRow(beforeDirectMonth, "Food").actualMinor + 1234);
    expect(findBudgetRow(sharedMonth, "Food").actualMinor).toBe(findBudgetRow(beforeSharedMonth, "Food").actualMinor);
    expect(findBudgetRow(combinedMonth, "Food").actualMinor).toBe(findBudgetRow(beforeCombinedMonth, "Food").actualMinor + 1234);
  });

  test("planned items stay at zero until linked, then absorb linked actuals and release the bucket total", async ({ page }) => {
    const rowId = `playwright-plan-${Date.now()}`;
    await postJson(page, "/api/month-plan/save", {
      rowId,
      month: "2026-04",
      sectionKey: "planned_items",
      categoryName: "Entertainment",
      label: "Playwright date night",
      planDate: "2026-04-18",
      accountName: "",
      plannedMinor: 5000,
      note: "Playwright planned item.",
      ownershipType: "direct",
      ownerName: "Tim"
    });

    const firstEntry = await postJson(page, "/api/entries/create", {
      date: "2026-04-18",
      description: "Playwright dinner charge",
      accountName: "UOB One",
      categoryName: "Entertainment",
      amountMinor: 1100,
      entryType: "expense",
      ownershipType: "direct",
      ownerName: "Tim"
    });

    const secondEntry = await postJson(page, "/api/entries/create", {
      date: "2026-04-19",
      description: "Playwright dessert charge",
      accountName: "UOB One",
      categoryName: "Entertainment",
      amountMinor: 400,
      entryType: "expense",
      ownershipType: "direct",
      ownerName: "Tim"
    });

    const beforeLink = await loadMonthPageData(page, { scope: "direct_plus_shared" });
    const beforeItem = beforeLink.monthPage.planSections
      .find((section) => section.key === "planned_items")
      .rows.find((row) => row.id === rowId);
    expect(beforeItem.actualMinor).toBe(0);
    const beforeBucketActualMinor = findBudgetRow(beforeLink, "Entertainment").actualMinor;

    await postJson(page, "/api/month-plan/links", {
      rowId,
      month: "2026-04",
      transactionIds: [firstEntry.entryId, secondEntry.entryId]
    });

    const afterLink = await loadMonthPageData(page, { scope: "direct_plus_shared" });
    const linkedItem = afterLink.monthPage.planSections
      .find((section) => section.key === "planned_items")
      .rows.find((row) => row.id === rowId);
    expect(linkedItem.actualMinor).toBe(1500);
    expect(linkedItem.linkedEntryCount).toBe(2);
    expect(findBudgetRow(afterLink, "Entertainment").actualMinor).toBe(beforeBucketActualMinor - 1500);
  });

  test("planned item match dialog supports lightweight filters and description filtering", async ({ page }) => {
    const rowId = `playwright-filter-plan-${Date.now()}`;
    await postJson(page, "/api/month-plan/save", {
      rowId,
      month: "2026-04",
      sectionKey: "planned_items",
      categoryName: "Entertainment",
      label: "Playwright date night",
      planDate: "2026-04-18",
      accountName: "",
      plannedMinor: 5000,
      note: "Filter dialog coverage.",
      ownershipType: "direct",
      ownerName: "Tim"
    });

    await postJson(page, "/api/entries/create", {
      date: "2026-04-18",
      description: "Playwright dinner charge",
      accountName: "UOB One",
      categoryName: "Entertainment",
      amountMinor: 1100,
      entryType: "expense",
      ownershipType: "direct",
      ownerName: "Tim"
    });

    await postJson(page, "/api/entries/create", {
      date: "2026-04-18",
      description: "Playwright dessert charge",
      accountName: "UOB One",
      categoryName: "Entertainment",
      amountMinor: 400,
      entryType: "expense",
      ownershipType: "direct",
      ownerName: "Tim"
    });

    await page.goto("/month?view=person-tim&month=2026-04&scope=direct_plus_shared");
    const row = page.locator("tr").filter({ hasText: "Playwright date night" }).first();
    await row.getByRole("button", { name: "Link entries" }).click();

    const dialog = page.locator(".planned-link-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Same category" })).toHaveClass(/is-active/);
    await expect(dialog.getByRole("button", { name: "This month only" })).toHaveClass(/is-active/);
    await expect(dialog.locator(".planned-link-row")).toHaveCount(2);

    await dialog.getByPlaceholder("Filter descriptions in this list").fill("dessert");
    await expect(dialog.locator(".planned-link-row")).toHaveCount(1);
    await expect(dialog).toContainText("Playwright dessert charge");

    await dialog.getByRole("button", { name: "Linked" }).click();
    await expect(dialog.locator(".planned-link-row")).toHaveCount(0);
  });

  test("planned item matcher keeps already linked entries visible even when default filters would hide them", async ({ page }) => {
    const saveResult = await postJson(page, "/api/month-plan/save", {
      rowId: `linked-visible-${Date.now()}`,
      month: "2026-04",
      sectionKey: "planned_items",
      categoryName: "Family & Personal",
      label: "Linked visibility item",
      planDate: "2026-04-01",
      accountName: "UOB One",
      plannedMinor: 26000,
      note: "Regression coverage for saved links.",
      ownershipType: "direct",
      ownerName: "Tim"
    });
    const rowId = saveResult.row?.id ?? saveResult.id ?? saveResult.rowId;
    expect(rowId).toBeTruthy();

    const linkedEntry = await postJson(page, "/api/entries/create", {
      date: "2026-04-01",
      description: "Linked visibility actual",
      accountName: "Citi Rewards",
      categoryName: "Subscriptions MO",
      amountMinor: 23407,
      entryType: "expense",
      ownershipType: "direct",
      ownerName: "Tim"
    });

    await postJson(page, "/api/month-plan/links", {
      rowId,
      month: "2026-04",
      transactionIds: [linkedEntry.entryId]
    });

    await page.goto("/month?view=person-tim&month=2026-04&scope=direct_plus_shared");
    const row = page.locator("tr").filter({ hasText: "Linked visibility item" }).first();
    await row.getByRole("button", { name: "1 linked" }).click();

    const dialog = page.locator(".planned-link-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Linked visibility actual");
    expect(await dialog.locator(".planned-link-row").count()).toBeGreaterThan(0);
  });

  test("planned item match dialog stays usable with a dense same-category ledger list", async ({ page }) => {
    const rowId = `playwright-dense-plan-${Date.now()}`;
    await postJson(page, "/api/month-plan/save", {
      rowId,
      month: "2026-04",
      sectionKey: "planned_items",
      categoryName: "Food & Drinks",
      label: "Playwright coffee beans",
      planDate: "2026-04-21",
      accountName: "UOB One",
      plannedMinor: 2400,
      note: "Dense candidate coverage.",
      ownershipType: "direct",
      ownerName: "Tim"
    });

    const linkedEntryIds = [];
    for (let index = 0; index < 50; index += 1) {
      const padded = String(index + 1).padStart(2, "0");
      const accountName = index < 25 ? "UOB One" : "Citi Rewards";
      const description = index < 25
        ? `Playwright oat latte ${padded}`
        : `Playwright dinner ${padded}`;
      const entry = await postJson(page, "/api/entries/create", {
        date: "2026-04-21",
        description,
        accountName,
        categoryName: "Food & Drinks",
        amountMinor: 400 + index,
        entryType: "expense",
        ownershipType: "direct",
        ownerName: "Tim"
      });
      if (index < 2) {
        linkedEntryIds.push(entry.entryId);
      }
    }

    await postJson(page, "/api/month-plan/links", {
      rowId,
      month: "2026-04",
      transactionIds: linkedEntryIds
    });

    await page.goto("/month?view=person-tim&month=2026-04&scope=direct_plus_shared");
    const row = page.locator("tr").filter({ hasText: "Playwright coffee beans" }).first();
    await row.getByRole("button", { name: /linked|Link entries/i }).click();

    const dialog = page.locator(".planned-link-dialog");
    await expect(dialog).toBeVisible();
    expect(await dialog.locator(".planned-link-row").count()).toBeGreaterThanOrEqual(50);
    await expect(dialog).toContainText("Playwright oat latte 01");
    await expect(dialog).toContainText("Playwright dinner 50");

    await dialog.getByRole("button", { name: "Same account" }).click();
    await expect(dialog).toContainText("Playwright oat latte 01");
    await expect(dialog.getByText("Playwright dinner 50")).toHaveCount(0);

    await dialog.getByPlaceholder("Filter descriptions in this list").fill("oat latte 07");
    await expect(dialog.locator(".planned-link-row")).toHaveCount(1);
    await expect(dialog).toContainText("Playwright oat latte 07");

    await dialog.getByPlaceholder("Filter descriptions in this list").fill("");
    await dialog.getByRole("button", { name: "Same account" }).click();
    await dialog.getByRole("button", { name: "Linked" }).click();
    await expect(dialog.locator(".planned-link-row")).toHaveCount(2);
    await expect(dialog).toContainText("Playwright oat latte 01");
    await expect(dialog).toContainText("Playwright oat latte 02");
  });

  test("offsetting income reduces the matching budget bucket actual", async ({ page }) => {
    const beforeMonthData = await loadMonthPageData(page, { scope: "direct_plus_shared" });

    await postJson(page, "/api/entries/create", {
      date: "2026-04-22",
      description: "Playwright groceries charge",
      accountName: "UOB One",
      categoryName: "Groceries",
      amountMinor: 2000,
      entryType: "expense",
      ownershipType: "direct",
      ownerName: "Tim"
    });

    await postJson(page, "/api/entries/create", {
      date: "2026-04-23",
      description: "Playwright grocery reimbursement",
      accountName: "UOB One",
      categoryName: "Groceries",
      amountMinor: 500,
      entryType: "income",
      ownershipType: "direct",
      ownerName: "Tim",
      offsetsCategory: true
    });

    const monthData = await loadMonthPageData(page, { scope: "direct_plus_shared" });
    expect(findBudgetRow(monthData, "Groceries").actualMinor).toBe(findBudgetRow(beforeMonthData, "Groceries").actualMinor + 1500);
  });

  test("mobile month edit sheet can open the contributing entries behind actual totals", async ({ browser }) => {
    const context = await browser.newContext({ ...devices["iPhone 12 Pro"] });
    const page = await context.newPage();
    await page.goto("/");

    const saveResult = await postJson(page, "/api/month-plan/save", {
      rowId: `mobile-actual-${Date.now()}`,
      month: "2026-04",
      sectionKey: "planned_items",
      categoryName: "Entertainment",
      label: "Mobile actual drilldown",
      planDate: "2026-04-18",
      accountName: "UOB One",
      plannedMinor: 3000,
      note: "Mobile actual drilldown coverage.",
      ownershipType: "direct",
      ownerName: "Tim"
    });
    const rowId = saveResult.row?.id ?? saveResult.id ?? saveResult.rowId;
    expect(rowId).toBeTruthy();

    const entry = await postJson(page, "/api/entries/create", {
      date: "2026-04-18",
      description: "Mobile actual entry",
      accountName: "UOB One",
      categoryName: "Entertainment",
      amountMinor: 1500,
      entryType: "expense",
      ownershipType: "direct",
      ownerName: "Tim"
    });
    await postJson(page, "/api/month-plan/links", {
      rowId,
      month: "2026-04",
      transactionIds: [entry.entryId]
    });

    await page.goto("/month?view=person-tim&month=2026-04&scope=direct_plus_shared");
    await page.locator("tr").filter({ hasText: "Mobile actual drilldown" }).first().click();
    const sheet = page.locator('.entry-mobile-sheet[aria-label="Edit planned item"]');
    await expect(sheet).toBeVisible();
    await sheet.locator(".month-actual-drilldown-mobile").click();

    await expect(page).toHaveURL(/\/entries\?/);
    await expect(page.getByText("Mobile actual entry")).toBeVisible();
    await context.close();
  });
});
