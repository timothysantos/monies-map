import { expect, test } from "@playwright/test";

import { postJson, reseedDemo } from "./helpers";

// Summary's tiles (design.md "Summary tiles"): Coming up, Investments, Miles,
// Tax reliefs and Bank fees are tiles (3 across on a desktop, 2 across on a
// phone, where Subscriptions and bills is a tile too). A tile opens the whole
// card in a centred dialog (desktop) or a bottom sheet (phone); the URL gets
// #summary-<card>; Esc, the close button and Back close it and focus goes
// back to the tile; Arrange cards hides a card and its tile together; money
// hidden leaves names only.

const now = new Date();
const monthsAgo = (back) => {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
};

async function addCharges(page) {
  for (let back = 4; back >= 1; back -= 1) {
    await postJson(page, "/api/entries/create", {
      date: `${monthsAgo(back)}-14`, description: "NETFLIX.COM 866-579-7172", accountName: "Citi Rewards", categoryName: "Subscriptions MO",
      entryType: "expense", ownershipType: "direct", ownerName: "Joyce", amountMinor: 1998
    });
  }
  await postJson(page, "/api/entries/create", {
    date: `${monthsAgo(1)}-20`, description: "ANNUAL FEE CITI REWARDS", accountName: "Citi Rewards", categoryName: "Fees",
    entryType: "expense", ownershipType: "direct", ownerName: "Joyce", amountMinor: 19260
  });
}

async function openSummary(page, { money = true, hash = "" } = {}) {
  await page.addInitScript((shown) => window.localStorage.setItem("monies-map:money-totals-visible", shown), String(money));
  await page.goto(`/?view=household${hash}`);
  await expect(page.locator(".summary-cards-arrange button")).toBeVisible({ timeout: 30_000 });
}

const box = (locator) => locator.evaluate((element) => {
  const rect = element.getBoundingClientRect();
  return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
});

test.describe("Summary tiles", () => {
  test.beforeEach(async ({ page }) => {
    await reseedDemo(page);
    await addCharges(page);
  });

  test("1440: Coming up and Bank fees are tiles, 3 across and 284px tall; Subscriptions and bills stays a big card", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openSummary(page);
    const coming = page.locator('[data-tile="coming"]');
    const fees = page.locator('[data-tile="bankfees"]');
    await expect(coming).toBeVisible({ timeout: 30_000 });
    await expect(fees).toBeVisible();
    expect((await box(coming)).height).toBe(284);
    // Subscriptions and bills is its big card on a desktop, not a tile.
    await expect(page.locator('[data-tile="subs"]')).toHaveCount(0);
    await expect(page.locator(".subs-card")).toBeVisible();
    // The tile's content: title and Open, a headline, a chip and rows.
    await expect(coming).toContainText("Coming up");
    await expect(coming).toContainText("Open ›");
    await expect(coming.locator(".summary-tile-headline")).toContainText("$");
    await expect(coming.locator(".summary-tile-chip")).toContainText(/\d+ charges?/);
    await expect(coming).toContainText("Netflix");
    await expect(fees.locator(".summary-tile-headline")).toContainText("$192.60");
    await expect(fees.locator(".summary-tile-row").first()).toContainText("Annual fees");
    // Tiles sit in rows of 3.
    const tiles = page.locator(".summary-tiles .summary-tile");
    const first = await box(tiles.first());
    const second = await box(tiles.nth(1));
    expect(second.y).toBe(first.y);
    expect(second.x).toBeGreaterThan(first.right);
  });

  test("1440: a tile opens its whole card in a dialog; Esc, the close button and Back close it and focus returns to the tile", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openSummary(page);
    const tile = page.locator('[data-tile="coming"]');
    await tile.click();
    const dialog = page.getByRole("dialog", { name: "Coming up" });
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/#summary-coming$/);
    // The whole existing card, on its Coming up tab, with its own tabs.
    await expect(dialog.locator(".subs-card")).toBeVisible();
    await expect(dialog.getByRole("tab", { name: "Coming up" })).toHaveAttribute("aria-selected", "true");
    await dialog.getByRole("tab", { name: /^All \d+$/ }).click();
    await expect(dialog.locator('[data-series="NETFLIX COM|monthly"]')).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page).not.toHaveURL(/#summary/);
    await expect(tile).toBeFocused();

    await tile.click();
    await expect(dialog).toBeVisible();
    const close = dialog.getByRole("button", { name: "Close dialog" });
    expect((await box(close)).height).toBeGreaterThanOrEqual(44);
    await close.click();
    await expect(dialog).toBeHidden();
    await expect(tile).toBeFocused();

    // Back closes it.
    await tile.click();
    await expect(dialog).toBeVisible();
    await page.goBack();
    await expect(dialog).toBeHidden();
    await expect(page).not.toHaveURL(/#summary/);
  });

  test("a link with #summary-bankfees opens that card at once; a plain or unknown hash opens nothing", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openSummary(page, { hash: "#summary-bankfees" });
    const dialog = page.getByRole("dialog", { name: "Bank fees" });
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await expect(dialog.locator(".bankfees-total")).toContainText("$192.60");
    await expect(dialog.locator(".bankfees-row").first()).toContainText("Annual fees");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await openSummary(page, { hash: "#summary-nothing" });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await openSummary(page, { hash: "#summary-mix" });
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("the card's own figure still opens its entries from inside the dialog", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openSummary(page, { hash: "#summary-bankfees" });
    const dialog = page.getByRole("dialog", { name: "Bank fees" });
    await dialog.locator('.bankfees-total [data-fig]').click();
    await page.getByRole("button", { name: "View entries", exact: true }).click();
    await expect(page).toHaveURL(/\/entries\?/);
  });

  test("hidden money: a tile keeps its words and drops every amount, chip and mark", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openSummary(page, { money: false });
    const coming = page.locator('[data-tile="coming"]');
    await expect(coming).toBeVisible({ timeout: 30_000 });
    await expect(coming).toContainText("Coming up");
    await expect(coming).toContainText("Netflix");
    await expect(coming).not.toContainText("$");
    await expect(coming.locator(".summary-tile-headline")).toHaveText("••••");
    await expect(coming.locator(".summary-tile-chip")).toHaveCount(0);
    await expect(coming.locator(".summary-tile-weeks")).toBeHidden();
    const fees = page.locator('[data-tile="bankfees"]');
    await expect(fees).not.toContainText("$");
    await expect(fees.locator(".summary-tile-stack")).toBeHidden();
  });

  test("Arrange cards hides a card and its tile together, and a hidden card's link opens nothing", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openSummary(page);
    await expect(page.locator('[data-tile="bankfees"]')).toBeVisible({ timeout: 30_000 });
    await page.locator(".summary-cards-arrange button").click();
    const editor = page.getByRole("dialog", { name: "Arrange cards" });
    await expect(editor.locator('[data-card="coming"] strong')).toHaveText("Coming up");
    await editor.locator('[data-card="bankfees"] .summary-cards-name').click();
    await editor.getByRole("button", { name: "Done" }).click();
    await expect(page.locator('[data-tile="bankfees"]')).toHaveCount(0);
    await expect(page.locator('[data-tile="coming"]')).toBeVisible();
    await page.goto("/?view=household#summary-bankfees");
    await expect(page.locator(".summary-cards-arrange button")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("dialog", { name: "Bank fees" })).toHaveCount(0);
  });

  test("390: tiles are 2 across and 256px tall, Subscriptions and bills is one of them, and a tap opens a sheet that Esc closes", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openSummary(page);
    const subs = page.locator('[data-tile="subs"]');
    await expect(subs).toBeVisible({ timeout: 30_000 });
    expect((await box(subs)).height).toBe(256);
    // On a phone the big Subscriptions card is not drawn on the page.
    await expect(page.locator(".summary-card-slot .subs-card")).toHaveCount(0);
    const tiles = page.locator(".summary-tiles .summary-tile");
    const first = await box(tiles.first());
    const second = await box(tiles.nth(1));
    expect(second.y).toBe(first.y);
    expect(second.x).toBeGreaterThan(first.right - 1);
    expect(second.right).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);

    await subs.click();
    const sheet = page.getByRole("dialog", { name: "Subscriptions and bills" });
    await expect(sheet).toBeVisible();
    await expect(page).toHaveURL(/#summary-subs$/);
    await expect(sheet.locator(".subs-card")).toBeVisible();
    await expect(sheet.locator('[data-series="NETFLIX COM|monthly"]')).toBeVisible();
    const sheetBox = await box(sheet);
    expect(sheetBox.bottom).toBeGreaterThan(800);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(subs).toBeFocused();
  });
});
