import { expect, test, devices } from "@playwright/test";

function formatMoney(minor) {
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: "SGD"
  }).format(minor / 100);
}

async function reseedDemo(page) {
  const response = await page.request.post("/api/demo/reseed");
  expect(response.ok(), await response.text()).toBeTruthy();
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
  const response = await page.request.post(path, {
    data: body
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
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
  await row.click();
  await expect(row.getByRole("button", { name: "Save" })).toBeVisible();
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

    await publicTransportRow.click();
    await expect(publicTransportRow.getByRole("button", { name: "Save" })).toBeVisible();
    await expect(publicTransportRow.getByRole("button", { name: "Cancel" })).toBeVisible();
    await expect(publicTransportRow.getByText("Delete")).toBeVisible();

    await publicTransportRow.getByRole("button", { name: "Cancel" }).click();
    await expect(publicTransportRow.getByText("Delete")).toHaveCount(0);

    for (const [label, plannedMinor] of expectedPlannedValues.entries()) {
      const row = page.locator("tr").filter({ hasText: label }).first();
      await expect(row).toContainText(formatMoney(plannedMinor));
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
    await row.getByRole("button", { name: "Save" }).click();
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

  test("mobile month page supports add and edit sheets plus category editing above the sheet", async ({ browser }) => {
    const context = await browser.newContext({ ...devices["iPhone 12 Pro"] });
    const page = await context.newPage();
    await page.goto("/");
    await reseedDemo(page);

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
    await reseedDemo(page);

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
    await expect(sheet).toContainText("Showing 1 of 1 candidate entries.");
    await expect(sheet).toContainText("Mobile dinner charge");

    await sheet.getByRole("button", { name: "Same account" }).click();
    await expect(sheet).toContainText("Showing 1 of 1 candidate entries.");
    await sheet.getByPlaceholder("Filter descriptions in this list").fill("zzz");
    await expect(sheet).toContainText("No matching expense entries fit the current filters.");

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(sheet).toHaveCount(0);

    await context.close();
  });

  test("new direct ledger expense updates the matching budget bucket actual in direct and direct+shared scopes", async ({ page }) => {
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

    expect(findBudgetRow(directMonth, "Food").actualMinor).toBe(1234);
    expect(findBudgetRow(sharedMonth, "Food").actualMinor).toBe(0);
    expect(findBudgetRow(combinedMonth, "Food").actualMinor).toBe(1234);
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
    expect(findBudgetRow(beforeLink, "Entertainment").actualMinor).toBe(1500);

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
    expect(findBudgetRow(afterLink, "Entertainment").actualMinor).toBe(0);
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
    await expect(dialog.locator(".planned-link-row")).toHaveCount(50);
    await expect(dialog.getByText("Showing 50 of 50 candidate entries.")).toBeVisible();

    await dialog.getByRole("button", { name: "Same account" }).click();
    await expect(dialog.locator(".planned-link-row")).toHaveCount(25);
    await expect(dialog.getByText("Showing 25 of 50 candidate entries.")).toBeVisible();

    await dialog.getByPlaceholder("Filter descriptions in this list").fill("oat latte 07");
    await expect(dialog.locator(".planned-link-row")).toHaveCount(1);
    await expect(dialog).toContainText("Playwright oat latte 07");
    await expect(dialog.getByText("Showing 1 of 50 candidate entries.")).toBeVisible();

    await dialog.getByPlaceholder("Filter descriptions in this list").fill("");
    await dialog.getByRole("button", { name: "Same account" }).click();
    await dialog.getByRole("button", { name: "Linked" }).click();
    await expect(dialog.locator(".planned-link-row")).toHaveCount(2);
    await expect(dialog.getByText("Showing 2 of 50 candidate entries.")).toBeVisible();
    await expect(dialog).toContainText("Playwright oat latte 01");
    await expect(dialog).toContainText("Playwright oat latte 02");
  });

  test("offsetting income reduces the matching budget bucket actual", async ({ page }) => {
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
    expect(findBudgetRow(monthData, "Groceries").actualMinor).toBe(1500);
  });
});
