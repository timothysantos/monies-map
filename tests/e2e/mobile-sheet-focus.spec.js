import { devices, expect, test } from "@playwright/test";

import { gotoPageAfterApi, reseedDemo } from "./helpers";

// The shared mobile bottom sheet (Month plan sheets, Entries add/edit) must
// behave like the app's Radix dialogs: focus moves in on open, stays inside,
// Escape closes it, and focus returns to the control that opened it.

const iPhone = devices["iPhone 12 Pro"].viewport;

async function gotoMobileMonth(page) {
  await page.setViewportSize(iPhone);
  await gotoPageAfterApi(
    page,
    "/month?view=person-tim&month=2026-05&scope=direct_plus_shared",
    "/api/month-page",
    () => page.getByRole("button", { name: "+ Add planned item" })
  );
}

function focusIsInside(locator) {
  return locator.evaluate((element) => element.contains(document.activeElement));
}

test.describe("mobile sheet focus", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.goto("/");
    await reseedDemo(page);
  });

  test("the add planned item sheet takes focus, keeps it inside, closes on Escape and returns focus", async ({ page }) => {
    await gotoMobileMonth(page);
    const opener = page.getByRole("button", { name: "+ Add planned item" });
    const sheet = page.locator('.entry-mobile-sheet[aria-label="+ Add planned item"]');

    await opener.click();
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute("role", "dialog");
    await expect.poll(() => focusIsInside(sheet)).toBe(true);

    // Tab and Shift+Tab past either end of the sheet wrap around inside it
    // instead of reaching the page underneath.
    for (let step = 0; step < 30; step += 1) {
      await page.keyboard.press("Tab");
      expect(await focusIsInside(sheet)).toBe(true);
    }
    for (let step = 0; step < 10; step += 1) {
      await page.keyboard.press("Shift+Tab");
      expect(await focusIsInside(sheet)).toBe(true);
    }

    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test("the edit planned item sheet opens from the keyboard, Escape discards the draft and focus returns to the row", async ({ page }) => {
    await gotoMobileMonth(page);
    const row = page.locator("tr").filter({ hasText: "Savings" }).first();
    const rowOpener = row.getByRole("button", { name: "Edit Savings row" });
    const sheet = page.locator('.entry-mobile-sheet[aria-label="Edit planned item"]');

    await rowOpener.focus();
    await page.keyboard.press("Enter");
    await expect(sheet).toBeVisible();
    await expect.poll(() => focusIsInside(sheet)).toBe(true);

    const amount = sheet.locator('input[value="1800.00"]');
    await amount.fill("1825.00");
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(rowOpener).toBeFocused();

    // Escape is a cancel, as in the desktop dialogs: nothing was saved and
    // the next open starts from the saved plan.
    await rowOpener.press("Enter");
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('input[value="1800.00"]')).toBeVisible();
    await expect(sheet.locator('input[value="1825.00"]')).toHaveCount(0);
  });

  test("Escape during a save keeps the sheet and its draft until the save answers", async ({ page }) => {
    await gotoMobileMonth(page);
    const row = page.locator("tr").filter({ hasText: "Savings" }).first();
    const sheet = page.locator('.entry-mobile-sheet[aria-label="Edit planned item"]');

    await row.getByRole("button", { name: "Edit Savings row" }).focus();
    await page.keyboard.press("Enter");
    await expect(sheet).toBeVisible();
    await sheet.locator('input[value="1800.00"]').fill("1810.00");

    let releaseSave;
    const saveHeld = new Promise((resolve) => { releaseSave = resolve; });
    await page.route("**/api/month-plan/save", async (route) => {
      await saveHeld;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Month plan save failed." })
      });
    });

    const saveButton = sheet.locator("button.dialog-primary");
    await saveButton.click();
    await expect(saveButton).toContainText("Saving");
    await page.keyboard.press("Escape");
    await expect(sheet).toBeVisible();

    releaseSave();
    await expect(sheet.getByRole("alert")).toHaveClass(/entry-submit-error/);
    await expect(sheet.locator('input[value="1810.00"]')).toBeVisible();
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });

  test("Escape inside a nested picker closes only the picker, not the sheet", async ({ page }) => {
    await gotoMobileMonth(page);
    const sheet = page.locator('.entry-mobile-sheet[aria-label="+ Add planned item"]');
    await page.getByRole("button", { name: "+ Add planned item" }).click();
    await expect(sheet).toBeVisible();

    await sheet.getByRole("button", { name: "Edit Savings" }).click();
    const categoryDialog = page.getByRole("dialog", { name: "Edit category" });
    await expect(categoryDialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(categoryDialog).toHaveCount(0);
    await expect(sheet).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
  });

  test("the Entries add entry sheet follows the same dialog pattern", async ({ page }) => {
    await page.setViewportSize(iPhone);
    await gotoPageAfterApi(
      page,
      "/entries?view=person-tim&month=2026-04",
      "/api/entries-page",
      () => page.getByRole("button", { name: "+ Add entry" }).first()
    );
    const opener = page.getByRole("button", { name: "+ Add entry" }).first();
    const sheet = page.locator('.entry-mobile-sheet[aria-label="Add entry"]');

    await opener.click();
    await expect(sheet).toBeVisible();
    await expect.poll(() => focusIsInside(sheet)).toBe(true);

    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(opener).toBeFocused();
  });
});
