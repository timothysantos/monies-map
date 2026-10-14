import { devices, expect, test } from "@playwright/test";

import { loadEntriesPage, loadMonthPage, loadSummaryPage, postJson, reseedDemo } from "./helpers";

// Openable figures (design.md "Openable figures"): every figure on a card is
// quietly openable. A tap, click, Enter or Space opens a small menu (View
// entries, Open plan, Open Splits, Ask about this); View entries opens
// Entries narrowed to exactly the money behind the figure, over its whole
// period, and the total Entries leads with is the figure. The exact cents
// for every figure kind, view and scope are in tests/openable-figures.test.mjs;
// this proves the menu, the navigation, the keyboard, hidden money and the
// shown totals in a real browser on a phone and a desktop.

const VIEW = "person-tim";
const MAY = "2026-05";
const RANGE = { start: "2025-06", end: MAY };
const summaryUrl = `/summary?view=${VIEW}&month=${MAY}&scope=direct_plus_shared&summary_start=${RANGE.start}&summary_end=${RANGE.end}`;
const monthUrl = `/month?view=${VIEW}&month=${MAY}&scope=direct_plus_shared&summary_start=${RANGE.start}&summary_end=${RANGE.end}`;
const cents = (minor) => new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" }).format(minor / 100);
const { defaultBrowserType: _browser, ...iPhone13 } = devices["iPhone 13"];
const menu = (page) => page.locator("[data-figure-menu]");

// Tim, May 2026: a salary, a GIRO filed under Investments and $9,000 moved
// from UOB One into Endowus (an investment account), a linked pair.
async function seed(page) {
  const entry = (body) => postJson(page, "/api/entries/create", { accountName: "UOB One", ownershipType: "direct", ownerName: "Tim", ...body });
  await entry({ date: `${MAY}-25`, description: "Figures salary", categoryName: "Salary", entryType: "income", amountMinor: 650_000 });
  await entry({ date: `${MAY}-03`, description: "iFAST GIRO", categoryName: "Investments", entryType: "expense", amountMinor: 120_000 });
  await postJson(page, "/api/accounts/create", { name: "Endowus", institution: "Endowus", kind: "investment", currency: "SGD", openingBalanceMinor: 0, ownerPersonId: VIEW });
  const { entryId: fromEntryId } = await entry({ date: `${MAY}-12`, description: "Endowus top-up", categoryName: "Transfer", entryType: "transfer", transferDirection: "out", amountMinor: 900_000 });
  const { entryId: toEntryId } = await entry({ date: `${MAY}-12`, description: "Endowus top-up", accountName: "Endowus", categoryName: "Transfer", entryType: "transfer", transferDirection: "in", amountMinor: 900_000 });
  await postJson(page, "/api/transfers/link", { fromEntryId, toEntryId });
}

// The range's invested, worked out from the Summary DTO by hand: the
// Investments category plus the moves into investment accounts, less out.
async function summaryInvested(page) {
  const { summaryPage } = await loadSummaryPage(page, { view: VIEW, month: MAY, summaryStart: RANGE.start, summaryEnd: RANGE.end });
  const filed = summaryPage.categoryShareChart.find((slice) => slice.label === "Investments")?.valueMinor ?? 0;
  const moves = summaryPage.investmentMoves ?? { intoMinor: 0, outOfMinor: 0 };
  return Math.max(0, filed + moves.intoMinor - moves.outOfMinor);
}

async function openLead(page, url, selector) {
  await page.goto(url);
  const lead = page.locator(selector);
  await expect(lead.locator(".summary-lead-spent")).toBeVisible({ timeout: 30_000 });
  return lead;
}

function box(locator) {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:lead-view", "plan"));
  await reseedDemo(page);
  await seed(page);
});

test.describe("desktop", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  });

  test("Summary: Invested opens a menu; View entries shows the range's invested to the cent", async ({ page }) => {
    const invested = await summaryInvested(page);
    expect(invested, "the GIRO and the Endowus top-up").toBeGreaterThanOrEqual(1_020_000);
    const lead = await openLead(page, summaryUrl, ".summary-lead");
    // The figure keeps its text; it is quietly openable, not a button to look at.
    const figure = lead.locator('[data-legend="invested"] [data-fig="invested"]');
    await expect(figure).toHaveCSS("text-decoration-line", "none");
    await figure.hover();
    await expect(figure).toHaveCSS("text-decoration-line", "underline");
    await figure.click();
    await expect(menu(page)).toHaveAttribute("aria-label", "Invested: what next");
    await expect(menu(page).getByRole("button")).toHaveText(["View entries", "Open May 2026 plan", "Ask about this"]);
    await expect(figure).toHaveAttribute("aria-expanded", "true");
    // Under the figure, inside the page.
    const menuBox = await box(menu(page));
    expect(menuBox.y).toBeGreaterThanOrEqual((await box(figure)).bottom - 1);
    expect(menuBox.right).toBeLessThanOrEqual(1440 - 16);

    await menu(page).getByRole("button", { name: "View entries" }).click();
    await expect(page).toHaveURL(/\/entries\?.*entry_figure=invested.*entry_from=2025-06.*entry_to=2026-05/);
    const entriesLead = page.locator(".entries-totals-lead");
    await expect(entriesLead.locator(".lsd-eyebrow")).toHaveText("Invested · Jun 2025 – May 2026", { timeout: 30_000 });
    await expect(entriesLead.locator(".lsd-amount")).toHaveText(cents(invested));
    // The rows behind it: the GIRO and Endowus's side of the top-up, never the cash side.
    await expect(page.locator(".entry-row").filter({ hasText: "iFAST GIRO" })).toHaveCount(1);
    await expect(page.locator(".entry-row").filter({ hasText: "Endowus top-up" })).toHaveCount(1);
    // The chip says what the list shows; ✕ is the month's whole list again.
    const chip = page.locator("[data-figure-chip]");
    await expect(chip).toHaveText("Invested · Jun 2025 – May 2026");
    await chip.getByRole("button", { name: "Show all of this month's entries" }).click();
    await expect(page).not.toHaveURL(/entry_figure|entry_from/);
    await expect(entriesLead.locator(".lsd-eyebrow")).toHaveText("Spent · May 2026");
  });

  test("Month: Spent's Ask about this asks and answers at once; Open plan lands on the plan", async ({ page }) => {
    const lead = await openLead(page, monthUrl, ".month-lead");
    await lead.locator(".summary-lead-spent").click();
    const ask = menu(page).getByRole("button", { name: "Ask about this" });
    await expect(ask).toHaveAttribute("data-question", /^(What did I spend the most on|Why did I spend more than planned) in May 2026\?$/);
    const question = await ask.getAttribute("data-question");
    await ask.click();
    await expect(menu(page)).toHaveCount(0);
    // The Ask panel beside the page asks it and answers it.
    const panel = page.locator(".ask-dock");
    await expect(panel.getByText(question, { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(panel.locator("[data-ask-money-answer], .ask-answer-card").first()).toBeVisible({ timeout: 30_000 });

    // The Income column's plan is the Month plan's income part.
    await page.goto(monthUrl);
    await expect(page.locator(".month-lead .summary-lead-spent")).toBeVisible({ timeout: 30_000 });
    await page.locator('.month-lead [data-metric="income"]').click();
    await menu(page).getByRole("button", { name: "Open plan" }).click();
    await expect(page).toHaveURL(/\/month\?.*#month-plan-income$/);
    await expect(page.locator("#month-plan-income")).toBeInViewport({ timeout: 10_000 });
  });

  test("keyboard: Enter and Space open the menu with its first choice focused; Escape closes it and gives the figure its focus back", async ({ page }) => {
    const lead = await openLead(page, summaryUrl, ".summary-lead");
    const spent = lead.locator(".summary-lead-spent");
    await spent.focus();
    await page.keyboard.press("Enter");
    await expect(menu(page)).toBeVisible();
    await expect(menu(page).getByRole("button", { name: "View entries" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu(page)).toHaveCount(0);
    await expect(spent).toBeFocused();
    await expect(spent).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press(" ");
    await expect(menu(page)).toBeVisible();
    // Enter on a choice takes it.
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/entries\?.*entry_figure=spending/);
  });

  test("Entries: a pill opens its menu and View entries narrows the list to its rows, the figure unchanged", async ({ page }) => {
    const { monthPage } = await loadEntriesPage(page, { view: VIEW, month: MAY });
    expect(monthPage.entries.length).toBeGreaterThan(3);
    await page.goto(`/entries?view=${VIEW}&month=${MAY}&scope=direct_plus_shared&entries_scope=direct_plus_shared`);
    const pill = page.locator('.entries-totals-pill[data-pill="transfers"]');
    await expect(pill).toBeVisible({ timeout: 30_000 });
    const figure = await pill.locator("strong").innerText();
    const allRows = await page.locator(".entry-row").count();
    await pill.click();
    await menu(page).getByRole("button", { name: "View entries" }).click();
    await expect(page).toHaveURL(/entry_figure=transfers/);
    await expect(page.locator(".entries-totals-lead .lsd-eyebrow")).toHaveText("Transfers · May 2026");
    await expect(page.locator(".entries-totals-lead .lsd-amount")).toHaveText(figure);
    await expect(pill.locator("strong")).toHaveText(figure);
    expect(await page.locator(".entry-row").count()).toBeLessThan(allRows);
  });

  test("Month plan row: the actual opens exactly its entries, whose Spent is the actual", async ({ page }) => {
    const data = await loadMonthPage(page, { view: VIEW, month: MAY });
    const row = data.monthPage.planSections.flatMap((section) => section.rows).find((item) => item.actualEntryIds?.length && item.actualMinor > 0);
    expect(row, "a plan row with entries behind it").toBeTruthy();
    await page.goto(monthUrl);
    const actual = page.locator(`.month-actual-drilldown[data-fig-ids="${row.actualEntryIds.join(" ")}"]`).first();
    await expect(actual).toHaveText(cents(row.actualMinor), { timeout: 30_000 });
    await actual.click();
    await menu(page).getByRole("button", { name: "View entries" }).click();
    await expect(page).toHaveURL(/entry_figure=spent.*entry_id=/);
    await expect(page.locator(".entries-totals-lead .lsd-amount")).toHaveText(cents(row.actualMinor), { timeout: 30_000 });
    await expect(page.locator(".entry-row")).toHaveCount(row.actualEntryIds.length);
  });

  test("hidden money: the same menu, no amount in it, and a question that does not say which side of the plan", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "false"));
    const lead = await openLead(page, monthUrl, ".month-lead");
    await expect(lead.locator(".summary-lead-spent")).toHaveText("••••");
    await lead.locator('[data-legend="spent"] [data-fig]').click();
    await expect(menu(page).getByRole("button")).toHaveText(["View entries", "Open plan", "Ask about this"]);
    // The title keeps the figure's name and period; no amount shows.
    await expect(menu(page).locator(".figure-menu-title")).toHaveText("Spent · May 2026");
    expect(await menu(page).evaluate((element) => element.textContent + element.getAttribute("aria-label"))).not.toMatch(/\$|\d+\.\d\d/);
    await expect(menu(page).getByRole("button", { name: "Ask about this" })).toHaveAttribute("data-question", "How did my spending compare with the plan in May 2026?");
  });
});

test.describe("phone", () => {
  test.use(iPhone13);

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  });

  test("a tap on Invested opens the menu inside the screen; View entries shows the same total", async ({ page }) => {
    const invested = await summaryInvested(page);
    const lead = await openLead(page, summaryUrl, ".summary-lead");
    await lead.locator('[data-segment="invested"]').tap();
    await expect(menu(page)).toBeVisible();
    // It leads with what it is: the figure's name and its period.
    await expect(menu(page).locator(".figure-menu-title")).toHaveText("Invested · Jun 2025 – May 2026");
    expect(await menu(page).evaluate((element) => element.firstElementChild?.className)).toContain("figure-menu-title");
    const menuBox = await box(menu(page));
    expect(menuBox.x).toBeGreaterThanOrEqual(16);
    expect(menuBox.right).toBeLessThanOrEqual(390 - 16);
    for (const button of await menu(page).getByRole("button").all()) {
      expect((await box(button)).height, "a 44px target").toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
    // A tap outside closes it.
    await lead.locator(".lsd-eyebrow").first().tap();
    await expect(menu(page)).toHaveCount(0);
    await lead.locator('[data-segment="invested"]').tap();
    await menu(page).getByRole("button", { name: "View entries" }).tap();
    await expect(page.locator(".entries-totals-lead .lsd-amount")).toHaveText(cents(invested), { timeout: 30_000 });
  });

  test("Simple: a Top spending chip opens its category's spending over the period", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:lead-view", "simple"));
    const { monthPage } = await loadMonthPage(page, { view: VIEW, month: MAY });
    await page.goto(monthUrl);
    const chip = page.locator(".simple-top-category").first();
    await expect(chip).toBeVisible({ timeout: 30_000 });
    const name = await chip.getAttribute("data-category");
    const slice = monthPage.categoryShareChart.find((item) => item.label === name);
    await chip.tap();
    await expect(menu(page)).toHaveAttribute("aria-label", `${name}: what next`);
    await expect(menu(page).getByRole("button", { name: "Ask about this" })).toHaveAttribute("data-question", `How much did I spend on ${name} in May 2026?`);
    await menu(page).getByRole("button", { name: "View entries" }).tap();
    await expect(page.locator(".entries-totals-lead .lsd-amount")).toHaveText(cents(slice.valueMinor), { timeout: 30_000 });
  });

  test("Ask about this on a phone opens the Ask page with the question answered", async ({ page }) => {
    const lead = await openLead(page, monthUrl, ".month-lead");
    await lead.locator('[data-metric="saved"]').tap();
    const ask = menu(page).getByRole("button", { name: "Ask about this" });
    await expect(ask).toHaveAttribute("data-question", "How much did I save in May 2026?");
    await ask.tap();
    await expect(page).toHaveURL(/\/ask\?/);
    await expect(page.locator('[data-ask-money-answer="saved"]')).toBeVisible({ timeout: 30_000 });
  });
});
