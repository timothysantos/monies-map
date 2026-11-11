import { devices, expect, test } from "@playwright/test";

import { gotoPageAfterApi, loadSummaryPage, reseedDemo } from "./helpers";

// Summary's Plan view on a desktop (owner decision, 2026-10-20; design.md
// "Summary lead"; docs/audits/summary-plan-layout/): the lead card takes the
// Summary's full width, the viewer and its Direct / Shared / Both switch sit
// in the title row, and Income and Saved are a slim stat strip inside the
// card (the Month lead's pattern) instead of two tall cards in a right
// column. From a 960 px wide card the lead is two columns: the headline, bar
// and sentence on the left, the money jobs and the strip on the right. A
// phone keeps its stacked lead, the Income and Saved pills under it and the
// floating View and scope bar.

const MONTH = "2026-05";
const RANGE = { view: "person-tim", month: MONTH, summaryStart: "2025-06", summaryEnd: MONTH };
const SUMMARY_URL = `/summary?view=person-tim&month=${MONTH}&scope=direct_plus_shared&summary_start=2025-06&summary_end=${MONTH}`;
const money = (minor) => new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" }).format(minor / 100);
const { defaultBrowserType: _browser, ...iPhone13 } = devices["iPhone 13"];
const menu = (page) => page.locator("[data-figure-menu]");

// The lead card's height at 1,440 px for this seed and range before the
// change (Income and Saved as cards beside it, the money jobs under the
// sentence): measured on the old layout, 2026-10-20.
const OLD_LEAD_HEIGHT_1440 = 331;

function box(locator) {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
  });
}

// What the old Income and Saved cards showed, worked out from the page DTO
// by hand as lead-support-detail.spec.js does (splitMoneyUse).
async function expectedSupport(page) {
  const { summaryPage } = await loadSummaryPage(page, RANGE);
  const card = (label) => summaryPage.metricCards.find((item) => item.label === label)?.amountMinor ?? 0;
  const slice = (label) => summaryPage.categoryShareChart.filter((item) => item.label === label).reduce((sum, item) => sum + item.valueMinor, 0);
  const moves = summaryPage.investmentMoves ?? { intoMinor: 0, outOfMinor: 0 };
  const spent = card("Actual spend") - slice("Investments") - slice("Savings");
  const invested = Math.max(0, slice("Investments") + moves.intoMinor - moves.outOfMinor);
  return {
    income: card("Actual income"),
    incomePlan: card("Planned income"),
    kept: card("Actual income") - spent - invested,
    savingsTarget: card("Savings target")
  };
}

// The money jobs are open on a desktop (folded on a phone); wait for their rows.
async function openSummary(page, { jobsOpen = true } = {}) {
  await gotoPageAfterApi(page, SUMMARY_URL, "/api/summary-page", () => page.locator(".summary-lead .summary-lead-spent"));
  if (jobsOpen) await expect(page.locator(".summary-lead .money-jobs-list")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await reseedDemo(page);
});

test.describe("desktop", () => {
  for (const width of [1280, 1440, 1920]) {
    test(`${width}: one full-width lead with Income and Saved in its strip and the scope in the title row`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const expected = await expectedSupport(page);
      await openSummary(page);
      const lead = page.locator(".summary-lead");

      // No right column: no Income or Saved cards anywhere.
      await expect(page.locator(".summary-support-pills, .summary-support-pill")).toHaveCount(0);

      // The strip: every figure the old cards had, with the same words.
      const income = lead.locator('.lead-column[data-metric="income"]');
      const saved = lead.locator('.lead-column[data-metric="saved"]');
      await expect(lead.locator(".lead-column")).toHaveCount(2);
      await expect(income.locator(".lead-column-label")).toHaveText("Income");
      await expect(income.locator("strong")).toHaveText(money(expected.income));
      await expect(income.locator("small")).toHaveText(`plan ${money(expected.incomePlan)}`);
      await expect(saved.locator(".lead-column-label")).toHaveText("Saved");
      await expect(saved.locator("strong")).toHaveText(money(expected.kept));
      await expect(saved.locator("small")).toHaveText(`target ${money(expected.savingsTarget)}`);
      await expect(income).toHaveAttribute("data-fig", "earned");
      await expect(income).toHaveAttribute("data-fig-plan", "income");
      await expect(saved).toHaveAttribute("data-fig", "kept");

      // The lead takes the Summary's full width, under the title row.
      // On the dashboard grid the lead takes 8 of 12 columns with Money
      // insights beside it (design.md "Summary dashboard layout").
      const panel = await box(page.locator(".summary-head"));
      const grid = await box(page.locator(".summary-grid"));
      const leadBox = await box(lead);
      const title = await box(page.locator(".summary-head h2"));
      expect(leadBox.width / grid.width, "lead is two thirds of the grid").toBeGreaterThan(0.64);
      expect(leadBox.width / grid.width).toBeLessThan(0.69);
      const insights = await box(page.locator('[data-summary-card="insights"]'));
      expect(insights.x, "Money insights sits beside the lead").toBeGreaterThanOrEqual(leadBox.right);
      expect(insights.y).toBe(leadBox.y);
      expect(leadBox.y).toBeGreaterThanOrEqual(title.bottom);

      // The viewer and the scope switch sit beside the title, whole.
      const scope = page.getByRole("group", { name: "Scope" });
      await expect(scope.getByRole("button")).toHaveText(["Direct", "Shared", "Both"]);
      const scopeBox = await box(scope);
      expect(scopeBox.x).toBeGreaterThan(title.right);
      expect(scopeBox.y).toBeLessThan(title.bottom);
      expect(scopeBox.bottom).toBeGreaterThan(title.y);
      expect(scopeBox.right).toBeLessThanOrEqual(panel.right);
      await expect(page.locator(".summary-head .panel-context")).toHaveText("Viewing • Tim");
      const clipped = await page.locator(".summary-head .panel-context, .summary-scope-switch .pill").evaluateAll((elements) => elements
        .filter((element) => element.scrollWidth > element.clientWidth + 1 || element.getBoundingClientRect().width < 20)
        .map((element) => element.textContent));
      expect(clipped).toEqual([]);

      // Two columns in the card: headline, bar and sentence on the left; the
      // money jobs and the strip under them on the right.
      const figure = await box(lead.locator(".lsd-figure"));
      const sentence = await box(lead.locator(".savings-bar-sentence"));
      const jobs = await box(lead.locator(".money-jobs"));
      const strip = await box(lead.locator(".lead-columns"));
      expect(jobs.x).toBeGreaterThan(figure.right);
      expect(jobs.x).toBeGreaterThan(sentence.right);
      expect(jobs.y).toBeLessThan(figure.bottom);
      expect(strip.x).toBe(jobs.x);
      expect(strip.y).toBeGreaterThanOrEqual(jobs.bottom);
      expect(strip.bottom).toBeLessThanOrEqual(leadBox.bottom);

      if (width === 1440) {
        expect(leadBox.height, `was ${OLD_LEAD_HEIGHT_1440} px`).toBeLessThanOrEqual(OLD_LEAD_HEIGHT_1440 * 0.75);
      }
    });
  }

  test("the strip's figures open the menus the cards had, and View entries totals are the figures", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const expected = await expectedSupport(page);
    await openSummary(page);
    const income = page.locator('.summary-lead .lead-column[data-metric="income"]');
    await income.click();
    await expect(menu(page)).toHaveAttribute("aria-label", "Earned: what next");
    await expect(menu(page).getByRole("button")).toHaveText(["View entries", "Open May 2026 plan", "Ask about this"]);
    await menu(page).getByRole("button", { name: "View entries" }).click();
    await expect(page).toHaveURL(/\/entries\?.*entry_figure=earned.*entry_from=2025-06.*entry_to=2026-05/);
    await expect(page.locator(".entries-totals-lead .lsd-amount")).toHaveText(money(expected.income), { timeout: 30_000 });

    await openSummary(page);
    // The keyboard reaches the strip after the money jobs: Enter opens it.
    const saved = page.locator('.summary-lead .lead-column[data-metric="saved"]');
    await saved.focus();
    await page.keyboard.press("Enter");
    await expect(menu(page)).toBeVisible();
    await expect(menu(page).getByRole("button").first()).toBeFocused();
    await expect(menu(page).getByRole("button")).toHaveText(["View entries", "Open May 2026 plan", "Ask about this"]);
    await menu(page).getByRole("button", { name: "View entries" }).click();
    await expect(page).toHaveURL(/\/entries\?.*entry_figure=kept/);
    await expect(page.locator(".entries-totals-lead .lsd-amount")).toHaveText(money(expected.kept), { timeout: 30_000 });
  });

  test("the money jobs keep the open state the person left when the card lays out in two columns", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openSummary(page);
    const jobs = page.locator(".summary-lead .money-jobs");
    const before = await box(page.locator(".summary-lead"));
    await jobs.locator(".money-jobs-summary").click();
    await expect(jobs).not.toHaveAttribute("open", "");
    // Folded, the strip moves up under the line and the card is no taller.
    const after = await box(page.locator(".summary-lead"));
    expect(after.height).toBeLessThanOrEqual(before.height);
    await page.setViewportSize({ width: 1920, height: 900 });
    await expect(jobs).not.toHaveAttribute("open", "");
  });

  test("Summary adds almost no layout shift while the lead loads", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      window.__shift = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          // A banner that mounts above the Summary (the import reminder) moves
          // the whole panel as one block; that is the shell's, not the
          // dashboard's layout, so it is not counted here. Every other shift
          // (a card or the lead moving inside the panel) is.
          const panelOnly = entry.sources.length > 0 && entry.sources.every((source) => source.node instanceof Element && source.node.classList.contains("panel"));
          if (!entry.hadRecentInput && !panelOnly) window.__shift += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    await openSummary(page);
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => window.__shift)).toBeLessThanOrEqual(0.05);
  });
});

test.describe("phone", () => {
  test.use({ ...iPhone13 });

  test("390: the stacked lead, the Income and Saved pills under it and no scope switch in the page", async ({ page }) => {
    const expected = await expectedSupport(page);
    await openSummary(page, { jobsOpen: false });
    const lead = await box(page.locator(".summary-lead"));
    const income = page.locator('.summary-support-pill[data-metric="income"]');
    const saved = page.locator('.summary-support-pill[data-metric="saved"]');
    await expect(income.locator("strong")).toHaveText(money(expected.income));
    await expect(saved.locator("strong")).toHaveText(money(expected.kept));
    // Still the pills with their tone's surface (design.md "Money colour").
    await expect(income).toHaveClass(/^summary-support-pill money-/);
    expect((await box(income)).y).toBeGreaterThan(lead.bottom);
    await expect(page.locator(".summary-lead .lead-column")).toHaveCount(0);
    await expect(page.locator(".summary-scope-switch")).toHaveCount(0);
    // Stacked: the money jobs under the sentence, not beside it.
    const sentence = await box(page.locator(".summary-lead .savings-bar-sentence"));
    expect((await box(page.locator(".summary-lead .money-jobs"))).y).toBeGreaterThan(sentence.y);
  });
});
