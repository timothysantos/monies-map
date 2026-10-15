import { expect, test } from "@playwright/test";

import { gotoPageAfterApi, leadFigures, loadEntriesPage, loadMonthPage, loadSplitsPage, postJson, reseedDemo } from "./helpers";

// Money colour follows one rule on every page (src/domain/money-tone.ts,
// design.md "Money colour"): money in or a good outcome is mint, a deficit,
// over plan or a debt rose, a plan sky, money out in a list (an expense row,
// a negative day) rose text, transfers the plain ink. Lists and tables colour text only; summary pills get a soft
// tint; hidden money shows no tone. These read the computed colours a person
// actually sees, so a stylesheet rule that paints over a tone fails here.

const INK = {
  in: "rgb(74, 92, 34)",
  short: "rgb(147, 54, 41)",
  plan: "rgb(45, 93, 94)",
  text: "rgb(53, 43, 36)",
  muted: "rgb(106, 95, 87)"
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

// The Month top (month-overview.jsx MonthLead): the spend lead and its pills.
const monthLead = (page, part) => page.locator(`.month-lead ${part}`);
const monthPill = (page, metric) => page.locator(`.month-lead-group .lead-column[data-metric="${metric}"]`);

// The demo seeds no income entries, so each test records one salary.
test.beforeEach(async ({ page }) => {
  // These read the Plan lead; April 2026 has no plan, so it would open in Simple.
  await page.addInitScript(() => window.localStorage.setItem("monies-map:lead-view", "plan"));
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

// The Summary top (design.md, "Lead · Support · Detail"): the lead card's
// planned spend is sky text, its spend plain (rose over plan), the headroom
// mint under plan and rose over; Income and Saved are soft-tint pills.
const summaryPill = (page, metric) => page.locator(`.summary-support-pill[data-metric="${metric}"]`);

test("Summary lead and pills: the plan is sky text, outcomes a soft tint, spending within plan plain", async ({ page }) => {
  await revealMoney(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  const summary = await page.request.get("/api/summary-page?view=household&month=2026-04&scope=direct_plus_shared&summary_start=2026-04&summary_end=2026-04").then((response) => response.json());
  const amount = (label) => summary.summaryPage.metricCards.find((item) => item.label === label).amountMinor;
  await openSummary(page, "household", "2026-04");

  const plan = await looks(page.locator(".summary-lead-plan"));
  expect(plan.color, "planned spend").toBe(INK.plan);
  // A plan is text only: no tint behind it.
  expect(plan.background).toBe(TRANSPARENT);

  expect(amount("Actual income")).toBeGreaterThan(0);
  const incomePill = await looks(summaryPill(page, "income"));
  expect(incomePill.className).toContain("money-soft");
  expect(incomePill.background).not.toBe(TRANSPARENT);
  expect((await looks(summaryPill(page, "income").locator("strong .private-money"))).color).toBe(INK.in);
  // The label and the plan line on a tinted pill are the tone's ink too
  // (muted grey would fail AA there).
  expect((await looks(summaryPill(page, "income").locator(".summary-support-pill-label"))).color).toBe(INK.in);
  expect((await looks(summaryPill(page, "income").locator("small"))).color).toBe(INK.in);

  // The lead is the spend job: spending against the spend plan (leadFigures).
  const lead = leadFigures(summary);
  const overPlan = lead.spent > lead.planned;
  expect((await looks(page.locator(".summary-lead-spent .private-money"))).color).toBe(overPlan ? INK.short : INK.text);
  if (lead.planned > 0 || lead.spent > 0) {
    expect((await looks(page.locator(".summary-lead-headroom"))).color).toBe(overPlan ? INK.short : INK.in);
    await expect(page.locator(".summary-lead-headroom")).toContainText(overPlan ? "over plan" : "under plan");
  } else {
    // Nothing spent against no plan: neither under nor over.
    await expect(page.locator(".summary-lead-headroom")).toHaveCount(0);
  }
  // The spend-vs-plan bar is gone: the plan line above carries the tone.
  await expect(page.locator(".summary-lead .lsd-bar")).toHaveCount(0);
  // Saved is what was kept: money moved to Savings counts as saved.
  const savings = lead.kept;
  expect((await looks(summaryPill(page, "saved").locator("strong .private-money"))).color).toBe(savings > 0 ? INK.in : savings < 0 ? INK.short : INK.text);

  // Intent vs Outcome's detail rows (the latest month's are open): text
  // only, no tint behind the numbers.
  const varianceCells = page.locator(".summary-intent-month").first().locator(".summary-intent-metric dd[class*='money-']");
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
    const lead = leadFigures(await loadMonthPage(page, { view, month }));
    return { view, month, planned: lead.planned, actual: lead.spent };
  }));
  const over = amounts.find((item) => item.planned > 0 && item.actual > item.planned);
  const under = amounts.find((item) => item.planned > 0 && item.actual <= item.planned);
  expect(over, JSON.stringify(amounts)).toBeTruthy();
  expect(under, JSON.stringify(amounts)).toBeTruthy();

  const openMonth = ({ view, month }) => gotoPageAfterApi(page, `/month?view=${view}&month=${month}&scope=direct_plus_shared`, "/api/month-page", () => monthLead(page, ".summary-lead-headroom"));

  // The lead: spend rose over plan, the spend gap ("over plan") rose text
  // with no tint, the plan sky text.
  await openMonth(over);
  expect((await looks(monthLead(page, ".summary-lead-spent .private-money"))).color).toBe(INK.short);
  const overGap = await looks(monthLead(page, ".summary-lead-headroom"));
  expect(overGap.color).toBe(INK.short);
  expect(overGap.background).toBe(TRANSPARENT);
  await expect(monthLead(page, ".summary-lead-headroom")).toContainText("over plan");
  expect((await looks(monthLead(page, ".summary-lead-plan"))).color).toBe(INK.plan);
  await expect(monthLead(page, ".lsd-bar")).toHaveCount(0);

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
  expect((await looks(monthLead(page, ".summary-lead-spent .private-money"))).color).toBe(INK.text);
  expect((await looks(monthLead(page, ".summary-lead-headroom"))).color).toBe(INK.in);
  await expect(monthLead(page, ".summary-lead-headroom")).toContainText("under plan");
});

test("Entries: expenses rose with their minus sign, income mint, transfers plain", async ({ page }) => {
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
  expect(expense.color).toBe(INK.short);
  expect(income.color).toBe(INK.in);
  for (const item of amounts) {
    expect(item.background).toBe(TRANSPARENT);
    if (item.isTransfer) expect(item.color).toBe(INK.text);
  }

  // The Entries top: income is a soft mint pill; Spent (the lead) is plain
  // ink, not rose (spending is not bad for being spending); transfers and
  // outflow plain.
  const item = (label) => page.locator(".entries-totals-pill").filter({ has: page.locator(".entries-totals-label", { hasText: new RegExp(`^${label}$`) }) });
  const incomeItem = await looks(item("Income"));
  expect(incomeItem.color).toBe(INK.in);
  expect(incomeItem.background).not.toBe(TRANSPARENT);
  expect((await looks(item("Income").locator("strong"))).color).toBe(INK.in);
  expect((await looks(page.locator(".entries-totals .lsd-amount"))).color).toBe(INK.text);
  expect((await looks(page.locator(".entries-totals .lsd-card"))).background).not.toBe(TRANSPARENT);
  expect((await looks(item("Transfers").locator("strong"))).color).toBe(INK.text);
  expect((await looks(item("Outflow").locator("strong"))).color).toBe(INK.text);
});

test("Splits: the lead card carries the balance tone; tiles on the orange are plain text; activity is coloured text only", async ({ page }) => {
  await revealMoney(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  const splits = await loadSplitsPage(page, { view: "person-tim", month: "2025-10" });
  const groups = splits.splitsPage.groups.filter((group) => group.balanceMinor !== 0);
  expect(groups.length, JSON.stringify(splits.splitsPage.groups)).toBeGreaterThan(0);

  for (const group of groups.slice(0, 2)) {
    await gotoPageAfterApi(page, `/splits?view=person-tim&month=2025-10&split_group=${group.id}`, "/api/splits-page", () => page.getByRole("heading", { name: "Splits", exact: true }));
    // The lead is a white card (not the orange): money owed to you is mint
    // text, a debt rose text, never a fill.
    const lead = page.locator(".splits-lead");
    const figure = lead.locator(".lsd-amount");
    await expect(lead.locator(".lsd-amount-caption")).toContainText(group.balanceMinor > 0 ? "owes you" : "You owe");
    const leadFigure = await looks(figure);
    expect(leadFigure.color).toBe(group.balanceMinor > 0 ? INK.in : INK.short);
    expect(leadFigure.background).toBe(TRANSPARENT);

    const pillBalance = page.locator(".splits-strip-tile").filter({ hasText: group.name }).first().locator(".splits-strip-tile-balance");
    const pill = await looks(pillBalance);
    expect(pill.background).toBe(TRANSPARENT);
    expect([INK.in, INK.short]).not.toContain(pill.color);
  }

  // Activity on the light cards: lent and received are mint, borrowed and
  // paid rose, as text only.
  const directions = await page.locator(".split-activity-trailing strong").evaluateAll((elements) => elements.map((element) => ({
    label: element.textContent.trim(),
    color: getComputedStyle(element).color,
    background: getComputedStyle(element).backgroundColor
  })));
  for (const direction of directions) {
    if (direction.label === "you lent" || direction.label === "you received") expect(direction.color).toBe(INK.in);
    if (direction.label === "you borrowed" || direction.label === "you paid") expect(direction.color).toBe(INK.short);
    expect(direction.background).toBe(TRANSPARENT);
  }
  expect(directions.some((direction) => ["you lent", "you borrowed"].includes(direction.label)), JSON.stringify(directions)).toBe(true);
});

test("hidden money shows no tone", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openSummary(page, "household", "2026-04");
  await expect(page.getByRole("button", { name: "Show money totals" })).toBeVisible();
  // The lead: dots in plain ink, the plan muted, no spend line, only the savings bar's percentages.
  await expect(page.locator(".summary-lead-spent")).toHaveText("••••");
  expect((await looks(page.locator(".summary-lead-spent .private-money"))).color).toBe(INK.text);
  expect((await looks(page.locator(".summary-lead-plan"))).color).toBe(INK.muted);
  await expect(page.locator(".summary-lead .savings-bar-track")).toBeVisible();
  await expect(page.locator(".summary-lead .lsd-bar")).toHaveCount(0);
  await expect(page.locator(".summary-lead-headroom")).toHaveCount(0);
  for (const metric of ["income", "saved"]) {
    const pill = summaryPill(page, metric);
    await expect(pill.locator("strong")).toHaveText("••••");
    expect((await looks(pill.locator("strong .private-money"))).color, metric).toBe(INK.text);
    // The pill keeps no mint or rose tint either: none, or the cream neutral
    // soft tint (60% over the card).
    const surface = parseColour((await looks(pill)).background);
    if (surface.alpha > 0) {
      const neutral = parseColour(await page.evaluate(() => {
        const probe = document.createElement("span");
        probe.style.color = "color-mix(in srgb, var(--pastel-neutral) 60%, var(--card))";
        document.body.append(probe);
        const colour = getComputedStyle(probe).color;
        probe.remove();
        return colour;
      })).rgb;
      surface.rgb.forEach((channel, index) => expect(Math.abs(channel - neutral[index]), `${metric} tint`).toBeLessThan(3));
    }
    expect((await looks(pill.locator(".summary-support-pill-label"))).color).toBe(INK.muted);
  }

  await gotoPageAfterApi(page, "/entries?view=person-tim&month=2026-04&scope=direct_plus_shared", "/api/entries-page", () => page.getByRole("heading", { name: "Entries", exact: true }));
  const incomeValue = page.locator(".entries-totals-pill").filter({ has: page.locator(".entries-totals-label", { hasText: /^Income$/ }) }).locator("strong");
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

// Hiding money hides its sign in words too: no line may say a hidden figure
// is over or under, owed or owing, or off.
const SIGN_WORDING = /\b(Not planned yet|Planned more than you earn|Over plan|Under plan|over plan|under plan|% of plan|You owe|You are owed|owes you|Settled up|you lent|you borrowed|you received|you paid|is off by)\b|[-−]\s?••••/;

test("hidden money shows no sign or outcome in words", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const visibleText = () => page.locator("main").innerText();

  await gotoPageAfterApi(page, "/month?view=household&month=2025-06&scope=direct_plus_shared", "/api/month-page", () => monthPill(page, "remaining"));
  await expect(monthPill(page, "remaining").locator("strong")).toHaveText("••••");
  expect(await visibleText()).not.toMatch(SIGN_WORDING);

  await openSummary(page, "household", "2026-04");
  await expect(page.locator(".summary-wallet-row").first()).toBeVisible();
  expect(await visibleText()).not.toMatch(SIGN_WORDING);
  // A wallet's statement health is an outcome too: hidden with the money.
  expect(await page.locator(".summary-wallet-health").allInnerTexts()).toEqual([]);

  await gotoPageAfterApi(page, "/splits?view=person-tim&month=2025-10&split_group=split-group-baby-river", "/api/splits-page", () => page.getByRole("heading", { name: "Splits", exact: true }));
  await expect(page.locator(".split-activity-card").first()).toBeVisible();
  const balance = page.locator(".splits-lead .lsd-amount-caption");
  await expect(balance).toContainText("Balance with");
  await expect(page.locator(".splits-lead .lsd-amount")).toHaveText("••••");
  // Hidden money turns the figure to plain ink: no tone says which side of zero it is.
  expect((await looks(page.locator(".splits-lead .lsd-amount"))).color).toBe(INK.text);
  expect(await visibleText()).not.toMatch(SIGN_WORDING);

  // Revealing brings the wording back.
  await page.getByRole("button", { name: "Show money totals" }).click();
  await expect(balance).toContainText("You owe");
  await expect(page.locator(".split-activity-trailing strong").first()).toBeVisible();
});
