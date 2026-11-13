import { expect, test } from "@playwright/test";

import { postJson, reseedDemo } from "./helpers";

// The Month page (a month picked in the Summary tab) and the Summary landing
// page fit a phone: no card reaches past the screen, nothing inside a card
// reaches past that card, and the page never scrolls sideways. Checked at
// 390 and 375 wide, with money shown, in Plan and in Simple, and with
// six-figure sums. The owner saw the Month page's Spending mix and its money
// cards overshoot the screen on an iPhone (2026-11-13): a Month rule reset
// the phone's full-bleed card margins and left the card 24px too wide.

const MONTH = "2025-10";
const RANGE = "summary_start=2025-06&summary_end=2025-10";
const PHONES = [{ width: 390, height: 844 }, { width: 375, height: 812 }];

async function addLongSums(page) {
  await postJson(page, "/api/entries/create", {
    date: `${MONTH}-12`, description: "RENOVATION CONTRACTOR FINAL", accountName: "UOB One", categoryName: "Family & Personal",
    entryType: "expense", ownershipType: "direct", ownerName: "Tim", amountMinor: 48_765_432
  });
  await postJson(page, "/api/entries/create", {
    date: `${MONTH}-15`, description: "PROPERTY SALE PROCEEDS", accountName: "UOB One", categoryName: "Other - Income",
    entryType: "income", ownershipType: "direct", ownerName: "Tim", amountMinor: 98_765_432
  });
}

// What reaches past the screen or past its own card, as plain strings.
async function fitProblems(page, cardSelector) {
  return page.evaluate((selector) => {
    const problems = [];
    const viewport = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > viewport + 1) problems.push(`page scrolls sideways (${document.documentElement.scrollWidth} > ${viewport})`);
    const name = (node) => `${node.tagName.toLowerCase()}.${String(node.className).trim().split(/\s+/).slice(0, 3).join(".")}`;
    const cards = [...document.querySelectorAll(selector)];
    if (!cards.length) problems.push(`no card matches ${selector}`);
    for (const card of cards) {
      const box = card.getBoundingClientRect();
      if (box.left < -0.5 || box.right > viewport + 0.5) problems.push(`${name(card)} reaches past the screen (${Math.round(box.left)} to ${Math.round(box.right)} of ${viewport})`);
      for (const node of card.querySelectorAll("*")) {
        const inner = node.getBoundingClientRect();
        if (inner.width === 0 || inner.height === 0) continue;
        if (getComputedStyle(node).position === "fixed") continue;
        if (inner.left < box.left - 0.5 || inner.right > box.right + 0.5) problems.push(`${name(node)} in ${name(card)} reaches past the card`);
      }
    }
    return [...new Set(problems)];
  }, cardSelector);
}

async function settle(page) {
  await expect.poll(() => page.evaluate(() => window.__MONIES_MAP_ROUTE_WORK__?.usable ?? false), { timeout: 45_000 }).toBe(true);
  // Lazy cards and their charts arrive on first view: scroll through once.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 400) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(1200);
}

// The cards themselves: on a phone a chart card runs edge to edge (past its
// grid slot, by design), so each is held to the screen and its own box.
const MONTH_CARDS = ".month-panel .lsd-card, .month-panel .chart-card, .month-panel .summary-account-pill";
const SUMMARY_CARDS = "[data-summary-grid] .lsd-card, [data-summary-grid] .chart-card, [data-summary-grid] [data-tile]";

test.describe("Month and Summary fit a phone", () => {
  test.beforeEach(async ({ page }) => {
    await reseedDemo(page);
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  });

  for (const size of PHONES) {
    for (const leadView of ["plan", "simple"]) {
      test(`Month page at ${size.width} wide in ${leadView}, with six-figure sums`, async ({ page }) => {
        await addLongSums(page);
        await page.setViewportSize(size);
        await page.addInitScript((view) => window.localStorage.setItem("monies-map:lead-view", view), leadView);
        await page.goto(`/month?view=person-tim&month=${MONTH}&${RANGE}`);
        const mix = page.locator(".month-panel .spending-mix-card");
        await expect(mix).toBeVisible({ timeout: 30_000 });
        await expect(mix.locator("[data-total-spend]")).toContainText(/\d{3},\d{3}\.\d{2}/);
        if (leadView === "simple") await expect(page.locator(".month-panel [data-money-in]")).toBeVisible();
        await settle(page);
        expect(await fitProblems(page, MONTH_CARDS)).toEqual([]);
      });
    }

    test(`Summary page at ${size.width} wide, with six-figure sums`, async ({ page }) => {
      await addLongSums(page);
      await page.setViewportSize(size);
      await page.goto(`/summary?view=person-tim&month=${MONTH}&${RANGE}`);
      await expect(page.locator("[data-summary-grid] .spending-mix-card")).toBeVisible({ timeout: 30_000 });
      await settle(page);
      expect(await fitProblems(page, SUMMARY_CARDS)).toEqual([]);
    });
  }

  // The guard itself: a card made wider than the screen is reported.
  test("a card wider than the screen is reported", async ({ page }) => {
    await page.setViewportSize(PHONES[0]);
    await page.goto(`/month?view=person-tim&month=${MONTH}&${RANGE}`);
    await expect(page.locator(".month-panel .spending-mix-card")).toBeVisible({ timeout: 30_000 });
    await page.addStyleTag({ content: ".month-panel .spending-mix-card { margin-inline: 0 !important; width: calc(100% + 24px) !important; }" });
    const problems = await fitProblems(page, ".month-panel .spending-mix-card");
    expect(problems.some((line) => line.includes("reaches past the screen"))).toBe(true);
  });
});
