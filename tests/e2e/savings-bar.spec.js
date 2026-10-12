import { devices, expect, test } from "@playwright/test";

import { loadMonthPage, loadSummaryPage, postJson, reseedDemo } from "./helpers";

// The savings bar under the Summary and Month lead (design.md, "Lead ·
// Support · Detail"): all the money earned is one bar, spent rose and kept
// mint, a thin plan bar under it, one plain line and a muted plan line. Every
// figure is the page DTO's own; percentages open in a popover on hover (mouse)
// or tap (phone); hidden money keeps only percentages. The model's exact
// numbers are in tests/savings-bar-model.test.mjs; this proves the rendering,
// the popovers, the tap targets, the Month card height and hidden money.

const VIEW = "person-tim";
const MONTH = "2026-05";
const RANGE = { start: "2025-06", end: MONTH };
const MONTH_URL = `/month?view=${VIEW}&month=${MONTH}&scope=direct_plus_shared&summary_start=${RANGE.start}&summary_end=${RANGE.end}`;
const SUMMARY_URL = `/summary?view=${VIEW}&month=${MONTH}&scope=direct_plus_shared&summary_start=${RANGE.start}&summary_end=${RANGE.end}`;
const wholeFormat = new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD", maximumFractionDigits: 0 });
const dollars = (minor) => wholeFormat.format(minor / 100);
const { defaultBrowserType: _browser, ...iPhone13 } = devices["iPhone 13"];

function box(locator) {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
  });
}

// The rendered colour of an element's background as [r, g, b] (the computed
// style may be a colour-mix, so the browser paints it to read it back).
function backgroundRgb(locator) {
  return locator.evaluate((element) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.fillStyle = getComputedStyle(element).backgroundColor;
    context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
  });
}

async function recordSalary(page, amountMinor) {
  await postJson(page, "/api/entries/create", {
    date: `${MONTH}-25`,
    description: "Savings bar salary",
    accountName: "UOB One",
    categoryName: "Salary",
    amountMinor,
    entryType: "income",
    ownershipType: "direct",
    ownerName: "Tim"
  });
}

async function revealMoney(page) {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
}

// What the bar must show, from the page DTOs, worked out here by hand rather
// than by the model under test.
// Money filed under Savings (the demo's monthly savings allocation) was moved,
// not spent: the bar counts it as kept (design.md "Money jobs").
async function expectedFigures(page, where) {
  let cards;
  let income;
  let chart;
  if (where === "summary") {
    const data = await loadSummaryPage(page, { view: VIEW, month: MONTH, summaryStart: RANGE.start, summaryEnd: RANGE.end });
    cards = data.summaryPage.metricCards;
    chart = data.summaryPage.categoryShareChart;
    income = cards.find((item) => item.label === "Actual income").amountMinor;
  } else {
    const data = await loadMonthPage(page, { view: VIEW, month: MONTH });
    cards = data.monthPage.metricCards;
    chart = data.monthPage.categoryShareChart;
    income = data.summaryPage.months[0].actualIncomeMinor;
  }
  const card = (label) => cards.find((item) => item.label === label).amountMinor;
  const slice = (label) => chart.find((item) => item.label === label)?.valueMinor ?? 0;
  const invested = slice("Investments");
  const spent = card("Actual spend") - invested - slice("Savings");
  const over = spent + invested > income;
  const kept = income - spent - invested;
  const keptShare = income > 0 ? Math.round((kept * 100) / income) : null;
  return { income, spent, invested, over, kept, keptShare };
}

async function openLead(page, where) {
  await page.goto(where === "summary" ? SUMMARY_URL : MONTH_URL);
  const lead = page.locator(where === "summary" ? ".summary-lead" : ".month-lead");
  await expect(lead.locator(".summary-lead-spent")).toBeVisible({ timeout: 30_000 });
  return lead;
}

// A normal saving: spent then kept, widths from the figures, the sentence and
// the plan line from the DTO, the plan bar under the track.
async function expectKeptBar(page, lead, figures) {
  const bar = lead.locator("[data-savings-bar]");
  const track = await box(bar.locator(".savings-bar-track"));
  const spentSegment = bar.locator('[data-segment="spent"]');
  const keptSegment = bar.locator('[data-segment="kept"]');
  await expect(bar.locator("[data-segment]")).toHaveCount(2);
  expect(((await box(spentSegment)).width / track.width) * 100).toBeCloseTo((figures.spent / figures.income) * 100, 0);
  expect(((await box(keptSegment)).width / track.width) * 100).toBeCloseTo((figures.kept / figures.income) * 100, 0);
  await expect(bar.locator(".savings-bar-tick")).toHaveCount(0);
  await expect(bar.locator("[data-savings-sentence]")).toHaveText(`You kept ${dollars(figures.kept)} of the ${dollars(figures.income)} you earned (${figures.keptShare}%)`);
  // The money jobs line took the old "Plan: spend … and save …" line's place.
  await expect(bar.locator("[data-savings-plan]")).toHaveCount(0);
  const planBar = await box(bar.locator(".savings-bar-plan"));
  expect(planBar.y).toBeGreaterThanOrEqual(track.bottom);
  expect(planBar.height).toBeLessThanOrEqual(4);
  expect(Math.abs(planBar.width - track.width)).toBeLessThanOrEqual(1);
  // Spent is rose, kept is mint: the red channel leads in one, the green in the other.
  const [spentRed, spentGreen] = await backgroundRgb(spentSegment);
  const [keptRed, keptGreen] = await backgroundRgb(keptSegment);
  expect(spentRed - spentGreen, "spent is rose").toBeGreaterThan(40);
  expect(keptGreen - keptRed, "kept is mint (olive in the 70s palette)").toBeGreaterThan(8);
  // The segment's popover text is also its accessible description.
  const description = async (segment) => {
    const id = await segment.getAttribute("aria-describedby");
    return page.locator(`[id="${id}"]`);
  };
  await expect(await description(spentSegment)).toHaveText(`Spent ${dollars(figures.spent)} · ${100 - figures.keptShare}% of income`);
  await expect(await description(keptSegment)).toHaveText(`Kept ${dollars(figures.kept)} · ${figures.keptShare}% of income`);
  await expect(spentSegment).toHaveAccessibleName("Spent");
  await expect(keptSegment).toHaveAccessibleName("Kept");
  await expect(spentSegment).toHaveAccessibleDescription(`Spent ${dollars(figures.spent)} · ${100 - figures.keptShare}% of income`);
  return { bar, spentSegment, keptSegment, description };
}

async function expectOverBar(page, lead, figures) {
  const bar = lead.locator("[data-savings-bar]");
  const track = await box(bar.locator(".savings-bar-track"));
  const spentSegment = bar.locator('[data-segment="spent"]');
  const savingsSegment = bar.locator('[data-segment="savings"]');
  await expect(bar.locator('[data-segment="kept"]')).toHaveCount(0);
  await expect(savingsSegment).toHaveClass(/is-hatched/);
  const tick = bar.locator(".savings-bar-tick");
  await expect(tick).toHaveText("income");
  const withinPercent = (figures.income / figures.spent) * 100;
  const tickBox = await box(tick);
  expect(((tickBox.x + tickBox.width / 2 - track.x) / track.width) * 100).toBeCloseTo(withinPercent, 0);
  expect(((await box(spentSegment)).width / track.width) * 100).toBeCloseTo(withinPercent, 0);
  expect(((await box(savingsSegment)).width / track.width) * 100).toBeCloseTo(100 - withinPercent, 0);
  // Hatched stripes, and the tone is still rose (the money-short class).
  expect(await savingsSegment.evaluate((element) => getComputedStyle(element).backgroundImage)).toContain("repeating-linear-gradient");
  await expect(savingsSegment).toHaveClass(/money-short/);
  await expect(bar.locator("[data-savings-sentence]")).toHaveText(`You spent ${dollars(figures.spent - figures.income)} more than you earned`);
  const savingsId = await savingsSegment.getAttribute("aria-describedby");
  await expect(page.locator(`[id="${savingsId}"]`)).toHaveText(`Came out of savings ${dollars(figures.spent - figures.income)} · ${Math.round(((figures.spent - figures.income) * 100) / figures.income)}% of income`);
  const spentId = await spentSegment.getAttribute("aria-describedby");
  await expect(page.locator(`[id="${spentId}"]`)).toHaveText(`Spent ${dollars(figures.spent)} · ${Math.round((figures.spent * 100) / figures.income)}% of income`);
}

// Each segment is at least 44px to touch: the 10px bar reaches into the gaps
// above and below it.
async function expectTouchTarget(page, segment) {
  const rect = await box(segment);
  const centre = rect.x + rect.width / 2;
  for (const y of [rect.y - 14, rect.bottom + 14]) {
    const hit = await page.evaluate(([x, top]) => document.elementFromPoint(x, top)?.getAttribute("data-segment"), [centre, y]);
    expect(hit, `a touch ${Math.round(Math.abs(y - rect.y))}px from the bar`).toBe(await segment.getAttribute("data-segment"));
  }
}

test.describe("phone", () => {
  test.use(iPhone13);

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await reseedDemo(page);
  });

  test("Month lead: the bar, line and plan from the DTO, a tap opens the percentages, the card stays near 200px", async ({ page }) => {
    await recordSalary(page, 6_500_000);
    await revealMoney(page);
    const figures = await expectedFigures(page, "month");
    expect(figures.kept, "the fixture month saves").toBeGreaterThan(0);
    const lead = await openLead(page, "month");
    const { bar, keptSegment, spentSegment, description } = await expectKeptBar(page, lead, figures);

    // One line of text each (the card is compact), the card ≤ 205px, and the
    // Money insights still start above the fold.
    expect((await box(bar.locator("[data-savings-sentence]"))).height, "sentence on one line").toBeLessThan(22);
    expect((await box(lead.locator("[data-money-jobs-summary]"))).height, "money jobs line on one line").toBeLessThan(18);
    const card = await box(lead);
    expect(card.height, "Month lead card height").toBeLessThanOrEqual(205);
    expect((await box(page.locator(".financial-insight").first())).y, "Money insights above the fold").toBeLessThan(664);
    for (const column of ["income", "saved", "remaining"]) {
      const columnBox = await box(page.locator(`.month-lead-group [data-metric="${column}"]`));
      expect(columnBox.height, `${column} tap target`).toBeGreaterThanOrEqual(44);
      expect(columnBox.bottom).toBeLessThanOrEqual(card.bottom);
    }
    expect(card.right).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);

    // Tap: the kept segment opens its popover, a tap on the other segment moves it,
    // a tap elsewhere closes it, a second tap on the same segment closes it.
    await expectTouchTarget(page, keptSegment);
    const keptPopover = await description(keptSegment);
    const spentPopover = await description(spentSegment);
    await expect(keptPopover).toBeHidden();
    await keptSegment.tap();
    await expect(keptPopover).toBeVisible();
    await expect(keptPopover).toContainText(`${figures.keptShare}% of income`);
    expect((await box(keptPopover)).right, "popover inside the screen").toBeLessThanOrEqual(390);
    expect((await box(keptPopover)).x).toBeGreaterThanOrEqual(0);
    await spentSegment.tap();
    await expect(spentPopover).toBeVisible();
    await expect(keptPopover).toBeHidden();
    await spentSegment.tap();
    await expect(spentPopover).toBeHidden();
    await keptSegment.tap();
    await expect(keptPopover).toBeVisible();
    await lead.locator(".lsd-eyebrow").tap();
    await expect(keptPopover).toBeHidden();
  });

  test("Month lead, spending more than was earned: rose to an income tick, the rest hatched, no kept part", async ({ page }) => {
    await recordSalary(page, 100_000);
    await revealMoney(page);
    const figures = await expectedFigures(page, "month");
    expect(figures.over, "the fixture month overspends the small salary").toBe(true);
    const lead = await openLead(page, "month");
    await expectOverBar(page, lead, figures);
    expect((await box(lead)).height, "Month lead card height").toBeLessThanOrEqual(205);
    await expect(lead.locator('[data-segment="savings"]')).toHaveAccessibleName("Came out of savings");
    await lead.locator('[data-segment="savings"]').tap();
    await expect(lead.locator('[data-popover="savings"]')).toBeVisible();
  });

  test("hidden money: percentages in the popover, no amount and no sign word anywhere in the bar", async ({ page }) => {
    await recordSalary(page, 6_500_000);
    const figures = await expectedFigures(page, "month");
    const lead = await openLead(page, "month");
    await expect(lead.locator(".summary-lead-spent")).toHaveText("••••");
    const bar = lead.locator("[data-savings-bar]");
    await expect(bar.locator("[data-segment]")).toHaveCount(2);
    await expect(bar.locator("[data-savings-sentence]")).toHaveText("Spent and kept, as a share of what you earned");
    await expect(bar.locator("[data-savings-plan]")).toHaveCount(0);
    await expect(bar.locator(".savings-bar-plan")).toHaveCount(0);
    const kept = bar.locator('[data-segment="kept"]');
    await kept.tap();
    await expect(bar.locator('[data-popover="kept"]')).toHaveText(`Kept · ${figures.keptShare}% of income`);
    // Everything the bar holds, hidden popovers too, is free of amounts and sign words.
    const text = await bar.evaluate((element) => [element.textContent, ...[...element.querySelectorAll("[aria-describedby]")].map((segment) => segment.getAttribute("aria-label"))].join(" "));
    expect(text).not.toMatch(/\$|[-−]\s?\d|\bkept \d|more than/i);
    // Neutral warm greys (the 70s ink is brown, so a little chroma): no rose or mint colour reveals a sign.
    for (const key of ["spent", "kept"]) {
      const [red, green, blue] = await backgroundRgb(bar.locator(`[data-segment="${key}"]`));
      expect(Math.max(red, green, blue) - Math.min(red, green, blue), `${key} is grey`).toBeLessThanOrEqual(20);
    }
  });
});

test.describe("desktop", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await reseedDemo(page);
  });

  test("Summary lead: the bar over the whole range, hover shows the percentages and moving away hides them", async ({ page }) => {
    await recordSalary(page, 6_500_000);
    await revealMoney(page);
    const figures = await expectedFigures(page, "summary");
    expect(figures.kept, "the range saves").toBeGreaterThan(0);
    const lead = await openLead(page, "summary");
    const { keptSegment, spentSegment, description } = await expectKeptBar(page, lead, figures);

    const keptPopover = await description(keptSegment);
    const spentPopover = await description(spentSegment);
    await expect(keptPopover).toBeHidden();
    await keptSegment.hover();
    await expect(keptPopover).toBeVisible();
    await expect(keptPopover).toHaveText(`Kept ${dollars(figures.kept)} · ${figures.keptShare}% of income`);
    // Hover alone: the next segment's popover, and moving away hides it.
    await spentSegment.hover();
    await expect(spentPopover).toBeVisible();
    await expect(keptPopover).toBeHidden();
    await lead.locator(".lsd-eyebrow").hover();
    await expect(spentPopover).toBeHidden();
    // A click opens the segment's menu under its popover (it does not toggle
    // it shut), and the menu stays while the mouse moves to it.
    await keptSegment.hover();
    await keptSegment.click();
    await expect(keptPopover).toBeVisible();
    await expect(lead.locator('[data-money-actions="kept"]')).toBeVisible();
    await spentSegment.hover();
    await expect(keptPopover).toBeVisible();
    await expect(spentPopover).toBeHidden();
    await lead.locator('[data-money-actions="kept"] [data-action="ask"]').hover();
    await expect(keptPopover).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(keptPopover).toBeHidden();

    // Keyboard: Enter on a focused segment opens it, Escape closes it.
    await keptSegment.focus();
    await page.keyboard.press("Enter");
    await expect(keptPopover).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(keptPopover).toBeHidden();

    // The Support pills and the plan line are still there; the old spend-vs-plan
    // bar is not (the savings bar and its plan bar are the only bars).
    await expect(page.locator('.summary-support-pill[data-metric="income"] strong')).toBeVisible();
    await expect(lead.locator(".lsd-progress-line")).toBeVisible();
    await expect(lead.locator(".lsd-bar")).toHaveCount(0);
  });

  test("Summary lead, spending more than was earned: the income tick and the hatched part", async ({ page }) => {
    await recordSalary(page, 100_000);
    await revealMoney(page);
    const figures = await expectedFigures(page, "summary");
    expect(figures.over, "the range overspends the small salary").toBe(true);
    const lead = await openLead(page, "summary");
    await expectOverBar(page, lead, figures);
    const savings = lead.locator('[data-segment="savings"]');
    await savings.hover();
    await expect(lead.locator('[data-popover="savings"]')).toBeVisible();
  });

  test("no income at all: the whole bar is the part that came out of savings, with no tick and no share of income", async ({ page }) => {
    await revealMoney(page);
    const figures = await expectedFigures(page, "summary");
    expect(figures.income, "the demo range has no income for Tim").toBe(0);
    expect(figures.spent).toBeGreaterThan(0);
    const lead = await openLead(page, "summary");
    const bar = lead.locator("[data-savings-bar]");
    await expect(bar.locator("[data-segment]")).toHaveCount(1);
    await expect(bar.locator('[data-segment="savings"]')).toHaveClass(/is-hatched/);
    await expect(bar.locator(".savings-bar-tick")).toHaveCount(0);
    await expect(bar.locator("[data-savings-sentence]")).toHaveText(`You spent ${dollars(figures.spent)} more than you earned`);
    const trackBox = await box(bar.locator(".savings-bar-track"));
    expect((await box(bar.locator('[data-segment="savings"]'))).width).toBeCloseTo(trackBox.width, 0);
    await bar.locator('[data-segment="savings"]').hover();
    await expect(bar.locator('[data-popover="savings"]')).toHaveText(`Came out of savings ${dollars(figures.spent)}`);
  });

  test("hidden money keeps the percentages and nothing else", async ({ page }) => {
    await recordSalary(page, 6_500_000);
    const figures = await expectedFigures(page, "summary");
    const lead = await openLead(page, "summary");
    const bar = lead.locator("[data-savings-bar]");
    await expect(bar.locator("[data-savings-sentence]")).toHaveText("Spent and kept, as a share of what you earned");
    await expect(bar.locator("[data-savings-plan]")).toHaveCount(0);
    await bar.locator('[data-segment="spent"]').hover();
    await expect(bar.locator('[data-popover="spent"]')).toHaveText(`Spent · ${100 - figures.keptShare}% of income`);
    expect(await bar.innerText()).not.toMatch(/\$|kept \d|more than/i);
  });
});
