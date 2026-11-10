import { expect, test } from "@playwright/test";

import { postJson, reseedDemo } from "./helpers";

// Summary's "What changed this month" card (design.md "What changed card"): it
// loads after the top summary, lists what rose and fell against the same
// point of last month, opens the shops behind a change on a tap, and every
// amount opens Entries with exactly its entries. The route reads the
// household's real today, so entries sit on the 1st of this and earlier months.

function monthsAgo(count) {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Singapore" }));
  const at = new Date(now.getFullYear(), now.getMonth() - count, 1);
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}`;
}

async function addEntry(page, month, description, categoryName, amountMinor) {
  await postJson(page, "/api/entries/create", {
    date: `${month}-01`, description, accountName: "Citi Rewards", categoryName,
    entryType: "expense", ownershipType: "direct", ownerName: "Joyce", amountMinor
  });
}

async function addMonths(page) {
  for (let back = 3; back >= 1; back -= 1) {
    await addEntry(page, monthsAgo(back), "KOUFU FOOD COURT", "Food & Drinks", 2_000);
  }
  await addEntry(page, monthsAgo(1), "COURTS MEGASTORE", "Home", 30_000);
  await addEntry(page, monthsAgo(0), "KOUFU FOOD COURT", "Food & Drinks", 9_000);
  await addEntry(page, monthsAgo(0), "BURNT ENDS", "Food & Drinks", 80_000);
}

async function openSummary(page, { money = true } = {}) {
  await page.addInitScript((shown) => window.localStorage.setItem("monies-map:money-totals-visible", shown), String(money));
  await page.goto("/?view=household");
  const card = page.locator(".chg-card");
  await expect(card).toBeVisible({ timeout: 30_000 });
  return card;
}

test.describe("What changed this month", () => {
  test.beforeEach(async ({ page }) => {
    await reseedDemo(page);
    await addMonths(page);
  });

  test("desktop: rows say up or down with the amount, a tap opens the shops, and a figure opens exactly its entries", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const card = await openSummary(page);
    await expect(card.getByRole("heading", { name: "What changed this month" })).toBeVisible();
    await expect(card.locator(".chg-intro")).toContainText("so far, against the same days of");
    const food = card.locator('[data-category="Food & Drinks"]');
    await expect(food.locator(".chg-diff")).toContainText(/^up \$/);
    await expect(food.locator(".chg-chip")).toHaveText("more than usual");
    await expect(food.locator(".chg-meta")).toContainText("$890.00 so far");
    await expect(food.locator(".chg-meta")).toContainText("at this point last month");
    const home = card.locator('[data-category="Home"]');
    await expect(home.locator(".chg-diff")).toContainText(/^down \$300\.00/);

    // The shops behind the change.
    await food.getByRole("button", { name: "Food & Drinks: shops behind the change" }).click();
    await expect(food.locator(".chg-shops")).toContainText("Shops behind it");
    await expect(food.locator(".chg-shops")).toContainText("Burnt Ends");
    await expect(food.locator(".chg-shops")).toContainText("up $800.00");

    // A figure opens Entries with exactly its entries, and their total is the figure.
    await food.locator(".chg-meta [data-fig]").first().click();
    await page.getByRole("button", { name: "View entries", exact: true }).click();
    await expect(page).toHaveURL(/\/entries\?.*entry_figure=spent/);
    await expect(page.locator(".entries-totals, .entries-lead, main").first()).toContainText("$890.00");
  });

  test("phone: one block, the first 3 rows, then Show all", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    // Two more categories that rose, so there are more than 3 rows.
    for (const [description, category] of [["SP SERVICES", "Bills"], ["NETFLIX.COM", "Subscriptions MO"]]) {
      await addEntry(page, monthsAgo(0), description, category, 40_000);
    }
    const card = await openSummary(page);
    await expect(card.locator(".chg-row")).toHaveCount(3);
    await card.getByRole("button", { name: /^Show all \d+ ›$/ }).click();
    expect(await card.locator(".chg-row").count()).toBeGreaterThan(3);
  });

  test("with money hidden the card shows no amounts, no up or down and no more than usual mark", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const card = await openSummary(page, { money: false });
    await expect(card.locator('[data-category="Food & Drinks"]')).toBeVisible();
    await expect(card).not.toContainText("$");
    await expect(card).not.toContainText("••••");
    await expect(card).not.toContainText(/\b(up|down)\b/);
    await expect(card).not.toContainText("more than usual");
    await card.getByRole("button", { name: "Food & Drinks: shops behind the change" }).click();
    await expect(card.locator(".chg-shops")).toContainText("Burnt Ends");
    await expect(card.locator(".chg-shops")).not.toContainText("$");
  });
});
