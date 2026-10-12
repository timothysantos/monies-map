import { devices, expect, test } from "@playwright/test";

import { gotoPageAfterApi, loadSummaryAccountPills, loadSummaryPage, reseedDemo } from "./helpers";

// The Summary body under the lead in the Lead · Support · Detail language
// (design.md, "Summary body"): Spending Mix is a donut with no labels on it
// and a ranked category list beside or under it (bubble, name, amount, share
// and a thin bar; the top 5, then "Show all N"); Wallets in view is one
// group of compact rows (wallet, balance, how fresh its statement is);
// everything tappable is at least 44px each way; nothing scrolls sideways.
// Hidden money shows no amounts and no wallet health, but keeps the shares.

const VIEW = "person-tim";
const RANGE = { summaryStart: "2025-06", summaryEnd: "2025-10" };
const SUMMARY_URL = `/summary?view=${VIEW}&month=2025-10&summary_start=${RANGE.summaryStart}&summary_end=${RANGE.summaryEnd}`;
const { defaultBrowserType: _browser, ...iPhone13 } = devices["iPhone 13"];
const TOP = 5;

const moneyFormatter = new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" });
const money = (minor) => moneyFormatter.format(minor / 100);
const sumMinor = (data) => data.reduce((sum, item) => sum + item.valueMinor, 0);
const percentOf = (item, data) => `${((item.valueMinor / sumMinor(data)) * 100).toFixed(1)}%`;

const mixCard = (page) => page.locator(".chart-card").filter({ has: page.getByRole("heading", { name: "Spending Mix" }) });
const walletsCard = (page) => page.locator(".summary-accounts");

function box(locator) {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
  });
}

async function setMoney(page, visible) {
  await page.addInitScript((value) => window.localStorage.setItem("monies-map:money-totals-visible", value), String(visible));
}

async function openSummary(page) {
  await gotoPageAfterApi(page, SUMMARY_URL, "/api/summary-page", () => mixCard(page).locator(".recharts-pie"));
  await expect.poll(() => page.evaluate(() => window.__MONIES_MAP_ROUTE_WORK__?.usable ?? false), { timeout: 45_000 }).toBe(true);
  await expect(walletsCard(page)).toBeVisible();
}

// The view and scope the open page is showing (its URL says).
function pageParams(page) {
  const params = new URL(page.url()).searchParams;
  return { view: params.get("view") ?? VIEW, scope: params.get("scope") ?? undefined };
}

// The range's share for what the open page is showing.
async function rangeShare(page) {
  const { summaryPage } = await loadSummaryPage(page, { view: pageParams(page).view, month: RANGE.summaryEnd, ...RANGE, scope: pageParams(page).scope });
  expect(summaryPage.categoryShareChart.length, "the fixture range has more than five categories").toBeGreaterThan(TOP);
  return summaryPage.categoryShareChart;
}

// Every piece of text and every badge in the card, as a box: no two of them
// may overlap (the old donut's percent labels sat on its category bubbles).
async function expectNoOverlappingLabels(page) {
  const boxes = await mixCard(page).evaluate((card) => {
    const shown = (rect) => rect.width > 0 && rect.height > 0;
    const items = [];
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      if (shown(rect)) items.push({ name: node.textContent.trim().slice(0, 30), x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom });
    }
    for (const badge of card.querySelectorAll(".category-icon, .donut-callout-badge")) {
      const rect = badge.getBoundingClientRect();
      if (shown(rect)) items.push({ name: `badge ${badge.getAttribute("aria-label") ?? ""}`, x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom });
    }
    return items;
  });
  expect(boxes.length).toBeGreaterThan(10);
  const overlaps = [];
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      const across = Math.min(a.right, b.right) - Math.max(a.x, b.x);
      const down = Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y);
      if (across > 1 && down > 1) overlaps.push(`${a.name} / ${b.name}`);
    }
  }
  expect(overlaps, "overlapping labels").toEqual([]);
  await expect(mixCard(page).locator(".recharts-pie-labels, .donut-callout-badge")).toHaveCount(0);
}

// Everything tappable inside `selector` is at least 44px tall and wide.
async function expectTargets44(page, selector) {
  const small = await page.locator(selector).evaluate((root) => [...root.querySelectorAll("button, a, input, select, textarea, [role='button']")]
    .map((element) => ({ rect: element.getBoundingClientRect(), name: element.getAttribute("aria-label") || element.textContent.trim().slice(0, 30) }))
    .filter(({ rect }) => rect.width > 0 && rect.height > 0 && (rect.width < 43.5 || rect.height < 43.5))
    .map(({ rect, name }) => `${name} ${Math.round(rect.width)}x${Math.round(rect.height)}`));
  expect(small, `${selector} targets under 44px`).toEqual([]);
}

async function expectNoSidewaysScroll(page, selector) {
  const result = await page.evaluate((root) => {
    const scope = document.querySelector(root);
    const scrollers = [...scope.querySelectorAll("*")].filter((element) => {
      const style = getComputedStyle(element);
      return /(auto|scroll)/.test(style.overflowX) && element.scrollWidth > element.clientWidth + 1;
    }).map((element) => element.className);
    return { viewport: window.innerWidth, document: document.documentElement.scrollWidth, scope: scope.scrollWidth - scope.clientWidth, scrollers };
  }, selector);
  expect(result.document, "page width").toBeLessThanOrEqual(result.viewport + 1);
  expect(result.scope, `${selector} overflow`).toBeLessThanOrEqual(1);
  expect(result.scrollers, `${selector} sideways scrollers`).toEqual([]);
}

async function expectRankedList(page, share) {
  const rows = mixCard(page).locator(".summary-mix-row");
  await expect(rows).toHaveCount(TOP);
  for (const [index, item] of share.slice(0, TOP).entries()) {
    const row = rows.nth(index);
    await expect(row.locator(".summary-mix-name")).toHaveText(item.label);
    await expect(row.locator(".summary-mix-amount")).toHaveText(money(item.valueMinor));
    await expect(row.locator(".summary-mix-percent")).toHaveText(percentOf(item, share));
    const width = await row.locator(".summary-mix-bar-fill").evaluate((fill) => fill.getBoundingClientRect().width / fill.parentElement.getBoundingClientRect().width);
    expect(width).toBeCloseTo(item.valueMinor / sumMinor(share), 1);
  }
  // Ranked: biggest first.
  expect(share.slice(0, TOP).map((item) => item.valueMinor)).toEqual(share.slice(0, TOP).map((item) => item.valueMinor).sort((a, b) => b - a));
}

async function expectShowAll(page, share) {
  const rows = mixCard(page).locator(".summary-mix-row");
  const toggle = mixCard(page).getByRole("button", { name: `Show all ${share.length}` });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(rows).toHaveCount(share.length);
  await expect(rows.last().locator(".summary-mix-name")).toHaveText(share.at(-1).label);
  const fewer = mixCard(page).getByRole("button", { name: "Show fewer" });
  await expect(fewer).toHaveAttribute("aria-expanded", "true");
  await fewer.click();
  await expect(rows).toHaveCount(TOP);
  await expect(mixCard(page).getByRole("button", { name: `Show all ${share.length}` })).toBeVisible();
}

for (const device of [
  { name: "phone", use: { ...iPhone13 }, tag: "@webkit" },
  { name: "desktop", use: { viewport: { width: 1280, height: 860 } }, tag: undefined }
]) {
  test.describe(`Summary body on a ${device.name}`, device.tag ? { tag: device.tag } : {}, () => {
    test.use(device.use);

    test.beforeEach(async ({ page }) => {
      await page.goto("/");
      await reseedDemo(page);
    });

    test("Spending Mix: a donut with no labels on it, no overlapping text, the ranked top 5 and Show all", async ({ page }) => {
      await setMoney(page, true);
      await openSummary(page);
      const share = await rangeShare(page);
      await expect(mixCard(page).locator(".donut-center strong")).toHaveText(money(sumMinor(share)));
      await expectNoOverlappingLabels(page);
      await expectRankedList(page, share);
      await expectShowAll(page, share);
      await expectNoSidewaysScroll(page, ".chart-card:has(.spending-mix-chart)");
      await expectTargets44(page, ".chart-card:has(.spending-mix-chart)");
      await expectNoOverlappingLabels(page);
    });

    test("Spending Mix: the list sits under the donut on a phone and beside it on a desktop", async ({ page }) => {
      await setMoney(page, true);
      await openSummary(page);
      const chart = await box(mixCard(page).locator(".spending-mix-chart"));
      const list = await box(mixCard(page).locator(".summary-mix-list"));
      if (device.name === "phone") {
        expect(list.y, "list under the donut").toBeGreaterThanOrEqual(chart.bottom - 1);
        expect(list.width).toBeGreaterThan(390 - 40);
      } else {
        expect(list.x, "list beside the donut").toBeGreaterThanOrEqual(chart.right - 1);
        expect(list.y).toBeLessThan(chart.bottom);
      }
    });

    test("Spending Mix: a row keeps today's three taps, hide from the chart, edit the category, open its entries", async ({ page }) => {
      await setMoney(page, true);
      await openSummary(page);
      const share = await rangeShare(page);
      const first = mixCard(page).locator(".summary-mix-row").first();
      const total = mixCard(page).locator(".donut-center strong");

      // The main tap hides the category from the donut and shows it again.
      const toggle = first.locator(".summary-mix-main");
      await expect(toggle).toHaveAttribute("aria-pressed", "true");
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-pressed", "false");
      await expect(total).toHaveText(money(sumMinor(share) - share[0].valueMinor));
      await expect(first).toContainText("Hidden");
      await mixCard(page).getByRole("button", { name: /Show 1 hidden category/ }).click();
      await expect(toggle).toHaveAttribute("aria-pressed", "true");
      await expect(total).toHaveText(money(sumMinor(share)));

      // The bubble edits the category.
      await first.getByRole("button", { name: `Edit ${share[0].label}` }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);

      // The arrow opens Entries for the category.
      await first.getByRole("button", { name: `View entries for ${share[0].label}` }).click();
      await expect(page).toHaveURL(/\/entries\?/);
      expect(new URL(page.url()).searchParams.getAll("entry_category")).toEqual([share[0].label]);
    });

    test("Wallets in view: one group of compact rows, the DTO's wallet, balance and freshness, no sideways scroll", async ({ page }) => {
      await setMoney(page, true);
      await openSummary(page);
      const { accountPills } = await loadSummaryAccountPills(page, { view: pageParams(page).view });
      expect(accountPills.length).toBeGreaterThan(1);
      const card = walletsCard(page);
      await expect(card.getByRole("heading", { name: "Wallets in view" })).toBeVisible();
      await expect(card.locator(".lsd-rows")).toHaveCount(1);
      const rows = card.locator(".summary-wallet-row");
      await expect(rows).toHaveCount(accountPills.length);
      for (const [index, account] of accountPills.entries()) {
        const row = rows.nth(index);
        await expect(row.locator(".summary-wallet-name")).toContainText(account.accountName);
        await expect(row).toContainText(money(account.balanceMinor));
        await expect(row.locator(".summary-wallet-health")).toHaveText(/statement|checkpoint/i);
        const rect = await box(row);
        expect(rect.height, "row height").toBeGreaterThanOrEqual(56);
        expect(rect.height, "compact row").toBeLessThanOrEqual(96);
      }
      await expectNoSidewaysScroll(page, ".summary-accounts");
      await expectTargets44(page, ".summary-accounts");

      // A row opens Entries for that wallet.
      await rows.first().click();
      await expect(page).toHaveURL(/\/entries\?/);
      expect(new URL(page.url()).searchParams.get("entry_wallet")).toBe(accountPills[0].accountId);
    });

    test("Intent vs Outcome note rows are at least 44px, with the month link and Details", async ({ page }) => {
      await setMoney(page, true);
      await openSummary(page);
      const card = page.locator(".summary-intent-month").first();
      await expect(card.locator(".summary-note-trigger")).toBeVisible();
      await expectTargets44(page, ".summary-intent");
      expect((await box(card.locator(".summary-note-trigger"))).height).toBeGreaterThanOrEqual(44);
    });

    test("hidden money: no amounts in Spending Mix or Wallets, shares kept, no wallet health", async ({ page }) => {
      await setMoney(page, false);
      await openSummary(page);
      const share = await rangeShare(page);
      const mix = mixCard(page);
      const mixText = await mix.innerText();
      expect(mixText).not.toMatch(/\$\s?\d/);
      expect(mixText).toContain("••••");
      await expect(mix.locator(".donut-center strong")).not.toContainText("$");
      await expect(mix.locator(".summary-mix-percent").first()).toHaveText(percentOf(share[0], share));
      await expect(mix.locator(".summary-mix-amount").first()).not.toContainText("$");
      await expectNoOverlappingLabels(page);

      const wallets = walletsCard(page);
      const walletText = await wallets.innerText();
      expect(walletText).not.toMatch(/\$\s?\d/);
      expect(walletText).toContain("••••");
      await expect(wallets.locator(".summary-wallet-health")).toHaveCount(0);
      // No sign through colour either: every wallet balance is plain ink.
      const colours = await wallets.locator(".summary-wallet-row .lsd-row-value").evaluateAll((values) => values.map((value) => getComputedStyle(value).color));
      expect(new Set(colours).size).toBe(1);
    });
  });
}
