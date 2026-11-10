import { mkdir } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { postJson, reseedDemo } from "./helpers";

// If this keeps up (DOMAIN.md "Pace"; design.md "If this keeps up"): after
// the top summary is usable, Summary shows where this month's spending ends
// under its month-by-month chart, and Month under its lead. Always a range
// in the plan tone, its menu says how it is worked out and offers Ask about
// this only (never View entries), and hidden money draws nothing. The read
// uses the household's real today, so the entries are placed relative to it:
// 3 complete months of everyday spending, Netflix on the 28th, and two
// entries this month. In the first 5 days of a month the pace is quiet, so
// the spec checks only that nothing shows.

// Set PACE_SHOT_DIR to also save screenshots.
const SHOT_DIR = process.env.PACE_SHOT_DIR;

async function shoot(locator, name) {
  if (SHOT_DIR) {
    await mkdir(SHOT_DIR, { recursive: true });
    await locator.screenshot({ path: path.join(SHOT_DIR, name) });
  }
}

const TODAY = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
const THIS_MONTH = TODAY.slice(0, 7);
const DAY = Number(TODAY.slice(8, 10));
const QUIET = DAY <= 5;
const RANGE = /^If this keeps up: about \$[\d,]+ to \$[\d,]+ by \d{1,2} [A-Z][a-z]{2}(?:, (?:under|over) the \$[\d,]+ plan)?\.$/;

function monthsAgo(count) {
  const [year, month] = THIS_MONTH.split("-").map(Number);
  const at = new Date(Date.UTC(year, month - 1 - count, 1));
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function addMonths(page) {
  const expense = (date, description, amountMinor) => postJson(page, "/api/entries/create", {
    date, description, accountName: "UOB One", categoryName: "Food & Drinks", entryType: "expense", ownershipType: "direct", ownerName: "Tim", amountMinor
  });
  const shops = ["KOPI CORNER", "TOAST HOUSE", "NOODLE BAR", "RICE STALL"];
  for (let back = 3; back >= 1; back -= 1) {
    for (const [index, day] of [3, 10, 17, 24].entries()) {
      await expense(`${monthsAgo(back)}-${String(day).padStart(2, "0")}`, `${shops[index]} ${String.fromCharCode(65 + back)}`, 25_000);
    }
  }
  // Netflix from June, so every month this year has entries (the year line).
  for (let back = 5; back >= 1; back -= 1) {
    await postJson(page, "/api/entries/create", {
      date: `${monthsAgo(back)}-28`, description: "NETFLIX.COM 866-579-7172", accountName: "UOB One", categoryName: "Subscriptions MO",
      entryType: "expense", ownershipType: "direct", ownerName: "Tim", amountMinor: 1_998
    });
  }
  // A salary on the 25th of the last 2 months: still due this month until the 25th.
  for (const back of [2, 1]) {
    await postJson(page, "/api/entries/create", {
      date: `${monthsAgo(back)}-25`, description: "ACME PTE LTD SALARY", accountName: "UOB One", categoryName: "Salary",
      entryType: "income", ownershipType: "direct", ownerName: "Tim", amountMinor: 600_000
    });
  }
  await expense(`${THIS_MONTH}-01`, "BAKERY ONE", 10_000);
  await expense(TODAY, "BAKERY TWO", 10_000);
}

async function revealMoney(page, shown = true) {
  await page.addInitScript((value) => window.localStorage.setItem("monies-map:money-totals-visible", value), String(shown));
}

test.describe("If this keeps up", () => {
  test.beforeEach(async ({ page }) => {
    await reseedDemo(page);
    await addMonths(page);
  });

  test("Summary: a range under the chart, its menu says how it is worked out and only asks", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await revealMoney(page);
    await page.goto(`/?view=household&summary_start=${monthsAgo(5)}&summary_end=${THIS_MONTH}`);
    const line = page.locator(".pace-line");
    if (QUIET) {
      await expect(page.locator(".subs-card")).toBeVisible({ timeout: 30_000 });
      await expect(line).toHaveCount(0);
      return;
    }
    await expect(line).toBeVisible({ timeout: 30_000 });
    const figure = line.locator('[data-fig="pace"]');
    await expect(figure).toHaveText(RANGE);
    if (DAY < 25) {
      await expect(line).toContainText(/About \$[\d,]+ to \$[\d,]+ left of what comes in\./);
    }
    await expect(line.locator(".pace-bar-high")).toHaveCount(1);
    // A range that starts after January: no year-end line.
    await expect(line.locator("[data-pace-year]")).toHaveCount(0);
    await shoot(line.locator("xpath=.."), "summary-desktop.png");

    await figure.click();
    const menu = page.locator(".figure-menu");
    await expect(menu).toBeVisible();
    await expect(menu).toContainText("If this keeps up");
    await expect(menu.locator(".figure-menu-note")).toContainText("How this is worked out");
    await expect(menu.locator(".figure-menu-note")).toContainText("Spent so far");
    await expect(menu.locator(".figure-menu-note")).toContainText("Only what's recorded; nothing is guessed about new spending.");
    await expect(menu.getByRole("button", { name: "View entries" })).toHaveCount(0);
    await expect(menu.getByRole("button", { name: "Open plan" })).toHaveCount(0);
    await expect(menu.getByRole("button", { name: "Ask about this" })).toBeVisible();
    await shoot(menu, "summary-menu.png");
  });

  // The year (owner decision D7): Summary only, from April, when the range
  // holds every month from January and money is still to come this month.
  test("Summary from January: the year-end line from April", async ({ page }) => {
    test.skip(QUIET || DAY >= 25, "quiet days, or the salary has already come");
    await page.setViewportSize({ width: 1280, height: 900 });
    await revealMoney(page);
    // One small entry in every month from January the demo leaves empty: a
    // month with nothing recorded keeps the year line quiet.
    for (let back = Number(THIS_MONTH.slice(5, 7)) - 1; back >= 1; back -= 1) {
      await postJson(page, "/api/entries/create", {
        date: `${monthsAgo(back)}-08`, description: `CORNER SHOP ${String.fromCharCode(64 + back)}`, accountName: "UOB One", categoryName: "Groceries",
        entryType: "expense", ownershipType: "direct", ownerName: "Tim", amountMinor: 1_000
      });
    }
    await page.goto(`/?view=household&summary_start=${THIS_MONTH.slice(0, 4)}-01&summary_end=${THIS_MONTH}`);
    const line = page.locator(".pace-line");
    await expect(line).toBeVisible({ timeout: 30_000 });
    const year = line.locator("[data-pace-year]");
    if (Number(THIS_MONTH.slice(5, 7)) < 4) {
      await expect(year).toHaveCount(0);
      return;
    }
    await expect(year).toHaveText(/^If this keeps up, about -?\$[\d,]+ to -?\$[\d,]+ kept in \d{4} by 31 Dec\.$/);
    await shoot(line, "summary-year.png");
  });

  test("Month on a phone: the line under the lead; hidden money draws nothing", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await revealMoney(page);
    await page.goto(`/month?view=household&month=${THIS_MONTH}`);
    const line = page.locator(".pace-line");
    if (QUIET) {
      await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });
      await expect(line).toHaveCount(0);
      return;
    }
    await expect(line).toBeVisible({ timeout: 30_000 });
    await expect(line.locator('[data-fig="pace"]')).toHaveText(RANGE);
    await line.scrollIntoViewIfNeeded();
    await shoot(page, "month-phone.png");

    // Hidden money: a fresh page that starts with totals hidden.
    const hidden = await page.context().newPage();
    await hidden.setViewportSize({ width: 390, height: 844 });
    await revealMoney(hidden, false);
    await hidden.goto(`/month?view=household&month=${THIS_MONTH}`);
    await expect(hidden.locator("main")).toBeVisible({ timeout: 30_000 });
    await hidden.waitForTimeout(2000);
    await expect(hidden.locator(".pace-line")).toHaveCount(0);
  });

  test("Coming up totals its next 30 days, if they come as usual", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await revealMoney(page);
    await page.goto("/?view=household");
    const card = page.locator(".subs-card");
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.getByRole("tab", { name: "Coming up" }).click();
    await expect(card.locator('[data-pace="coming-up"]')).toHaveText(/^About \$[\d,]+(?: to \$[\d,]+)? by \d{1,2} [A-Z][a-z]{2}, if they come as usual$/);
    await shoot(card, "coming-up.png");
  });
});
