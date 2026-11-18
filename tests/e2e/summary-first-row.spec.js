import { expect, test } from "@playwright/test";

import { expectFits } from "./fit-check.js";
import { STRESS, seedStressHousehold } from "./fit-stress-fixture.js";
import { postJson, reseedDemo } from "./helpers";

// Summary's row of "Earned vs spent" and "What changed" (owner request,
// 2026-11-18; design.md "Summary first card row"): the month list starts with
// the newest 3 months and "Show all N ›" opens the rest in place ("Show
// fewer" folds them); beside it, What changed shows as many whole rows as fit
// the height of the folded month card, at least 3, with "Show all N ›" only
// while some are left out. A phone keeps What changed's first 3 rows.

// Simple is the default lead; the default spec storage pins Plan.
test.use({ storageState: { cookies: [], origins: [] } });

function monthsAgo(count) {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Singapore" }));
  const at = new Date(now.getFullYear(), now.getMonth() - count, 1);
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}`;
}

// This month against last month: 8 categories move, so What changed has 8 rows.
const SPEND = {
  "Food & Drinks": [90_000, 40_000], Shopping: [60_000, 10_000], Groceries: [20_000, 70_000], Bills: [45_000, 15_000],
  Entertainment: [5_000, 35_000], Education: [50_000, 10_000], Healthcare: [4_000, 30_000], Travel: [120_000, 20_000]
};
const CHANGED_ROWS = Object.keys(SPEND).length;

async function addMonths(page, { tim = "Tim", joyce = "Joyce" } = {}) {
  for (let back = 6; back >= 0; back -= 1) {
    const month = monthsAgo(back);
    await postJson(page, "/api/entries/create", { date: `${month}-01`, description: "PAYROLL", accountName: "UOB One", categoryName: "Salary", amountMinor: 800_000, entryType: "income", ownershipType: "direct", ownerName: tim });
    for (const [category, [now, before]] of Object.entries(SPEND)) {
      const amountMinor = back === 0 ? now : back === 1 ? before : 30_000;
      await postJson(page, "/api/entries/create", { date: `${month}-01`, description: `${category.toUpperCase()} SHOP`, accountName: "Citi Rewards", categoryName: category, amountMinor, entryType: "expense", ownershipType: "direct", ownerName: joyce });
    }
  }
}

// `start`: the range's first month (the range always ends this month, as
// What changed shows only then).
async function openSummary(page, start = null) {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await page.goto(start ? `/summary?view=household&summary_start=${start}&summary_end=${monthsAgo(0)}` : "/summary?view=household");
  await expect(page.locator(".chg-card .chg-row").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("[data-earned-spent] .earned-spent-row").first()).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

const months = (page) => page.locator("[data-earned-spent] .earned-spent-row");
const shownMonths = (page) => page.locator("[data-earned-spent] .earned-spent-row:visible");
const monthFold = (page) => page.locator("[data-earned-spent]").getByRole("button", { name: /^(Show all \d+ ›|Show fewer)$/ });
const changedRows = (page) => page.locator(".chg-card .chg-row:visible");
const changedFold = (page) => page.locator(".chg-card").getByRole("button", { name: /^Show all \d+ ›$/ });

// The geometry of the row: each card's box and the bottom of each shown row of What changed.
function rowGeometry(page) {
  return page.evaluate(() => {
    const box = (element) => element.getBoundingClientRect();
    const card = document.querySelector(".chg-card");
    const list = card.querySelector(".chg-list");
    const shown = [...list.querySelectorAll(":scope > .chg-row")].filter((row) => row.checkVisibility({ visibilityProperty: true }));
    return {
      left: box(document.querySelector("[data-earned-spent]")),
      right: box(card),
      list: box(list),
      rowBottoms: shown.map((row) => box(row).bottom),
      smallestRow: Math.min(...[...list.querySelectorAll(":scope > .chg-row")].map((row) => row.offsetHeight))
    };
  });
}

test.describe("Summary's first card row", () => {
  test.beforeEach(async ({ page }) => {
    await reseedDemo(page);
    await addMonths(page);
  });

  test("the month list starts with the newest 3 months; Show all opens the rest and Show fewer folds them", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openSummary(page);
    const total = await months(page).count();
    expect(total).toBeGreaterThan(3);
    await expect(shownMonths(page)).toHaveCount(3);
    // The three shown are the newest: this month first.
    const shownKeys = await shownMonths(page).evaluateAll((rows) => rows.map((row) => row.dataset.month));
    expect(shownKeys).toEqual([monthsAgo(0), monthsAgo(1), monthsAgo(2)]);
    // Each shown figure is still openable, and its month title opens the month.
    for (const row of await shownMonths(page).all()) {
      await expect(row.locator('[data-fig="earned"]')).toHaveCount(1);
      await expect(row.locator('[data-fig="spending"]')).toHaveCount(1);
      await expect(row.locator('[data-fig="kept"]')).toHaveCount(1);
    }

    const fold = monthFold(page);
    await expect(fold).toHaveText(`Show all ${total} ›`);
    await expect(fold).toHaveAttribute("aria-expanded", "false");
    await fold.evaluate((button) => button.scrollIntoView({ block: "center", behavior: "instant" }));
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await fold.click();
    await expect(shownMonths(page)).toHaveCount(total);
    await expect(fold).toHaveText("Show fewer");
    await expect(fold).toHaveAttribute("aria-expanded", "true");
    // Focus moves to the first month that appeared; the page does not jump.
    await expect(page.locator(`[data-earned-spent] [data-month="${monthsAgo(3)}"] .summary-month-link`)).toBeFocused();
    expect(Math.abs((await page.evaluate(() => window.scrollY)) - scrollBefore)).toBeLessThanOrEqual(2);

    await fold.click();
    await expect(shownMonths(page)).toHaveCount(3);
    await expect(fold).toHaveAttribute("aria-expanded", "false");

    // Opening a month from its title still works.
    await shownMonths(page).first().locator(".summary-month-link").click();
    await expect(page).toHaveURL(new RegExp(`month=${monthsAgo(0)}`));
  });

  test("3 months or fewer: every month shows and there is no Show all", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openSummary(page, monthsAgo(2));
    await expect(months(page)).toHaveCount(3);
    await expect(shownMonths(page)).toHaveCount(3);
    await expect(monthFold(page)).toHaveCount(0);
  });

  for (const viewport of [{ width: 1280, height: 800 }, { width: 1440, height: 900 }]) {
    test(`${viewport.width}x${viewport.height}: What changed fills the month card's height with whole rows`, async ({ page }) => {
      await page.setViewportSize(viewport);

      // A short month card (2 months): not every row fits, so Show all stays.
      await openSummary(page, monthsAgo(1));
      let shape = await rowGeometry(page);
      expect(Math.abs(shape.left.bottom - shape.right.bottom)).toBeLessThanOrEqual(4);
      expect(shape.rowBottoms.length).toBeGreaterThanOrEqual(3);
      expect(shape.rowBottoms.length).toBeLessThan(CHANGED_ROWS);
      for (const bottom of shape.rowBottoms) expect(bottom).toBeLessThanOrEqual(shape.right.bottom);
      await expect(changedFold(page)).toHaveText(`Show all ${CHANGED_ROWS} ›`);
      // As many as fit: the room left under the list is less than a row.
      expect(shape.right.bottom - shape.list.bottom).toBeLessThan(shape.smallestRow + 18);
      const fewer = shape.rowBottoms.length;

      // A tall month card (all months, folded to 3): more rows fit, and at
      // 1440 every one, with no Show all.
      await openSummary(page);
      shape = await rowGeometry(page);
      expect(Math.abs(shape.left.bottom - shape.right.bottom)).toBeLessThanOrEqual(4);
      expect(shape.rowBottoms.length).toBeGreaterThan(fewer);
      for (const bottom of shape.rowBottoms) expect(bottom).toBeLessThanOrEqual(shape.list.bottom + 1);
      if (viewport.width === 1440) {
        await expect(changedRows(page)).toHaveCount(CHANGED_ROWS);
        await expect(changedFold(page)).toHaveCount(0);
      } else if (shape.rowBottoms.length < CHANGED_ROWS) {
        await expect(changedFold(page)).toHaveText(`Show all ${CHANGED_ROWS} ›`);
        expect(shape.right.bottom - shape.list.bottom).toBeLessThan(shape.smallestRow + 18);
      } else {
        await expect(changedFold(page)).toHaveCount(0);
      }

      // Opening the month list does not stretch What changed: it keeps its
      // height, at the top of the row.
      const before = shape.right;
      await monthFold(page).click();
      await expect(shownMonths(page)).toHaveCount(await months(page).count());
      shape = await rowGeometry(page);
      expect(shape.left.height).toBeGreaterThan(before.height + 100);
      expect(Math.abs(shape.right.height - before.height)).toBeLessThanOrEqual(2);
      expect(Math.abs(shape.right.top - shape.left.top)).toBeLessThanOrEqual(2);
    });
  }

  test("1280x800: Show all on What changed opens every row", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openSummary(page, monthsAgo(1));
    await changedFold(page).click();
    await expect(changedRows(page)).toHaveCount(CHANGED_ROWS);
    await expect(changedFold(page)).toHaveCount(0);
    // Every amount still opens its entries.
    await expect(page.locator(".chg-card .chg-meta [data-fig]")).toHaveCount(CHANGED_ROWS * 2);
  });

  test("phone: What changed keeps its first 3 rows and the month list its newest 3", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openSummary(page);
    await expect(changedRows(page)).toHaveCount(3);
    await expect(page.locator(".chg-card .chg-row")).toHaveCount(3);
    await expect(changedFold(page)).toHaveText(`Show all ${CHANGED_ROWS} ›`);
    await expect(shownMonths(page)).toHaveCount(3);
    await expect(monthFold(page)).toHaveText(`Show all ${await months(page).count()} ›`);
  });
});

// The phone fit check (docs/code-spec.md "Phone fit check") with the heavy
// household: the row folded, then both lists open. A What changed row's
// name button is 28 px tall, unchanged by this work: the whole row is its
// tap target (summary-changed-section.jsx, Row), so the check skips it.
const ROW_NAME = [".chg-open"];

test("phone fit: Summary's first card row, folded and open", async ({ page }) => {
  test.setTimeout(240_000);
  await seedStressHousehold(page);
  await addMonths(page, { tim: STRESS.tim, joyce: STRESS.joyce });
  for (const phone of [{ width: 320, height: 568 }, { width: 375, height: 557 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(phone);
    await openSummary(page);
    await page.locator("[data-earned-spent]").scrollIntoViewIfNeeded();
    for (const card of ["plan", "changed"]) await expectFits(page, { root: `[data-summary-card="${card}"]`, ignore: ROW_NAME });
    await monthFold(page).click();
    await changedFold(page).click();
    await expect(changedFold(page)).toHaveCount(0);
    for (const card of ["plan", "changed"]) await expectFits(page, { root: `[data-summary-card="${card}"]`, ignore: ROW_NAME });
  }
});
