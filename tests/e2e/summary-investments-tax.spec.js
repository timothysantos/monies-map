import { mkdir } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { postJson, reseedDemo } from "./helpers";

// Summary's "Investments" and "Tax reliefs" cards (design.md "Investments
// over time and Tax reliefs"): both load after the top summary, show the
// year's top-ups against the limits and the statements' worth, every figure
// opens exactly its entries, and hidden money hides the amounts. The tax
// entries are real (placed in the current year); the Investments answer is
// stubbed with a fixed body, because a statement value only arrives by
// importing a statement (the answer itself is proved against the real Worker
// in tests/investments-over-time.test.mjs).

// Set INVEST_TAX_SHOT_DIR to also save screenshots of both cards.
const SHOT_DIR = process.env.INVEST_TAX_SHOT_DIR;

async function shoot(locator, name) {
  if (SHOT_DIR) {
    await mkdir(SHOT_DIR, { recursive: true });
    await locator.screenshot({ path: path.join(SHOT_DIR, name) });
  }
}

const YEAR = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Singapore" })).getFullYear();
const TODAY = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });

async function addTaxEntries(page) {
  const entry = (date, description, categoryName, amountMinor, ownerName) => postJson(page, "/api/entries/create", {
    date, description, accountName: ownerName === "Tim" ? "UOB One" : "Citi Rewards", categoryName,
    entryType: "expense", ownershipType: "direct", ownerName, amountMinor
  });
  await entry(`${YEAR}-01-12`, "SRS CONTRIBUTION OCBC", "SRS top-up", 600_000, "Tim");
  await entry(`${YEAR}-01-14`, "CPF BOARD CASH TOP-UP", "CPF top-up", 800_000, "Tim");
  await entry(`${YEAR}-01-16`, "GIVING.SG DONATION", "Charity gift", 50_000, "Joyce");
}

async function stubInvestments(page, ids) {
  const accounts = [
    { accountId: "a1", name: "Endowus Core", provider: "Endowus", personId: "person-tim", personName: "Tim", asOfDate: `${YEAR}-09-30`, worthMinor: 1_860_000, startWorthMinor: 1_300_000, putIn: { amountMinor: 400_000, ids }, grewMinor: 160_000, paidOutMinor: 2_000 },
    { accountId: "a2", name: "StashAway", provider: "StashAway", personId: "person-joyce", personName: "Joyce", asOfDate: `${YEAR}-09-30`, worthMinor: 640_000, startWorthMinor: 600_000, putIn: { amountMinor: 0, ids: [] }, grewMinor: 40_000, paidOutMinor: 0 }
  ];
  const months = ["03", "06", "09"].map((month, index) => ({ month: `${YEAR}-${month}`, worthMinor: 1_900_000 + index * 300_000, putInMinor: 1_900_000 + index * 100_000 }));
  await page.route("**/api/investments-over-time*", (route) => route.fulfill({
    json: { viewId: "household", today: TODAY, year: String(YEAR), asOfDate: `${YEAR}-09-30`, worthMinor: 2_500_000, startWorthMinor: 1_900_000, putIn: { amountMinor: 400_000, ids }, grewMinor: 200_000, paidOutMinor: 2_000, months, accounts }
  }));
}

async function openSummary(page, { money = true } = {}) {
  await page.addInitScript((shown) => window.localStorage.setItem("monies-map:money-totals-visible", shown), String(money));
  await page.goto("/?view=household");
  await expect(page.locator('[data-tile="taxreliefs"]')).toBeVisible({ timeout: 30_000 });
  // The cards are tiles on Summary and open whole in a dialog or sheet
  // (design.md "Summary tiles"); `show` opens one and closes the other.
  const show = async (id) => {
    if (await page.getByRole("dialog").count()) {
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
    await page.locator(`[data-tile="${id}"]`).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  };
  return { tax: page.locator(".tax-card"), invest: page.locator(".invest-card"), show };
}

test.describe("Investments and Tax reliefs", () => {
  test.beforeEach(async ({ page }) => {
    await reseedDemo(page);
    await addTaxEntries(page);
    const created = await postJson(page, "/api/entries/create", {
      date: `${YEAR}-02-03`, description: "ENDOWUS TOP UP", accountName: "UOB One", categoryName: "Investments",
      entryType: "expense", ownershipType: "direct", ownerName: "Tim", amountMinor: 400_000
    });
    await stubInvestments(page, [created.entryId ?? created.id]);
  });

  test("desktop: statements' worth, what was put in, the limits and the room left", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const { tax, invest, show } = await openSummary(page);
    await show("investments");
    await expect(invest.getByRole("heading", { name: "Investments" })).toBeVisible();
    await expect(invest).toContainText("Worth on the latest statements");
    await expect(invest).toContainText("You put in since Jan");
    await expect(invest).toContainText("Grew by");
    await expect(invest).toContainText("Paid out");
    await expect(invest.locator(".invest-chart")).toBeVisible();
    expect(await invest.locator(".invest-row[data-account]").count()).toBeGreaterThan(0);

    await shoot(invest, "investments-desktop.png");
    await show("taxreliefs");
    await expect(tax.getByRole("heading", { name: /^Tax reliefs for \d{4}$/ })).toBeVisible();
    await expect(tax.locator(".tax-deadline")).toContainText(/(\d+ days? left|Last day), until 31 Dec/);
    await expect(tax).toContainText("$15,300");
    await expect(tax).toContainText("counted 2½ times");
    await expect(tax.locator(".tax-footnote")).toContainText("doesn't know your income");
    // Never the tax saved.
    await expect(tax).not.toContainText(/tax saved|you save|should/i);
    await expect(tax.locator(".tax-person").first()).toHaveAttribute("style", /--person/);
    await shoot(tax, "tax-reliefs-desktop.png");
  });

  test("a tax figure opens exactly its entries; a put in figure opens its transfers", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const { tax, invest, show } = await openSummary(page);
    await show("taxreliefs");
    const srs = tax.locator('[data-relief="srs"] [data-fig="outflow"]').first();
    const amount = (await srs.textContent()).trim();
    await srs.click();
    await page.getByRole("button", { name: "View entries", exact: true }).click();
    await expect(page).toHaveURL(/\/entries\?.*entry_figure=outflow/);
    await expect(page.locator("main").first()).toContainText(amount);

    await page.goto("/?view=household");
    await page.locator('[data-tile="investments"]').click();
    await expect(invest).toBeVisible({ timeout: 30_000 });
    await invest.locator(".invest-tile-figure[data-fig]").first().click();
    await page.getByRole("button", { name: "View entries", exact: true }).click();
    await expect(page).toHaveURL(/\/entries\?.*entry_figure=(invested|took_out)/);
  });

  test("phone: compact, with the accounts one tap away", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { invest, tax, show } = await openSummary(page);
    await show("investments");
    await expect(invest.locator(".invest-phone-line")).toContainText("You put in");
    await expect(invest.locator(".invest-tile")).toHaveCount(0);
    await expect(invest.locator(".invest-row[data-account]")).toHaveCount(0);
    await invest.getByRole("button", { name: "Tap for each account" }).click();
    expect(await invest.locator(".invest-row[data-account]").count()).toBeGreaterThan(0);
    await shoot(invest, "investments-phone.png");
    await show("taxreliefs");
    await shoot(tax, "tax-reliefs-phone.png");
  });

  test("with money hidden no amount, bar or room left shows", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const { tax, invest, show } = await openSummary(page, { money: false });
    await show("investments");
    await expect(invest.locator(".invest-worth")).toHaveText("••••");
    await expect(invest.locator(".invest-chart")).toHaveCount(0);
    await show("taxreliefs");
    await expect(tax.locator(".tax-bar")).toHaveCount(0);
    await expect(tax.locator(".tax-room")).toHaveCount(0);
    await expect(tax).not.toContainText("$");
    await shoot(tax, "tax-reliefs-hidden-money.png");
  });
});
