import { expect, test } from "@playwright/test";
const currencyFormatter = new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" });

function findView(data, id) {
  const view = data.views.find((item) => item.id === id);
  if (!view) {
    throw new Error(`View not found: ${id}`);
  }
  return view;
}

function findSummaryMonth(view, month) {
  const item = view.summaryPage.months.find((row) => row.month === month);
  if (!item) {
    throw new Error(`Summary month not found: ${month}`);
  }
  return item;
}

function findBudgetBucketActual(view, categoryName) {
  const section = view.monthPage.planSections.find((item) => item.key === "budget_buckets");
  if (!section) {
    throw new Error("Budget buckets section not found");
  }

  const row = section.rows.find((item) => item.categoryName === categoryName);
  if (!row) {
    throw new Error(`Budget bucket not found: ${categoryName}`);
  }

  return row.actualMinor;
}

function findDonutMonthValue(view, month, categoryName) {
  const donutMonth = view.summaryPage.categoryShareByMonth.find((item) => item.month === month);
  if (!donutMonth) {
    throw new Error(`Donut month not found: ${month}`);
  }

  const entry = donutMonth.data.find((item) => item.label === categoryName);
  if (!entry) {
    return 0;
  }

  return entry.valueMinor;
}

async function reseedDemo(page) {
  const result = await page.evaluate(async () => {
    const response = await fetch("/api/demo/reseed", { method: "POST" });
    return { ok: response.ok, status: response.status, text: await response.text() };
  });
  expect(result.ok, result.text).toBeTruthy();
}

async function loadBootstrap(page, { month = "2025-10", scope = "direct_plus_shared" } = {}) {
  return page.evaluate(async ({ month, scope }) => {
    const response = await fetch(`/api/bootstrap?month=${month}&scope=${scope}`);
    if (!response.ok) {
      throw new Error(`Bootstrap failed: ${response.status}`);
    }
    return response.json();
  }, { month, scope });
}

function formatMoney(minor) {
  return currencyFormatter.format(minor / 100);
}

test.describe("import flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await reseedDemo(page);
  });

  test("preview flags unknown accounts from the CSV input", async ({ page }) => {
    await page.goto("/imports?view=person-tim&month=2025-10");

    await page.getByLabel("CSV content").fill(
      [
        "date,description,amount,account,category,note",
        "2025-10-08,Playwright unknown account,-42.00,Imaginary Wallet,Food & Drinks,Should require account mapping."
      ].join("\n")
    );

    await page.getByRole("button", { name: "Preview import" }).click();

    await expect(page.getByText("Unknown accounts need mapping before commit.")).toBeVisible();
    await expect(page.locator(".import-warning .pill.warning").filter({ hasText: "Imaginary Wallet" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Commit import" })).toBeEnabled();
  });

  test("imported row can be edited and rolls through entries, month, and summary", async ({ page }) => {
    const before = await loadBootstrap(page);
    const beforeView = findView(before, "person-tim");
    const beforeMonth = findSummaryMonth(beforeView, "2025-10");
    const beforeFoodActual = findBudgetBucketActual(beforeView, "Food & Drinks");
    const beforeGroceriesActual = findBudgetBucketActual(beforeView, "Groceries");
    const beforeFoodDonut = findDonutMonthValue(beforeView, "2025-10", "Food & Drinks");

    await page.goto("/imports?view=person-tim&month=2025-10");

    await page.getByLabel("Source label").fill("Playwright import");
    await page.getByLabel("CSV content").fill(
      [
        "category,account,note,amount,date,description",
        "Groceries,UOB One,Playwright import row,-111.11,2025-10-17,Playwright groceries import"
      ].join("\n")
    );

    await page.getByRole("button", { name: "Preview import" }).click();
    await expect(page.locator('.import-preview-table input[value="Playwright groceries import"]')).toBeVisible();
    await expect(page.getByRole("button", { name: "Commit import" })).toBeEnabled();
    await page.getByRole("button", { name: "Commit import" }).click();

    await page.goto("/entries?view=person-tim&month=2025-10");
    const entryRow = page.locator(".entry-row").filter({ hasText: "Playwright groceries import" }).first();
    await expect(entryRow.locator(".entry-row-description strong").filter({ hasText: "Playwright groceries import" })).toBeVisible();
    await entryRow.locator(".entry-row-main").click();
    await entryRow.getByLabel("Category").selectOption("Food & Drinks");
    await entryRow.getByRole("button", { name: "Done editing entry" }).click();

    await expect(entryRow.locator(".entry-row-description strong").filter({ hasText: "Playwright groceries import" })).toBeVisible();

    const after = await loadBootstrap(page);
    const afterView = findView(after, "person-tim");
    const afterMonth = findSummaryMonth(afterView, "2025-10");
    const afterFoodActual = findBudgetBucketActual(afterView, "Food & Drinks");
    const afterGroceriesActual = findBudgetBucketActual(afterView, "Groceries");
    const afterFoodDonut = findDonutMonthValue(afterView, "2025-10", "Food & Drinks");
    const afterActualSpend = afterView.monthPage.metricCards.find((item) => item.label === "Actual spend")?.amountMinor ?? 0;

    expect(afterActualSpend).toBe(
      (beforeView.monthPage.metricCards.find((item) => item.label === "Actual spend")?.amountMinor ?? 0) + 11_111
    );
    expect(afterMonth.realExpensesMinor).toBe(beforeMonth.realExpensesMinor + 11_111);
    expect(afterFoodActual).toBe(beforeFoodActual + 11_111);
    expect(afterGroceriesActual).toBe(beforeGroceriesActual);
    expect(afterFoodDonut).toBe(beforeFoodDonut + 11_111);

    await page.goto("/month?view=person-tim&month=2025-10");
    await expect(page.getByText(formatMoney(afterActualSpend))).toBeVisible();

    await page.goto("/summary?view=person-tim&month=2025-10");
    await expect(page.getByRole("button", { name: "Oct 2025" })).toBeVisible();
    await expect(page.getByText(formatMoney(afterMonth.realExpensesMinor))).toBeVisible();
  });

  test("summary and month stay aligned across tabs after persisted changes", async ({ browser, page }) => {
    const context = page.context();
    const summaryPage = page;
    const importsPage = await context.newPage();
    const monthPage = await context.newPage();

    await summaryPage.goto("/summary?view=person-tim&month=2025-10&summary_focus=2025-10");
    await monthPage.goto("/month?view=person-tim&month=2025-10");
    await importsPage.goto("/imports?view=person-tim&month=2025-10");

    const before = await loadBootstrap(summaryPage);
    const beforeView = findView(before, "person-tim");
    const beforeMonth = findSummaryMonth(beforeView, "2025-10");
    const expectedAfterActual = beforeMonth.realExpensesMinor + 22_22;

    await importsPage.getByLabel("Source label").fill("Cross-tab sync import");
    await importsPage.getByLabel("CSV content").fill(
      [
        "date,description,amount,account,category,note",
        "2025-10-18,Cross-tab sync groceries,-22.22,UOB One,Groceries,Should refresh summary and month."
      ].join("\n")
    );

    await importsPage.getByRole("button", { name: "Preview import" }).click();
    await importsPage.getByRole("button", { name: "Commit import" }).click();

    const expectedLabel = formatMoney(expectedAfterActual);
    await expect(summaryPage.getByText(expectedLabel)).toBeVisible({ timeout: 10000 });
    await expect(monthPage.getByText(expectedLabel)).toBeVisible({ timeout: 10000 });

    const after = await loadBootstrap(summaryPage);
    const afterView = findView(after, "person-tim");
    const afterMonth = findSummaryMonth(afterView, "2025-10");
    const monthActualCard = afterView.monthPage.metricCards.find((item) => item.label === "Actual spend");

    expect(afterMonth.realExpensesMinor).toBe(expectedAfterActual);
    expect(monthActualCard?.amountMinor).toBe(expectedAfterActual);

    await importsPage.close();
    await monthPage.close();
  });
});
