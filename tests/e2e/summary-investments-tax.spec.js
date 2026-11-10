import { expect, test } from "@playwright/test";

import { reseedDemo } from "./helpers";

// Summary's "Investments" and "Tax reliefs" cards on the demo household
// (design.md "Investments over time and Tax reliefs"): both load after the top
// summary, show the statements' worth and the year's top-ups against the
// limits, every figure opens exactly its entries, and hidden money hides the
// amounts.

async function openSummary(page, { money = true } = {}) {
  await page.addInitScript((shown) => window.localStorage.setItem("monies-map:money-totals-visible", shown), String(money));
  await page.goto("/?view=household");
  const tax = page.locator(".tax-card");
  await expect(tax).toBeVisible({ timeout: 30_000 });
  return { tax, invest: page.locator(".invest-card") };
}

test.describe("Investments and Tax reliefs", () => {
  test.beforeEach(async ({ page }) => {
    await reseedDemo(page);
  });

  test("desktop: statements' worth, what was put in, the limits and the room left", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const { tax, invest } = await openSummary(page);
    await expect(invest.getByRole("heading", { name: "Investments" })).toBeVisible();
    await expect(invest).toContainText("Worth on the latest statements");
    await expect(invest).toContainText("You put in since Jan");
    await expect(invest).toContainText("Grew by");
    await expect(invest).toContainText("Paid out");
    await expect(invest.locator(".invest-chart")).toBeVisible();
    expect(await invest.locator(".invest-row[data-account]").count()).toBeGreaterThan(0);

    await expect(tax.getByRole("heading", { name: /^Tax reliefs for \d{4}$/ })).toBeVisible();
    await expect(tax.locator(".tax-deadline")).toContainText(/(\d+ days? left|Last day), until 31 Dec/);
    await expect(tax).toContainText("$15,300");
    await expect(tax).toContainText("counted 2½ times");
    await expect(tax.locator(".tax-footnote")).toContainText("doesn't know your income");
    // Never the tax saved.
    await expect(tax).not.toContainText(/tax saved|you save|should/i);
    await expect(tax.locator(".tax-person").first()).toHaveAttribute("style", /--person/);
  });

  test("a tax figure opens exactly its entries; a put in figure opens its transfers", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const { tax, invest } = await openSummary(page);
    const srs = tax.locator('[data-relief="srs"] [data-fig="outflow"]').first();
    const amount = (await srs.textContent()).trim();
    await srs.click();
    await page.getByRole("button", { name: "View entries", exact: true }).click();
    await expect(page).toHaveURL(/\/entries\?.*entry_figure=outflow/);
    await expect(page.locator("main").first()).toContainText(amount);

    await page.goBack();
    await expect(invest).toBeVisible({ timeout: 30_000 });
    await invest.locator(".invest-tile-figure[data-fig]").first().click();
    await page.getByRole("button", { name: "View entries", exact: true }).click();
    await expect(page).toHaveURL(/\/entries\?.*entry_figure=(invested|took_out)/);
  });

  test("phone: compact, with the accounts one tap away", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { invest } = await openSummary(page);
    await expect(invest.locator(".invest-phone-line")).toContainText("You put in");
    await expect(invest.locator(".invest-tile")).toHaveCount(0);
    await expect(invest.locator(".invest-row[data-account]")).toHaveCount(0);
    await invest.getByRole("button", { name: "Tap for each account" }).click();
    expect(await invest.locator(".invest-row[data-account]").count()).toBeGreaterThan(0);
  });

  test("with money hidden no amount, bar or room left shows", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const { tax, invest } = await openSummary(page, { money: false });
    await expect(invest.locator(".invest-worth")).toHaveText("••••");
    await expect(invest.locator(".invest-chart")).toHaveCount(0);
    await expect(tax.locator(".tax-bar")).toHaveCount(0);
    await expect(tax.locator(".tax-room")).toHaveCount(0);
    await expect(tax).not.toContainText("$");
  });
});
