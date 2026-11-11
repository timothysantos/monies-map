import { mkdir } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { postJson, reseedDemo } from "./helpers";

// Summary's "Miles and cashback" card and Settings > Cards and rewards
// (design.md "Miles and cashback"): what each credit card earned this
// month, its bonus-cap bar, the best card now, a notice when a bonus is used
// up, every amount opens exactly its entries, hidden money hides the miles
// and bars, the card can be moved or hidden with Arrange cards, and the rules
// are edited, reset and put back in Settings. The answers are the real
// Worker's: the entries are placed today so they fall in this cycle.

// Set MILES_SHOT_DIR to also save screenshots of the card and Settings.
const SHOT_DIR = process.env.MILES_SHOT_DIR;

async function shoot(locator, name) {
  if (SHOT_DIR) {
    await mkdir(SHOT_DIR, { recursive: true });
    await locator.screenshot({ path: path.join(SHOT_DIR, name) });
  }
}

const TODAY = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });

async function addSpending(page) {
  const entry = (description, accountName, categoryName, amountMinor, ownerName) => postJson(page, "/api/entries/create", {
    date: TODAY, description, accountName, categoryName, entryType: "expense", ownershipType: "direct", ownerName, amountMinor
  });
  // A big online buy uses up Citi Rewards' bonus; dinner uses some of Lady's.
  await entry("AMAZE*LAZADA SINGAPORE", "Citi Rewards", "Shopping", 120_000, "Joyce");
  await entry("SONG FA BAK KUT TEH", "UOB Lady's", "Food & Drinks", 38_000, "Joyce");
  await entry("COLD STORAGE TAMPINES", "UOB One", "Groceries", 9_000, "Tim");
}

async function openSummary(page, { money = true } = {}) {
  await page.addInitScript((shown) => window.localStorage.setItem("monies-map:money-totals-visible", shown), String(money));
  await page.goto("/?view=household");
  // Miles and cashback is a tile on Summary and opens whole in a dialog or sheet.
  await page.locator('[data-tile="miles"]').click({ timeout: 30_000 });
  const card = page.getByRole("dialog").locator("[data-card-rewards]");
  await expect(card).toBeVisible({ timeout: 30_000 });
  return card;
}

test.describe("Miles and cashback on Summary", () => {
  test.beforeEach(async ({ page }) => {
    await reseedDemo(page);
    await addSpending(page);
  });

  test("desktop: miles per card, a used-up bonus, the best card and the estimate note", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const card = await openSummary(page);
    await expect(card.getByRole("heading", { name: "Miles and cashback" })).toBeVisible();
    await expect(card).toContainText("Your card statement's points are the final word.");
    await expect(card).toContainText("Miles so far");
    await expect(card).toContainText("Cashback so far");
    // Miles and cashback are kept apart: dollars never turn into miles.
    await expect(card.locator('[data-card]')).toHaveCount(3);
    await expect(card.locator(".cr-bonus.is-used-up")).toHaveCount(1);
    await expect(card).toContainText(/The bonus on Citi Rewards is used up until/);
    await expect(card.getByText("Best card now")).toBeVisible();
    await expect(card.locator(".cr-owner").first()).toHaveAttribute("style", /--person/);
    await shoot(card, "miles-desktop.png");
  });

  test("an amount opens exactly its entries in the household view", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const card = await openSummary(page);
    const figure = card.locator('[data-card] .cr-bonus [data-fig="spent"]').first();
    const amount = (await figure.textContent()).trim();
    await figure.click();
    await page.getByRole("button", { name: "View entries", exact: true }).click();
    await expect(page).toHaveURL(/\/entries\?.*view=household/);
    await expect(page).toHaveURL(/entry_figure=spent/);
    await expect(page.locator("main").first()).toContainText(amount);
  });

  test("phone: compact, no sideways scroll, every card one tap away", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const card = await openSummary(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    expect(await card.locator("[data-card]").count()).toBeLessThanOrEqual(3);
    await shoot(card, "miles-phone.png");
  });

  test("with money hidden no miles, bar or amount shows", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const card = await openSummary(page, { money: false });
    await expect(card.locator(".cr-bar")).toHaveCount(0);
    await expect(card).not.toContainText(/\d[\d,]* miles(?! a dollar)/);
    await expect(card).not.toContainText("$");
    await shoot(card, "miles-hidden-money.png");
  });

  test("Arrange cards can hide it and it reads nothing while hidden", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.goto("/?view=household");
    await expect(page.locator('[data-tile="miles"]')).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: /Arrange cards/ }).click();
    const row = page.getByRole("dialog").getByText("Miles and cashback");
    await expect(row).toBeVisible();
    await row.click();
    await page.getByRole("button", { name: "Done" }).click();
    // Its tile goes with it, and nothing reads its data while it is hidden.
    await expect(page.locator('[data-tile="miles"]')).toHaveCount(0);
    await expect(page.locator("[data-card-rewards]")).toHaveCount(0);
  });
});

test.describe("Settings > Cards and rewards", () => {
  test.beforeEach(async ({ page }) => {
    await reseedDemo(page);
    // Money starts hidden in a new browser; the caps are shown as dollars.
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  });

  test("the usual rules are in; a change saves, can be undone and reset; the setting defaults to the household", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/settings?view=household");
    await page.getByRole("button", { name: /Cards and rewards/ }).click();
    const section = page.locator("#settings-card-rewards");
    await expect(section).toContainText("Suggest cards from");
    await expect(section).toContainText("The whole household");
    const ladys = section.locator("[data-card-rewards]").filter({ hasText: "UOB Lady's" });
    await expect(ladys).toContainText("Miles · 0.4 a dollar, 4 on Food & Drinks up to $1,000.00 a month");
    await expect(ladys).toContainText("Usual rules");
    await shoot(section, "miles-settings-desktop.png");

    await ladys.getByRole("button", { name: "UOB Lady's: rewards" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator('[data-row="cap-0"] input').fill("1500");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(section).toContainText("UOB Lady's: rewards saved.");
    await expect(ladys).toContainText("up to $1,500.00 a month");
    await expect(ladys).toContainText("Changed");

    await section.getByRole("button", { name: "Undo" }).click();
    await expect(ladys).toContainText("up to $1,000.00 a month");
    await expect(ladys).toContainText("Usual rules");

    // A change, then Reset to the usual rules.
    await ladys.getByRole("button", { name: "UOB Lady's: rewards" }).click();
    await page.getByRole("dialog").locator('[data-row="base"] input').fill("1");
    await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
    await expect(ladys).toContainText("Changed");
    await ladys.getByRole("button", { name: "UOB Lady's: rewards" }).click();
    await page.getByRole("button", { name: "Reset to the usual rules" }).click();
    await expect(section).toContainText("UOB Lady's: back to the usual rules.");
    await expect(ladys).toContainText("Usual rules");
  });

  test("a number that does not read is refused plainly and nothing changes", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/settings?view=household");
    await page.getByRole("button", { name: /Cards and rewards/ }).click();
    const section = page.locator("#settings-card-rewards");
    const ladys = section.locator("[data-card-rewards]").filter({ hasText: "UOB Lady's" });
    await ladys.getByRole("button", { name: "UOB Lady's: rewards" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator('[data-row="base"] input').fill("lots");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toContainText("Check the numbers: use digits only, like 4 or 1000.");
    await page.keyboard.press("Escape");
    await expect(ladys).toContainText("Usual rules");
  });

  test("Suggest cards from saves, shows each person apart on Summary, and Undo puts it back", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/settings?view=household");
    await page.getByRole("button", { name: /Cards and rewards/ }).click();
    const section = page.locator("#settings-card-rewards");
    await expect(section.locator('select[aria-label="Suggest cards from"]')).toHaveValue("household");
    await section.locator('select[aria-label="Suggest cards from"]').selectOption("own");
    await expect(section).toContainText("Cards are now suggested from: Each person's own cards.");
    await section.getByRole("button", { name: "Undo" }).click();
    await expect(section.locator('select[aria-label="Suggest cards from"]')).toHaveValue("household");
  });

  test("phone: the section and a card's sheet fit the screen", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/settings?view=household");
    await page.getByRole("button", { name: /Cards and rewards/ }).click();
    const section = page.locator("#settings-card-rewards");
    await expect(section).toBeVisible();
    await shoot(section, "miles-settings-phone.png");
    await section.locator("[data-card-rewards]").first().getByRole("button").click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await shoot(page.getByRole("dialog"), "miles-settings-sheet-phone.png");
  });
});
