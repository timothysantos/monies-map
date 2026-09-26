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

// A portrait tablet (761–1024 px wide) keeps the desktop page layout, but
// Month opens its plan rows in the sheet there (MONTH_SHEET_LAYOUT_QUERY).
// The sheet must sit on screen, not at the bottom of the scroll-locked page.
// Presses go to viewport coordinates (page.mouse or page.touchscreen),
// because a locator click scrolls the target into view first and would hide
// an off-screen sheet.
const PORTRAIT_TABLETS = [
  { name: "900x1200 window", touch: false, use: { viewport: { width: 900, height: 1200 } } },
  { name: "820x1180 touch", touch: true, use: { viewport: { width: 820, height: 1180 }, hasTouch: true } }
];

// Reads where the sheet and its Save button are, against the part of the
// page the person can see, without scrolling anything.
async function readSheetPlacement(sheet) {
  return sheet.evaluate((sheetElement) => {
    const rect = sheetElement.getBoundingClientRect();
    const save = sheetElement.querySelector("button.dialog-primary");
    const saveRect = save.getBoundingClientRect();
    const saveCenter = { x: saveRect.left + saveRect.width / 2, y: saveRect.top + saveRect.height / 2 };
    const hit = document.elementFromPoint(saveCenter.x, saveCenter.y);
    const visible = window.visualViewport ?? { offsetLeft: 0, offsetTop: 0, width: window.innerWidth, height: window.innerHeight };
    return {
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      visible: { left: visible.offsetLeft, top: visible.offsetTop, right: visible.offsetLeft + visible.width, bottom: visible.offsetTop + visible.height },
      scrollY: window.scrollY,
      saveCenter,
      saveIsHit: Boolean(hit && save.contains(hit))
    };
  });
}

function expectOnScreen(placement) {
  expect(placement.top).toBeGreaterThanOrEqual(placement.visible.top);
  expect(placement.bottom).toBeLessThanOrEqual(placement.visible.bottom + 0.5);
  expect(placement.left).toBeGreaterThanOrEqual(placement.visible.left);
  expect(placement.right).toBeLessThanOrEqual(placement.visible.right + 0.5);
  expect(placement.saveIsHit).toBe(true);
}

async function pressAt(page, point, touch) {
  if (touch) {
    await page.touchscreen.tap(point.x, point.y);
  } else {
    await page.mouse.click(point.x, point.y);
  }
}

for (const tablet of PORTRAIT_TABLETS) {
  test.describe(`Month sheet on a portrait tablet (${tablet.name})`, () => {
    test.use(tablet.use);

    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
      await page.goto("/");
      await reseedDemo(page);
      await gotoPageAfterApi(
        page,
        "/month?view=person-tim&month=2026-05&scope=direct_plus_shared",
        "/api/month-page",
        () => page.getByRole("button", { name: "+ Add planned item" })
      );
    });

    test("the add planned item sheet opens on screen and saves from its own Save button", async ({ page }) => {
      const sheet = page.locator('.entry-mobile-sheet[aria-label="+ Add planned item"]');
      const opener = page.getByRole("button", { name: "+ Add planned item" });
      await opener.scrollIntoViewIfNeeded();
      const scrollBefore = await page.evaluate(() => window.scrollY);
      await (tablet.touch ? opener.tap() : opener.click());
      await expect(sheet).toBeVisible();
      await expect.poll(() => focusIsInside(sheet)).toBe(true);

      const placement = await readSheetPlacement(sheet);
      expectOnScreen(placement);
      expect(placement.scrollY).toBe(scrollBefore);

      // Outside the sheet every point lands on the backdrop, not the page.
      const reachable = await sheet.evaluate((sheetElement) => {
        const backdrop = document.querySelector(".entry-composer-overlay");
        const misses = [];
        for (let y = 4; y < window.innerHeight; y += 40) {
          for (let x = 4; x < window.innerWidth; x += 40) {
            const hit = document.elementFromPoint(x, y);
            if (hit && (sheetElement.contains(hit) || hit === backdrop)) continue;
            misses.push(`${x},${y} ${hit?.tagName ?? "none"}.${hit?.className ?? ""}`);
          }
        }
        return misses;
      });
      expect(reachable).toEqual([]);

      const item = sheet.locator("label").filter({ hasText: "Item" }).locator("input");
      const planned = sheet.locator("label").filter({ hasText: "Planned" }).locator("input");
      await item.fill("Tablet sheet check");
      await planned.fill("42.00");
      await expect(item).toHaveValue("Tablet sheet check");
      await expect(planned).toHaveValue("42.00");
      // Filling did not have to move the page or the sheet to reach a field.
      expectOnScreen(await readSheetPlacement(sheet));

      await pressAt(page, placement.saveCenter, tablet.touch);
      await expect(page.locator("tr").filter({ hasText: "Tablet sheet check" })).toHaveCount(1);
      // A saved add sheet starts a fresh item, still on screen.
      await expect(item).toHaveValue("New item");
      expectOnScreen(await readSheetPlacement(sheet));
      const cancel = await sheet.getByRole("button", { name: "Cancel", exact: true }).boundingBox();
      await pressAt(page, { x: cancel.x + cancel.width / 2, y: cancel.y + cancel.height / 2 }, tablet.touch);
      await expect(sheet).toHaveCount(0);
    });

    test("an existing plan row opens its edit sheet on screen and saves the change", async ({ page }) => {
      const rowOpener = page.locator("tr").filter({ hasText: "Savings" }).first().getByRole("button", { name: "Edit Savings row" });
      const sheet = page.locator('.entry-mobile-sheet[aria-label="Edit planned item"]');
      await (tablet.touch ? rowOpener.tap() : rowOpener.click());
      await expect(sheet).toBeVisible();
      await expect.poll(() => focusIsInside(sheet)).toBe(true);

      const placement = await readSheetPlacement(sheet);
      expectOnScreen(placement);

      await sheet.locator('input[value="1800.00"]').fill("1825.00");
      expectOnScreen(await readSheetPlacement(sheet));
      await pressAt(page, placement.saveCenter, tablet.touch);
      await expect(sheet).toHaveCount(0);

      await (tablet.touch ? rowOpener.tap() : rowOpener.click());
      await expect(sheet.locator('input[value="1825.00"]')).toBeVisible();
      // A press on the backdrop, away from the sheet, closes it.
      await pressAt(page, { x: 8, y: 8 }, tablet.touch);
      await expect(sheet).toHaveCount(0);
    });

    test("Entries keeps its desktop editor and composer at this size", async ({ page }) => {
      const entryRows = page.locator(".entry-row");
      await gotoPageAfterApi(page, "/entries?view=person-tim&month=2026-05", "/api/entries-page", () => entryRows.first());
      await expect(page.locator(".entries-filter-stack")).toBeVisible();

      await entryRows.first().click();
      await expect(page.locator(".entry-edit-grid").first()).toBeVisible();
      await expect(page.locator(".entry-mobile-sheet")).toHaveCount(0);
      await page.getByRole("button", { name: "Cancel editing entry" }).click();
      await expect(page.locator(".entry-edit-grid")).toHaveCount(0);

      await page.getByRole("button", { name: "+ Add entry" }).first().click();
      await expect(page.locator(".entry-row.entry-composer")).toBeVisible();
      await expect(page.locator(".entry-mobile-sheet")).toHaveCount(0);
    });
  });
}

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
