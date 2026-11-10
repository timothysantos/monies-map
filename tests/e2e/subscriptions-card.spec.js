import { expect, test } from "@playwright/test";

import { postJson, reseedDemo } from "./helpers";

// Summary's "Subscriptions and bills" card (design.md "Subscriptions and
// bills"): it loads after the top summary, lists the charges that come back
// each month, says "Went up" with the old and new price, and every amount
// opens Entries with exactly its charges, whose Spent total is the amount.
// The route reads the household's real today, so the charges are placed
// relative to it.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthsAgo(count) {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Singapore" }));
  const at = new Date(now.getFullYear(), now.getMonth() - count, 1);
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}`;
}

async function addCharges(page) {
  for (let back = 4; back >= 1; back -= 1) {
    await postJson(page, "/api/entries/create", {
      date: `${monthsAgo(back)}-14`, description: "NETFLIX.COM 866-579-7172", accountName: "Citi Rewards", categoryName: "Subscriptions MO",
      entryType: "expense", ownershipType: "direct", ownerName: "Joyce", amountMinor: 1998
    });
    await postJson(page, "/api/entries/create", {
      date: `${monthsAgo(back)}-22`, description: "SINGTEL MOBILE 81234567", accountName: "UOB One", categoryName: "Bills",
      entryType: "expense", ownershipType: "direct", ownerName: "Tim", amountMinor: back === 1 ? 4290 : 3890
    });
  }
}

async function openSummary(page, { money = true } = {}) {
  await page.addInitScript((shown) => window.localStorage.setItem("monies-map:money-totals-visible", shown), String(money));
  await page.goto("/?view=household");
  const card = page.locator(".subs-card");
  await expect(card).toBeVisible({ timeout: 30_000 });
  return card;
}

test.describe("Subscriptions and bills", () => {
  test.beforeEach(async ({ page }) => {
    await reseedDemo(page);
    await addCharges(page);
  });

  test("desktop: the card lists the charges, says what went up, and a figure opens exactly its entries", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const card = await openSummary(page);
    await expect(card.getByRole("heading", { name: "Subscriptions and bills" })).toBeVisible();
    const netflix = card.locator('[data-series="NETFLIX COM|monthly"]');
    const singtel = card.locator('[data-series="SINGTEL MOBILE|monthly"]');
    await expect(netflix).toContainText("Netflix");
    await expect(netflix).toContainText("Subscriptions MO · monthly, around the 14th · Citi Rewards • Joyce");
    await expect(netflix.locator(".subs-year")).toContainText("$79.92");
    const newMonth = MONTHS[Number(monthsAgo(1).slice(5)) - 1];
    await expect(singtel).toContainText(`Went up: $38.90 → $42.90 in ${newMonth}`);

    await netflix.locator(".subs-year [data-fig]").click();
    await page.getByRole("button", { name: "View entries", exact: true }).click();
    await expect(page).toHaveURL(/\/entries\?.*entry_figure=spent/);
    await expect(page.locator(".entries-totals, .entries-lead, main").first()).toContainText("$79.92");
  });

  test("phone: the rows most worth a look come first, with the shorter words", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const card = await openSummary(page);
    const rows = card.locator(".subs-row");
    await expect(rows.first()).toContainText("Singtel");
    await expect(rows.first()).toContainText("Went up $4.00 in");
    await expect(card.locator(".subs-year")).toHaveCount(0);
  });

  test("with money hidden the card shows no amounts and no went-up figures", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const card = await openSummary(page, { money: false });
    const singtel = card.locator('[data-series="SINGTEL MOBILE|monthly"]');
    await expect(singtel).toContainText("Went up in");
    await expect(singtel).not.toContainText("$");
    await expect(card.locator(".subs-total-figure").first()).toHaveText("••••");
  });

  test("a row opens its details; taking it off the list, Undo and Rename change the card at once", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const card = await openSummary(page);
    const singtel = card.locator('[data-series="SINGTEL MOBILE|monthly"]');
    await singtel.getByRole("button", { name: "Singtel: details and choices" }).click();
    const dialog = page.getByRole("dialog", { name: "Singtel" });
    await expect(dialog).toContainText("Usually");
    await expect(dialog).toContainText("$42.90 a month");
    await expect(dialog).toContainText("Found 4 months in a row in your entries.");
    await dialog.getByRole("button", { name: "Not a subscription or bill" }).click();
    await expect(dialog).toBeHidden();
    await expect(card.locator(".subs-notice")).toContainText("Taken off the list");
    await expect(card.locator('.subs-list > [data-series="SINGTEL MOBILE|monthly"]')).toHaveCount(0);
    await expect(card).toContainText("1 taken off the list");

    await card.locator(".subs-notice").getByRole("button", { name: "Undo" }).click();
    await expect(card.locator(".subs-notice")).toContainText("Undone");
    await expect(singtel).toBeVisible();

    const netflix = card.locator('[data-series="NETFLIX COM|monthly"]');
    await netflix.getByRole("button", { name: "Netflix: details and choices" }).click();
    await page.getByRole("dialog", { name: "Netflix" }).getByRole("button", { name: "Rename" }).click();
    const rename = page.getByRole("dialog", { name: "Rename" });
    await rename.getByLabel("Name").fill("Netflix family plan");
    await rename.getByRole("button", { name: "Save" }).click();
    await expect(card.locator(".subs-notice")).toContainText("Renamed");
    await expect(netflix.locator(".subs-name")).toContainText("Netflix family plan");
    // Both people see it: it is the household's choice.
    await page.reload();
    await expect(page.locator('.subs-card [data-series="NETFLIX COM|monthly"] .subs-name')).toContainText("Netflix family plan", { timeout: 30_000 });
  });
});
