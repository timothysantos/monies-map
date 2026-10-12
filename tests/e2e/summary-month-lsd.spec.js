import { devices, expect, test } from "@playwright/test";

import { gotoPageAfterApi, loadMonthPage, loadSummaryPage, postJson, reseedDemo } from "./helpers";

// The Month top and Summary's Intent vs Outcome in the Lead · Support · Detail
// language (design.md). Month: one lead card (the month's actual spend
// against planned spend, with a bar) and Support pills for income, savings
// and remaining budget, in place of the six sideways-scrolling tiles.
// Intent vs Outcome: each month a compact card whose lead is its spend
// against plan, its income as chips and its metric rows folded under
// "Details". Every figure must equal the page DTO's own numbers, every
// drill-through must still work, nothing may scroll sideways at 390 px, and
// hidden money must show dots in plain ink with no over or under words.

const VIEW = "person-tim";
const MONTH = "2026-05";
const RANGE = { start: "2025-06", end: MONTH };
const MONTH_URL = `/month?view=${VIEW}&month=${MONTH}&scope=direct_plus_shared&summary_start=${RANGE.start}&summary_end=${RANGE.end}`;
const SUMMARY_URL = `/summary?view=${VIEW}&month=${MONTH}&scope=direct_plus_shared&summary_start=${RANGE.start}&summary_end=${RANGE.end}`;
const INK = { in: "rgb(23, 104, 74)", short: "rgb(163, 53, 42)", plan: "rgb(47, 91, 134)", text: "rgb(38, 35, 31)", muted: "rgb(115, 111, 105)" };
const SIGN_WORDING = /\b(To allocate|Overplanned|over plan|under plan|% of plan)\b|[-−]\s?••••/;
const money = (minor) => new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" }).format(minor / 100);
const monthLabel = (month) => new Intl.DateTimeFormat("en-SG", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
// The phone the owner tests on; `npm run test:e2e:webkit` runs it in WebKit.
const { defaultBrowserType: _browser, ...iPhone13 } = devices["iPhone 13"];

function colour(locator) {
  return locator.evaluate((element) => getComputedStyle(element).color);
}

function box(locator) {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, right: rect.right, bottom: rect.bottom };
  });
}

// Nothing in the page or inside `selector` is wider than its box, and no
// element there is a sideways scroll container.
async function expectNoSidewaysScroll(page, selector) {
  const result = await page.evaluate((root) => {
    const scope = document.querySelector(root);
    const scrollers = scope ? [...scope.querySelectorAll("*")].filter((element) => {
      const style = getComputedStyle(element);
      return /(auto|scroll)/.test(style.overflowX) && element.scrollWidth > element.clientWidth + 1;
    }).map((element) => element.className) : ["missing"];
    return { viewport: window.innerWidth, document: document.documentElement.scrollWidth, scope: scope ? scope.scrollWidth - scope.clientWidth : -1, scrollers };
  }, selector);
  expect(result.document, "page width").toBeLessThanOrEqual(result.viewport + 1);
  expect(result.scope, `${selector} overflow`).toBeLessThanOrEqual(1);
  expect(result.scrollers, `${selector} sideways scrollers`).toEqual([]);
}

// What the Month lead must show, from the Month page DTO: the plan rows and
// their metric cards, and the month's own Summary rollup for income and
// savings.
async function expectedMonthFigures(page) {
  const data = await loadMonthPage(page, { view: VIEW, month: MONTH });
  const card = (label) => data.monthPage.metricCards.find((item) => item.label === label).amountMinor;
  const summaryMonth = data.summaryPage.months[0];
  const plannedIncome = data.monthPage.incomeRows.reduce((sum, row) => sum + row.plannedMinor, 0);
  const planned = card("Planned spend");
  const actual = card("Actual spend");
  return {
    planned,
    actual,
    percent: Math.round((actual / planned) * 100),
    gap: planned - actual,
    savingsTarget: card("Savings target"),
    plannedIncome,
    actualIncome: summaryMonth.actualIncomeMinor,
    saved: summaryMonth.realizedSavingsMinor,
    remaining: plannedIncome - planned
  };
}

// The plan sections run edge to edge on a phone (the stack around them is
// narrower by design), so each section is what must fit.
async function expectPlanSectionsFit(page) {
  for (const selector of [".month-plan-section-income", ".month-plan-section-budgets", ".month-plan-section-planned"]) {
    await expectNoSidewaysScroll(page, selector);
  }
}

async function openMonth(page) {
  await gotoPageAfterApi(page, MONTH_URL, "/api/month-page", () => page.locator(".month-lead"));
}

async function openSummary(page) {
  await gotoPageAfterApi(page, SUMMARY_URL, "/api/summary-page", () => page.locator(".summary-intent-month").first());
}

async function expectMonthLeadFigures(page) {
  const figures = await expectedMonthFigures(page);
  expect(figures.planned, "the fixture month has a plan").toBeGreaterThan(0);
  expect(figures.actualIncome, "the salary this test records").toBeGreaterThan(0);
  await openMonth(page);
  const lead = page.locator(".month-lead");
  await expect(lead.locator(".lsd-eyebrow")).toHaveText(`Spent · ${monthLabel(MONTH)}`);
  await expect(lead.locator(".summary-lead-spent")).toHaveText(money(figures.actual));
  await expect(lead.locator(".summary-lead-plan")).toHaveText(`of ${money(figures.planned)} plan`);
  await expect(lead.locator(".lsd-progress-line")).toHaveText(
    `${figures.percent}% of plan${money(Math.abs(figures.gap))} ${figures.gap >= 0 ? "under plan" : "over plan"}`
  );
  const pill = (metric) => page.locator(`.month-lead-group .summary-support-pill[data-metric="${metric}"]`);
  await expect(pill("income").locator("strong")).toHaveText(money(figures.actualIncome));
  await expect(pill("income").locator("small")).toHaveText(`plan ${money(figures.plannedIncome)}`);
  await expect(pill("saved").locator("strong")).toHaveText(money(figures.saved));
  await expect(pill("saved").locator("small")).toHaveText(`target ${money(figures.savingsTarget)}`);
  await expect(pill("remaining").locator(".summary-support-pill-label")).toHaveText("Remaining budget");
  await expect(pill("remaining").locator("strong")).toHaveText(money(figures.remaining));
  await expect(pill("remaining").locator("small")).toHaveText(figures.remaining >= 0 ? "To allocate" : "Overplanned");
  // The six tiles are gone; their figures are all above.
  await expect(page.locator(".month-panel .metric")).toHaveCount(0);
  return figures;
}

// Remaining budget keeps its explanation: a tap on the pill opens it.
async function expectRemainingExplains(page, figures) {
  await page.locator('.month-lead-group .summary-support-pill[data-metric="remaining"]').click();
  await expect(page.locator(".metric-detail-popover")).toContainText(
    figures.remaining >= 0 ? "Money is still unassigned" : "Planned spend is higher than planned income"
  );
  await page.keyboard.press("Escape");
  await expect(page.locator(".metric-detail-popover")).toHaveCount(0);
}

async function expectIntentCards(page) {
  const data = await loadSummaryPage(page, { view: VIEW, month: MONTH, summaryStart: RANGE.start, summaryEnd: RANGE.end });
  const months = [...data.summaryPage.months].sort((left, right) => right.month.localeCompare(left.month));
  expect(months.length, "the range has months").toBeGreaterThan(1);
  await openSummary(page);
  const cards = page.locator(".summary-intent-month");
  await expect(cards).toHaveCount(months.length);

  for (const [index, month] of months.entries()) {
    const cardLocator = cards.nth(index);
    const headroom = month.estimatedExpensesMinor - month.realExpensesMinor;
    await expect(cardLocator.locator(".summary-month-link")).toHaveText(monthLabel(month.month));
    await expect(cardLocator.locator(".summary-intent-spent")).toHaveText(money(month.realExpensesMinor));
    await expect(cardLocator.locator(".summary-intent-plan")).toHaveText(`of ${money(month.estimatedExpensesMinor)} plan`);
    if (month.estimatedExpensesMinor > 0) {
      await expect(cardLocator.locator(".lsd-progress-line")).toHaveText(
        `${Math.round((month.realExpensesMinor / month.estimatedExpensesMinor) * 100)}% of plan${money(Math.abs(headroom))} ${headroom >= 0 ? "under plan" : "over plan"}`
      );
    }
    await expect(cardLocator.locator(".lsd-chip")).toHaveText([
      `Planned income ${money(month.plannedIncomeMinor)}`,
      `Actual income ${money(month.actualIncomeMinor)}`
    ]);
    // The latest month's details are open, as today; the others fold.
    const details = cardLocator.getByRole("button", { name: /^Details/ });
    await expect(details).toHaveAttribute("aria-expanded", index === 0 ? "true" : "false");
  }

  // The latest month's rows carry the old table's figures.
  const latest = months[0];
  const row = (metric) => cards.first().locator(`.summary-intent-metric[data-metric="${metric}"]`);
  const figuresOf = (metric) => row(metric).locator("dd");
  await expect(figuresOf("income")).toHaveText([money(latest.plannedIncomeMinor), money(latest.actualIncomeMinor), money(latest.actualIncomeMinor - latest.plannedIncomeMinor)]);
  await expect(figuresOf("spend")).toHaveText([money(latest.estimatedExpensesMinor), money(latest.realExpensesMinor), money(latest.estimatedExpensesMinor - latest.realExpensesMinor)]);
  await expect(figuresOf("savings")).toHaveText([money(latest.savingsGoalMinor), money(latest.realizedSavingsMinor), money(latest.realizedSavingsMinor - latest.savingsGoalMinor)]);
  await expect(row("income").locator(".lsd-row-label")).toHaveText("Income");
  await expect(row("spend").locator(".lsd-row-label")).toHaveText("Expected spend");
  await expect(row("savings").locator(".lsd-row-label")).toHaveText("Savings goal");

  // A folded month opens on a tap and shows its own rows.
  const second = cards.nth(1);
  await expect(second.locator(".summary-intent-metric")).toHaveCount(0);
  await second.getByRole("button", { name: /^Details/ }).click();
  await expect(second.getByRole("button", { name: /^Details/ })).toHaveAttribute("aria-expanded", "true");
  await expect(second.locator('.summary-intent-metric[data-metric="spend"] dd').nth(1)).toHaveText(money(months[1].realExpensesMinor));
  return months;
}

async function recordSalary(page) {
  await postJson(page, "/api/entries/create", {
    date: `${MONTH}-25`,
    description: "Lead salary",
    accountName: "UOB One",
    categoryName: "Salary",
    amountMinor: 650_000,
    entryType: "income",
    ownershipType: "direct",
    ownerName: "Tim"
  });
}

async function revealMoney(page) {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
}

test.describe("phone", { tag: "@webkit" }, () => {
  test.use(iPhone13);

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await reseedDemo(page);
    await recordSalary(page);
  });

  test("Month top: one lead card with the DTO's figures, Support pills under it, nothing scrolls sideways", async ({ page }) => {
    await revealMoney(page);
    const figures = await expectMonthLeadFigures(page);
    const lead = await box(page.locator(".month-lead"));
    const income = await box(page.locator('.month-lead-group [data-metric="income"]'));
    const remaining = await box(page.locator('.month-lead-group [data-metric="remaining"]'));
    expect(lead.width).toBeGreaterThan(390 - 2 * 24);
    expect(income.y).toBeGreaterThan(lead.bottom);
    expect(remaining.right).toBeLessThanOrEqual(390);
    await expectNoSidewaysScroll(page, ".month-lead-group");
    await expectRemainingExplains(page, figures);
  });

  test("Intent vs Outcome: compact month cards with the DTO's figures, Details folds, the month link opens the month", async ({ page }) => {
    await revealMoney(page);
    const months = await expectIntentCards(page);
    await expectNoSidewaysScroll(page, ".summary-intent");
    // The Summary top keeps no sideways tile row either.
    await expectNoSidewaysScroll(page, ".summary-head");

    // Drill-through: the month name opens that month.
    const target = months[1].month;
    await page.locator(".summary-intent-month").nth(1).locator(".summary-month-link").click();
    await expect(page).toHaveURL(new RegExp(`/month\\?.*month=${target}`));
    await expect(page.locator(".month-lead .lsd-eyebrow")).toHaveText(`Spent · ${monthLabel(target)}`);
  });

  test("plan rows are compact cards: the DTO's figures, a bar each, nothing scrolls sideways, a tap opens the sheet", async ({ page }) => {
    await revealMoney(page);
    await openMonth(page);
    const data = await loadMonthPage(page, { view: VIEW, month: MONTH });
    const budgets = data.monthPage.planSections.find((section) => section.key === "budget_buckets").rows;
    expect(budgets.length, "the fixture month has budget buckets").toBeGreaterThan(0);
    await expectPlanSectionsFit(page);
    const rows = page.locator(".month-plan-section-budgets tbody tr:not(.month-inline-action-row)");
    await expect(rows).toHaveCount(budgets.length);
    const first = budgets[0];
    const row = rows.filter({ hasText: first.label }).first();
    await expect(row.locator(".month-actual-drilldown")).toHaveText(money(first.actualMinor));
    await expect(row.locator(".month-cell-planned")).toHaveText(money(first.plannedMinor));
    await expect(row.locator(".month-row-bar")).toBeVisible();
    const widthPercent = await row.locator(".lsd-bar-fill").evaluate((fill) => Math.round((fill.getBoundingClientRect().width / fill.parentElement.getBoundingClientRect().width) * 100));
    expect(Math.abs(widthPercent - Math.min(100, Math.round((first.actualMinor / first.plannedMinor) * 100)))).toBeLessThanOrEqual(2);
    const rowBox = await box(row);
    expect(rowBox.right).toBeLessThanOrEqual(390);
    expect(await row.locator(".month-cell-item").evaluate((cell) => cell.getBoundingClientRect().height)).toBeGreaterThan(0);
    // The strip of column names still sorts.
    await expect(page.locator(".month-plan-section-budgets thead th:visible")).toHaveCount(5);
    // A tap on the row opens the plan card sheet.
    await row.locator(".month-cell-item").click();
    await expect(page.locator(".entry-mobile-sheet")).toBeVisible();
  });

  test("hidden money: plan rows keep only the bar's track", async ({ page }) => {
    await openMonth(page);
    const rows = page.locator(".month-plan-section-budgets tbody tr:not(.month-inline-action-row)");
    await expect(rows.first().locator(".month-row-bar")).toBeVisible();
    await expect(page.locator(".month-plan-section .lsd-bar-fill")).toHaveCount(0);
    await expect(rows.first().locator(".month-actual-drilldown")).toHaveText("••••");
    await expectPlanSectionsFit(page);
  });

  test("hidden money: dots in plain ink, the bars' track only, no over or under words", async ({ page }) => {
    await openMonth(page);
    const lead = page.locator(".month-lead");
    await expect(lead.locator(".summary-lead-spent")).toHaveText("••••");
    expect(await colour(lead.locator(".summary-lead-spent .private-money"))).toBe(INK.text);
    await expect(lead.locator(".lsd-bar")).toBeVisible();
    await expect(lead.locator(".lsd-bar-fill")).toHaveCount(0);
    await expect(lead.locator(".lsd-progress-line")).toHaveCount(0);
    for (const metric of ["income", "saved", "remaining"]) {
      const pill = page.locator(`.month-lead-group [data-metric="${metric}"]`);
      await expect(pill.locator("strong")).toHaveText("••••");
      expect(await colour(pill.locator("strong .private-money")), metric).toBe(INK.text);
    }
    expect(await page.locator(".month-lead-group").innerText()).not.toMatch(SIGN_WORDING);

    await openSummary(page);
    const first = page.locator(".summary-intent-month").first();
    await expect(first.locator(".summary-intent-spent")).toHaveText("••••");
    expect(await colour(first.locator(".summary-intent-spent .private-money"))).toBe(INK.text);
    await expect(first.locator(".lsd-bar-fill")).toHaveCount(0);
    for (const value of await first.locator(".summary-intent-metric dd").all()) {
      await expect(value).toHaveText("••••");
      expect([INK.text, INK.muted]).toContain(await colour(value));
    }
    expect(await page.locator(".summary-intent").innerText()).not.toMatch(SIGN_WORDING);
    await expectNoSidewaysScroll(page, ".summary-intent");
  });
});

test.describe("desktop", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await reseedDemo(page);
    await recordSalary(page);
  });

  test("Month top: the lead with the pills in a column to its right, the plan sky, under plan mint", async ({ page }) => {
    await revealMoney(page);
    const figures = await expectMonthLeadFigures(page);
    const lead = await box(page.locator(".month-lead"));
    const income = await box(page.locator('.month-lead-group [data-metric="income"]'));
    const saved = await box(page.locator('.month-lead-group [data-metric="saved"]'));
    expect(income.x).toBeGreaterThan(lead.right);
    expect(saved.x).toBe(income.x);
    expect(saved.y).toBeGreaterThan(income.bottom);
    expect(await colour(page.locator(".month-lead .summary-lead-plan"))).toBe(INK.plan);
    const isOver = figures.actual > figures.planned;
    expect(await colour(page.locator(".month-lead .summary-lead-spent .private-money"))).toBe(isOver ? INK.short : INK.text);
    expect(await colour(page.locator(".month-lead .summary-lead-headroom"))).toBe(isOver ? INK.short : INK.in);
    expect(await page.locator(".month-lead .lsd-bar-fill").getAttribute("class")).toContain(isOver ? "money-short" : "money-neutral");
    await expectRemainingExplains(page, figures);
  });

  test("plan tables keep their columns and add a thin bar under each actual", async ({ page }) => {
    await revealMoney(page);
    await openMonth(page);
    const data = await loadMonthPage(page, { view: VIEW, month: MONTH });
    const budgets = data.monthPage.planSections.find((section) => section.key === "budget_buckets").rows;
    const rows = page.locator(".month-plan-section-budgets tbody tr:not(.month-inline-action-row)");
    await expect(rows).toHaveCount(budgets.length);
    await expect(page.locator(".month-plan-section-budgets thead th")).toHaveCount(6);
    const row = rows.filter({ hasText: budgets[0].label }).first();
    await expect(row.locator(".month-row-bar")).toBeVisible();
    // Money columns are right-aligned; the item is the heaviest text.
    expect(await row.locator(".month-cell-planned").evaluate((cell) => getComputedStyle(cell).textAlign)).toBe("right");
    expect(Number(await row.locator(".month-cell-item").evaluate((cell) => getComputedStyle(cell).fontWeight))).toBeGreaterThanOrEqual(600);
    await expect(row.locator(".month-actual-drilldown")).toHaveText(money(budgets[0].actualMinor));
  });

  test("Intent vs Outcome: the same cards, the note row edits the month note", async ({ page }) => {
    await revealMoney(page);
    await expectIntentCards(page);
    await expectNoSidewaysScroll(page, ".summary-intent");
    await page.locator(".summary-intent-month").first().locator(".summary-note-trigger").click();
    await expect(page.locator(".note-dialog-content")).toBeVisible();
  });
});
