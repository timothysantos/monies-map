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

// aria-hidden or inert on the element or any ancestor removes it from the
// accessibility tree.
function hiddenFromScreenReaders(locator) {
  return locator.evaluate((element) => Boolean(element.closest('[aria-hidden="true"], [inert]')));
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

  test("the Entries edit sheet hides the entry list from screen readers until it closes", async ({ page }) => {
    await page.setViewportSize(iPhone);
    await gotoPageAfterApi(
      page,
      "/entries?view=person-tim&month=2026-04",
      "/api/entries-page",
      () => page.locator(".entry-row").first()
    );
    const rows = page.locator(".entry-row");
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(5);
    const sheet = page.locator(".entry-mobile-sheet");
    // Role queries follow the accessibility tree, so a row's own controls
    // drop out of them while the sheet hides the list.
    const firstRowButtons = rows.first().getByRole("button");
    expect(await firstRowButtons.count()).toBeGreaterThan(0);

    await rows.nth(2).locator(".entry-row-main").click();
    await expect(sheet).toBeVisible();
    await expect.poll(() => focusIsInside(sheet)).toBe(true);
    expect(await hiddenFromScreenReaders(sheet)).toBe(false);
    for (const index of [0, 2, rowCount - 1]) {
      expect(await hiddenFromScreenReaders(rows.nth(index))).toBe(true);
    }
    await expect(firstRowButtons).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    expect(await hiddenFromScreenReaders(rows.nth(2))).toBe(false);
    expect(await firstRowButtons.count()).toBeGreaterThan(0);
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

// The page behind an open sheet is out of reach: the backdrop covers every
// point outside the sheet, a finger drag or wheel over the backdrop leaves the
// page where it was, and the page's controls are hidden from screen readers.
// All of it is released when the sheet closes.
test.describe("mobile sheet background", () => {
  test.use({ viewport: iPhone, hasTouch: true, isMobile: true });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.goto("/");
    await reseedDemo(page);
  });

  test("while a sheet is open the page behind cannot be tapped, scrolled or read", async ({ page }) => {
    await gotoMobileMonth(page);
    const scrollable = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    expect(scrollable).toBeGreaterThan(600);
    await page.evaluate(() => window.scrollTo({ top: 400, behavior: "instant" }));
    const opener = page.getByRole("button", { name: "+ Add planned item" });
    const sheet = page.locator('.entry-mobile-sheet[aria-label="+ Add planned item"]');
    await opener.click();
    await expect(sheet).toBeVisible();
    await expect.poll(() => focusIsInside(sheet)).toBe(true);

    // Tab wraps at the sheet's edges even without a trap, so also move focus
    // outside directly (as assistive tech can): the trap pulls it back.
    const movedOutside = await page.evaluate(() => {
      const target = document.querySelector('#root button[aria-label="Edit Savings row"]');
      target?.focus();
      return Boolean(target);
    });
    expect(movedOutside).toBe(true);
    await expect.poll(() => focusIsInside(sheet)).toBe(true);

    await expect(page.getByRole("button", { name: "+ Add planned item", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Edit Savings row" })).toHaveCount(0);
    expect(await hiddenFromScreenReaders(page.locator("tr").filter({ hasText: "Savings" }).first())).toBe(true);
    expect(await hiddenFromScreenReaders(sheet)).toBe(false);

    const cover = await sheet.evaluate((sheetElement) => {
      const backdrop = document.querySelector(".entry-composer-overlay");
      const reachable = [];
      let onBackdrop = 0;
      for (let y = 4; y < window.innerHeight; y += 24) {
        for (let x = 4; x < window.innerWidth; x += 24) {
          const hit = document.elementFromPoint(x, y);
          if (hit && sheetElement.contains(hit)) continue;
          if (hit && hit === backdrop) onBackdrop += 1;
          else reachable.push(`${x},${y} ${hit?.tagName ?? "none"}.${hit?.className ?? ""}`);
        }
      }
      return { reachable, onBackdrop, sheetTop: sheetElement.getBoundingClientRect().top };
    });
    expect(cover.reachable).toEqual([]);
    expect(cover.onBackdrop).toBeGreaterThan(0);
    // A tall sheet stops 24 px below the top; the drag starts in that strip.
    expect(cover.sheetTop).toBeGreaterThan(16);

    const scrollBefore = await page.evaluate(() => window.scrollY);
    expect(scrollBefore).toBeGreaterThan(0);
    const backdropY = Math.floor(cover.sheetTop / 2);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.synthesizeScrollGesture", { x: 195, y: backdropY, yDistance: -400, gestureSourceType: "touch", speed: 1200 });
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    await page.mouse.move(195, backdropY);
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    await expect(sheet).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(opener).toBeFocused();
    expect(await hiddenFromScreenReaders(opener)).toBe(false);
    await expect(page.getByRole("button", { name: "Edit Savings row" })).toHaveCount(1);
    const scrollAfterClose = await page.evaluate(() => window.scrollY);
    await cdp.send("Input.synthesizeScrollGesture", { x: 195, y: 300, yDistance: 300, gestureSourceType: "touch", speed: 1200 });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(scrollAfterClose);
  });
});
