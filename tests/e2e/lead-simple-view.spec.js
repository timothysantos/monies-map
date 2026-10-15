import { devices, expect, test } from "@playwright/test";

import { loadMonthPage, loadSummaryPage, postJson, reseedDemo } from "./helpers";

// The Summary and Month lead's Plan | Simple switch (lead-view.js, design.md
// "Plan or Simple"). Plan is the lead as it was: spend against plan, the
// savings bar with its plan bar, the money jobs, the Income and Saved
// figures, and on Summary Intent vs Outcome. Simple is "Earned $x · Spent $y"
// over the same savings bar without the plan bar, nothing else, and on
// Summary "Earned vs spent by month" in Intent vs Outcome's place. Without a
// remembered choice both pages open in Simple, planned period or not; the
// choice is remembered on the device (or the login) and wins on both pages.
// Settings > Summary view is the same preference (settings-reference-data).
// Specs that exercise Plan pin it with pinPlan().
// The model's exact numbers are in tests/lead-view.test.mjs; this proves the
// rendering, the switch, the remembered choice, the defaults and hidden money.

// These specs exercise the real default (Simple) and the choice itself, so no
// saved Plan choice is pre-set as in playwright.config.js.
test.use({ storageState: { cookies: [], origins: [] } });

const VIEW = "person-tim";
const MONTH = "2026-05";
const RANGE = { start: "2025-06", end: MONTH };
const SUMMARY_URL = `/summary?view=${VIEW}&month=${MONTH}&scope=direct_plus_shared&summary_start=${RANGE.start}&summary_end=${RANGE.end}`;
const MONTH_URL = `/month?view=${VIEW}&month=${MONTH}&scope=direct_plus_shared&summary_start=${RANGE.start}&summary_end=${RANGE.end}`;
// A month with entries and no plan at all (the demo plans 2025-06 to 2026-05).
const BARE_MONTH = "2024-03";
const BARE_SUMMARY_URL = `/summary?view=${VIEW}&month=${BARE_MONTH}&scope=direct_plus_shared&summary_start=${BARE_MONTH}&summary_end=${BARE_MONTH}`;
const BARE_MONTH_URL = `/month?view=${VIEW}&month=${BARE_MONTH}&scope=direct_plus_shared&summary_start=${BARE_MONTH}&summary_end=${BARE_MONTH}`;
const STORAGE_KEY = "monies-map:lead-view";
const centsFormat = new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" });
const money = (minor) => centsFormat.format(minor / 100);
const { defaultBrowserType: _browser, ...iPhone13 } = devices["iPhone 13"];

// A saved Plan choice, set once per tab so a later switch and a reload are
// not overwritten by the init script.
async function pinPlan(page) {
  await page.addInitScript((key) => {
    if (window.sessionStorage.getItem("pinned-plan")) return;
    window.sessionStorage.setItem("pinned-plan", "1");
    window.localStorage.setItem(key, "plan");
  }, STORAGE_KEY);
}

async function revealMoney(page) {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
}

// What Simple must show, from the page DTOs, worked out here by hand: money
// filed under Investments or Savings was moved, not spent.
function splitByHand(incomeMinor, actualSpendMinor, share) {
  const slice = (label) => share.find((item) => item.label === label)?.valueMinor ?? 0;
  return { earned: incomeMinor, spent: actualSpendMinor - slice("Investments") - slice("Savings") };
}

async function expectedSummary(page, { start, end, month }) {
  const data = await loadSummaryPage(page, { view: VIEW, month, summaryStart: start, summaryEnd: end });
  const card = (label) => data.summaryPage.metricCards.find((item) => item.label === label).amountMinor;
  return { data, ...splitByHand(card("Actual income"), card("Actual spend"), data.summaryPage.categoryShareChart) };
}

async function expectedMonth(page, month) {
  const data = await loadMonthPage(page, { view: VIEW, month });
  const card = (label) => data.monthPage.metricCards.find((item) => item.label === label).amountMinor;
  return splitByHand(data.summaryPage.months[0].actualIncomeMinor, card("Actual spend"), data.monthPage.categoryShareChart);
}

const leadGroup = (page) => page.locator(".summary-lead-group").first();
const viewSwitch = (page) => leadGroup(page).getByRole("radiogroup", { name: "Show this period" });
const option = (page, name) => viewSwitch(page).getByRole("radio", { name });

async function expectPlan(page, { summary, jobs = true }) {
  const group = leadGroup(page);
  await expect(group).toHaveAttribute("data-lead-view", "plan", { timeout: 30_000 });
  await expect(option(page, "Plan")).toBeChecked();
  await expect(option(page, "Simple")).not.toBeChecked();
  await expect(group.locator(".summary-lead-spent")).toBeVisible();
  await expect(group.locator(".lsd-eyebrow")).toHaveText(/^Spent · /);
  await expect(group.locator(".summary-lead-plan")).toBeVisible();
  // The money jobs line is there when the plan gives the money a job.
  await expect(group.locator(".money-jobs")).toHaveCount(jobs ? 1 : 0);
  await expect(group.locator(".lead-simple")).toHaveCount(0);
  if (summary) {
    await expect(group.locator(".summary-support-pill")).toHaveCount(2);
    await expect(page.locator(".summary-intent")).toBeVisible();
    await expect(page.locator("[data-earned-spent]")).toHaveCount(0);
  } else {
    await expect(group.locator(".lead-column")).toHaveCount(3);
  }
}

async function expectSimple(page, { summary, earned, spent }) {
  const group = leadGroup(page);
  await expect(group).toHaveAttribute("data-lead-view", "simple", { timeout: 30_000 });
  await expect(option(page, "Simple")).toBeChecked();
  await expect(option(page, "Plan")).not.toBeChecked();
  await expect(group.locator('.lead-simple [data-simple="earned"]')).toHaveText(`Earned${money(earned)}`);
  await expect(group.locator('.lead-simple [data-simple="spent"]')).toHaveText(`Spent${money(spent)}`);
  // No plan anywhere: no "of $x plan", no percent of plan, no plan bar or
  // legend item, no money jobs and no Income / Saved / Remaining figures.
  await expect(group.locator(".lsd-eyebrow")).not.toHaveText(/Spent/);
  await expect(group.locator(".summary-lead-spent, .summary-lead-plan, .summary-lead-line")).toHaveCount(0);
  await expect(group.locator(".savings-bar-plan")).toHaveCount(0);
  await expect(group.locator('[data-savings-legend] [data-legend="plan"]')).toHaveCount(0);
  await expect(group.locator(".money-jobs")).toHaveCount(0);
  await expect(group.locator(".summary-support-pill, .lead-column")).toHaveCount(0);
  await expect(group).not.toContainText(/plan\b|target|money job|where your money goes|on track/i);
  if (summary) {
    await expect(page.locator("[data-earned-spent]")).toBeVisible();
    await expect(page.locator(".summary-intent")).toHaveCount(0);
  }
}

async function expectFlatMonthRows(page) {
  // The month name is a flat row link, not a native grey button: no fill,
  // no border, and every row lines up in two columns (name left, result right).
  const rows = await page.locator("[data-earned-spent] .earned-spent-row").evaluateAll((items) => items.map((item) => {
    const button = item.querySelector(".summary-month-link");
    const result = item.querySelector(".earned-spent-result");
    const style = getComputedStyle(button);
    return {
      background: style.backgroundColor,
      borderWidth: style.borderTopWidth,
      appearance: style.appearance,
      left: Math.round(button.getBoundingClientRect().left),
      height: button.getBoundingClientRect().height,
      resultRight: Math.round(result.getBoundingClientRect().right)
    };
  }));
  expect(rows.length).toBeGreaterThan(1);
  for (const row of rows) {
    expect(row.background).toBe("rgba(0, 0, 0, 0)");
    expect(row.borderWidth).toBe("0px");
    expect(row.height).toBeGreaterThanOrEqual(44);
  }
  expect(new Set(rows.map((row) => row.left)).size, "month names share one left edge").toBe(1);
  expect(new Set(rows.map((row) => row.resultRight)).size, "results share one right edge").toBe(1);
}

async function recordBareMonth(page) {
  for (const entry of [
    { description: "Simple view salary", categoryName: "Salary", amountMinor: 50_000, entryType: "income" },
    { description: "Simple view lunch", categoryName: "Food & Drinks", amountMinor: 12_345, entryType: "expense" }
  ]) {
    await postJson(page, "/api/entries/create", {
      date: `${BARE_MONTH}-12`,
      accountName: "UOB One",
      ownershipType: "direct",
      ownerName: "Tim",
      ...entry
    });
  }
}

test.describe("desktop", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/summary");
    await reseedDemo(page);
    await revealMoney(page);
  });

  test("a fresh visit opens Summary and Month in Simple even when the period has a plan; a saved Plan choice opens Plan", async ({ page }) => {
    const expected = await expectedSummary(page, { start: RANGE.start, end: RANGE.end, month: MONTH });
    await page.goto(SUMMARY_URL);
    await expectSimple(page, { summary: true, earned: expected.earned, spent: expected.spent });
    expect(await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY)).toBeNull();
    await page.goto(MONTH_URL);
    await expect(leadGroup(page)).toHaveAttribute("data-lead-view", "simple", { timeout: 30_000 });
    // A saved Plan choice wins over the default, on both pages and a reload.
    await option(page, "Plan").click();
    await expectPlan(page, { summary: false });
    await page.goto(SUMMARY_URL);
    await expectPlan(page, { summary: true });
    await page.reload();
    await expectPlan(page, { summary: true });
  });

  test("with Plan chosen, Simple shows earned and spent from the same split, and the choice survives a reload and carries to Month", async ({ page }) => {
    await pinPlan(page);
    const expected = await expectedSummary(page, { start: RANGE.start, end: RANGE.end, month: MONTH });
    await page.goto(SUMMARY_URL);
    await expectPlan(page, { summary: true });
    await expect(leadGroup(page).locator(".savings-bar-plan")).toHaveCount(1);
    await expect(leadGroup(page).locator('[data-savings-legend] [data-legend="plan"]')).toHaveCount(1);
    const sentence = await leadGroup(page).locator("[data-savings-sentence]").textContent();
    const segments = await leadGroup(page).locator("[data-segment]").evaluateAll((parts) => parts.map((part) => part.dataset.segment));

    await option(page, "Simple").click();
    await expectSimple(page, { summary: true, earned: expected.earned, spent: expected.spent });
    // The same savings bar: the same parts and the same plain line as Plan.
    await expect(leadGroup(page).locator("[data-savings-sentence]")).toHaveText(sentence);
    expect(await leadGroup(page).locator("[data-segment]").evaluateAll((parts) => parts.map((part) => part.dataset.segment))).toEqual(segments);
    // The eyebrow is the range alone.
    await expect(leadGroup(page).locator(".lsd-eyebrow")).toHaveText("Jun 2025 – May 2026");
    expect(await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY)).toBe("simple");

    // Earned vs spent by month: newest first, one row per month in the range.
    const list = page.locator("[data-earned-spent]");
    await expect(list.locator("h3")).toHaveText("Earned vs spent by month");
    const rows = list.locator(".earned-spent-row");
    const months = expected.data.summaryPage.months.map((item) => item.month).sort().reverse();
    await expect(rows).toHaveCount(months.length);
    expect(await rows.evaluateAll((items) => items.map((item) => item.dataset.month))).toEqual(months);
    // May's row is May's Month lead in Simple: the same earned and spent.
    const may = await expectedMonth(page, MONTH);
    const mayRow = list.locator(`[data-month="${MONTH}"]`);
    await expect(mayRow.locator(".earned-spent-figures")).toContainText(`Earned ${money(may.earned)}`);
    await expect(mayRow.locator(".earned-spent-figures")).toContainText(`Spent ${money(may.spent)}`);
    await expect(mayRow.locator(".earned-spent-result")).toHaveText(/^(Kept|Overspent) \$[\d,]+\.\d\d$/);
    await expect(mayRow.locator(".earned-spent-bar [data-segment]").first()).toBeVisible();
    await expect(list).not.toContainText(/plan\b|target|variance|estimate/i);

    await page.reload();
    await expectSimple(page, { summary: true, earned: expected.earned, spent: expected.spent });

    // Month keeps the same choice: Simple there too, with Money in for the plan tables.
    await page.goto(MONTH_URL);
    await expectSimple(page, { summary: false, earned: may.earned, spent: may.spent });
    await expect(page.locator(".month-plan-stack")).toHaveCount(0);
    await expect(page.locator("[data-money-in]")).toBeVisible();
    await expect(leadGroup(page).locator(".lsd-eyebrow")).toHaveText("May 2026");

    // Back to Plan on Month: Summary follows.
    await option(page, "Plan").click();
    await expectPlan(page, { summary: false });
    await page.goto(SUMMARY_URL);
    await expectPlan(page, { summary: true });
  });

  test("the month name in Earned vs spent by month opens that month", async ({ page }) => {
    await page.addInitScript((key) => window.localStorage.setItem(key, "simple"), STORAGE_KEY);
    await page.goto(SUMMARY_URL);
    const row = page.locator('[data-earned-spent] [data-month="2025-10"]');
    await row.getByRole("button", { name: "Oct 2025" }).click();
    await expect(page).toHaveURL(/\/month\?.*month=2025-10/);
    await expect(leadGroup(page).locator(".lsd-eyebrow")).toHaveText("Oct 2025");
  });

  test("the switch is a radio group: the arrow keys move the choice and the focus", async ({ page }) => {
    await pinPlan(page);
    await page.goto(SUMMARY_URL);
    await expectPlan(page, { summary: true });
    // Native radios in one group: Tab reaches the checked one only.
    await expect(viewSwitch(page).locator('input[type="radio"][name="lead-view"]')).toHaveCount(2);
    await option(page, "Plan").focus();
    await page.keyboard.press("ArrowRight");
    await expect(option(page, "Simple")).toBeFocused();
    await expect(leadGroup(page)).toHaveAttribute("data-lead-view", "simple");
    await page.keyboard.press("ArrowLeft");
    await expect(option(page, "Plan")).toBeFocused();
    await expect(leadGroup(page)).toHaveAttribute("data-lead-view", "plan");
  });

  test("a period with no plan opens in Simple on Summary and Month; choosing Plan wins over that default", async ({ page }) => {
    await recordBareMonth(page);
    await page.goto(BARE_SUMMARY_URL);
    await expectSimple(page, { summary: true, earned: 50_000, spent: 12_345 });
    expect(await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY)).toBeNull();
    await expect(leadGroup(page).locator("[data-savings-sentence]")).toHaveText("You kept $377 of the $500 you earned (75%)");
    const row = page.locator(`[data-earned-spent] [data-month="${BARE_MONTH}"]`);
    await expect(row.locator(".earned-spent-result")).toHaveText("Kept $376.55");
    await expect(row.locator(".earned-spent-figures")).toHaveText(`Earned ${money(50_000)}Spent ${money(12_345)}`);

    await page.goto(BARE_MONTH_URL);
    await expectSimple(page, { summary: false, earned: 50_000, spent: 12_345 });

    // Plan, chosen, is shown even with no plan, and stays chosen.
    await option(page, "Plan").click();
    await expectPlan(page, { summary: false, jobs: false });
    await page.goto(BARE_SUMMARY_URL);
    await expectPlan(page, { summary: true, jobs: false });
    await page.reload();
    await expectPlan(page, { summary: true, jobs: false });
  });

  test("Simple's facts under the bar: daily spend and top spending opening Entries; what was kept stays the bar's line", async ({ page }) => {
    await recordBareMonth(page);
    // April 2024: spending and no income.
    await postJson(page, "/api/entries/create", {
      date: "2024-04-08", description: "Simple view groceries", accountName: "UOB One", categoryName: "Food & Drinks",
      amountMinor: 12_345, entryType: "expense", ownershipType: "direct", ownerName: "Tim"
    });
    await page.goto(BARE_SUMMARY_URL);
    const facts = leadGroup(page).locator("[data-simple-metrics]");
    await expect(facts).toBeVisible({ timeout: 30_000 });
    // $123.45 over March's 31 days; what was kept is the bar's line, not a fact.
    await expect(leadGroup(page).locator("[data-savings-sentence]")).toHaveText("You kept $377 of the $500 you earned (75%)");
    await expect(facts.locator('[data-metric="daily"]')).toHaveText("Daily spend $4");
    await expect(facts.locator('[data-metric="top"]')).toHaveText("Top spendingFood & Drinks 100%");
    await expect(facts).not.toContainText(/kept/i);
    // No invested money: nothing about investing anywhere in the facts.
    await expect(facts).not.toContainText(/invest/i);
    // A chip is an openable figure: View entries is its spending over the period.
    await facts.getByRole("button", { name: /^Food & Drinks 100%/ }).click();
    await page.locator('[data-figure-menu="category"]').getByRole("button", { name: "View entries" }).click();
    await expect(page).toHaveURL(/\/entries\?.*entry_category=Food/);
    await expect(page.locator(".entries-totals-lead .lsd-amount")).toHaveText("$123.45", { timeout: 30_000 });

    // The month alone on Month: the same facts.
    await page.goto(BARE_MONTH_URL);
    await expect(leadGroup(page).locator('[data-simple-metrics] [data-metric="daily"]')).toHaveText("Daily spend $4");

    // A month with spending and no income: the bar says it, the facts stay.
    await page.goto(`/month?view=${VIEW}&month=2024-04&scope=direct_plus_shared`);
    const april = leadGroup(page).locator("[data-simple-metrics]");
    await expect(april.locator('[data-metric="daily"]')).toHaveText("Daily spend $4", { timeout: 30_000 });
    await expect(leadGroup(page).locator("[data-savings-sentence]")).toHaveText("You spent $123 more than you earned");

    // Plan has none of these.
    await option(page, "Plan").click();
    await expect(leadGroup(page).locator("[data-simple-metrics]")).toHaveCount(0);
  });

  test("the whole page follows the switch: Summary keeps Spending Mix, wallets and insights; Month swaps the plan tables for Money in", async ({ page }) => {
    await pinPlan(page);
    await recordBareMonth(page);
    await page.goto(SUMMARY_URL);
    await expectPlan(page, { summary: true });
    for (const section of [".summary-mix-list", ".summary-accounts", ".financial-insight"]) {
      await expect(page.locator(section).first(), section).toBeVisible();
    }
    // Switching at the top keeps the page where it is.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await option(page, "Simple").click();
    await expect(page.locator("[data-earned-spent]")).toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    for (const section of [".summary-mix-list", ".summary-accounts", ".financial-insight"]) {
      await expect(page.locator(section).first(), section).toBeVisible();
    }
    await expect(page.locator(".summary-intent")).toHaveCount(0);

    // Month, Simple (the choice carries): no plan tables; Money in by source.
    await page.goto(BARE_MONTH_URL);
    await expect(leadGroup(page)).toHaveAttribute("data-lead-view", "simple", { timeout: 30_000 });
    await expect(page.locator(".month-plan-stack")).toHaveCount(0);
    await expect(page.locator(".month-spending-mix")).toBeVisible();
    const moneyIn = page.locator("[data-money-in]");
    await expect(moneyIn.locator("h3")).toHaveText("Money in");
    const salary = moneyIn.locator('[data-source="Simple view salary"]');
    await expect(salary).toContainText("Simple view salary");
    await expect(salary).toContainText(money(50_000));
    await expect(moneyIn.locator("[data-source]")).toHaveCount(1);
    // "Plan this month" switches the page to Plan, with the plan tables in view
    // (this month has no plan rows yet, so Plan Studio has nothing to show and
    // holds no space).
    const planLink = moneyIn.getByRole("button", { name: "Plan this month" });
    await planLink.scrollIntoViewIfNeeded();
    await planLink.click();
    await expectPlan(page, { summary: false, jobs: false });
    await expect(page.locator("[data-plan-studio], [data-plan-studio-reserve]")).toHaveCount(0);
    const stack = await page.locator(".month-plan-stack").boundingBox();
    expect(stack.y).toBeLessThan(page.viewportSize().height);
    await expect(page.locator("[data-money-in]")).toHaveCount(0);

    // Back to Simple: a Money in row opens its entries.
    await option(page, "Simple").click();
    await page.locator('[data-money-in] [data-source="Simple view salary"]').click();
    await expect(page).toHaveURL(/\/entries\?/);
  });

  test("Simple leaves out the insights about the plan; Plan keeps them", async ({ page }) => {
    const insightText = async () => {
      const insight = page.locator(".financial-insight-month");
      await expect(insight.locator(".checkin-fact").first()).toBeVisible({ timeout: 30_000 });
      const toggle = insight.getByRole("button", { name: "See all insights" });
      if (await toggle.count()) await toggle.click();
      return (await insight.locator(".checkin-fact, .checkin-also li").allTextContents()).join(" | ");
    };
    await pinPlan(page);
    await page.goto(MONTH_URL);
    const planText = await insightText();
    // The demo's May has insights about its plan in Plan.
    expect(planText).toMatch(/plan/i);
    await option(page, "Simple").click();
    await expect(leadGroup(page)).toHaveAttribute("data-lead-view", "simple");
    const simpleText = await insightText();
    expect(simpleText).not.toMatch(/plan|budget/i);
  });

  test("blocked storage: the default still applies and the switch still works for the visit", async ({ page }) => {
    await page.addInitScript(() => {
      const { getItem, setItem } = Storage.prototype;
      Storage.prototype.getItem = function blockedGet(key) {
        if (key === "monies-map:lead-view") throw new Error("SecurityError");
        return getItem.call(this, key);
      };
      Storage.prototype.setItem = function blockedSet(key, value) {
        if (key === "monies-map:lead-view") throw new Error("QuotaExceededError");
        return setItem.call(this, key, value);
      };
    });
    const expected = await expectedSummary(page, { start: RANGE.start, end: RANGE.end, month: MONTH });
    await page.goto(SUMMARY_URL);
    await expectSimple(page, { summary: true, earned: expected.earned, spent: expected.spent });
    await option(page, "Plan").click();
    await expectPlan(page, { summary: true });
  });
});

test.describe("phone", () => {
  test.use(iPhone13);

  test.beforeEach(async ({ page }) => {
    await page.goto("/summary");
    await reseedDemo(page);
  });

  test("Simple on a phone: 44px switch targets, no sideways scroll, and the Month card is no taller in Plan", async ({ page }) => {
    await revealMoney(page);
    await pinPlan(page);
    const expected = await expectedSummary(page, { start: RANGE.start, end: RANGE.end, month: MONTH });
    await page.goto(SUMMARY_URL);
    await expectPlan(page, { summary: true });
    // Each option answers a tap 21px above and below its middle (a 44px target).
    for (const name of ["Plan", "Simple"]) {
      const hits = await option(page, name).evaluate((button) => {
        const rect = button.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        return [y - 21, y, y + 21].map((at) => button.contains(document.elementFromPoint(x, at)));
      });
      expect(hits, `${name} hit area`).toEqual([true, true, true]);
      expect((await option(page, name).boundingBox()).width, `${name} width`).toBeGreaterThanOrEqual(44);
    }
    await option(page, "Simple").tap();
    await expectSimple(page, { summary: true, earned: expected.earned, spent: expected.spent });
    await expect(page.locator("[data-earned-spent] .earned-spent-row").first()).toBeVisible();
    const width = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: window.innerWidth }));
    expect(width.document).toBeLessThanOrEqual(width.viewport + 1);
    // Each month's name is a 44px target.
    const link = await page.locator("[data-earned-spent] .summary-month-link").first().boundingBox();
    expect(link.height).toBeGreaterThanOrEqual(44);
    await expectFlatMonthRows(page);

    // Month in Plan with the switch in its head stays within the 270px card.
    await page.evaluate((key) => window.localStorage.setItem(key, "plan"), STORAGE_KEY);
    await page.goto(MONTH_URL);
    await expectPlan(page, { summary: false });
    const card = await page.locator(".month-lead").boundingBox();
    expect(card.height, "Month lead height in Plan").toBeLessThanOrEqual(270);
    await option(page, "Simple").tap();
    const may = await expectedMonth(page, MONTH);
    await expectSimple(page, { summary: false, earned: may.earned, spent: may.spent });
    const simpleCard = await page.locator(".month-lead").boundingBox();
    expect(simpleCard.height, "Month lead height in Simple").toBeLessThanOrEqual(card.height);
  });

  test("a fresh Simple visit draws the month names as flat row links, not grey buttons", async ({ page }) => {
    await revealMoney(page);
    // No Plan first: the Intent vs Outcome stylesheet is never loaded, so the
    // Simple view must style the month name itself.
    await page.goto(SUMMARY_URL);
    await expect(page.locator("[data-earned-spent] .earned-spent-row").first()).toBeVisible();
    await expectFlatMonthRows(page);
  });

  test("hidden money in Simple: shares and shapes only, no amount and no kept or overspent word", async ({ page }) => {
    await recordBareMonth(page);
    await postJson(page, "/api/entries/create", {
      date: `${MONTH}-25`,
      description: "Simple view salary",
      accountName: "UOB One",
      categoryName: "Salary",
      amountMinor: 900_000,
      entryType: "income",
      ownershipType: "direct",
      ownerName: "Tim"
    });
    await page.addInitScript((key) => window.localStorage.setItem(key, "simple"), STORAGE_KEY);
    await page.goto(SUMMARY_URL);
    const group = leadGroup(page);
    await expect(group).toHaveAttribute("data-lead-view", "simple", { timeout: 30_000 });
    await expect(group.locator('.lead-simple [data-simple="earned"]')).toHaveText("Earned••••");
    await expect(group.locator('.lead-simple [data-simple="spent"]')).toHaveText("Spent••••");
    await expect(group).not.toContainText("$");
    await expect(group.locator("[data-savings-sentence]")).toHaveText(/as (a share|shares) of/);
    await expect(group.locator('[data-savings-legend] [data-legend="plan"]')).toHaveCount(0);
    // The Simple figures lose their tone, like every hidden amount.
    const colours = await group.locator(".lead-simple-figure > span").evaluateAll((spans) => spans.map((span) => getComputedStyle(span).color));
    expect(new Set(colours).size).toBe(1);

    const list = page.locator("[data-earned-spent]");
    await expect(list.locator(".earned-spent-row").first()).toBeVisible();
    await expect(list).not.toContainText("$");
    await expect(list.locator(".earned-spent-months")).not.toContainText(/Kept|Overspent|Earned|Invested/);
    await expect(list.locator(".earned-spent-figures")).toHaveCount(0);
    // May has the salary recorded above; the demo's other months have no
    // income, so there is no share to show and the row says nothing.
    await expect(list.locator(`[data-month="${MONTH}"] .earned-spent-result`)).toHaveText(/^Spent · \d+% of earned$/);
    await expect(list.locator('[data-month="2025-10"] .earned-spent-result')).toHaveCount(0);
    await expect(list.locator(`[data-month="${MONTH}"] .earned-spent-bar [data-segment]`).first()).toBeVisible();

    // The facts keep only the categories' shares: no kept, no daily spend.
    const facts = group.locator("[data-simple-metrics]");
    await expect(facts.locator('[data-metric="top"] button').first()).toHaveText(/^.+ \d+%$/);
    await expect(facts.locator('[data-metric="daily"]')).toHaveCount(0);
    await expect(facts).not.toContainText("$");

    // The no-plan month alone, hidden: the same.
    await page.goto(BARE_SUMMARY_URL);
    await expect(leadGroup(page)).toHaveAttribute("data-lead-view", "simple", { timeout: 30_000 });
    await expect(page.locator(`[data-earned-spent] [data-month="${BARE_MONTH}"] .earned-spent-result`)).toHaveText("Spent · 25% of earned");
    await expect(page.locator("[data-earned-spent]")).not.toContainText("$");
  });
});

// Signed in (the Access identity header, as Cloudflare Access sends it), the
// choice belongs to the login: saved on the server and back on the app
// shell, so it follows the login to a new browser, and two logins keep their
// own. Without a login (every test above) it stays on the device.
test.describe("per login", () => {
  async function loginContext(browser, email, personId = null) {
    const context = await browser.newContext({ extraHTTPHeaders: { "Cf-Access-Authenticated-User-Email": email } });
    await context.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    const page = await context.newPage();
    if (personId) {
      const response = await page.request.post("/api/login-identities/register", { data: { personId } });
      expect(response.ok(), await response.text()).toBeTruthy();
    }
    return { context, page };
  }

  test("a login's choice follows it to a new browser, and another login keeps its own", async ({ browser }) => {
    const tim = await loginContext(browser, "tim.simple@example.com");
    await reseedDemo(tim.page);
    expect((await tim.page.request.post("/api/login-identities/register", { data: { personId: "person-tim" } })).ok()).toBeTruthy();
    await tim.page.goto(SUMMARY_URL);
    // Never chose: Simple, though May has a plan.
    await expect(leadGroup(tim.page)).toHaveAttribute("data-lead-view", "simple", { timeout: 30_000 });
    const saved = tim.page.waitForResponse((response) => response.url().endsWith("/api/viewer-preferences/lead-view"));
    await option(tim.page, "Plan").click();
    expect((await saved).status()).toBe(200);
    await expectPlan(tim.page, { summary: true });
    await tim.context.close();

    // A new browser for the same login: fresh storage, and the choice is back.
    const timAgain = await loginContext(browser, "tim.simple@example.com");
    await timAgain.page.goto(SUMMARY_URL);
    await expectPlan(timAgain.page, { summary: true });
    await timAgain.page.goto(MONTH_URL);
    await expectPlan(timAgain.page, { summary: false });

    // Another login has not chosen: Simple, not Tim's Plan.
    const joyce = await loginContext(browser, "joyce.simple@example.com", "person-joyce");
    await joyce.page.goto(SUMMARY_URL);
    await expect(leadGroup(joyce.page)).toHaveAttribute("data-lead-view", "simple", { timeout: 30_000 });
    await joyce.context.close();

    // Back to Simple on this browser: it stays Simple on reload (the kept app
    // shell is updated too), and a third browser opens in Simple.
    const savedSimple = timAgain.page.waitForResponse((response) => response.url().endsWith("/api/viewer-preferences/lead-view"));
    await option(timAgain.page, "Simple").click();
    expect((await savedSimple).status()).toBe(200);
    await timAgain.page.reload();
    await expect(leadGroup(timAgain.page)).toHaveAttribute("data-lead-view", "simple", { timeout: 30_000 });
    await timAgain.context.close();
    const timThird = await loginContext(browser, "tim.simple@example.com");
    await timThird.page.goto(SUMMARY_URL);
    await expect(leadGroup(timThird.page)).toHaveAttribute("data-lead-view", "simple", { timeout: 30_000 });
    await timThird.context.close();
  });

  test("a write from another site is refused and changes nothing", async ({ browser }) => {
    const tim = await loginContext(browser, "tim.cross@example.com");
    await reseedDemo(tim.page);
    expect((await tim.page.request.post("/api/login-identities/register", { data: { personId: "person-tim" } })).ok()).toBeTruthy();
    const refused = await tim.page.request.post("/api/viewer-preferences/lead-view", {
      data: { leadView: "simple" },
      headers: { "Sec-Fetch-Site": "cross-site", Origin: "https://elsewhere.example" }
    });
    expect(refused.status()).toBe(403);
    await tim.page.goto(SUMMARY_URL);
    // Nothing changed: still the default, Simple.
    await expect(leadGroup(tim.page)).toHaveAttribute("data-lead-view", "simple", { timeout: 30_000 });
    await tim.context.close();
  });
});
