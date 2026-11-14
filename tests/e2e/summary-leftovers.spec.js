import { expect, test } from "@playwright/test";

import { postJson, reseedDemo } from "./helpers";

// The Summary leftovers: the Splits tile (who owes whom right now, from the
// Summary page's own split balances), the change notes on the lead card,
// Subscriptions and bills, Miles and cashback and Bank fees (Spending mix's
// helper and words), and "What changed" on the Month page for the month in
// progress only. Entries are placed relative to the household's real today.

const TODAY = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
const THIS_MONTH = TODAY.slice(0, 7);

function monthsAgo(count) {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Singapore" }));
  const at = new Date(now.getFullYear(), now.getMonth() - count, 1);
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}`;
}

async function openSummary(page, { view = "household", money = true, hash = "" } = {}) {
  await page.addInitScript((shown) => window.localStorage.setItem("monies-map:money-totals-visible", shown), String(money));
  await page.goto(`/?view=${view}${hash}`);
  await expect(page.locator(".summary-cards-arrange button")).toBeVisible({ timeout: 30_000 });
}

test.describe("Splits tile", () => {
  test.beforeEach(async ({ page }) => {
    await reseedDemo(page);
  });

  test("1440: the tile says who owes whom, in the Splits page's words; its card's amount opens Splits at that group", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openSummary(page, { view: "person-tim" });
    const splitsPage = await (await page.request.get("/api/splits-page?view=person-tim&month=" + THIS_MONTH)).json();
    const groups = splitsPage.splitsPage.groups.filter((group) => group.id !== "split-group-none" && group.entryCount > 0 && group.balanceMinor !== 0);
    expect(groups.length).toBeGreaterThan(0);
    const group = groups[0];

    const tile = page.locator('[data-tile="splits"]');
    await expect(tile).toBeVisible({ timeout: 30_000 });
    await expect(tile).toContainText("Splits");
    await expect(tile).toContainText("Open ›");
    await expect(tile).toContainText("Who owes whom right now");
    // The chip and rows carry the page's own wording ("Joyce owes you", "You owe Joyce").
    await expect(tile.locator(".summary-tile-chip")).toContainText(/owes you|You owe/);
    await expect(tile.locator(".summary-tile-row", { hasText: group.name })).toBeVisible();
    // The tile cell is one of the registered cards.
    await expect(page.locator('[data-summary-card="splits"]')).toHaveCount(1);

    await tile.click();
    const dialog = page.getByRole("dialog", { name: "Splits" });
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/#summary-splits$/);
    const row = dialog.locator(".bankfees-row", { hasText: group.name });
    await expect(row).toContainText(/owes you|You owe/);
    await row.locator("[data-fig='splits']").click();
    await page.getByRole("button", { name: "Open Splits", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/splits\\?.*split_group=${group.id}`));
  });

  test("hidden money: the tile keeps the group names and drops every amount and who owes whom", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openSummary(page, { view: "person-tim", money: false });
    const tile = page.locator('[data-tile="splits"]');
    await expect(tile).toBeVisible({ timeout: 30_000 });
    await expect(tile.locator(".summary-tile-headline")).toHaveText("••••");
    await expect(tile.locator(".summary-tile-chip")).toHaveCount(0);
    await expect(tile.locator(".summary-tile-rows")).not.toContainText(/owes|\$|¥/);
    expect(await tile.locator(".summary-tile-row").count()).toBeGreaterThan(0);
  });

  test("Arrange cards hides it like the others; with no split group used there is no tile", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openSummary(page);
    await expect(page.locator('[data-tile="splits"]')).toBeVisible({ timeout: 30_000 });
    await page.locator(".summary-cards-arrange button").click();
    const editor = page.getByRole("dialog", { name: "Arrange cards" });
    await expect(editor.locator('[data-card="splits"] strong')).toHaveText("Splits");
    await editor.locator('[data-card="splits"] .summary-cards-name').click();
    await editor.getByRole("button", { name: "Done" }).click();
    await expect(page.locator('[data-tile="splits"]')).toHaveCount(0);
    await expect(page.locator('[data-summary-card="splits"]')).toHaveCount(0);
  });

  test("390: a tap opens the card in a sheet", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openSummary(page, { view: "person-tim" });
    await page.locator('[data-tile="splits"]').click({ timeout: 30_000 });
    await expect(page.getByRole("dialog", { name: "Splits" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Splits" })).toHaveCount(0);
  });
});

test.describe("Change notes", () => {
  test.beforeEach(async ({ page }) => {
    await reseedDemo(page);
  });

  test("Subscriptions and bills: this month's total against the month before, rose for a rise; nothing when it did not move", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const charge = (back, amountMinor, description, category) => postJson(page, "/api/entries/create", {
      date: `${monthsAgo(back)}-14`, description, accountName: "Citi Rewards", categoryName: category,
      entryType: "expense", ownershipType: "direct", ownerName: "Joyce", amountMinor
    });
    for (let back = 5; back >= 1; back -= 1) {
      await charge(back, 1998, "NETFLIX.COM 866-579-7172", "Subscriptions MO");
      // The same fixed amount, until the last month, when it goes up.
      await charge(back, back === 1 ? 15_000 : 12_000, "GREAT EASTERN INSURANCE", "Subscriptions MO");
    }
    await openSummary(page);
    const card = page.locator(".subs-card");
    await expect(card).toBeVisible({ timeout: 30_000 });
    // $139.98 the month before, $169.98 now: up 21%, in rose (spending that went up).
    const note = card.locator(".subs-total-note");
    await expect(note).toHaveText("▲ 21% vs the month before");
    await expect(note.locator("b")).toHaveClass(/money-short/);
  });

  test("Subscriptions and bills: no note when the month did not move", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    for (let back = 5; back >= 1; back -= 1) {
      await postJson(page, "/api/entries/create", {
        date: `${monthsAgo(back)}-14`, description: "GREAT EASTERN INSURANCE", accountName: "Citi Rewards", categoryName: "Subscriptions MO",
        entryType: "expense", ownershipType: "direct", ownerName: "Joyce", amountMinor: 12_000
      });
    }
    await openSummary(page);
    await expect(page.locator(".subs-card")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".subs-card [data-change-note]")).toHaveCount(0);
  });

  test("Bank fees: the last full month against the month before, never the month in progress", async ({ page }) => {
    test.skip(monthsAgo(2).slice(0, 4) !== THIS_MONTH.slice(0, 4), "the fee year must hold both months");
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const [back, amountMinor] of [[2, 5_000], [1, 19_260]]) {
      await postJson(page, "/api/entries/create", {
        date: `${monthsAgo(back)}-20`, description: "LATE FEE CITI REWARDS", accountName: "Citi Rewards", categoryName: "Fees",
        entryType: "expense", ownershipType: "direct", ownerName: "Joyce", amountMinor
      });
    }
    // A fee this month is left out of the comparison.
    await postJson(page, "/api/entries/create", {
      date: TODAY, description: "LATE FEE CITI REWARDS", accountName: "Citi Rewards", categoryName: "Fees",
      entryType: "expense", ownershipType: "direct", ownerName: "Joyce", amountMinor: 90_000
    });
    await openSummary(page);
    const tile = page.locator('[data-tile="bankfees"]');
    await expect(tile).toBeVisible({ timeout: 30_000 });
    // $50.00 then $192.60: up 285%.
    await expect(tile.locator("[data-change-note]")).toHaveText("▲ 285% vs the month before (full months only)");
    await expect(tile.locator("[data-change-note] b")).toHaveClass(/money-short/);
    await tile.click();
    await expect(page.getByRole("dialog", { name: "Bank fees" }).locator("[data-change-note]")).toHaveText("▲ 285% vs the month before (full months only)");
  });

  test("Miles and cashback: earned so far against the same days of the cycle before", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const dining = (date, amountMinor) => postJson(page, "/api/entries/create", {
      date, description: "SONG FA BAK KUT TEH", accountName: "UOB Lady's", categoryName: "Food & Drinks",
      entryType: "expense", ownershipType: "direct", ownerName: "Joyce", amountMinor
    });
    await dining(TODAY, 38_000);
    // The first day of the month before is always inside the same days of that cycle.
    await dining(`${monthsAgo(1)}-01`, 19_000);
    await openSummary(page);
    const tile = page.locator('[data-tile="miles"]');
    await expect(tile).toBeVisible({ timeout: 30_000 });
    const note = tile.locator("[data-change-note]");
    await expect(note).toHaveText(/^▲ \d+% vs the month before$/);
    await expect(note.locator("b")).toHaveClass(/money-in/);
    await tile.click();
    await expect(page.getByRole("dialog", { name: "Miles and cashback" }).locator("[data-change-note]").first()).toContainText("vs the month before");
  });

  test("hidden money: no change note on any card", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openSummary(page, { money: false });
    await expect(page.locator('[data-tile="bankfees"], [data-tile="miles"], [data-tile="splits"]').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".summary-lead-slot [data-change-note], .subs-card [data-change-note], [data-tile] [data-change-note]")).toHaveCount(0);
  });

  test("the lead card carries the same note as Spending mix, same words, or neither has one", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    // Three earlier months and a range that ends in a complete month: the rule has history to compare.
    for (let back = 6; back >= 1; back -= 1) {
      await postJson(page, "/api/entries/create", {
        date: `${monthsAgo(back)}-10`, description: "COLD STORAGE", accountName: "Citi Rewards", categoryName: "Groceries",
        entryType: "expense", ownershipType: "direct", ownerName: "Joyce", amountMinor: back > 3 ? 20_000 : 30_000
      });
    }
    await openSummary(page);
    const mix = page.locator(".summary-mix-note[data-change-note]");
    const lead = page.locator(".summary-lead-slot [data-change-note]");
    if (await mix.count()) {
      await expect(lead).toHaveText(await mix.first().innerText());
      await expect(lead.locator("b")).toHaveClass(/money-(in|short)/);
    } else {
      await expect(lead).toHaveCount(0);
    }
  });
});

test.describe("What changed on the Month page", () => {
  test.beforeEach(async ({ page }) => {
    await reseedDemo(page);
    for (const [month, description, category, amountMinor] of [
      [monthsAgo(1), "KOUFU FOOD COURT", "Food & Drinks", 2_000],
      [monthsAgo(1), "COURTS MEGASTORE", "Home", 30_000],
      [THIS_MONTH, "BURNT ENDS", "Food & Drinks", 80_000]
    ]) {
      await postJson(page, "/api/entries/create", {
        date: `${month}-01`, description, accountName: "Citi Rewards", categoryName: category,
        entryType: "expense", ownershipType: "direct", ownerName: "Joyce", amountMinor
      });
    }
  });

  test("the month in progress shows the Summary card as it is; a past month shows nothing of it", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.goto(`/month?view=household&month=${THIS_MONTH}`);
    const card = page.locator("[data-month-card='changed'] .chg-card");
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card.getByRole("heading", { name: "What changed", exact: true })).toBeVisible();
    await expect(card.locator('[data-category="Food & Drinks"] .chg-diff')).toContainText(/^up \$/);
    await expect(card.locator('[data-category="Home"] .chg-diff')).toContainText(/^down \$300\.00/);
    // It sits between the insights and Spending mix, in the same grid.
    const order = await page.locator("[data-month-cards] > [data-month-card]").evaluateAll((slots) => slots.map((slot) => slot.getAttribute("data-month-card")));
    expect(order.indexOf("insights")).toBeLessThan(order.indexOf("changed"));
    expect(order.indexOf("changed")).toBeLessThan(order.indexOf("mix"));

    await page.goto(`/month?view=household&month=${monthsAgo(1)}`);
    await expect(page.locator("[data-month-card='mix']")).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    await expect(page.locator(".chg-card")).toHaveCount(0);
    // The empty slot takes no room.
    expect(await page.locator("[data-month-card='changed']").evaluate((slot) => slot.getBoundingClientRect().height)).toBe(0);
  });

  test("390: the same card, and with money hidden it shows names only", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "false"));
    await page.goto(`/month?view=household&month=${THIS_MONTH}`);
    const card = page.locator("[data-month-card='changed'] .chg-card");
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).not.toContainText("$");
    await expect(card).not.toContainText(/\b(up|down)\b/);
  });
});
