import { expect, test } from "@playwright/test";

import { gotoPageAfterApi, loadEntriesPage, loadMonthPage, loadSplitsPage, postJson, reseedDemo } from "./helpers";

// Money colour follows one rule on every page (src/domain/money-tone.ts,
// design.md "Money colour"): money in or a good outcome is mint, a deficit,
// over plan or a debt rose, a plan sky, ordinary spending and transfers the
// plain ink. Lists and tables colour text only; summary pills get a soft
// tint; hidden money shows no tone. These read the computed colours a person
// actually sees, so a stylesheet rule that paints over a tone fails here.

const INK = {
  in: "rgb(23, 104, 74)",
  short: "rgb(163, 53, 42)",
  plan: "rgb(47, 91, 134)",
  text: "rgb(38, 35, 31)",
  muted: "rgb(115, 111, 105)"
};
const TRANSPARENT = "rgba(0, 0, 0, 0)";

// Chromium reports color-mix() results as color(srgb r g b / a) with 0-1
// channels; everything else as rgb()/rgba() with 0-255 channels.
function parseColour(value) {
  const srgb = value.match(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/);
  if (srgb) {
    return { rgb: [srgb[1], srgb[2], srgb[3]].map((channel) => Number(channel) * 255), alpha: srgb[4] === undefined ? 1 : Number(srgb[4]) };
  }
  const rgb = value.match(/rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)/);
  return { rgb: [rgb[1], rgb[2], rgb[3]].map(Number), alpha: rgb[4] === undefined ? 1 : Number(rgb[4]) };
}

function over(top, bottom) {
  const { rgb, alpha } = parseColour(top);
  return rgb.map((channel, index) => channel * alpha + bottom[index] * (1 - alpha));
}

function contrast(foreground, background) {
  const luminance = (rgb) => {
    const [r, g, b] = rgb.map((channel) => {
      const value = channel / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [light, dark] = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
  return (light + 0.05) / (dark + 0.05);
}

function looks(locator) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return { color: style.color, background: style.backgroundColor, className: element.className };
  });
}

async function revealMoney(page) {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
}

async function openSummary(page, view, month) {
  await gotoPageAfterApi(
    page,
    `/summary?view=${view}&month=${month}&scope=direct_plus_shared&summary_start=${month}&summary_end=${month}`,
    "/api/summary-page",
    () => page.getByRole("heading", { name: "Summary", exact: true })
  );
}

const card = (page, label) => page.locator(".summary-head-metrics .metric, .metric-row-month .metric")
  .filter({ has: page.locator(":scope > span", { hasText: new RegExp(`^${label}$`) }) });
const cardValue = (page, label) => card(page, label).locator("strong .private-money");

// The demo seeds no income entries, so each test records one salary.
test.beforeEach(async ({ page }) => {
  await reseedDemo(page);
  await postJson(page, "/api/entries/create", {
    date: "2026-04-25",
    description: "Money tones salary",
    accountName: "UOB One",
    categoryName: "Salary",
    amountMinor: 650_000,
    entryType: "income",
    ownershipType: "direct",
    ownerName: "Tim"
  });
});

test("Summary pills: plans are sky text, outcomes a soft tint, spending within plan plain", async ({ page }) => {
  await revealMoney(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  const summary = await page.request.get("/api/summary-page?view=household&month=2026-04&scope=direct_plus_shared&summary_start=2026-04&summary_end=2026-04").then((response) => response.json());
  const amount = (label) => summary.summaryPage.metricCards.find((item) => item.label === label).amountMinor;
  await openSummary(page, "household", "2026-04");

  for (const label of ["Planned income", "Planned spend", "Savings target"]) {
    const value = await looks(cardValue(page, label));
    expect(value.color, `${label} value`).toBe(INK.plan);
    // A plan is text only: the card keeps the plain surface.
    expect((await looks(card(page, label))).className).not.toContain("money-soft");
  }

  expect(amount("Actual income")).toBeGreaterThan(0);
  expect((await looks(cardValue(page, "Actual income"))).color).toBe(INK.in);
  const incomeCard = await looks(card(page, "Actual income"));
  expect(incomeCard.className).toContain("money-soft");
  expect(incomeCard.background).not.toBe(TRANSPARENT);
  // The label on a tinted card is the tone's ink too (muted grey would fail AA there).
  expect((await looks(card(page, "Actual income").locator(":scope > span"))).color).toBe(INK.in);

  const overPlan = amount("Actual spend") > amount("Planned spend");
  expect((await looks(cardValue(page, "Actual spend"))).color).toBe(overPlan ? INK.short : INK.text);
  const savings = amount("Realized savings");
  expect((await looks(cardValue(page, "Realized savings"))).color).toBe(savings > 0 ? INK.in : savings < 0 ? INK.short : INK.text);

  // Intent vs Outcome is a table: text only, no tint behind the numbers.
  const varianceCells = page.locator(".plan-detail-table td[class*='money-']");
  await page.locator(".plan-row-card").first().evaluate((details) => { details.open = true; });
  await expect(varianceCells.first()).toBeVisible();
  for (const cell of await varianceCells.all()) {
    const style = await looks(cell);
    expect(style.background).toBe(TRANSPARENT);
    expect([INK.in, INK.short, INK.text]).toContain(style.color);
  }
});

test("Month: over-plan outcomes are rose, under-plan mint, tables text-only", async ({ page }) => {
  await revealMoney(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  // Find an overspent and an underspent planned month in the demo.
  const candidates = ["household", "person-tim"].flatMap((view) => ["2025-06", "2025-07", "2025-11", "2026-04"].map((month) => ({ view, month })));
  const amounts = await Promise.all(candidates.map(async ({ view, month }) => {
    const data = await loadMonthPage(page, { view, month });
    const value = (label) => data.monthPage.metricCards.find((item) => item.label === label).amountMinor;
    return { view, month, planned: value("Planned spend"), actual: value("Actual spend") };
  }));
  const over = amounts.find((item) => item.planned > 0 && item.actual > item.planned);
  const under = amounts.find((item) => item.planned > 0 && item.actual <= item.planned);
  expect(over, JSON.stringify(amounts)).toBeTruthy();
  expect(under, JSON.stringify(amounts)).toBeTruthy();

  const openMonth = ({ view, month }) => gotoPageAfterApi(page, `/month?view=${view}&month=${month}&scope=direct_plus_shared`, "/api/month-page", () => card(page, "Spend gap"));

  await openMonth(over);
  expect((await looks(cardValue(page, "Actual spend"))).color).toBe(INK.short);
  expect((await looks(cardValue(page, "Spend gap"))).color).toBe(INK.short);
  expect((await looks(card(page, "Spend gap"))).className).toContain("money-soft");
  expect((await looks(cardValue(page, "Planned spend"))).color).toBe(INK.plan);

  // Plan tables: a row over its plan shows a rose variance and actual; the
  // cells stay unfilled.
  const rows = page.locator(".month-plan-section:not(.month-plan-section-income) tbody tr");
  await expect(rows.first()).toBeVisible();
  const tableColours = await rows.evaluateAll((elements) => elements.map((row) => {
    const cells = [...row.querySelectorAll("td")];
    const variance = cells.find((cell) => /money-(in|short)/.test(cell.className));
    const actual = row.querySelector(".month-actual-drilldown .private-money");
    return variance && actual ? {
      varianceText: variance.textContent,
      variance: getComputedStyle(variance).color,
      varianceBackground: getComputedStyle(variance).backgroundColor,
      actual: getComputedStyle(actual).color
    } : null;
  }).filter(Boolean));
  const overRow = tableColours.find((row) => row.varianceText.includes("-"));
  const underRow = tableColours.find((row) => !row.varianceText.includes("-"));
  expect(overRow, JSON.stringify(tableColours)).toBeTruthy();
  expect(overRow.variance).toBe(INK.short);
  expect(overRow.actual).toBe(INK.short);
  expect(underRow.variance).toBe(INK.in);
  expect(underRow.actual).toBe(INK.text);
  for (const row of tableColours) expect(row.varianceBackground).toBe(TRANSPARENT);

  await openMonth(under);
  expect((await looks(cardValue(page, "Actual spend"))).color).toBe(INK.text);
  expect((await looks(cardValue(page, "Spend gap"))).color).toBe(INK.in);
});

test("Entries: expenses plain with their minus sign, income mint, transfers plain", async ({ page }) => {
  await revealMoney(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  // A demo month with expenses and a transfer, plus a salary in it.
  const months = ["2026-05", "2026-04", "2026-03", "2025-11", "2025-10"];
  const lists = await Promise.all(months.map((month) => loadEntriesPage(page, { view: "person-tim", month })));
  const index = lists.findIndex((data) => {
    const types = data.monthPage.entries.map((item) => item.entryType);
    return types.filter((type) => type === "expense").length >= 3 && types.includes("transfer");
  });
  expect(index, "a month with expenses and a transfer").toBeGreaterThanOrEqual(0);
  const month = months[index];
  await postJson(page, "/api/entries/create", {
    date: `${month}-26`, description: "Money tones bonus", accountName: "UOB One", categoryName: "Salary",
    amountMinor: 120_000, entryType: "income", ownershipType: "direct", ownerName: "Tim"
  });
  await gotoPageAfterApi(page, `/entries?view=person-tim&month=${month}&scope=direct_plus_shared`, "/api/entries-page", () => page.getByRole("heading", { name: "Entries", exact: true }));
  await expect.poll(() => page.locator(".entry-row-amount > strong").count(), { timeout: 20_000 }).toBeGreaterThan(3);

  const amounts = await page.locator(".entry-row-amount > strong").evaluateAll((elements) => elements.map((element) => ({
    text: element.textContent,
    color: getComputedStyle(element).color,
    background: getComputedStyle(element).backgroundColor,
    isTransfer: Boolean(element.closest(".entry-row")?.querySelector(".entry-chip-transfer"))
  })));
  const expense = amounts.find((item) => item.text.startsWith("-") && !item.isTransfer);
  const income = amounts.find((item) => !item.text.startsWith("-") && !item.isTransfer);
  expect(expense, JSON.stringify(amounts.slice(0, 5))).toBeTruthy();
  expect(income, JSON.stringify(amounts.slice(0, 5))).toBeTruthy();
  expect(expense.color).toBe(INK.text);
  expect(income.color).toBe(INK.in);
  for (const item of amounts) {
    expect(item.background).toBe(TRANSPARENT);
    if (item.isTransfer) expect(item.color).toBe(INK.text);
  }

  // The totals strip: income is a soft mint chip; spend and transfers plain.
  const item = (label) => page.locator(".entries-totals-item").filter({ has: page.locator(".entries-totals-label", { hasText: new RegExp(`^${label}$`) }) });
  const incomeItem = await looks(item("Income"));
  expect(incomeItem.color).toBe(INK.in);
  expect(incomeItem.background).not.toBe(TRANSPARENT);
  expect((await looks(item("Income").locator("strong"))).color).toBe(INK.in);
  expect((await looks(item("Spend").locator("strong"))).color).toBe(INK.text);
  expect((await looks(item("Spend"))).background).toBe(TRANSPARENT);
  expect((await looks(item("Transfers").locator("strong"))).color).toBe(INK.text);
});

test("Splits: you owe is rose and you are owed mint on the orange, with AA contrast", async ({ page }) => {
  await revealMoney(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  const splits = await loadSplitsPage(page, { view: "person-tim", month: "2025-10" });
  const groups = splits.splitsPage.groups.filter((group) => group.balanceMinor !== 0);
  expect(groups.length, JSON.stringify(splits.splitsPage.groups)).toBeGreaterThan(0);

  for (const group of groups.slice(0, 2)) {
    await gotoPageAfterApi(page, `/splits?view=person-tim&month=2025-10&split_group=${group.id}`, "/api/splits-page", () => page.getByRole("heading", { name: "Splits", exact: true }));
    const balance = page.locator(".splits-summary-strip .entries-summary-metrics > span").first();
    await expect(balance).toContainText(group.balanceMinor > 0 ? "You are owed" : "You owe");
    const chip = await looks(balance);
    const ink = group.balanceMinor > 0 ? INK.in : INK.short;
    expect(chip.color).toBe(ink);
    expect((await looks(balance.locator("strong"))).color).toBe(ink);
    // Composite the wash over the darker end of the orange panel.
    const washed = over(chip.background, [166, 94, 58]);
    expect(contrast(parseColour(ink).rgb, washed)).toBeGreaterThanOrEqual(4.5);

    // The group pill's balance line carries the same tone.
    const pillBalance = page.locator(".split-group-pill").filter({ hasText: group.name }).first().locator(".split-group-pill-balance");
    expect((await looks(pillBalance)).color).toBe(ink);
  }

  // Activity on the light cards: lent is mint, borrowed rose, as text only.
  const directions = await page.locator(".split-activity-trailing strong").evaluateAll((elements) => elements.map((element) => ({
    label: element.textContent.trim(),
    color: getComputedStyle(element).color,
    background: getComputedStyle(element).backgroundColor
  })));
  for (const direction of directions) {
    if (direction.label === "you lent" || direction.label === "you received") expect(direction.color).toBe(INK.in);
    if (direction.label === "you borrowed") expect(direction.color).toBe(INK.short);
    expect(direction.background).toBe(TRANSPARENT);
  }
  expect(directions.some((direction) => ["you lent", "you borrowed"].includes(direction.label)), JSON.stringify(directions)).toBe(true);
});

test("hidden money shows no tone", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openSummary(page, "household", "2026-04");
  await expect(page.getByRole("button", { name: "Show money totals" })).toBeVisible();
  for (const label of ["Planned income", "Actual income", "Actual spend", "Realized savings"]) {
    const value = await looks(cardValue(page, label));
    expect(value.color, label).toBe(INK.text);
    // The card keeps no mint or rose tint either (a neutral one is fine).
    const surface = parseColour((await looks(card(page, label))).background).rgb;
    expect(Math.max(...surface) - Math.min(...surface), `${label} tint`).toBeLessThan(12);
    expect((await looks(card(page, label).locator(":scope > span"))).color).toBe(INK.muted);
  }

  await gotoPageAfterApi(page, "/entries?view=person-tim&month=2026-04&scope=direct_plus_shared", "/api/entries-page", () => page.getByRole("heading", { name: "Entries", exact: true }));
  const incomeValue = page.locator(".entries-totals-item").filter({ has: page.locator(".entries-totals-label", { hasText: /^Income$/ }) }).locator("strong");
  await expect(incomeValue).toHaveText("••••");
  expect((await looks(incomeValue)).color).not.toBe(INK.in);
  const rowColours = await page.locator(".entry-row-amount > strong").evaluateAll((elements) => elements.map((element) => getComputedStyle(element).color));
  expect(rowColours.length).toBeGreaterThan(0);
  expect(rowColours.filter((colour) => colour === INK.in || colour === INK.short)).toEqual([]);

  // Revealing brings the tones back without a reload.
  await page.getByRole("button", { name: "Show money totals" }).click();
  await expect(incomeValue).not.toHaveText("••••");
  expect((await looks(incomeValue)).color).toBe(INK.in);
});
