import { devices, expect, test } from "@playwright/test";

import { loadMonthPage, loadSummaryPage, postJson, reseedDemo } from "./helpers";

// Money jobs (design.md "Money jobs"; DOMAIN.md "Money job"): the savings bar
// says what was invested as its own plum part, the lead's Detail says which
// of the plan's jobs (spend within the budget, save the target, invest the
// goal, the planned income) were done, and a bar part or a job opens a menu:
// "View entries" (Entries filtered to the money behind it) and "Ask about
// this" (Ask with a question in the message box). Every expected figure is
// worked out here from the page DTOs, not by the model under test (its
// exact numbers are in tests/money-jobs-model.test.mjs and
// tests/savings-bar-model.test.mjs).

const VIEW = "person-tim";
const MONTH = "2026-05";
const MONTH_WORDS = "May 2026";
const RANGE = { start: "2025-06", end: MONTH };
const MONTH_URL = `/month?view=${VIEW}&month=${MONTH}&scope=direct_plus_shared&summary_start=${RANGE.start}&summary_end=${RANGE.end}`;
const SUMMARY_URL = `/summary?view=${VIEW}&month=${MONTH}&scope=direct_plus_shared&summary_start=${MONTH}&summary_end=${MONTH}`;
const wholeFormat = new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD", maximumFractionDigits: 0 });
const dollars = (minor) => wholeFormat.format(minor / 100);
const { defaultBrowserType: _browser, ...iPhone13 } = devices["iPhone 13"];
const message = (page) => page.getByRole("textbox", { name: "Message" });

// May 2026 for Tim: a salary, an iFAST plan line and a GIRO under Investments.
async function seedInvesting(page) {
  await postJson(page, "/api/entries/create", {
    date: `${MONTH}-25`, description: "Money jobs salary", accountName: "UOB One", categoryName: "Salary",
    amountMinor: 6_500_000, entryType: "income", ownershipType: "direct", ownerName: "Tim"
  });
  await postJson(page, "/api/month-plan/save", {
    rowId: "money-jobs-e2e-ifast", month: MONTH, sectionKey: "planned_items", categoryName: "Investments", label: "iFAST",
    planDate: null, accountName: "", plannedMinor: 150_000, note: "", ownershipType: "direct", ownerName: "Tim"
  });
  await postJson(page, "/api/entries/create", {
    date: `${MONTH}-03`, description: "Money jobs iFAST GIRO", accountName: "UOB One", categoryName: "Investments",
    amountMinor: 120_000, entryType: "expense", ownershipType: "direct", ownerName: "Tim"
  });
}

async function revealMoney(page) {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
}

// The month's figures as the Month lead reads them, from the Month page DTO.
async function monthFigures(page) {
  const data = await loadMonthPage(page, { view: VIEW, month: MONTH });
  const rows = data.monthPage.planSections.flatMap((section) => section.rows);
  const slice = (label) => data.monthPage.categoryShareChart.find((item) => item.label === label)?.valueMinor ?? 0;
  const sum = (list) => list.reduce((total, row) => total + row.plannedMinor, 0);
  const income = data.summaryPage.months[0].actualIncomeMinor;
  const invested = slice("Investments");
  const spending = data.summaryPage.months[0].realExpensesMinor - invested - slice("Savings");
  const savePlan = sum(rows.filter((row) => row.label === "Savings"));
  const investPlan = sum(rows.filter((row) => row.label !== "Savings" && row.categoryName === "Investments"));
  return {
    income,
    invested,
    spending,
    kept: income - spending - invested,
    spendPlan: sum(rows) - savePlan - investPlan,
    savePlan,
    investPlan,
    plannedIncome: sum(data.monthPage.incomeRows)
  };
}

// The job rows, worked out by hand: [label, status] in the owner's order.
function jobRows(figures) {
  const rows = [];
  const status = (gap, word) => (gap < 50 ? "✓ done" : `${word} by ${dollars(gap)}`);
  if (figures.spendPlan > 0) rows.push([`Spend within ${dollars(figures.spendPlan)}`, status(figures.spending - figures.spendPlan, "over")]);
  if (figures.savePlan > 0) rows.push([`Save ${dollars(figures.savePlan)}`, status(figures.savePlan - figures.kept, "short")]);
  if (figures.investPlan > 0) rows.push([`Invest ${dollars(figures.investPlan)}`, status(figures.investPlan - figures.invested, "short")]);
  if (figures.plannedIncome > 0) rows.push([`Income ${dollars(figures.plannedIncome)}`, status(figures.plannedIncome - figures.income, "short")]);
  return rows;
}

async function openLead(page, url, leadSelector) {
  await page.goto(url);
  const lead = page.locator(leadSelector);
  await expect(lead.locator(".summary-lead-spent")).toBeVisible({ timeout: 30_000 });
  return lead;
}

function backgroundRgb(locator) {
  return locator.evaluate((element) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.fillStyle = getComputedStyle(element).backgroundColor;
    context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
  });
}

test.describe("phone", () => {
  test.use(iPhone13);

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await reseedDemo(page);
    await seedInvesting(page);
  });

  test("Month lead: invested is its own part, the jobs fold to one line, and each row says done, short or over", async ({ page }) => {
    await revealMoney(page);
    const figures = await monthFigures(page);
    expect(figures.invested, "the GIRO is invested").toBe(120_000);
    expect(figures.investPlan).toBe(150_000);
    const lead = await openLead(page, MONTH_URL, ".month-lead");
    const bar = lead.locator("[data-savings-bar]");

    await expect(bar.locator("[data-segment]")).toHaveCount(3);
    await expect(bar.locator("[data-segment]").nth(1)).toHaveAttribute("data-segment", "invested");
    await expect(bar.locator('[data-segment="invested"]')).toHaveAccessibleName("Invested");
    await expect(bar.locator('[data-popover="invested"]')).toHaveText(`Invested ${dollars(figures.invested)} · ${Math.round((figures.invested * 100) / figures.income)}% of income`);
    await expect(bar.locator("[data-savings-sentence]")).toHaveText(`You kept ${dollars(figures.kept)} and invested ${dollars(figures.invested)} of the ${dollars(figures.income)} you earned`);
    // Faded plum: red and blue over green, unlike the mint kept part.
    const [red, green, blue] = await backgroundRgb(bar.locator('[data-segment="invested"]'));
    expect(red - green, "invested is plum").toBeGreaterThan(15);
    expect(blue - green, "invested is plum").toBeGreaterThan(5);

    // Folded on a phone: one line, the rows hidden until it is tapped.
    const rows = jobRows(figures);
    const done = rows.filter(([, status]) => status === "✓ done").length;
    const jobs = lead.locator("[data-money-jobs]");
    await expect(lead.locator("[data-money-jobs-summary]")).toHaveText(`${done} of ${rows.length} money jobs done`);
    await expect(jobs).not.toHaveAttribute("open", "");
    await expect(jobs.locator("[data-job]").first()).toBeHidden();
    expect((await lead.boundingBox()).height, "Month lead card height").toBeLessThanOrEqual(205);
    await lead.locator("[data-money-jobs-summary]").tap();
    await expect(jobs.locator("[data-job]")).toHaveCount(rows.length);
    const shown = await jobs.locator("[data-job]").evaluateAll((items) => items.map((item) => [
      item.querySelector(".money-job-label").textContent,
      item.querySelector("[data-job-status]").textContent
    ]));
    expect(shown).toEqual(rows);
    await expect(jobs.locator('[data-job="invest"] [data-job-status]')).toHaveText("short by $300");
    await expect(jobs.locator('[data-job="invest"] [data-job-status]')).toHaveClass(/money-short/);
  });

  test("a bar part's menu opens Entries filtered to that money, and a job's to its own", async ({ page }) => {
    await revealMoney(page);
    const lead = await openLead(page, MONTH_URL, ".month-lead");
    const bar = lead.locator("[data-savings-bar]");

    await bar.locator('[data-segment="invested"]').tap();
    await expect(bar.locator('[data-popover="invested"]')).toBeVisible();
    const menu = bar.locator('[data-money-actions="invested"]');
    await expect(menu.getByRole("button")).toHaveText(["View entries", "Ask about this"]);
    await menu.getByRole("button", { name: "View entries" }).tap();
    await expect(page).toHaveURL(/\/entries\?/);
    const url = new URL(page.url());
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ view: VIEW, month: MONTH, scope: "direct_plus_shared", entry_category: "Investments" });
    expect(url.searchParams.has("entry_type")).toBe(false);
    expect(url.searchParams.has("from_ask")).toBe(false);
    await expect(page.locator(".entry-row").filter({ hasText: "Money jobs iFAST GIRO" })).toHaveCount(1, { timeout: 30_000 });
    await expect(page.locator(".entry-row").filter({ hasText: "Money jobs salary" })).toHaveCount(0);

    // The spent part lists the expenses; the income job the income.
    await page.goBack();
    await bar.locator('[data-segment="spent"]').tap();
    await bar.locator('[data-money-actions="spent"]').getByRole("button", { name: "View entries" }).tap();
    await expect(page).toHaveURL(/entry_type=expense/);
    expect(new URL(page.url()).searchParams.get("month")).toBe(MONTH);

    await page.goBack();
    await lead.locator("[data-money-jobs-summary]").tap();
    await lead.locator('[data-job="income"] .money-job-row').tap();
    await lead.locator('[data-job="income"] [data-action="entries"]').tap();
    await expect(page).toHaveURL(/entry_type=income/);
    await expect(page.locator(".entry-row").filter({ hasText: "Money jobs salary" })).toHaveCount(1, { timeout: 30_000 });
  });

  test("Ask about this opens Ask with the question in the message box, for the person to send", async ({ page }) => {
    await revealMoney(page);
    const figures = await monthFigures(page);
    const question = figures.spending > figures.spendPlan
      ? `Why did I spend more than planned in ${MONTH_WORDS}?`
      : `What did I spend the most on in ${MONTH_WORDS}?`;
    const lead = await openLead(page, MONTH_URL, ".month-lead");
    await lead.locator('[data-segment="spent"]').tap();
    const ask = lead.locator('[data-money-actions="spent"] [data-action="ask"]');
    await expect(ask).toHaveAttribute("data-question", question);
    await ask.tap();
    await expect(page).toHaveURL(/\/ask\?/);
    await expect(message(page)).toHaveValue(question, { timeout: 30_000 });
    // Read once: the question leaves the URL, and nothing was sent.
    await expect(page).not.toHaveURL(/ask_text/);
    expect(new URL(page.url()).searchParams.get("month")).toBe(MONTH);
    await expect(page.locator(".ask-answer")).toHaveCount(0);
    await page.reload();
    await expect(message(page)).toHaveValue(question, { timeout: 30_000 });
  });

  test("hidden money: the jobs say ✓ or a percentage, the menu and question carry no amount", async ({ page }) => {
    const figures = await monthFigures(page);
    const lead = await openLead(page, MONTH_URL, ".month-lead");
    await expect(lead.locator(".summary-lead-spent")).toHaveText("••••");
    const rows = jobRows(figures);
    const done = rows.filter(([, status]) => status === "✓ done").length;
    await expect(lead.locator("[data-money-jobs-summary]")).toHaveText(`${done} of ${rows.length} money jobs done`);
    await lead.locator("[data-money-jobs-summary]").tap();
    const statuses = await lead.locator("[data-job-status]").allTextContents();
    expect(statuses).toHaveLength(rows.length);
    for (const status of statuses) expect(status).toMatch(/^(✓|\d+%)$/);
    await expect(lead.locator('[data-job="invest"] [data-job-status]')).toHaveText("80%");
    await expect(lead.locator('[data-job="invest"] .money-job-label')).toHaveText("Invest");
    // Neutral ink: no tone reveals which side of the plan a job fell.
    const colours = await lead.locator("[data-job-status]").evaluateAll((items) => [...new Set(items.map((item) => getComputedStyle(item).color))]);
    expect(colours).toHaveLength(1);

    await lead.locator('[data-job="spend"] .money-job-row').tap();
    await expect(lead.locator('[data-job="spend"] [data-action="ask"]')).toHaveAttribute("data-question", `How did my spending compare with the plan in ${MONTH_WORDS}?`);
    await lead.locator('[data-segment="invested"]').tap();
    await expect(lead.locator('[data-popover="invested"]')).toHaveText(/^Invested · \d+% of income$/);
    const text = await lead.locator("[data-savings-bar], [data-money-jobs]").evaluateAll((items) => items.map((item) => item.textContent).join(" "));
    expect(text).not.toMatch(/\$|short|over by|under|more than/i);
  });
});

test.describe("desktop", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await reseedDemo(page);
    await seedInvesting(page);
  });

  test("Summary lead: the jobs are open, hover shows a part's popover, a click its menu, and Ask opens beside the page", async ({ page }) => {
    await revealMoney(page);
    const summary = await loadSummaryPage(page, { view: VIEW, month: MONTH, summaryStart: MONTH, summaryEnd: MONTH });
    const card = (label) => summary.summaryPage.metricCards.find((item) => item.label === label).amountMinor;
    expect(card("Planned investments")).toBe(150_000);
    const lead = await openLead(page, SUMMARY_URL, ".summary-lead");
    const jobs = lead.locator("[data-money-jobs]");
    await expect(jobs).toHaveAttribute("open", "");
    await expect(jobs.locator('[data-job="invest"]')).toContainText("Invest $1,500");
    await expect(jobs.locator('[data-job="invest"] [data-job-status]')).toHaveText("short by $300");

    const invested = lead.locator('[data-segment="invested"]');
    await invested.hover();
    await expect(lead.locator('[data-popover="invested"]')).toBeVisible();
    await expect(lead.locator('[data-money-actions="invested"]')).toHaveCount(0);
    await invested.click();
    const ask = lead.locator('[data-money-actions="invested"] [data-action="ask"]');
    await expect(ask).toBeVisible();
    await ask.click();
    // The Ask panel beside Summary, which stays, with the question waiting.
    await expect(page).toHaveURL(/\/summary\?/);
    await expect(page.locator(".ask-dock").getByRole("textbox", { name: "Message" })).toHaveValue(`How much did I invest in ${MONTH_WORDS}?`, { timeout: 30_000 });
    await expect(page.locator(".ask-dock .ask-answer")).toHaveCount(0);

    // A second question while the panel is open goes into the same message box.
    await lead.locator('[data-job="income"] .money-job-row').click();
    await lead.locator('[data-job="income"] [data-action="ask"]').click();
    await expect(page.locator(".ask-dock").getByRole("textbox", { name: "Message" })).toHaveValue(`How much did I invest in ${MONTH_WORDS}? How much did I earn in ${MONTH_WORDS}?`);
  });
});
