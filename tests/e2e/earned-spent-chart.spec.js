import { devices, expect, test } from "@playwright/test";

import { reseedDemo } from "./helpers";

// The column + line chart above Summary's month-by-month list (design.md
// "Plan or Simple", src/client/earned-spent-chart.js). Simple: Earned and
// Spent columns and a Kept line in "Earned vs spent by month". Plan: Earned
// and Spent columns and a Planned spending line in Intent vs Outcome. It
// shows for a range of months only, never while money is hidden; every
// column and point opens a menu that names the month and the series, whose
// View entries lists exactly the money behind the figure. The exact series
// numbers are in tests/earned-spent-chart-model.test.mjs and the markup in
// tests/earned-spent-chart-dom.test.mjs; this proves it in a real browser on
// a desktop and a phone.

const VIEW = "person-tim";
const MONTH = "2026-05";
const RANGE = { start: "2025-06", end: MONTH };
// A link that targets one month opens Intent vs Outcome's full month cards.
const SUMMARY_URL = `/summary?view=${VIEW}&month=${MONTH}&scope=direct_plus_shared&summary_start=${RANGE.start}&summary_end=${RANGE.end}#month-${MONTH}`;
const ONE_MONTH_URL = `/summary?view=${VIEW}&month=${MONTH}&scope=direct_plus_shared&summary_start=${MONTH}&summary_end=${MONTH}`;
const { defaultBrowserType: _browser, ...iPhone13 } = devices["iPhone 13"];

const chart = (page) => page.locator("[data-earned-spent-chart]");
const point = (page, series, month = MONTH) => chart(page).locator(`.ec-point[data-ec-series="${series}"][data-ec-month="${month}"]`);
const menu = (page) => page.locator("[data-figure-menu]");

async function useView(page, lead) {
  await page.addInitScript((value) => window.localStorage.setItem("monies-map:lead-view", value), lead);
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
}

async function openSummary(page, url = SUMMARY_URL) {
  await page.goto(url);
  await expect(page.locator(".summary-lead-group").first()).toBeVisible({ timeout: 30_000 });
}

// The chart plays once when it is on screen; wait for it to finish so a
// column is at full height when it is pointed at.
async function settledChart(page) {
  await chart(page).scrollIntoViewIfNeeded();
  await expect(chart(page)).toHaveAttribute("data-chart-motion", "done", { timeout: 15_000 });
}

// The month's figures as the list under the chart writes them.
async function simpleRow(page, month) {
  const row = page.locator(`[data-earned-spent] [data-month="${month}"]`);
  await expect(row.locator(".earned-spent-figures")).toBeVisible();
  const figures = (await row.locator(".earned-spent-figures").innerText()).replace(/\s+/g, " ");
  return {
    earned: figures.match(/Earned (\S+)/)[1],
    spent: figures.match(/Spent (\S+)/)[1],
    result: (await row.locator(".earned-spent-result").innerText()).trim()
  };
}

// "$12,345.67" in cents.
const toCents = (text) => Math.round(Number(text.replace(/[^\d.]/g, "")) * 100);

test.beforeEach(async ({ page }) => {
  await reseedDemo(page);
});

test.describe("Simple, desktop", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await useView(page, "simple");
  });

  test("the chart sits above the month list in Earned vs spent by month, with the list's own figures", async ({ page }) => {
    await openSummary(page);
    const card = page.locator("[data-earned-spent]");
    await expect(card.locator("h3")).toHaveText("Earned vs spent");
    await expect(chart(page)).toHaveCount(1);
    await expect(card.locator("[data-earned-spent-chart]")).toHaveCount(1);
    const chartBox = await chart(page).boundingBox();
    const listBox = await card.locator(".earned-spent-months").boundingBox();
    expect(chartBox.y + chartBox.height).toBeLessThanOrEqual(listBox.y + 1);
    // One column pair and one Kept point for each month in the list.
    const months = await card.locator(".earned-spent-row").count();
    expect(months).toBeGreaterThan(1);
    await expect(chart(page).locator(".ec-point")).toHaveCount(months * 3);
    await expect(chart(page).locator(".ec-legend .ec-chip")).toHaveText(["Earned", "Spent", "Kept"]);
    await expect(chart(page).locator(".ec-axis-label").filter({ hasText: "$0" })).toHaveCount(1);
    // Columns and the line carry the list's numbers.
    const may = await simpleRow(page, MONTH);
    await expect(point(page, "earned")).toHaveAttribute("aria-label", `May 2026 earned ${may.earned}`);
    await expect(point(page, "spent")).toHaveAttribute("aria-label", `May 2026 spent ${may.spent}`);
    const kept = may.result.replace(/^(Kept|Overspent) /, "");
    const word = may.result.startsWith("Overspent") ? "overspent" : "kept";
    await expect(point(page, "kept")).toHaveAttribute("aria-label", `May 2026 ${word} ${kept}`);
    // No plan anywhere in it.
    await expect(chart(page)).not.toContainText(/plan/i);
  });

  test("a resting pointer on a Spent column opens a menu naming the month and series; View entries totals the figure", async ({ page }) => {
    await openSummary(page);
    await settledChart(page);
    const may = await simpleRow(page, MONTH);
    const column = point(page, "spent");
    const box = await column.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(menu(page)).toBeVisible({ timeout: 5_000 });
    await expect(menu(page).locator(".figure-menu-title")).toHaveText("Spent · May 2026");
    await expect(menu(page).locator(".figure-menu-note")).toContainText(may.spent);
    await expect(menu(page).getByRole("button")).toHaveText(["View entries", "Ask about this"]);
    // The month's row in the list is marked while the pointer is on it.
    await expect(page.locator(`[data-earned-spent] [data-month="${MONTH}"]`)).toHaveClass(/is-chart-active/);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 2);
    await menu(page).getByRole("button", { name: "View entries" }).click();
    await expect(page).toHaveURL(/\/entries\?.*month=2026-05.*entry_figure=spending/);
    await expect(page.locator(".entries-totals-lead .lsd-eyebrow")).toHaveText("Spent · May 2026", { timeout: 30_000 });
    await expect(page.locator(".entries-totals-lead .lsd-amount")).toHaveText(may.spent);
  });

  test("Earned and Kept open their own entries; Ask about this asks about that month", async ({ page }) => {
    await openSummary(page);
    await settledChart(page);
    const may = await simpleRow(page, MONTH);
    await point(page, "earned").click();
    await expect(menu(page).locator(".figure-menu-title")).toHaveText("Earned · May 2026");
    await menu(page).getByRole("button", { name: "View entries" }).click();
    await expect(page.locator(".entries-totals-lead .lsd-eyebrow")).toHaveText("Earned · May 2026", { timeout: 30_000 });
    await expect(page.locator(".entries-totals-lead .lsd-amount")).toHaveText(may.earned);

    await openSummary(page);
    await settledChart(page);
    await point(page, "kept").click();
    await expect(menu(page).locator(".figure-menu-title")).toHaveText("Kept · May 2026");
    const ask = menu(page).getByRole("button", { name: "Ask about this" });
    const question = await ask.getAttribute("data-question");
    expect(question).toMatch(/ in May 2026\?$/);
    await ask.click();
    await expect(page.locator(".ask-dock").getByText(question, { exact: true })).toBeVisible({ timeout: 30_000 });
  });

  test("the legend chips show and hide series, and the last one showing stays", async ({ page }) => {
    await openSummary(page);
    await settledChart(page);
    const spent = chart(page).locator('.ec-chip[data-series="spent"]');
    await spent.click();
    await expect(spent).toHaveAttribute("aria-pressed", "false");
    await expect(chart(page).locator('.ec-point[data-ec-series="spent"]')).toHaveCount(0);
    const months = await page.locator("[data-earned-spent] .earned-spent-row").count();
    await expect(chart(page).locator('.ec-point[data-ec-series="earned"]')).toHaveCount(months);
    await expect(chart(page).locator(".ec-line")).toHaveCount(1);
    await chart(page).locator('.ec-chip[data-series="kept"]').click();
    await expect(chart(page).locator(".ec-line")).toHaveCount(0);
    // Earned is the last one showing: it cannot be hidden.
    const earned = chart(page).locator('.ec-chip[data-series="earned"]');
    await earned.click();
    await expect(earned).toHaveAttribute("aria-pressed", "true");
    await expect(chart(page).locator('.ec-point[data-ec-series="earned"]')).toHaveCount(months);
    await spent.click();
    await expect(chart(page).locator('.ec-point[data-ec-series="spent"]')).toHaveCount(months);
  });

  test("keyboard: Tab reaches one point, the arrows move between months and series, Enter opens the menu, Escape gives the focus back", async ({ page }) => {
    await openSummary(page);
    await settledChart(page);
    const first = chart(page).locator(".ec-point").first();
    await expect(chart(page).locator('.ec-point[tabindex="0"]')).toHaveCount(1);
    await first.focus();
    await expect(first).toHaveAttribute("data-ec-series", "earned");
    await expect(first).toHaveAttribute("data-ec-month", "2025-06");
    await page.keyboard.press("ArrowRight");
    await expect(page.locator(".ec-point:focus")).toHaveAttribute("data-ec-month", "2025-07");
    await page.keyboard.press("ArrowDown");
    await expect(page.locator(".ec-point:focus")).toHaveAttribute("data-ec-series", "spent");
    await expect(page.locator(".ec-point:focus")).toHaveAttribute("data-ec-month", "2025-07");
    await page.keyboard.press("End");
    await expect(page.locator(".ec-point:focus")).toHaveAttribute("data-ec-month", MONTH);
    await page.keyboard.press("ArrowUp");
    await expect(page.locator(".ec-point:focus")).toHaveAttribute("data-ec-series", "earned");
    await page.keyboard.press("Home");
    await expect(page.locator(".ec-point:focus")).toHaveAttribute("data-ec-month", "2025-06");
    const focused = page.locator(".ec-point:focus");
    await page.keyboard.press("Enter");
    await expect(menu(page)).toBeVisible();
    await expect(menu(page).getByRole("button", { name: "View entries" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu(page)).toHaveCount(0);
    await expect(focused).toBeFocused();
  });

  test("one month shows no chart and no placeholder", async ({ page }) => {
    await openSummary(page, ONE_MONTH_URL);
    await expect(page.locator("[data-earned-spent]")).toBeVisible({ timeout: 30_000 });
    await expect(chart(page)).toHaveCount(0);
    await expect(page.locator(".earned-spent-chart-reserve")).toHaveCount(0);
  });

  test("hidden money draws nothing: no chart, no axis, no placeholder", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "false"));
    await openSummary(page);
    await expect(page.locator("[data-earned-spent]")).toBeVisible({ timeout: 30_000 });
    await expect(chart(page)).toHaveCount(0);
    await expect(page.locator(".earned-spent-chart-reserve, .ec-axis, .ec-bar")).toHaveCount(0);
  });

  test("the chart grows in on first view, and not at all for reduced motion", async ({ page }) => {
    await openSummary(page);
    await chart(page).scrollIntoViewIfNeeded();
    await expect(chart(page)).toHaveAttribute("data-chart-motion", /^(playing|done)$/, { timeout: 15_000 });
    await expect(chart(page)).toHaveAttribute("data-chart-motion", "done", { timeout: 15_000 });
    await expect(point(page, "spent").locator(".ec-bar")).toHaveCSS("transform", "none");

    const still = await page.context().newPage();
    await still.emulateMedia({ reducedMotion: "reduce" });
    await still.setViewportSize({ width: 1440, height: 900 });
    await openSummary(still);
    await expect(chart(still)).toHaveAttribute("data-chart-motion", "off");
    await expect(point(still, "spent").locator(".ec-bar")).toHaveCSS("animation-name", "none");
    await expect(point(still, "spent").locator(".ec-bar")).toHaveCSS("transform", "none");
    await still.close();
  });

  test("the chart reserves its height while it loads: the card below does not jump", async ({ page }) => {
    await openSummary(page);
    await expect(chart(page)).toHaveCount(1, { timeout: 30_000 });
    const reserve = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.className = "earned-spent-chart-reserve";
      document.body.appendChild(probe);
      const height = probe.getBoundingClientRect().height;
      probe.remove();
      return height;
    });
    const actual = (await chart(page).boundingBox()).height;
    expect(Math.abs(actual - reserve), "the placeholder and the chart are within 4px").toBeLessThanOrEqual(4);
  });
});

test.describe("Plan, desktop", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await useView(page, "plan");
  });

  test("Intent vs Outcome carries earned, spent, planned spending, and spent and planned so far", async ({ page }) => {
    await openSummary(page);
    const card = page.locator(".summary-intent");
    await expect(card.locator("[data-earned-spent-chart]")).toHaveAttribute("data-earned-spent-chart", "plan", { timeout: 30_000 });
    await expect(chart(page).locator(".ec-legend .ec-chip")).toHaveText(["Earned", "Spent", "Planned spending", "Spent so far", "Planned so far"]);
    await expect(chart(page).locator('.ec-chip[data-series="kept"]')).toHaveCount(0);
    // A point for each month that has a plan; a month without one has none.
    const cards = card.locator(".summary-intent-month");
    const months = await cards.count();
    let planned = 0;
    for (let index = 0; index < months; index += 1) {
      const text = await cards.nth(index).locator(".summary-intent-plan").innerText();
      if (!/\$0\.00/.test(text)) planned += 1;
    }
    expect(planned).toBeGreaterThan(0);
    await expect(chart(page).locator('.ec-point[data-ec-series="earned"]')).toHaveCount(months);
    await expect(chart(page).locator('.ec-point[data-ec-series="plan"]')).toHaveCount(planned);
    await expect(chart(page).locator('.ec-point[data-ec-series="spentSoFar"]')).toHaveCount(months);
    await expect(chart(page).locator('.ec-point[data-ec-series="plannedSoFar"]')).toHaveCount(months);
    const spentLabel = await card.locator(`[data-month="${MONTH}"] .summary-intent-spent`).innerText();
    await expect(point(page, "spent")).toHaveAttribute("aria-label", `May 2026 spent ${spentLabel.trim()}`);
    const plannedMay = (await card.locator(`[data-month="${MONTH}"] .summary-intent-plan`).innerText()).match(/\$[\d,]+\.\d\d/)[0];
    await expect(point(page, "plan")).toHaveAttribute("aria-label", `May 2026 planned spending ${plannedMay}`);
    // Two dashed lines on their own axis on the right: Spent so far in the
    // rose ink, Planned so far in the sky ink, each its own dash.
    const spentLine = chart(page).locator(".ec-line.is-spentSoFar");
    const plannedLine = chart(page).locator(".ec-line.is-plannedSoFar");
    await expect(spentLine).toHaveCount(1);
    await expect(plannedLine).toHaveCount(1);
    const style = (locator) => locator.evaluate((node) => ({ stroke: getComputedStyle(node).stroke, dash: getComputedStyle(node).strokeDasharray }));
    const [spentStyle, plannedStyle] = [await style(spentLine), await style(plannedLine)];
    expect(spentStyle.dash).toMatch(/\d/);
    expect(plannedStyle.dash).toMatch(/\d/);
    expect(spentStyle.dash).not.toBe(plannedStyle.dash);
    expect(spentStyle.stroke).not.toBe(plannedStyle.stroke);
    const tokens = await page.evaluate(() => {
      const probe = document.createElement("span");
      document.body.append(probe);
      const read = (token) => { probe.style.color = `var(${token})`; return getComputedStyle(probe).color; };
      const out = { rose: read("--pastel-rose-ink"), sky: read("--pastel-sky-ink") };
      probe.remove();
      return out;
    });
    expect(spentStyle.stroke).toBe(tokens.rose);
    expect(plannedStyle.stroke).toBe(tokens.sky);
    await expect(chart(page).locator(".ec-axis.is-right .ec-axis-label").first()).toBeVisible();
  });

  test("the gap between Planned so far and Spent so far in the last month is the lead's over or under plan", async ({ page }) => {
    await openSummary(page);
    await settledChart(page);
    const amountOf = async (series) => toCents((await point(page, series).getAttribute("aria-label")).match(/\$[\d,]+\.\d\d/)[0]);
    const gap = (await amountOf("plannedSoFar")) - (await amountOf("spentSoFar"));
    // The lead says "$x under plan" or "$x over plan" for the whole range.
    const lead = (await page.locator(".summary-lead-group").first().innerText()).replace(/\s+/g, " ");
    const [, amount, side] = lead.match(/(\$[\d,]+\.\d\d) (under|over) plan/);
    expect(Math.abs(gap)).toBe(toCents(amount));
    expect(gap < 0 ? "over" : "under").toBe(side);
  });

  test("a running point's menu gives both totals and the gap; View entries totals Spent so far and Open plan opens the month's plan", async ({ page }) => {
    await openSummary(page);
    await settledChart(page);
    const spentMay = (await point(page, "spentSoFar").getAttribute("aria-label")).match(/\$[\d,]+\.\d\d/)[0];
    await point(page, "plannedSoFar").click();
    await expect(menu(page).locator(".figure-menu-title")).toHaveText("Planned so far · Jun 2025 – May 2026");
    await expect(menu(page).getByRole("button")).toHaveText(["View entries", "Open May 2026 plan", "Ask about this"]);
    await expect(menu(page).locator(".figure-menu-note")).toContainText(/planned from Jun 2025 to May 2026/);
    await expect(menu(page).locator(".figure-menu-note")).toContainText(`${spentMay} spent`);
    await expect(menu(page).locator(".figure-menu-note")).toContainText(/(under|over) plan|On plan/);
    await page.mouse.move(5, 5);
    await page.keyboard.press("Escape");
    await expect(menu(page)).toHaveCount(0);
    await point(page, "spentSoFar").click();
    await expect(menu(page).locator(".figure-menu-title")).toHaveText("Spent so far · Jun 2025 – May 2026");
    await menu(page).getByRole("button", { name: "View entries" }).click();
    await expect(page.locator(".entries-totals-lead .lsd-amount")).toHaveText(spentMay, { timeout: 30_000 });
  });

  test("the planned point's menu names the series and month, lists View entries, Open plan and Ask", async ({ page }) => {
    await openSummary(page);
    await settledChart(page);
    await point(page, "plan").click();
    await expect(menu(page).locator(".figure-menu-title")).toHaveText("Planned spending · May 2026");
    await expect(menu(page).getByRole("button")).toHaveText(["View entries", "Open plan", "Ask about this"]);
    await expect(menu(page).locator(".figure-menu-note")).toContainText("planned");
    await menu(page).getByRole("button", { name: "Open plan" }).click();
    await expect(page).toHaveURL(/\/month\?.*month=2026-05.*#month-plan$/);
  });

  test("a Spent column's View entries totals the Intent card's spent figure", async ({ page }) => {
    await openSummary(page);
    await settledChart(page);
    const spent = (await page.locator(`.summary-intent [data-month="${MONTH}"] .summary-intent-spent`).innerText()).trim();
    await point(page, "spent").click();
    await expect(menu(page).locator(".figure-menu-title")).toHaveText("Spent · May 2026");
    await menu(page).getByRole("button", { name: "View entries" }).click();
    await expect(page.locator(".entries-totals-lead .lsd-amount")).toHaveText(spent, { timeout: 30_000 });
  });
});

test.describe("phone", () => {
  test.use(iPhone13);

  test("a range of months fits at 390px without sideways scrolling, and a tap opens the menu inside the screen", async ({ page }) => {
    await useView(page, "simple");
    await openSummary(page);
    await settledChart(page);
    const scroll = await chart(page).locator(".ec-scroll").evaluate((element) => ({ client: element.clientWidth, scroll: element.scrollWidth }));
    expect(scroll.scroll).toBeLessThanOrEqual(scroll.client);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
    // Legend chips are 44px targets around a 28px pill.
    for (const chip of await chart(page).locator(".ec-chip").all()) {
      const box = await chip.boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
    const may = await simpleRow(page, MONTH);
    await point(page, "spent").tap();
    await expect(menu(page)).toBeVisible();
    await expect(menu(page).locator(".figure-menu-title")).toHaveText("Spent · May 2026");
    const menuBox = await menu(page).boundingBox();
    expect(menuBox.x).toBeGreaterThanOrEqual(15);
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(390 - 15);
    await menu(page).getByRole("button", { name: "View entries" }).tap();
    await expect(page.locator(".entries-totals-lead .lsd-amount")).toHaveText(may.spent, { timeout: 30_000 });
  });

  test("Ask about this from a column opens the Ask page", async ({ page }) => {
    await useView(page, "simple");
    await openSummary(page);
    await settledChart(page);
    await point(page, "earned").tap();
    await menu(page).getByRole("button", { name: "Ask about this" }).tap();
    await expect(page).toHaveURL(/\/ask\?/);
  });

  test("Plan on a phone: the chart fits the card", async ({ page }) => {
    await useView(page, "plan");
    await openSummary(page);
    await expect(page.locator(".summary-intent [data-earned-spent-chart]")).toBeVisible({ timeout: 30_000 });
    const box = await chart(page).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(391);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  });
});
