import { devices, expect, test } from "@playwright/test";

import { loadMonthPage, loadSummaryPage, postJson, reseedDemo } from "./helpers";

// Money jobs (design.md "Money jobs"; DOMAIN.md "Money job"): the savings bar
// says what was invested as its own plum part, the lead's Detail says which
// of the plan's jobs (spend within the budget, save the target, invest the
// goal, the planned income) were done, and a bar part or a job opens a menu:
// "View entries" (Entries filtered to the money behind it) and "Ask about
// this" (Ask opens and answers the question straight away, as if typed). Every expected figure is
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
const cents = new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" });
const { defaultBrowserType: _browser, ...iPhone13 } = devices["iPhone 13"];
const message = (page) => page.getByRole("textbox", { name: "Message" });

// May 2026 for Tim: a planned and a received salary, an iFAST plan line and
// a GIRO under Investments.
async function seedInvesting(page) {
  await postJson(page, "/api/month-plan/save", {
    rowId: "money-jobs-e2e-salary", month: MONTH, sectionKey: "income", categoryName: "Salary", label: "Salary",
    planDate: null, accountName: "", plannedMinor: 7_000_000, note: "", ownershipType: "direct", ownerName: "Tim"
  });
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
    // Seed before any page opens: a page opened first on a fresh, empty
    // stack keeps a shell without the people, and a person link then falls
    // back to Household.
    await reseedDemo(page);
    await seedInvesting(page);
  });

  test("Month lead: invested is its own part, the jobs fold to one line, and each row says done, short or over", async ({ page }) => {
    await revealMoney(page);
    const lead = await openLead(page, MONTH_URL, ".month-lead");
    const figures = await monthFigures(page);
    expect(figures.invested, "the GIRO is invested").toBe(120_000);
    expect(figures.investPlan).toBe(150_000);
    const bar = lead.locator("[data-savings-bar]");

    await expect(bar.locator("[data-segment]")).toHaveCount(3);
    await expect(bar.locator("[data-segment]").nth(1)).toHaveAttribute("data-segment", "invested");
    await expect(bar.locator('[data-segment="invested"]')).toHaveAccessibleName("Invested");
    // The legend names it without a tap: the figure on a phone (the share needs the room of a wider screen), then the plan bar.
    await expect(bar.locator('[data-legend="invested"]')).toHaveText(`Invested ${dollars(figures.invested)}`);
    await expect(bar.locator("[data-savings-legend] [data-legend]")).toHaveCount(4);
    await expect(bar.locator('[data-legend="plan"]')).toHaveText("Plan");
    expect((await bar.locator("[data-savings-legend]").boundingBox()).height, "legend on one line with investing too").toBeLessThan(18);
    // On a phone the sentence is its one-line form; Saved is the same kept.
    await expect(bar.locator("[data-savings-sentence]")).toHaveText(`Kept ${dollars(figures.kept)} · invested ${dollars(figures.invested)} of ${dollars(figures.income)}`);
    expect((await bar.locator("[data-savings-sentence]").boundingBox()).height, "sentence on one line").toBeLessThan(22);
    await expect(lead.locator('.lead-column[data-metric="saved"] strong')).toHaveText(new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" }).format(figures.kept / 100));
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
    // The jobs line takes the old plan line's place: the card stays compact.
    expect((await lead.boundingBox()).height, "Month lead card height").toBeLessThanOrEqual(215);
    expect((await page.locator(".financial-insight").first().boundingBox()).y, "Money insights above the fold").toBeLessThan(664);
    // The rows' and the menu's words are not in the first screen: they load on the first open.
    const detailLoaded = () => page.evaluate(() => performance.getEntriesByType("resource").some((entry) => entry.name.includes("money-jobs-detail")));
    expect(await detailLoaded(), "rows' words before the first open").toBe(false);
    await lead.locator("[data-money-jobs-summary]").tap();
    await expect(jobs.locator("[data-job]")).toHaveCount(rows.length);
    expect(await detailLoaded(), "rows' words after the first open").toBe(true);
    const shown = await jobs.locator("[data-job]").evaluateAll((items) => items.map((item) => [
      item.querySelector(".money-job-label").textContent,
      item.querySelector("[data-job-status]").textContent
    ]));
    expect(shown).toEqual(rows);
    await expect(jobs.locator('[data-job="invest"] [data-job-status]')).toHaveText("short by $300");
    await expect(jobs.locator('[data-job="invest"] [data-job-status]')).toHaveClass(/money-short/);
  });

  test("a bar part's menu opens Entries narrowed to that money, and a job's to its own", async ({ page }) => {
    await revealMoney(page);
    const lead = await openLead(page, MONTH_URL, ".month-lead");
    const bar = lead.locator("[data-savings-bar]");

    await bar.locator('[data-segment="invested"]').tap();
    const menu = page.locator('[data-figure-menu="invested"]');
    await expect(menu.getByRole("button")).toHaveText(["View entries", "Open plan", "Ask about this"]);
    await menu.getByRole("button", { name: "View entries" }).tap();
    await expect(page).toHaveURL(/\/entries\?/);
    const url = new URL(page.url());
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ view: VIEW, month: MONTH, scope: "direct_plus_shared", entry_figure: "invested" });
    expect(url.searchParams.has("entry_type")).toBe(false);
    expect(url.searchParams.has("from_ask")).toBe(false);
    await expect(page.locator(".entry-row").filter({ hasText: "Money jobs iFAST GIRO" })).toHaveCount(1, { timeout: 30_000 });
    await expect(page.locator(".entry-row").filter({ hasText: "Money jobs salary" })).toHaveCount(0);

    // The spent part lists the expenses; the income job the income.
    await page.goBack();
    await bar.locator('[data-segment="spent"]').tap();
    await page.locator('[data-figure-menu="spending"]').getByRole("button", { name: "View entries" }).tap();
    await expect(page).toHaveURL(/entry_figure=spending/);
    expect(new URL(page.url()).searchParams.get("month")).toBe(MONTH);

    await page.goBack();
    await lead.locator("[data-money-jobs-summary]").tap();
    await lead.locator('[data-job="income"] .money-job-row').tap();
    await page.locator('[data-figure-menu="earned"] [data-action="entries"]').tap();
    await expect(page).toHaveURL(/entry_figure=earned/);
    await expect(page.locator(".entry-row").filter({ hasText: "Money jobs salary" })).toHaveCount(1, { timeout: 30_000 });
  });

  test("Ask about this opens Ask and answers the question straight away", async ({ page }) => {
    await revealMoney(page);
    const lead = await openLead(page, MONTH_URL, ".month-lead");
    const figures = await monthFigures(page);
    const question = figures.spending > figures.spendPlan
      ? `Why did I spend more than planned in ${MONTH_WORDS}?`
      : `What did I spend the most on in ${MONTH_WORDS}?`;
    await lead.locator('[data-segment="spent"]').tap();
    const ask = page.locator('[data-figure-menu="spending"] [data-action="ask"]');
    await expect(ask).toHaveAttribute("data-question", question);
    await ask.tap();
    await expect(page).toHaveURL(/\/ask\?/);
    // Sent as if typed: the question is the person's message, the answer
    // follows it, and the message box is empty (nothing waits to be sent).
    await expect(page.locator(".ask-thread .ask-me")).toHaveText(question, { timeout: 30_000 });
    // The reader's own answer for that wording: the plan card or the spending card.
    await expect(page.locator(`[data-ask-money-answer="${figures.spending > figures.spendPlan ? "plan" : "spending"}"]`)).toBeVisible({ timeout: 30_000 });
    await expect(message(page)).toHaveValue("");
    expect(new URL(page.url()).searchParams.get("month")).toBe(MONTH);
    expect(new URL(page.url()).searchParams.has("ask_text")).toBe(false);
    // Asked once: the conversation is kept, and a reload does not send the question again.
    await page.reload();
    await expect(message(page)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".ask-thread .ask-me")).toHaveText([question]);
    await expect(page.locator("[data-ask-money-answer]")).toHaveCount(1);
  });

  test("the kept part asks how much was saved and gets the lead's Saved; Open in Entries from the invested answer lists the GIRO", async ({ page }) => {
    await revealMoney(page);
    const lead = await openLead(page, MONTH_URL, ".month-lead");
    const figures = await monthFigures(page);
    expect(figures.kept, "something was kept").toBeGreaterThan(0);
    const bar = lead.locator("[data-savings-bar]");
    await bar.locator('[data-segment="kept"]').tap();
    const ask = page.locator('[data-figure-menu="kept"] [data-action="ask"]');
    await expect(ask).toHaveAttribute("data-question", `How much did I save in ${MONTH_WORDS}?`);
    await ask.tap();
    await expect(page).toHaveURL(/\/ask\?/);
    const saved = page.locator('[data-ask-money-answer="saved"]');
    await expect(saved.locator(".ask-answer-amount")).toHaveText(cents.format(figures.kept / 100), { timeout: 30_000 });
    await expect(saved.locator(".ask-answer-detail")).toHaveText("Saved");
    await expect(saved.locator(".ask-money-wording")).toContainText(`so you kept ${cents.format(figures.kept / 100)}`);

    // Typed by hand, the invested question gets its card and its Entries link.
    await message(page).fill(`how much did we invest in ${MONTH_WORDS}?`);
    await message(page).press("Enter");
    const invested = page.locator('[data-ask-money-answer="invested"]');
    await expect(invested.locator(".ask-answer-amount")).toHaveText(cents.format(figures.invested / 100), { timeout: 30_000 });
    await page.getByRole("button", { name: "Open in Entries" }).first().tap();
    await expect(page).toHaveURL(/\/entries\?/);
    expect(Object.fromEntries(new URL(page.url()).searchParams)).toMatchObject({ view: VIEW, month: MONTH, entry_category: "Investments" });
    await expect(page.locator(".entry-row").filter({ hasText: "Money jobs iFAST GIRO" })).toHaveCount(1, { timeout: 30_000 });
  });

  test("hidden money: the jobs say ✓ or a percentage, the menu and question carry no amount", async ({ page }) => {
    const lead = await openLead(page, MONTH_URL, ".month-lead");
    const figures = await monthFigures(page);
    await expect(lead.locator(".summary-lead-spent")).toHaveText("••••");
    await expect(lead.locator("[data-savings-sentence]")).toHaveText("Spent, invested and kept, as shares of income");
    expect((await lead.boundingBox()).height, "Month lead card height").toBeLessThanOrEqual(215);
    const rows = jobRows(figures);
    const done = rows.filter(([, status]) => status === "✓ done").length;
    await expect(lead.locator("[data-money-jobs-summary]")).toHaveText(`${done} of ${rows.length} money jobs done`);
    await lead.locator("[data-money-jobs-summary]").tap();
    // The rows load on the first open.
    await expect(lead.locator("[data-job]")).toHaveCount(rows.length);
    const statuses = await lead.locator("[data-job-status]").allTextContents();
    expect(statuses).toHaveLength(rows.length);
    for (const status of statuses) expect(status).toMatch(/^(✓|\d+%)$/);
    await expect(lead.locator('[data-job="invest"] [data-job-status]')).toHaveText("80%");
    await expect(lead.locator('[data-job="invest"] .money-job-label')).toHaveText("Invest");
    // Neutral ink: no tone reveals which side of the plan a job fell.
    const colours = await lead.locator("[data-job-status]").evaluateAll((items) => [...new Set(items.map((item) => getComputedStyle(item).color))]);
    expect(colours).toHaveLength(1);

    await lead.locator('[data-job="spend"] .money-job-row').tap();
    await expect(page.locator('[data-figure-menu="spending"] [data-action="ask"]')).toHaveAttribute("data-question", `How did my spending compare with the plan in ${MONTH_WORDS}?`);
    await expect(lead.locator('[data-legend="invested"]')).toHaveText(/^Invested · \d+%$/);
    await lead.locator('[data-segment="invested"]').tap();
    const text = await page.locator(".month-lead [data-savings-bar], .month-lead [data-money-jobs], [data-figure-menu]").evaluateAll((items) => items.map((item) => item.textContent).join(" "));
    expect(text).not.toMatch(/\$|short|over by|under|more than/i);

    // Its question gets the plan answer (not this month against last), with
    // every amount masked and no words that say which side of the plan.
    const spendAsk = page.locator('[data-figure-menu="spending"] [data-action="ask"]');
    if (!(await spendAsk.isVisible())) {
      // The Invested menu (with its title) can sit over the Spend row: a second tap on Invested closes it.
      await lead.locator('[data-segment="invested"]').tap();
      await expect(page.locator('[data-figure-menu="invested"]')).toHaveCount(0);
      await lead.locator('[data-job="spend"] .money-job-row').tap();
    }
    await spendAsk.tap();
    await expect(page).toHaveURL(/\/ask\?/);
    const answer = page.locator('[data-ask-money-answer="plan"]');
    await expect(answer.locator(".ask-answer-title")).toHaveText("May against plan", { timeout: 30_000 });
    await expect(answer.locator(".ask-answer-amount")).toHaveText("••••");
    await expect(answer.locator(".ask-brief-hidden")).toHaveText("Reveal money totals to read these insights.");
    await expect(answer).not.toContainText(/\$\d|more than|under the/);
  });
});

test.describe("desktop", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    // Seed before any page opens: a page opened first on a fresh, empty
    // stack keeps a shell without the people, and a person link then falls
    // back to Household.
    await reseedDemo(page);
    await seedInvesting(page);
  });

  test("Summary lead: the jobs are open, the legend names the parts, a click opens a part's menu, and Ask opens beside the page and answers", async ({ page }) => {
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
    // The legend has the figure and the share without a hover; a hover opens nothing.
    await expect(lead.locator('[data-legend="invested"]')).toHaveText(/^Invested \$[\d,]+ · \d+%$/);
    await invested.hover();
    await expect(page.locator('[data-figure-menu="invested"]')).toHaveCount(0);
    await invested.click();
    const ask = page.locator('[data-figure-menu="invested"] [data-action="ask"]');
    await expect(ask).toBeVisible();
    await ask.click();
    // The Ask panel beside Summary, which stays, asks it at once.
    await expect(page).toHaveURL(/\/summary\?/);
    const dock = page.locator(".ask-dock");
    await expect(dock.locator(".ask-thread .ask-me")).toHaveText(`How much did I invest in ${MONTH_WORDS}?`, { timeout: 30_000 });
    // The invested answer, not a search for "invest": the lead's invested
    // against the invest job, and the GIRO behind it.
    const investedAnswer = dock.locator('[data-ask-money-answer="invested"]');
    await expect(investedAnswer.locator(".ask-answer-amount")).toHaveText(cents.format(120_000 / 100), { timeout: 30_000 });
    await expect(investedAnswer.locator(".ask-answer-title")).toHaveText("May investing");
    await expect(investedAnswer.locator(".money-plan").first()).toHaveText(`of ${cents.format(1_500)} plan`);
    await expect(investedAnswer.locator(".ask-money-lines li")).toHaveCount(1);
    await expect(investedAnswer.locator(".ask-money-lines li")).toContainText("Money jobs iFAST GIRO");
    await expect(investedAnswer.locator("[data-savings-bar] [data-segment='invested']")).toHaveCount(1);
    await expect(dock.getByRole("textbox", { name: "Message" })).toHaveValue("");

    // A second question while the panel is open is asked in the same conversation.
    await lead.locator('[data-job="income"] .money-job-row').click();
    await page.locator('[data-figure-menu="earned"] [data-action="ask"]').click();
    await expect(dock.locator(".ask-thread .ask-me")).toHaveText([`How much did I invest in ${MONTH_WORDS}?`, `How much did I earn in ${MONTH_WORDS}?`], { timeout: 30_000 });
    await expect(dock.locator('[data-ask-money-answer="income"] .ask-answer-amount')).toHaveText(cents.format((await monthFigures(page)).income / 100), { timeout: 30_000 });
    await expect(dock.getByRole("textbox", { name: "Message" })).toHaveValue("");
  });
});
