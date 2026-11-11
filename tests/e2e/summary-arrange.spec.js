import { expect, test } from "@playwright/test";

import { reseedDemo } from "./helpers";

// Arrange Summary (design.md "Arrange Summary"): the cards under the top
// summary can be moved and hidden (Money insights can be moved, never
// hidden); nothing changes until Done; the choice survives a reload; Reset
// brings the usual order back. Without a login it is kept on the device.

// What changed this month has no card outside the month in progress, so the demo shows no slot for it.
const USUAL = ["insights", "plan", "mix", "subs", "miles", "investments", "taxreliefs", "accounts"];

// Every card is a slot of the dashboard grid, in the person's order.
async function cardOrder(page) {
  return page.evaluate(() => [...document.querySelectorAll(".panel [data-summary-card]")].map((element) => element.getAttribute("data-summary-card")));
}

test.describe("Arrange Summary", () => {
  test.beforeEach(async ({ page }) => {
    await reseedDemo(page);
  });

  test("desktop: move a card with the keyboard, hide one, Done, reload, then Reset", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/?view=household");
    await expect(page.locator(".summary-cards-arrange button")).toHaveText("Arrange cards", { timeout: 30_000 });
    expect(await cardOrder(page)).toEqual(USUAL);

    await page.locator(".summary-cards-arrange button").click();
    const dialog = page.getByRole("dialog", { name: "Arrange cards" });
    await expect(dialog).toContainText("The top summary always stays first.");
    // Money insights is never hidden.
    await expect(dialog.locator('[data-card="insights"] .summary-cards-name')).toBeDisabled();
    // The keyboard alone: Spending Mix up one place.
    await dialog.getByRole("button", { name: "Move Spending Mix up" }).focus();
    await page.keyboard.press("Enter");
    await dialog.locator('[data-card="accounts"] .summary-cards-name').click();
    await expect(dialog.locator('[data-card="accounts"]')).toContainText("Hidden");
    // Cancel changes nothing.
    await dialog.getByRole("button", { name: "Close dialog" }).click();
    expect(await cardOrder(page)).toEqual(USUAL);

    await page.locator(".summary-cards-arrange button").click();
    // Two moves up: above Intent vs Outcome (and under Money insights).
    for (let move = 0; move < 2; move += 1) await dialog.getByRole("button", { name: "Move Spending Mix up" }).click();
    await dialog.locator('[data-card="accounts"] .summary-cards-name').click();
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toBeHidden();
    expect(await cardOrder(page)).toEqual(["insights", "mix", "plan", "subs", "miles", "investments", "taxreliefs"]);
    await expect(page.locator(".summary-accounts")).toHaveCount(0);

    await page.reload();
    await expect(page.locator(".summary-cards-arrange button")).toBeVisible({ timeout: 30_000 });
    expect(await cardOrder(page)).toEqual(["insights", "mix", "plan", "subs", "miles", "investments", "taxreliefs"]);

    await page.locator(".summary-cards-arrange button").click();
    await dialog.getByRole("button", { name: "Reset to the usual order" }).click();
    expect(await cardOrder(page)).toEqual(USUAL);
  });

  test("phone: Edit cards, Up and Down are 44 px and the ends are greyed out", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?view=household");
    const link = page.locator(".summary-cards-arrange button");
    await expect(link).toHaveText("Edit cards", { timeout: 30_000 });
    await link.click();
    const sheet = page.getByRole("dialog", { name: "Edit cards" });
    await expect(sheet).toContainText("Tap a card's name to show or hide it.");
    const firstUp = sheet.getByRole("button", { name: "Move Money insights up" });
    await expect(firstUp).toBeDisabled();
    await expect(sheet.getByRole("button", { name: "Move The accounts shown down" })).toBeDisabled();
    const box = await sheet.getByRole("button", { name: "Move Spending Mix up" }).boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
    // Cancel, Reset and Done each have their own room: none overlaps another.
    const bars = [];
    for (const name of ["Cancel", "Reset to the usual order", "Done"]) {
      const bar = await sheet.getByRole("button", { name }).boundingBox();
      expect(bar, name).not.toBeNull();
      expect(bar.x).toBeGreaterThanOrEqual(0);
      expect(bar.x + bar.width).toBeLessThanOrEqual(390);
      bars.push(bar);
    }
    for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) {
      const apart = bars[a].x + bars[a].width <= bars[b].x + 1 || bars[b].x + bars[b].width <= bars[a].x + 1
        || bars[a].y + bars[a].height <= bars[b].y + 1 || bars[b].y + bars[b].height <= bars[a].y + 1;
      expect(apart, `buttons ${a} and ${b} overlap`).toBe(true);
    }
  });
});
