import { expect, test } from "@playwright/test";

import { loadMonthPage, loadSummaryPage, postJson, reseedDemo } from "./helpers";

// Owner decision d34 (DOMAIN.md "Money job"): money moved into an account of
// kind Investment is invested, not kept, and money taken back out of one is
// its own line ("Took out of investments"), never a negative invested. The
// Month and Summary lead's savings bar, the Invest job and Ask's "How much
// did I invest" read the same split (splitMoneyUse) from the page's
// `investmentMoves`. The exact numbers are in tests/investment-moves.test.mjs
// and tests/ask-money-jobs-answers.test.mjs; this proves what the screens
// show on a real Worker. Set INVESTMENT_SHOTS=<dir> to keep screenshots.

const VIEW = "person-tim";
const MAY = "2026-05";
const APRIL = "2026-04";
const RANGE = { start: "2025-06", end: MAY };
const monthUrl = (month) => `/month?view=${VIEW}&month=${month}&scope=direct_plus_shared&summary_start=${RANGE.start}&summary_end=${RANGE.end}`;
const wholeFormat = new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD", maximumFractionDigits: 0 });
const dollars = (minor) => wholeFormat.format(minor / 100);
const cents = (minor) => new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" }).format(minor / 100);
const MOVED_IN = 200_000;
const TAKEN_OUT = 9_000_000;

// Tim's Endowus account (kind Investment): $2,000 in from UOB One in May,
// and $90,000 back out to UOB One in April. Both are linked pairs. April
// also has a $5,000 salary and a $1,200 GIRO filed under Investments.
async function seedInvestmentMoves(page) {
  await postJson(page, "/api/accounts/create", { name: "Endowus", institution: "Endowus", kind: "investment", currency: "SGD", openingBalanceMinor: 0, ownerPersonId: VIEW });
  const transfer = async (date, amountMinor, from, to, description) => {
    const entry = (accountName, transferDirection) => postJson(page, "/api/entries/create", {
      date, description, accountName, categoryName: "Transfer", amountMinor, entryType: "transfer", transferDirection, ownershipType: "direct", ownerName: "Tim"
    });
    const { entryId: fromEntryId } = await entry(from, "out");
    const { entryId: toEntryId } = await entry(to, "in");
    await postJson(page, "/api/transfers/link", { fromEntryId, toEntryId });
  };
  await transfer(`${MAY}-12`, MOVED_IN, "UOB One", "Endowus", "Endowus top-up");
  await transfer(`${APRIL}-20`, TAKEN_OUT, "Endowus", "UOB One", "Endowus withdrawal");
  for (const [date, description, categoryName, entryType, amountMinor] of [
    [`${APRIL}-25`, "April salary", "Salary", "income", 500_000],
    [`${APRIL}-03`, "April GIRO", "Investments", "expense", 120_000]
  ]) {
    await postJson(page, "/api/entries/create", { date, description, accountName: "UOB One", categoryName, amountMinor, entryType, ownershipType: "direct", ownerName: "Tim" });
  }
}

// A month's money as the lead splits it, worked out here from the Month page
// DTO by hand rather than by the model under test.
async function monthFigures(page, month) {
  const data = await loadMonthPage(page, { view: VIEW, month });
  const slice = (label) => data.monthPage.categoryShareChart.find((item) => item.label === label)?.valueMinor ?? 0;
  const moves = data.monthPage.investmentMoves ?? { intoMinor: 0, outOfMinor: 0 };
  const income = data.summaryPage.months[0].actualIncomeMinor;
  const filed = slice("Investments");
  const spending = data.summaryPage.months[0].realExpensesMinor - filed - slice("Savings");
  const net = filed + moves.intoMinor - moves.outOfMinor;
  const invested = Math.max(0, net);
  return { moves, income, filed, spending, invested, takenOut: Math.max(0, -net), kept: income - spending - invested };
}

async function openMonthLead(page, month) {
  await page.goto(monthUrl(month));
  const lead = page.locator(".month-lead");
  await expect(lead.locator(".summary-lead-spent")).toBeVisible({ timeout: 30_000 });
  return lead.locator("[data-savings-bar]");
}

async function keepShot(page, locator, name) {
  if (process.env.INVESTMENT_SHOTS) {
    await locator.screenshot({ path: `${process.env.INVESTMENT_SHOTS}/${name}.png` });
  }
}

test.describe("money moved into and out of investment accounts", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await reseedDemo(page);
    await seedInvestmentMoves(page);
  });

  test("Month lead: the transfer into Endowus is invested, not kept", async ({ page }) => {
    const figures = await monthFigures(page, MAY);
    expect(figures.moves).toEqual({ intoMinor: MOVED_IN, outOfMinor: 0 });
    expect(figures.invested).toBe(figures.filed + MOVED_IN);
    const bar = await openMonthLead(page, MAY);
    await expect(bar.locator('[data-segment="invested"]')).toHaveCount(1);
    await expect(bar.locator('[data-legend="invested"]')).toContainText(`Invested ${dollars(figures.invested)}`);
    // Saved is what was kept: the $2,000 moved in is not in it.
    await expect(page.locator('.month-lead [data-metric="saved"] strong')).toHaveText(cents(figures.kept));
    await expect(bar.locator('[data-legend="taken-out"]')).toHaveCount(0);
    await keepShot(page, page.locator(".month-lead"), "month-lead-may-moved-in");
  });

  test("Month lead: a month that took more out than it put in says Took out of investments, with no invested part", async ({ page }) => {
    const figures = await monthFigures(page, APRIL);
    expect(figures.moves).toEqual({ intoMinor: 0, outOfMinor: TAKEN_OUT });
    expect([figures.filed, figures.takenOut]).toEqual([120_000, TAKEN_OUT - 120_000]);
    const bar = await openMonthLead(page, APRIL);
    await expect(bar.locator('[data-segment="invested"]')).toHaveCount(0);
    await expect(bar.locator('[data-legend="taken-out"]')).toHaveText(`Took out of investments ${dollars(figures.takenOut)}`);
    await keepShot(page, page.locator(".month-lead"), "month-lead-april-taken-out");

    // Hidden money leaves the line out.
    await page.evaluate(() => window.localStorage.setItem("monies-map:money-totals-visible", "false"));
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "false"));
    await page.reload();
    await expect(page.locator(".month-lead .summary-lead-spent")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.month-lead [data-legend="taken-out"]')).toHaveCount(0);
  });

  test("Summary lead nets the range's moves", async ({ page }) => {
    const data = await loadSummaryPage(page, { view: VIEW, month: MAY, summaryStart: RANGE.start, summaryEnd: RANGE.end });
    expect(data.summaryPage.investmentMoves).toEqual({ intoMinor: MOVED_IN, outOfMinor: TAKEN_OUT });
  });

  test("Ask: How much did I invest counts the transfer into Endowus with the Investments entries", async ({ page }) => {
    const figures = await monthFigures(page, MAY);
    await page.goto(`/ask?view=${VIEW}&month=${MAY}&scope=direct_plus_shared`);
    const message = page.getByRole("textbox", { name: "Message" });
    await expect(message).toBeVisible();
    await message.fill("How much did I invest in May 2026?");
    await message.press("Enter");
    const answer = page.locator('[data-ask-money-answer="invested"]');
    await expect(answer).toBeVisible({ timeout: 30_000 });
    await expect(answer.locator(".ask-answer-amount")).toHaveText(cents(figures.invested));
    await expect(answer.locator(".ask-money-wording")).toContainText(`You put ${cents(figures.invested)} into Investments in May.`);
    await expect(answer.locator(".ask-money-lines")).toContainText("Endowus top-up");
    // The answer's savings bar is the lead's.
    await expect(answer.locator('[data-legend="invested"]')).toContainText(`Invested ${dollars(figures.invested)}`);
    await keepShot(page, answer, "ask-invested-may");
  });
});
