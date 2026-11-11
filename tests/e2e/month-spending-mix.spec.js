import { devices, expect, test } from "@playwright/test";

import { loadMonthPage, loadSummaryPage, reseedDemo } from "./helpers";

// The Summary tab's month choice drives Spending Mix. All months shows the
// range; a picked month (the Month page) shows that month's donut and
// category cards, below the money insights and above the plan tables, from
// the Month page it already loaded. A category card opens Entries for that
// category and month. A month with no spending shows the empty state.

const RANGE = { summaryStart: "2025-06", summaryEnd: "2025-10" };
const RANGE_QUERY = `summary_start=${RANGE.summaryStart}&summary_end=${RANGE.summaryEnd}`;
const SUMMARY_URL = `/summary?view=person-tim&month=2025-10&${RANGE_QUERY}`;
const iPhone = devices["iPhone 13"];
const moneyFormatter = new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" });
const formatMoney = (minor) => moneyFormatter.format(minor / 100);
const sumMinor = (data) => data.reduce((sum, item) => sum + item.valueMinor, 0);
const monthLabel = (month) => {
  const [year, number] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-SG", { month: "short", year: "numeric" }).format(new Date(year, number - 1, 1)).replace(/\bSept\b/, "Sep");
};

async function waitUsable(page) {
  await expect.poll(() => page.evaluate(() => window.__MONIES_MAP_ROUTE_WORK__?.usable ?? false), { timeout: 45_000 }).toBe(true);
}

async function rangeSummary(page) {
  const data = await loadSummaryPage(page, { view: "person-tim", month: RANGE.summaryEnd, ...RANGE });
  return data.summaryPage;
}

function monthShare(summary, month) {
  const share = summary.categoryShareByMonth.find((item) => item.month === month)?.data;
  expect(share, `the Summary page has ${month}'s share`).toBeTruthy();
  return share;
}

// Two range months with spending, and different totals so a stale donut shows.
function pickTwoMonths(summary) {
  const withSpend = summary.rangeMonths.filter((month) => monthShare(summary, month).length > 0);
  expect(withSpend.length).toBeGreaterThan(1);
  const [first, second] = withSpend.slice(-2);
  expect(sumMinor(monthShare(summary, first))).not.toBe(sumMinor(monthShare(summary, second)));
  return { earlier: first, later: second };
}

function spendingMix(page) {
  return page.locator(".chart-card").filter({ has: page.getByRole("heading", { name: "Spending mix" }) });
}

async function expectMix(page, share) {
  const mix = spendingMix(page);
  await expect(mix).toHaveCount(1);
  await expect(mix.locator(".summary-mix-total-amount")).toHaveText(formatMoney(sumMinor(share)));
  // The ranked list shows the top five (three on a phone); "Show all N" lists the rest
  // (tests/e2e/summary-body-lsd.spec.js covers the toggle).
  const rows = mix.locator(".summary-mix-row");
  const listed = Math.min(share.length, page.viewportSize().width < 761 ? 3 : 5);
  await expect(rows).toHaveCount(listed);
  await expect(rows.first()).toContainText(share[0].label);
  await expect(rows.first()).toContainText(formatMoney(share[0].valueMinor));
  await expect(rows.last()).toContainText(share[listed - 1].label);
}

// Spending Mix sits in the Month content after the money insights and before
// the plan tables.
async function expectMixPlacedInMonth(page) {
  const order = await page.locator(".month-panel").evaluate((panel) => {
    const insight = panel.querySelector(".financial-insight-month");
    const mix = panel.querySelector(".month-spending-mix");
    const plans = panel.querySelector(".month-plan-stack");
    const follows = (a, b) => Boolean(a && b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING));
    return { afterInsight: follows(insight, mix), beforePlans: follows(mix, plans) };
  });
  expect(order).toEqual({ afterInsight: true, beforePlans: true });
}

// A person scope's month with no spending, in the range (the seed's Shared
// scope has some for Tim).
async function findEmptyMonth(page) {
  for (const scope of ["shared", "direct"]) {
    for (const view of ["person-tim", "person-joyce"]) {
      const { summaryPage } = await loadSummaryPage(page, { view, month: RANGE.summaryEnd, ...RANGE, scope });
      const empty = summaryPage.categoryShareByMonth.find((item) => item.data.length === 0);
      if (empty) {
        return { view, scope, month: empty.month };
      }
    }
  }
  throw new Error("The seed has no month without spending in the range.");
}

test.describe("Spending Mix for a picked month on a phone", () => {
  test.use({ viewport: iPhone.viewport, hasTouch: true, isMobile: true, userAgent: iPhone.userAgent, deviceScaleFactor: 2 });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.goto("/");
    await reseedDemo(page);
  });

  test("picking a month shows its Spending Mix, the arrows update it, and All months shows the range", async ({ page }) => {
    const summary = await rangeSummary(page);
    const { earlier, later } = pickTwoMonths(summary);
    await page.goto(SUMMARY_URL);
    await waitUsable(page);
    await expectMix(page, summary.categoryShareChart);

    // Pick the later month in the sheet: no Spending Mix request of its own.
    const spendingRequests = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/summary-page")) spendingRequests.push(request.url());
    });
    const island = page.locator(".mobile-context-sticky-wrap");
    await island.getByRole("button", { name: /All months/ }).click();
    const sheet = page.getByRole("dialog", { name: "Pick a month" });
    await sheet.getByRole("button", { name: new RegExp(`^${monthLabel(later)}`) }).click();
    await expect(page).toHaveURL(new RegExp(`/month\\?.*month=${later}(&|$)`));
    await waitUsable(page);
    await expectMix(page, monthShare(summary, later));
    await expectMixPlacedInMonth(page);
    expect(spendingRequests).toEqual([]);

    // The Month page's own figures agree with what the donut shows.
    const { monthPage } = await loadMonthPage(page, { view: "person-tim", month: later });
    expect(monthPage.categoryShareChart).toEqual(monthShare(summary, later));

    // Step back to the earlier month with the arrow, one month at a time
    // (each step waits for its URL): the donut follows.
    const control = island.getByRole("group", { name: "Month" });
    const steps = summary.rangeMonths.slice(summary.rangeMonths.indexOf(earlier), summary.rangeMonths.indexOf(later)).reverse();
    for (const month of steps) {
      await control.getByRole("button", { name: "Previous month" }).click();
      await expect(page).toHaveURL(new RegExp(`month=${month}(&|$)`));
      await expect(control).toContainText(monthLabel(month));
    }
    await waitUsable(page);
    await expectMix(page, monthShare(summary, earlier));

    // All months: the whole range again.
    await control.getByRole("button", { name: new RegExp(monthLabel(earlier)) }).click();
    await page.getByRole("dialog", { name: "Pick a month" }).getByRole("button", { name: /All months/ }).click();
    await expect(page).toHaveURL(/\/summary\?/);
    await waitUsable(page);
    await expectMix(page, summary.categoryShareChart);
  });

  test("with money hidden the month's Spending Mix shows no amounts", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "false"));
    const summary = await rangeSummary(page);
    const { later } = pickTwoMonths(summary);
    await page.goto(`/month?view=person-tim&month=${later}&${RANGE_QUERY}`);
    await waitUsable(page);
    const mix = spendingMix(page);
    await expect(mix.locator(".summary-mix-row")).toHaveCount(Math.min(monthShare(summary, later).length, 5));
    const text = await mix.innerText();
    expect(text).not.toMatch(/\$\s?\d/);
    expect(text).toContain("••••");
    await expect(mix.locator(".summary-mix-total-amount")).not.toContainText("$");
  });

  test("a category card opens Entries for that category and the picked month", async ({ page }) => {
    const summary = await rangeSummary(page);
    const { earlier } = pickTwoMonths(summary);
    const top = monthShare(summary, earlier)[0];
    await page.goto(`/month?view=person-tim&month=${earlier}&${RANGE_QUERY}`);
    await waitUsable(page);
    // The arrow opens the category's menu (design.md "Openable figures").
    await spendingMix(page).getByRole("button", { name: `View entries for ${top.label}` }).click();
    await page.locator('[data-figure-menu="category"]').getByRole("button", { name: "View entries" }).click();
    await expect(page).toHaveURL(/\/entries\?/);
    const url = new URL(page.url());
    expect(url.searchParams.get("month")).toBe(earlier);
    expect(url.searchParams.getAll("entry_category")).toEqual([top.label]);
    expect(url.searchParams.get("view")).toBe("person-tim");
    await waitUsable(page);
    // Only that category's rows in that month: every row names it, and the
    // Spend total is the card's amount.
    const rows = page.locator(".entry-row");
    await expect(rows.first()).toBeVisible();
    expect((await rows.allInnerTexts()).every((text) => text.includes(top.label))).toBe(true);
    await expect(page.getByRole("region", { name: "Entry totals" })).toContainText(formatMoney(top.valueMinor));
  });

  test("a month with no spending shows the empty state, not a chart", async ({ page }) => {
    const { view, scope, month } = await findEmptyMonth(page);
    await page.goto(`/month?view=${view}&month=${month}&scope=${scope}&${RANGE_QUERY}`);
    await waitUsable(page);
    const mix = spendingMix(page);
    await expect(mix).toHaveCount(1);
    await expect(mix.locator(".state-note .state-title")).toHaveText("No spend rows in this view.");
    await expect(mix.locator(".spending-mix-chart-shell")).toHaveCount(0);
    await expect(mix.locator(".summary-mix-row")).toHaveCount(0);
  });
});

test.describe("Spending Mix for a picked month on a desktop", () => {
  test.use({ viewport: { width: 1280, height: 860 } });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.goto("/");
    await reseedDemo(page);
  });

  test("the month row picks a month's Spending Mix, switches it, and All months shows the range", async ({ page }) => {
    const summary = await rangeSummary(page);
    const { earlier, later } = pickTwoMonths(summary);
    await page.goto(SUMMARY_URL);
    await waitUsable(page);
    await expectMix(page, summary.categoryShareChart);

    const row = page.getByRole("group", { name: "Month" });
    await row.getByRole("button", { name: monthLabel(later), exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/month\\?.*month=${later}(&|$)`));
    await waitUsable(page);
    await expectMix(page, monthShare(summary, later));
    await expectMixPlacedInMonth(page);

    await row.getByRole("button", { name: monthLabel(earlier), exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`month=${earlier}(&|$)`));
    await waitUsable(page);
    await expectMix(page, monthShare(summary, earlier));

    await row.getByRole("button", { name: "All months" }).click();
    await expect(page).toHaveURL(/\/summary\?/);
    await waitUsable(page);
    await expectMix(page, summary.categoryShareChart);
  });

  test("a category card on a picked month opens Entries for that category and month", async ({ page }) => {
    const summary = await rangeSummary(page);
    const { later } = pickTwoMonths(summary);
    const last = monthShare(summary, later).at(-1);
    await page.goto(`/month?view=person-tim&month=${later}&${RANGE_QUERY}`);
    await waitUsable(page);
    await spendingMix(page).getByRole("button", { name: `View entries for ${last.label}` }).click();
    await page.locator('[data-figure-menu="category"]').getByRole("button", { name: "View entries" }).click();
    await expect(page).toHaveURL(/\/entries\?/);
    const url = new URL(page.url());
    expect(url.searchParams.get("month")).toBe(later);
    expect(url.searchParams.getAll("entry_category")).toEqual([last.label]);
    await waitUsable(page);
    await expect(page.getByRole("region", { name: "Entry totals" })).toContainText(formatMoney(last.valueMinor));
  });

  test("a month with no spending shows the empty state, not a chart", async ({ page }) => {
    const { view, scope, month } = await findEmptyMonth(page);
    await page.goto(`/month?view=${view}&month=${month}&scope=${scope}&${RANGE_QUERY}`);
    await waitUsable(page);
    const mix = spendingMix(page);
    await expect(mix.locator(".state-note .state-title")).toHaveText("No spend rows in this view.");
    await expect(mix.locator(".spending-mix-chart-shell")).toHaveCount(0);
  });
});
