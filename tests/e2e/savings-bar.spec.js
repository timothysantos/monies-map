import { devices, expect, test } from "@playwright/test";

import { loadMonthPage, loadSummaryPage, postJson, reseedDemo } from "./helpers";

// The savings bar under the Summary and Month lead (design.md, "Lead ·
// Support · Detail"): all the money earned is one bar, spent rose and kept
// mint, a thin plan bar under it, a legend and one plain line. Every figure is
// the page DTO's own. The legend (each part's name and figure, and the plan
// bar's name) is always in the page: nothing needs a hover or a tap, and
// there is no popover. A tap or click on a part (or its legend line) opens
// its menu under it (design.md "Openable figures"). Hidden money keeps labels
// and percentages only. The
// model's exact numbers are in tests/savings-bar-model.test.mjs; this proves
// the rendering, the legend, the tap targets, the Month card height and
// hidden money.

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

// The legend item for a part or the plan bar (`data-legend`), and its text
// without the swatch: "Spent $209,000" on a phone, "Spent $209,000 · 85%" on
// a wider screen, "Spent · 85%" with money hidden.
const legendItem = (bar, key) => bar.locator(`[data-savings-legend] [data-legend="${key}"]`);
const POPOVER = ".savings-bar-popover, .savings-bar-float";
const isPhone = (page) => page.viewportSize().width < 761;
// A phone has no room for the share beside the figure; a wider screen has.
const legendText = (page, label, percent) => (isPhone(page) || percent === null ? label : `${label} · ${percent}%`);
// The Month card's phone cap: 270 px (was 215 before the lead rhythm gave every group room; design.md "Lead rhythm").
const MONTH_CARD_CAP = 270;

// The lead's vertical rhythm (summary-lead.css, "The lead's vertical rhythm"):
// 4 px between lines of one group, 8 px from the bar to its legend, 12 px
// between groups (16 px from 761 px wide), and a line-height on every text
// role. The gaps are measured between the rendered boxes, so a rule that
// glues the legend to the bar or the sentence to the legend fails here. Runs on
// the Month and Summary leads (the Summary card has no stat strip).
const SPACING_SCALE = [4, 8, 12, 16];
async function expectLeadRhythm(page, lead) {
  const group = isPhone(page) ? 12 : 16;
  const bar = lead.locator("[data-savings-bar]");
  const gap = async (above, below) => (await box(below)).y - (await box(above)).bottom;
  const near = (value, expected, message) => expect(Math.abs(value - expected), `${message}: ${value}px, expected ${expected}px`).toBeLessThanOrEqual(1);

  const figure = lead.locator(".lsd-figure");
  const progress = lead.locator(".summary-lead-line");
  const track = bar.locator(".savings-bar-track");
  const plan = bar.locator(".savings-bar-plan");
  const legend = bar.locator("[data-savings-legend]");
  const sentence = bar.locator("[data-savings-sentence]");
  const jobs = lead.locator("[data-money-jobs]");

  // Within a group: a line gap (4) between the eyebrow, the figure and the progress line.
  near(await gap(lead.locator(".lsd-eyebrow"), figure), 4, "eyebrow to headline");
  near(await gap(figure, progress), 4, "headline to progress line");
  // Between groups: head, then the bar and its legend, then the sentence and the money jobs.
  near(await gap(progress, track), group, "progress line to bar");
  near(await gap(track, plan), 4, "bar to plan bar");
  near(await gap(plan, legend), 8, "plan bar to legend");
  expect(await gap(track, legend), "the legend never touches the bar").toBeGreaterThanOrEqual(8);
  near(await gap(legend, sentence), group, "legend to sentence");
  near(await gap(sentence, jobs), 4, "sentence to money jobs line");
  const columns = lead.locator(".lead-columns");
  if (await columns.count()) {
    near(await gap(jobs, columns), group, "money jobs to the stat strip");
    // A stat's label, figure and plan line sit a line gap apart.
    const first = lead.locator('[data-metric="income"]');
    near(await gap(first.locator(".lead-column-label"), first.locator("strong")), 4, "stat label to figure");
    near(await gap(first.locator("strong"), first.locator("small")), 4, "stat figure to plan line");
  }
  for (const value of [4, 8, group]) {
    expect(SPACING_SCALE, `${value}px is on the scale`).toContain(value);
  }

  // A line-height on every text role: none is glued (ratio under 1.15) to the next.
  const roles = [".lsd-eyebrow", ".lsd-figure .lsd-amount", ".summary-lead-line", "[data-savings-legend]", "[data-savings-sentence]", "[data-money-jobs-summary]", ".lead-column-label", ".lead-column strong", ".lead-column small"];
  for (const selector of roles) {
    const target = lead.locator(selector).first();
    if (!(await target.count())) continue;
    const ratio = await target.evaluate((element) => {
      const style = getComputedStyle(element);
      return Number.parseFloat(style.lineHeight) / Number.parseFloat(style.fontSize);
    });
    expect(ratio, `${selector} line-height ratio`).toBeGreaterThanOrEqual(selector === ".lsd-figure .lsd-amount" ? 1.1 : 1.2);
  }

  // The legend wraps cleanly: inside the card, rows a line gap apart, never touching.
  const card = await box(lead);
  const items = await legend.locator("li").evaluateAll((nodes) => nodes.map((node) => {
    const rect = node.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, right: rect.right };
  }));
  for (const item of items) expect(item.right, "legend item inside the card").toBeLessThanOrEqual(card.right);
  const rows = [...new Set(items.map((item) => Math.round(item.top)))].sort((left, right) => left - right);
  for (let index = 1; index < rows.length; index += 1) {
    const rowBottom = Math.max(...items.filter((item) => Math.round(item.top) === rows[index - 1]).map((item) => item.bottom));
    expect(rows[index] - rowBottom, "legend rows keep a line gap").toBeGreaterThanOrEqual(3);
  }
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
  // The legend is in the page without any interaction: the right items in
  // bar order, then the plan bar's name; no popover exists to open.
  await expect(bar.locator("[data-savings-legend]")).toBeVisible();
  await expect(bar.locator("[data-savings-legend] [data-legend]")).toHaveCount(3);
  await expect(bar.locator("[data-savings-legend] [data-legend]").nth(0)).toHaveAttribute("data-legend", "spent");
  await expect(bar.locator("[data-savings-legend] [data-legend]").nth(1)).toHaveAttribute("data-legend", "kept");
  await expect(bar.locator("[data-savings-legend] [data-legend]").nth(2)).toHaveAttribute("data-legend", "plan");
  await expect(bar.locator(POPOVER)).toHaveCount(0);
  await expect(legendItem(bar, "spent")).toHaveText(legendText(page, `Spent ${dollars(figures.spent)}`, 100 - figures.keptShare));
  await expect(legendItem(bar, "kept")).toHaveText(legendText(page, `Kept ${dollars(figures.kept)}`, figures.keptShare));
  // The swatches are the bar's colours (a rose spent, a mint kept).
  const [swatchRed, swatchGreen] = await backgroundRgb(legendItem(bar, "spent").locator(".savings-bar-swatch"));
  expect(swatchRed - swatchGreen, "spent swatch is rose").toBeGreaterThan(40);
  const [keptSwatchRed, keptSwatchGreen] = await backgroundRgb(legendItem(bar, "kept").locator(".savings-bar-swatch"));
  expect(keptSwatchGreen - keptSwatchRed, "kept swatch is mint").toBeGreaterThan(8);
  // The thin plan bar is named without any interaction.
  await expect(legendItem(bar, "plan")).toBeVisible();
  // The segment's accessible description is its legend item.
  await expect(spentSegment).toHaveAccessibleName("Spent");
  await expect(keptSegment).toHaveAccessibleName("Kept");
  await expect(spentSegment).toHaveAccessibleDescription(await legendItem(bar, "spent").innerText());
  return { bar, spentSegment, keptSegment };
}

async function expectOverBar(page, lead, figures) {
  const bar = lead.locator("[data-savings-bar]");
  const track = await box(bar.locator(".savings-bar-track"));
  const spentSegment = bar.locator('[data-segment="spent"]');
  const savingsSegment = bar.locator('[data-segment="savings"]');
  await expect(bar.locator('[data-segment="kept"]')).toHaveCount(0);
  await expect(savingsSegment).toHaveClass(/is-hatched/);
  const tick = bar.locator(".savings-bar-tick");
  // The tick carries no label on the bar (a label there covered the parts):
  // the legend names it, "Earned" on a phone (one line), "All you earned $x" with room.
  await expect(tick).toHaveText("");
  await expect(legendItem(bar, "earned")).toHaveText(isPhone(page) ? "Earned" : `All you earned ${dollars(figures.income)}`);
  const withinPercent = (figures.income / figures.spent) * 100;
  const tickBox = await box(tick);
  expect(((tickBox.x + tickBox.width / 2 - track.x) / track.width) * 100).toBeCloseTo(withinPercent, 0);
  expect(((await box(spentSegment)).width / track.width) * 100).toBeCloseTo(withinPercent, 0);
  expect(((await box(savingsSegment)).width / track.width) * 100).toBeCloseTo(100 - withinPercent, 0);
  // Hatched stripes, and the tone is still rose (the money-short class).
  expect(await savingsSegment.evaluate((element) => getComputedStyle(element).backgroundImage)).toContain("repeating-linear-gradient");
  await expect(savingsSegment).toHaveClass(/money-short/);
  await expect(bar.locator("[data-savings-sentence]")).toHaveText(`You spent ${dollars(figures.spent - figures.income)} more than you earned`);
  await expect(legendItem(bar, "spent")).toHaveText(legendText(page, `Spent ${dollars(figures.spent)}`, null));
  await expect(legendItem(bar, "savings")).toHaveText(legendText(page, `From savings ${dollars(figures.spent - figures.income)}`, null));
  // More out than in: no share of income is meaningful, so the legend shows none.
  await expect(bar.locator("[data-savings-legend] .savings-bar-legend-share")).toHaveCount(0);
  // The striped swatch matches the striped part.
  expect(await legendItem(bar, "savings").locator(".savings-bar-swatch").evaluate((element) => getComputedStyle(element).backgroundImage)).toContain("repeating-linear-gradient");
  await expect(bar.locator('[data-legend="kept"]')).toHaveCount(0);
  await expect(bar.locator(POPOVER)).toHaveCount(0);
  // The plan bar's name: "Plan" on a phone, "Plan: spend $x · keep $y" with room.
  await expect(legendItem(bar, "plan")).toHaveText(isPhone(page) ? "Plan" : /^Plan: spend \$[\d,]+( · invest \$[\d,]+)?( · keep \$[\d,]+)?$/);
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

// A tap or click on a part opens its menu (View entries, Open plan, Ask
// about this; design.md "Openable figures") just under the part, inside the
// page's gutters. `key` is the part's money figure (spending, kept,
// invested, from_savings).
const openMenu = (page) => page.locator("[data-figure-menu]");
async function expectMenuInFlow(bar, key) {
  const page = bar.page();
  const menu = page.locator(`[data-figure-menu="${key}"]`);
  await expect(menu).toBeVisible();
  // ("Open May 2026 plan" on a Summary range.)
  await expect(menu.getByRole("button")).toHaveText(["View entries", /^Open (\w+ \d{4} )?plan$/, "Ask about this"]);
  const segment = bar.locator(`[data-fig="${key}"]`).first();
  expect((await box(menu)).y, "the menu is under the part").toBeGreaterThanOrEqual((await box(segment)).bottom - 1);
  expect((await box(menu)).right).toBeLessThanOrEqual(page.viewportSize().width - 15);
  return menu;
}

test.describe("phone", () => {
  test.use(iPhone13);

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await reseedDemo(page);
  });

  test("Month lead: the bar, the legend and the plan name are in the page without a tap, a tap opens the menu, the card stays within 270px", async ({ page }) => {
    await recordSalary(page, 6_500_000);
    await revealMoney(page);
    const figures = await expectedFigures(page, "month");
    expect(figures.kept, "the fixture month saves").toBeGreaterThan(0);
    const lead = await openLead(page, "month");
    const { bar, keptSegment, spentSegment } = await expectKeptBar(page, lead, figures);

    // The legend is one line on a phone (amounts, no shares), under the plan bar
    // and above the sentence, inside the card.
    const legend = await box(bar.locator("[data-savings-legend]"));
    expect(legend.height, "legend on one line").toBeLessThan(18);
    expect(legend.y, "legend under the plan bar").toBeGreaterThanOrEqual((await box(bar.locator(".savings-bar-plan"))).bottom);
    expect(legend.right).toBeLessThanOrEqual(390);
    expect((await box(bar.locator("[data-savings-sentence]"))).y, "legend above the sentence").toBeGreaterThanOrEqual(legend.bottom);
    // One line of text each (the card is compact), the card ≤ 270px, and the
    // Money insights still start above the fold.
    expect((await box(bar.locator("[data-savings-sentence]"))).height, "sentence on one line").toBeLessThan(22);
    expect((await box(lead.locator("[data-money-jobs]"))).height, "money jobs line on one line").toBeLessThan(18);
    expect((await box(lead.locator("[data-money-jobs-summary]"))).height, "money jobs line tap target").toBeGreaterThanOrEqual(40);
    await expectLeadRhythm(page, lead);
    const card = await box(lead);
    expect(card.height, "Month lead card height").toBeLessThanOrEqual(MONTH_CARD_CAP);
    expect((await box(page.locator(".financial-insight").first())).y, "Money insights above the fold").toBeLessThan(664);
    for (const column of ["income", "saved", "remaining"]) {
      const columnBox = await box(page.locator(`.month-lead-group [data-metric="${column}"]`));
      expect(columnBox.height, `${column} tap target`).toBeGreaterThanOrEqual(44);
      expect(columnBox.bottom).toBeLessThanOrEqual(card.bottom);
    }
    expect(card.right).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);

    // Tap: a part opens its menu in the flow, a tap on the other part moves
    // it, a second tap on the same part closes it, a tap elsewhere closes it.
    await expectTouchTarget(page, keptSegment);
    await expect(openMenu(page)).toHaveCount(0);
    await keptSegment.tap();
    await expectMenuInFlow(bar, "kept");
    await spentSegment.tap();
    await expectMenuInFlow(bar, "spending");
    await expect(page.locator('[data-figure-menu="kept"]')).toHaveCount(0);
    await spentSegment.tap();
    await expect(openMenu(page)).toHaveCount(0);
    await keptSegment.tap();
    await expectMenuInFlow(bar, "kept");
    await lead.locator(".lsd-eyebrow").tap();
    await expect(openMenu(page)).toHaveCount(0);
  });

  test("Month lead, spending more than was earned: rose to an \"All you earned\" tick, the rest striped and named in the legend, no kept part", async ({ page }) => {
    await recordSalary(page, 100_000);
    await revealMoney(page);
    const figures = await expectedFigures(page, "month");
    expect(figures.over, "the fixture month overspends the small salary").toBe(true);
    const lead = await openLead(page, "month");
    await expectOverBar(page, lead, figures);
    await expectLeadRhythm(page, lead);
    expect((await box(lead)).height, "Month lead card height").toBeLessThanOrEqual(MONTH_CARD_CAP);
    expect((await box(lead.locator("[data-savings-legend]"))).height, "legend on one line").toBeLessThan(18);
    await expect(lead.locator('[data-segment="savings"]')).toHaveAccessibleName("Came out of savings");
    await lead.locator('[data-segment="savings"]').tap();
    await expectMenuInFlow(lead.locator("[data-savings-bar]"), "from_savings");
  });

  test("hidden money: the legend has labels and percentages only, no plan item, no amount and no sign word anywhere in the bar", async ({ page }) => {
    await recordSalary(page, 6_500_000);
    const figures = await expectedFigures(page, "month");
    const lead = await openLead(page, "month");
    await expect(lead.locator(".summary-lead-spent")).toHaveText("••••");
    const bar = lead.locator("[data-savings-bar]");
    await expect(bar.locator("[data-segment]")).toHaveCount(2);
    await expect(bar.locator("[data-savings-sentence]")).toHaveText("Spent and kept, as a share of what you earned");
    await expect(bar.locator("[data-savings-plan]")).toHaveCount(0);
    await expect(bar.locator(".savings-bar-plan")).toHaveCount(0);
    // Labels and shares, even on a phone; the plan is not drawn, so it is not named.
    await expect(bar.locator("[data-savings-legend] [data-legend]")).toHaveCount(2);
    await expect(legendItem(bar, "spent")).toHaveText(`Spent · ${100 - figures.keptShare}%`);
    await expect(legendItem(bar, "kept")).toHaveText(`Kept · ${figures.keptShare}%`);
    await expect(legendItem(bar, "plan")).toHaveCount(0);
    expect((await box(lead)).height, "Month lead card height").toBeLessThanOrEqual(MONTH_CARD_CAP);
    await bar.locator('[data-segment="kept"]').tap();
    await expectMenuInFlow(bar, "kept");
    // Everything the bar holds, the menu too, is free of amounts and sign words.
    const text = [
      await bar.evaluate((element) => [element.textContent, ...[...element.querySelectorAll("[aria-label]")].map((part) => part.getAttribute("aria-label"))].join(" ")),
      await openMenu(page).evaluate((element) => `${element.textContent} ${element.getAttribute("aria-label")}`)
    ].join(" ");
    expect(text).not.toMatch(/\$|[-−]\s?\d|\bkept \d|more than/i);
    // Neutral warm greys (the 70s ink is brown, so a little chroma): no rose or mint colour reveals a sign.
    for (const key of ["spent", "kept"]) {
      const [red, green, blue] = await backgroundRgb(bar.locator(`[data-segment="${key}"]`));
      expect(Math.max(red, green, blue) - Math.min(red, green, blue), `${key} is grey`).toBeLessThanOrEqual(20);
      // The legend's swatch is the same grey as its part.
      expect(await backgroundRgb(legendItem(bar, key).locator(".savings-bar-swatch")), `${key} swatch`).toEqual([red, green, blue]);
    }
  });
});

test.describe("desktop", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await reseedDemo(page);
  });

  test("Summary lead: the legend names each part with its figure and share and the plan bar, hover shows nothing, a click opens the menu in the flow", async ({ page }) => {
    await recordSalary(page, 6_500_000);
    await revealMoney(page);
    const figures = await expectedFigures(page, "summary");
    expect(figures.kept, "the range saves").toBeGreaterThan(0);
    const lead = await openLead(page, "summary");
    const { bar, keptSegment, spentSegment } = await expectKeptBar(page, lead, figures);

    // Hover opens nothing: the legend is already there and there is no popover.
    await keptSegment.hover();
    await expect(bar.locator(POPOVER)).toHaveCount(0);
    await expect(openMenu(page)).toHaveCount(0);
    // A click opens the menu under the legend (a second click closes it);
    // hovering another part leaves it where it is.
    await keptSegment.click();
    await expectMenuInFlow(bar, "kept");
    await spentSegment.hover();
    await expect(page.locator('[data-figure-menu="kept"]')).toBeVisible();
    await page.locator('[data-figure-menu="kept"] [data-action="ask"]').hover();
    await expect(page.locator('[data-figure-menu="kept"]')).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(openMenu(page)).toHaveCount(0);
    await spentSegment.click();
    await expectMenuInFlow(bar, "spending");
    await spentSegment.click();
    await expect(openMenu(page)).toHaveCount(0);

    // Keyboard: Enter on a focused part opens its menu, Escape closes it.
    await keptSegment.focus();
    await page.keyboard.press("Enter");
    await expectMenuInFlow(bar, "kept");
    await page.keyboard.press("Escape");
    await expect(openMenu(page)).toHaveCount(0);

    // The Support pills and the plan line are still there; the old spend-vs-plan
    // bar is not (the savings bar and its plan bar are the only bars).
    await expect(page.locator('.summary-support-pill[data-metric="income"] strong')).toBeVisible();
    await expect(lead.locator(".lsd-progress-line")).toBeVisible();
    await expect(lead.locator(".lsd-bar")).toHaveCount(0);
  });

  test("Month lead at desktop width: the same rhythm, shares of income beside a saving and none when more went out than came in", async ({ page }) => {
    await recordSalary(page, 6_500_000);
    await revealMoney(page);
    const figures = await expectedFigures(page, "month");
    const lead = await openLead(page, "month");
    await expectKeptBar(page, lead, figures);
    await expectLeadRhythm(page, lead);
    await expect(legendItem(lead.locator("[data-savings-bar]"), "spent")).toContainText(`${100 - figures.keptShare}%`);

    // Salary not landed yet ($10 earned): spending is a share of nothing, so
    // the legend shows no percentage (it read "26347%").
    await reseedDemo(page);
    await recordSalary(page, 1_012);
    const over = await expectedFigures(page, "month");
    expect(over.over, "the month now spends more than it earned").toBe(true);
    const overLead = await openLead(page, "month");
    await expect(overLead.locator('[data-segment="savings"]')).toBeVisible();
    await expect(overLead.locator("[data-savings-legend] .savings-bar-legend-share")).toHaveCount(0);
    expect(await overLead.locator("[data-savings-legend]").innerText()).not.toMatch(/\d%/);
    await expectLeadRhythm(page, overLead);
  });

  test("Summary lead, spending more than was earned: the tick says \"All you earned\" with the figure, the striped part is \"From savings\" in the legend", async ({ page }) => {
    await recordSalary(page, 100_000);
    await revealMoney(page);
    const figures = await expectedFigures(page, "summary");
    expect(figures.over, "the range overspends the small salary").toBe(true);
    const lead = await openLead(page, "summary");
    await expectOverBar(page, lead, figures);
    await expectLeadRhythm(page, lead);
    // Nothing is drawn over the bar: the tick's name is in the legend, under
    // the bars.
    const track = await box(lead.locator(".savings-bar-track"));
    const earned = await box(legendItem(lead.locator("[data-savings-bar]"), "earned"));
    expect(earned.y).toBeGreaterThanOrEqual(track.bottom);
    // It opens what was earned.
    await legendItem(lead.locator("[data-savings-bar]"), "earned").locator("[data-fig]").click();
    await expect(page.locator('[data-figure-menu="earned"]')).toBeVisible();
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
    // No income, so no share of it: the legend has the figure alone.
    await expect(legendItem(bar, "savings")).toHaveText(`From savings ${dollars(figures.spent)}`);
  });

  test("hidden money keeps the labels and percentages and nothing else", async ({ page }) => {
    await recordSalary(page, 6_500_000);
    const figures = await expectedFigures(page, "summary");
    const lead = await openLead(page, "summary");
    const bar = lead.locator("[data-savings-bar]");
    await expect(bar.locator("[data-savings-sentence]")).toHaveText("Spent and kept, as a share of what you earned");
    await expect(bar.locator("[data-savings-plan]")).toHaveCount(0);
    await expect(legendItem(bar, "spent")).toHaveText(`Spent · ${100 - figures.keptShare}%`);
    await expect(legendItem(bar, "kept")).toHaveText(`Kept · ${figures.keptShare}%`);
    await expect(legendItem(bar, "plan")).toHaveCount(0);
    expect(await bar.innerText()).not.toMatch(/\$|kept \d|more than/i);
  });
});
