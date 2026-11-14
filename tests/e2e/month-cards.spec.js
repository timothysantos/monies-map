import { expect, test } from "@playwright/test";

import { loadMonthPage, loadSummaryPage, reseedDemo } from "./helpers";

// Month cards (design.md "Month cards"): the Month page's cards wear the
// Summary dashboard's design. Every card has the shared head (title and one
// quiet subtitle in the same computed sizes as Summary's), Spending mix has
// the icon-bubble donut that draws in on first view and, for a complete
// month, the change note against the month before (Summary's rule, from
// figures the tab already holds). The lead keeps its compact Month form (its
// height and text-only gap are guarded in summary-month-lsd and money-tones).

const MONTH = "2025-10";
const RANGE = { summaryStart: "2025-06", summaryEnd: "2025-10" };
const RANGE_QUERY = `summary_start=${RANGE.summaryStart}&summary_end=${RANGE.summaryEnd}`;
const MONTH_URL = (month = MONTH, view = "person-tim") => `/month?view=${view}&month=${month}&${RANGE_QUERY}`;

async function open(page, url, { lead = "plan", money = true } = {}) {
  await page.addInitScript(({ lead: view, money: shown }) => {
    window.localStorage.setItem("monies-map:money-totals-visible", String(shown));
    window.localStorage.setItem("monies-map:lead-view", view);
  }, { lead, money });
  await page.goto(url);
  await expect.poll(() => page.evaluate(() => window.__MONIES_MAP_ROUTE_WORK__?.usable ?? false), { timeout: 45_000 }).toBe(true);
}

// Title and subtitle of every Month card, with their computed look.
// A card slot with nothing in it (What changed outside the month in progress) has no head.
const readMonthHeads = (page) => page.locator("[data-month-card]:not(:empty)").evaluateAll((cards) => cards.map((card) => {
  const title = card.querySelector(".summary-card-title");
  const sub = card.querySelector(".summary-card-sub");
  const t = title && getComputedStyle(title);
  const s = sub && getComputedStyle(sub);
  return {
    id: card.dataset.monthCard,
    title: title?.textContent.trim() ?? null,
    sub: sub?.textContent.trim() ?? null,
    look: t && s ? `${t.fontSize} ${t.fontWeight} ${t.textTransform} | ${s.fontSize} ${s.fontWeight} ${s.color}` : null
  };
}));

const summaryHeadLook = (page) => page.locator('[data-summary-card="mix"]').evaluate((card) => {
  const t = getComputedStyle(card.querySelector(".summary-card-title"));
  const s = getComputedStyle(card.querySelector(".summary-card-sub"));
  return `${t.fontSize} ${t.fontWeight} ${t.textTransform} | ${s.fontSize} ${s.fontWeight} ${s.color}`;
});

const expectedNote = (current, previous) => {
  const percent = Math.round((Math.abs(current - previous) / previous) * 100);
  return `${current > previous ? "▲" : "▼"} ${percent}% vs the month before`;
};

test.describe("Month cards wear Summary's design", () => {
  test.beforeEach(async ({ page }) => {
    await reseedDemo(page);
  });

  for (const size of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    test(`${size.width} wide: every card has the shared head, in Summary's sizes`, async ({ page }) => {
      await page.setViewportSize(size);
      await open(page, `/summary?view=person-tim&month=${MONTH}&${RANGE_QUERY}`);
      await expect(page.locator('[data-summary-card="mix"] .summary-card-title')).toBeVisible({ timeout: 30_000 });
      const summaryLook = await summaryHeadLook(page);
      const mixTotalSize = () => page.locator(".summary-mix-total-amount").first().evaluate((node) => getComputedStyle(node).fontSize);
      const summaryMixSize = await mixTotalSize();

      await page.goto(MONTH_URL());
      await expect(page.locator('[data-month-card="mix"] .summary-card-title')).toBeVisible({ timeout: 30_000 });
      const heads = await readMonthHeads(page);
      expect(heads.map(({ id, title, sub }) => [id, title, sub])).toEqual([
        ["insights", "Money insights", "Needs a look, and went well"],
        ["mix", "Spending mix", "By category, Oct 2025"],
        ["monthNote", "Monthly note", "Why the month looked like this"],
        ["accounts", "Accounts", "Balances on the latest statements"]
      ]);
      for (const head of heads) expect(head.look, head.id).toBe(summaryLook);
      // Spending mix's big total is the same size as Summary's.
      expect(await mixTotalSize()).toBe(summaryMixSize);
    });
  }

  test("Simple: Money in wears the same head, with the month", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, MONTH_URL(), { lead: "simple" });
    const moneyIn = page.locator('[data-month-card="moneyIn"]');
    await expect(moneyIn.locator(".summary-card-title")).toHaveText("Money in", { timeout: 30_000 });
    await expect(moneyIn.locator(".summary-card-sub")).toHaveText("By source, Oct 2025");
  });

  test("a complete month's Spending mix notes the change against the month before; the month in progress and hidden money do not", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const monthData = await loadMonthPage(page, { view: "person-tim", month: MONTH });
    const summary = await loadSummaryPage(page, { view: "person-tim", month: MONTH, ...RANGE });
    const current = monthData.summaryPage.months[0].realExpensesMinor;
    const previous = summary.summaryPage.months.find((item) => item.month === "2025-09").realExpensesMinor;
    expect(previous).toBeGreaterThanOrEqual(10_000);

    await open(page, MONTH_URL());
    const mix = page.locator('[data-month-card="mix"]');
    await expect(mix.locator("[data-change-note]")).toHaveText(expectedNote(current, previous), { timeout: 30_000 });
    // Every slice and row still opens its figure menu.
    await expect(mix.locator(".summary-mix-arrow[data-fig='category']").first()).toBeVisible();
    // The donut draws in once on first view, then rests.
    const donut = mix.locator(".spending-mix-bubbles");
    await donut.scrollIntoViewIfNeeded();
    await expect(donut).toHaveAttribute("data-donut-motion", "done", { timeout: 10_000 });

    // The range's first month has no month before it loaded: no note, no held line.
    await page.goto(MONTH_URL("2025-06"));
    await expect(page.locator('[data-month-card="mix"] .summary-mix-total-amount')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-month-card="mix"] .summary-mix-note')).toHaveCount(0);
  });

  test("hidden money shows no change note", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, MONTH_URL(), { money: false });
    await expect(page.locator('[data-month-card="mix"] .summary-card-title')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    await expect(page.locator('[data-month-card="mix"] .summary-mix-note')).toHaveCount(0);
  });
});
