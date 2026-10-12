import { devices, expect, test } from "@playwright/test";

import { loadSummaryPage, reseedDemo } from "./helpers";

// One Summary tab: All months is the Summary page (/summary), a picked month
// is the Month page (/month?month=...). The header picks the range, a phone
// picks the month in the floating island and its "Pick a month" sheet, a
// desktop in the month row under the header. The URL stays the source of
// truth, and picking a month pins the range so it never moves.

const RANGE = { summaryStart: "2025-06", summaryEnd: "2025-10" };
const SUMMARY_URL = `/summary?view=person-tim&month=2025-10&summary_start=${RANGE.summaryStart}&summary_end=${RANGE.summaryEnd}`;
const iPhone = devices["iPhone 13"];
const moneyFormatter = new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" });
const wholeMoneyFormatter = new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD", minimumFractionDigits: 0, maximumFractionDigits: 0 });
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

function countRequests(page, fragment) {
  const urls = [];
  page.on("request", (request) => {
    if (request.url().includes(fragment)) urls.push(request.url());
  });
  return urls;
}

test.describe("Summary tab month choice on a phone", () => {
  test.use({ viewport: iPhone.viewport, hasTouch: true, isMobile: true, userAgent: iPhone.userAgent, deviceScaleFactor: 2 });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.goto("/");
    await reseedDemo(page);
  });

  test("the bottom bar has one Summary tab and no Month tab", async ({ page }) => {
    await page.goto(SUMMARY_URL);
    await waitUsable(page);
    const tabs = page.locator("nav.tab-strip");
    await expect(tabs.locator("> a.tab:visible")).toHaveText(["Summary", "Entries", "Splits", "Ask"]);
    await expect(tabs.getByRole("link", { name: "Month", exact: true })).toHaveCount(0);
    await expect(tabs.getByRole("button", { name: "More pages" })).toBeVisible();
    // One grid column per primary tab, then the ••• menu, and every tab fits
    // its column on one line.
    expect(await tabs.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(5);
    const overflowing = await tabs.locator("> a.tab:visible, > button.tab").evaluateAll((items) => items
      .filter((item) => item.scrollWidth > item.clientWidth + 1 || item.getBoundingClientRect().height > 60)
      .map((item) => item.textContent.trim()));
    expect(overflowing).toEqual([]);
  });

  test("picking a month in the sheet opens Month for it, pins the range and reuses the loaded Summary", async ({ page }) => {
    const summary = await rangeSummary(page);
    const rangeMonths = summary.rangeMonths;
    expect(rangeMonths.length).toBeGreaterThan(2);
    await page.goto("/summary?view=person-tim&month=2026-04");
    await waitUsable(page);

    const island = page.locator(".mobile-context-sticky-wrap");
    const allMonths = island.getByRole("button", { name: /All months/ });
    await expect(allMonths).toHaveText(/All months\s*Month/);
    // Beside the month control the scope trigger shows no hint line (one
    // row), but a screen reader still hears it.
    const hint = island.locator(".mobile-context-trigger-hint");
    expect(await hint.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThanOrEqual(1);
    await expect(island.locator(".mobile-context-trigger")).toHaveAccessibleName("Tim · Direct + Shared View and scope");
    // On Entries the hint line still shows (negative case).
    await page.goto("/entries?view=person-tim&month=2026-04");
    await waitUsable(page);
    expect(await hint.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(5);
    await page.goto("/summary?view=person-tim&month=2026-04");
    await waitUsable(page);
    const islandHeight = await island.locator(".mobile-context-sticky-bar").evaluate((element) => element.getBoundingClientRect().height);
    expect(islandHeight).toBeLessThanOrEqual(48);

    const summaryRequests = countRequests(page, "/api/summary-page");
    await allMonths.click();
    const sheet = page.getByRole("dialog", { name: "Pick a month" });
    await expect(sheet).toBeVisible();
    const implicit = await (await page.request.get("/api/summary-page?view=person-tim&month=2026-04&scope=direct_plus_shared")).json();
    const shownMonths = implicit.summaryPage.rangeMonths;
    await expect(sheet.locator(".summary-month-tile")).toHaveCount(shownMonths.length);
    // Newest month first, years as headings.
    const newest = shownMonths.at(-1);
    await expect(sheet.locator(".summary-month-tile").first()).toContainText(monthLabel(newest).split(" ")[0]);
    await expect(sheet.locator(".summary-month-all")).toHaveAttribute("aria-pressed", "true");

    const target = shownMonths.at(-2);
    await sheet.locator(".summary-month-tile").nth(1).click();
    await expect(sheet).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/month\\?.*month=${target}`));
    const url = new URL(page.url());
    expect(url.searchParams.get("summary_start")).toBe(shownMonths[0]);
    expect(url.searchParams.get("summary_end")).toBe(newest);
    await waitUsable(page);
    await expect(page.locator(".month-panel-head")).toBeVisible();
    await expect(island.getByRole("group", { name: "Month" })).toContainText(monthLabel(target));
    await expect(page.locator("nav.tab-strip").getByRole("link", { name: "Summary", exact: true })).toHaveAttribute("aria-current", "page");
    // The pinned range reuses the Summary page already loaded: no new request.
    expect(summaryRequests).toEqual([]);
    await expect(page.locator(".control-bar .period-range-segment").first()).toHaveText(monthLabel(shownMonths[0]));
  });

  test("a /month deep link lands on the Summary tab with that month picked", async ({ page }) => {
    await page.goto("/month?view=person-tim&month=2025-08");
    await waitUsable(page);
    await expect(page).toHaveURL(/\/month\?.*month=2025-08/);
    await expect(page.locator(".month-panel-head")).toBeVisible();
    const tabs = page.locator("nav.tab-strip");
    await expect(tabs.getByRole("link", { name: "Summary", exact: true })).toHaveClass(/is-active/);
    await expect(tabs.getByRole("link", { name: "Summary", exact: true })).toHaveAttribute("aria-current", "page");
    const control = page.locator(".mobile-context-sticky-wrap").getByRole("group", { name: "Month" });
    await expect(control).toContainText(monthLabel("2025-08"));
    // The header keeps the range, not a single month.
    await expect(page.locator(".control-bar .period-mode")).toHaveText("Range");
    await expect(page.locator(".control-bar .period-range-segment")).toHaveCount(2);
  });

  test("the island arrows step through the range's months and stop at its ends", async ({ page }) => {
    const { rangeMonths } = await rangeSummary(page);
    const first = rangeMonths[0];
    const second = rangeMonths[1];
    await page.goto(`/month?view=person-tim&month=${second}&summary_start=${RANGE.summaryStart}&summary_end=${RANGE.summaryEnd}`);
    await waitUsable(page);
    const control = page.locator(".mobile-context-sticky-wrap").getByRole("group", { name: "Month" });
    const previous = control.getByRole("button", { name: "Previous month" });
    const next = control.getByRole("button", { name: "Next month" });
    await expect(previous).toBeEnabled();

    await previous.click();
    await expect(page).toHaveURL(new RegExp(`month=${first}(&|$)`));
    await expect(control).toContainText(monthLabel(first));
    // The range stays where it was.
    await expect(page).toHaveURL(new RegExp(`summary_start=${RANGE.summaryStart}`));
    // The range's first month has nothing before it.
    await expect(previous).toBeDisabled();

    await next.click();
    await expect(page).toHaveURL(new RegExp(`month=${second}(&|$)`));

    // At the range's last month Next is disabled.
    await page.goto(`/month?view=person-tim&month=${rangeMonths.at(-1)}&summary_start=${RANGE.summaryStart}&summary_end=${RANGE.summaryEnd}`);
    await waitUsable(page);
    await expect(control.getByRole("button", { name: "Next month" })).toBeDisabled();
    await expect(control.getByRole("button", { name: "Previous month" })).toBeEnabled();
  });

  test("All months in the sheet returns to Summary with the same range", async ({ page }) => {
    const { rangeMonths } = await rangeSummary(page);
    await page.goto(`/month?view=person-tim&month=${rangeMonths[1]}&summary_start=${RANGE.summaryStart}&summary_end=${RANGE.summaryEnd}`);
    await waitUsable(page);
    await page.locator(".mobile-context-sticky-wrap").getByRole("button", { name: new RegExp(monthLabel(rangeMonths[1])) }).click();
    const sheet = page.getByRole("dialog", { name: "Pick a month" });
    await expect(sheet).toBeVisible();
    const picked = sheet.locator(".summary-month-tile[aria-pressed='true']");
    await expect(picked).toHaveCount(1);
    await expect(picked).toContainText(monthLabel(rangeMonths[1]).split(" ")[0]);
    await expect(sheet.locator(".summary-month-all")).toHaveAttribute("aria-pressed", "false");

    await sheet.getByRole("button", { name: /All months/ }).click();
    await expect(page).toHaveURL(/\/summary\?/);
    await expect(page).toHaveURL(new RegExp(`summary_start=${RANGE.summaryStart}&summary_end=${RANGE.summaryEnd}`));
    await waitUsable(page);
    await expect(page.getByRole("heading", { name: "Summary", exact: true })).toBeVisible();
    await expect(page.locator(".mobile-context-sticky-wrap").getByRole("button", { name: /All months/ })).toBeVisible();
  });

  test("the sheet shows spend against plan for the range and each month, and Escape closes it", async ({ page }) => {
    const summary = await rangeSummary(page);
    await page.goto(SUMMARY_URL);
    await waitUsable(page);
    const trigger = page.locator(".mobile-context-sticky-wrap").getByRole("button", { name: /All months/ });
    await trigger.click();
    const sheet = page.getByRole("dialog", { name: "Pick a month" });
    const actual = summary.months.reduce((sum, month) => sum + month.realExpensesMinor, 0);
    const planned = summary.months.reduce((sum, month) => sum + month.estimatedExpensesMinor, 0);
    const card = sheet.locator(".summary-month-all");
    await expect(card).toContainText(moneyFormatter.format(actual / 100));
    await expect(card).toContainText(`of ${moneyFormatter.format(planned / 100)} plan`);
    await expect(sheet.locator(".summary-month-sheet-range")).toContainText(`${monthLabel(summary.rangeStartMonth)} – ${monthLabel(summary.rangeEndMonth)}`);

    for (const month of summary.months) {
      const tile = sheet.getByRole("button", { name: new RegExp(`^${monthLabel(month.month)}`) });
      await expect(tile).toContainText(wholeMoneyFormatter.format(month.realExpensesMinor / 100));
      const isOver = month.realExpensesMinor > month.estimatedExpensesMinor;
      const amount = tile.locator(".summary-month-tile-amount");
      if (isOver) {
        await expect(amount).toHaveClass(/money-short/);
        await expect(amount).toContainText("over");
      } else {
        await expect(amount).not.toHaveClass(/money-short/);
        await expect(amount).not.toContainText("over");
      }
    }

    // Focus stays in the sheet; Escape closes it without changing the choice.
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest("[role='dialog']")))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(page).toHaveURL(/\/summary\?/);
  });

  test("with money hidden the sheet shows no amounts, no over-plan colour and no over word", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "false"));
    const summary = await rangeSummary(page);
    expect(summary.months.some((month) => month.realExpensesMinor > month.estimatedExpensesMinor), "the seed has an over-plan month").toBe(true);
    await page.goto(SUMMARY_URL);
    await waitUsable(page);
    await page.locator(".mobile-context-sticky-wrap").getByRole("button", { name: /All months/ }).click();
    const sheet = page.getByRole("dialog", { name: "Pick a month" });
    await expect(sheet).toBeVisible();
    const text = await sheet.innerText();
    expect(text).not.toMatch(/\$\s?\d/);
    expect(text).not.toMatch(/\bover\b/);
    expect(text).toContain("••••");
    const roseInk = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--pastel-rose-ink").trim());
    const colours = await sheet.locator(".summary-month-tile-amount, .summary-month-bar-fill").evaluateAll((elements) => elements.map((element) => {
      const style = getComputedStyle(element);
      return [style.color, style.backgroundColor, style.fontWeight];
    }));
    const rose = await page.evaluate((hex) => {
      const probe = document.createElement("span");
      probe.style.color = hex;
      document.body.appendChild(probe);
      const value = getComputedStyle(probe).color;
      probe.remove();
      return value;
    }, roseInk);
    for (const [color, background, weight] of colours) {
      expect(color).not.toBe(rose);
      expect(background).not.toBe(rose);
      expect(Number(weight)).toBeLessThan(600);
    }
  });

  test("Spending Mix follows the month choice: All months shows the whole range and a picked month that month, with no month chips", async ({ page }) => {
    const summary = await rangeSummary(page);
    // An old link that focused one month no longer narrows the Spending Mix.
    await page.goto(`${SUMMARY_URL}&summary_focus=${summary.rangeMonths.at(-1)}`);
    await waitUsable(page);
    const mix = page.locator(".chart-card").filter({ has: page.getByRole("heading", { name: "Spending Mix" }) });
    await expect(mix).toBeVisible();
    await expect(mix.locator(".summary-focus-button")).toHaveCount(0);
    await expect(mix.getByRole("button", { name: "Range overall" })).toHaveCount(0);
    const rows = mix.locator(".share-row");
    await expect(rows).toHaveCount(summary.categoryShareChart.length);
    const top = summary.categoryShareChart[0];
    await expect(rows.first()).toContainText(moneyFormatter.format(top.valueMinor / 100));

    // A picked month is the Month page: its Spending Mix shows that month
    // only (tests/e2e/month-spending-mix.spec.js covers it in full).
    const newest = summary.rangeMonths.at(-1);
    const newestShare = summary.categoryShareByMonth.find((item) => item.month === newest).data;
    await page.locator(".mobile-context-sticky-wrap").getByRole("button", { name: /All months/ }).click();
    await page.getByRole("dialog", { name: "Pick a month" }).locator(".summary-month-tile").first().click();
    await expect(page).toHaveURL(new RegExp(`/month\\?.*month=${newest}(&|$)`));
    await expect(page.locator(".month-panel-head")).toBeVisible();
    const monthMix = page.locator(".month-panel .chart-card").filter({ has: page.getByRole("heading", { name: "Spending Mix" }) });
    await expect(monthMix.locator(".share-row")).toHaveCount(newestShare.length);
    await expect(monthMix.locator(".summary-focus-button")).toHaveCount(0);
  });
});

test.describe("Summary tab month choice on a desktop", () => {
  test.use({ viewport: { width: 1280, height: 860 } });

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await reseedDemo(page);
  });

  test("the header has no Month tab and the month row picks a month and All months", async ({ page }) => {
    const { rangeMonths } = await rangeSummary(page);
    await page.goto(SUMMARY_URL);
    await waitUsable(page);
    const tabs = page.locator("nav.tab-strip");
    await expect(tabs.locator("> a.tab:visible")).toHaveText(["Summary", "Entries", "Splits", "Imports", "Settings", "FAQ"]);

    const row = page.getByRole("group", { name: "Month" });
    await expect(row.getByRole("button")).toHaveText(["All months", ...rangeMonths.slice().reverse().map(monthLabel)]);
    await expect(row.getByRole("button", { name: "All months" })).toHaveAttribute("aria-pressed", "true");
    // The phone's island control is not shown on a desktop.
    await expect(page.locator(".mobile-month-choice")).toBeHidden();

    const target = rangeMonths[1];
    await row.getByRole("button", { name: monthLabel(target), exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/month\\?.*month=${target}`));
    await waitUsable(page);
    await expect(page.getByRole("heading", { name: "Month", exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: monthLabel(target), exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(tabs.getByRole("link", { name: "Summary", exact: true })).toHaveClass(/is-active/);

    await row.getByRole("button", { name: "All months" }).click();
    await expect(page).toHaveURL(/\/summary\?/);
    await expect(page.getByRole("heading", { name: "Summary", exact: true })).toBeVisible();
  });

  test("a header range change keeps the picked month inside the new range", async ({ page }) => {
    await page.goto("/month?view=person-tim&month=2025-07&summary_start=2025-07&summary_end=2025-09");
    await waitUsable(page);
    await expect(page.getByRole("group", { name: "Month" }).getByRole("button")).toHaveText(["All months", ...["2025-09", "2025-08", "2025-07"].map(monthLabel)]);
    await page.getByRole("button", { name: "Next period" }).click();
    // The range moves on a month; July left it, so the month moves to August.
    await expect(page).toHaveURL(/summary_start=2025-08&summary_end=2025-10/);
    await expect(page).toHaveURL(/month=2025-08(&|$)/);
    await waitUsable(page);
    await expect(page.getByRole("group", { name: "Month" }).getByRole("button", { name: monthLabel("2025-08"), exact: true })).toHaveAttribute("aria-pressed", "true");
  });

  test("the Summary tab from a picked month opens All months", async ({ page }) => {
    await page.goto(`/month?view=person-tim&month=2025-08&summary_start=${RANGE.summaryStart}&summary_end=${RANGE.summaryEnd}`);
    await waitUsable(page);
    await page.locator("nav.tab-strip").getByRole("link", { name: "Summary", exact: true }).click();
    await expect(page).toHaveURL(/\/summary\?/);
    await expect(page).toHaveURL(new RegExp(`summary_start=${RANGE.summaryStart}`));
    await expect(page.getByRole("heading", { name: "Summary", exact: true })).toBeVisible();
  });
});
