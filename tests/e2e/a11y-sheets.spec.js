import { devices, expect, test } from "@playwright/test";

import { activeElementName, axeViolations, settleAnimations } from "./a11y-helpers";
import { postJson, reseedDemo } from "./helpers";

// Accessibility of the phone sheets and dialogs (docs/audits/a11y-pass.md):
// a sheet or dialog takes focus when it opens and gives it back to the
// control that opened it, "Discard changes?" keeps Tab inside its two
// buttons, and axe finds nothing in the sheets and the Splits strip.
// Phone with touch, as the other sheet specs; keys stand in for a keyboard
// and a screen reader's focus.

const MONTH = "2026-05";
test.use({ viewport: devices["iPhone 12 Pro"].viewport, hasTouch: true });

async function waitUsable(page) {
  await expect.poll(() => page.evaluate(() => window.__MONIES_MAP_ROUTE_WORK__?.usable ?? false), { timeout: 45_000 }).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await page.goto("/");
  await reseedDemo(page);
});

// A one-finger drag from the sheet's grab bar, as TouchEvents (the same
// way sheet-swipe-dismiss.spec.js drives the swipe).
function swipeDown(page, sheetSelector, distance = 260) {
  return page.evaluate(async ({ sheetSelector, distance }) => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const rect = document.querySelector(sheetSelector).getBoundingClientRect();
    const from = { x: rect.x + rect.width / 2, y: rect.y + 8 };
    const target = document.elementFromPoint(from.x, from.y);
    const touchAt = (x, y) => new Touch({ identifier: 7, target, clientX: x, clientY: y, pageX: x, pageY: y, screenX: x, screenY: y });
    const fire = (type, touch, active) => target.dispatchEvent(new TouchEvent(type, {
      bubbles: true, cancelable: true, composed: true,
      touches: active ? [touch] : [], targetTouches: active ? [touch] : [], changedTouches: [touch]
    }));
    fire("touchstart", touchAt(from.x, from.y), true);
    let y = from.y;
    for (let step = 0; step < 10; step += 1) {
      await wait(20);
      y += distance / 10;
      fire("touchmove", touchAt(from.x, y), true);
    }
    await wait(140);
    fire("touchend", touchAt(from.x, y), false);
  }, { sheetSelector, distance });
}

async function openThenClose(page, opener, closeKey = "Escape") {
  await opener.focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  const inside = await activeElementName(page);
  await page.keyboard.press(closeKey);
  await page.waitForTimeout(500);
  return { inside, after: await activeElementName(page) };
}

test.describe("Discard changes?", () => {
  test("keeps Tab inside Discard and Keep editing, and is clean for axe", async ({ page }) => {
    const { entryId } = await postJson(page, "/api/entries/create", {
      date: `${MONTH}-24`, description: "A11y entry", accountName: "UOB One", categoryName: "Groceries", amountMinor: 3210,
      entryType: "expense", ownershipType: "direct", ownerName: "Tim"
    });
    await page.goto(`/entries?view=person-tim&month=${MONTH}&editing_entry=${entryId}`);
    const sheet = page.locator('.entry-mobile-sheet[aria-label="Edit entry"]');
    await expect(sheet).toBeVisible({ timeout: 60_000 });
    await page.getByRole("textbox", { name: "Description" }).fill("A11y entry, changed");
    await swipeDown(page, ".entry-mobile-sheet");
    const confirm = page.getByRole("alertdialog", { name: "Discard changes?" });
    await expect(confirm).toBeVisible();
    await settleAnimations(page);

    const keep = confirm.getByRole("button", { name: "Keep editing" });
    const discard = confirm.getByRole("button", { name: "Discard" });
    await expect(keep).toBeFocused();
    // Tab loops: Keep editing is last, so Tab wraps to Discard and back.
    await page.keyboard.press("Tab");
    await expect(discard).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(keep).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(discard).toBeFocused();
    expect(await axeViolations(page, { include: ".sheet-discard-confirm" }), "the open question").toEqual([]);

    // Escape keeps editing: the sheet and its draft stay.
    await page.keyboard.press("Escape");
    await expect(confirm).toHaveCount(0);
    await expect(sheet).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Description" })).toHaveValue("A11y entry, changed");

    // Negative: the form behind is unreachable while the question is up.
    await swipeDown(page, ".entry-mobile-sheet");
    await expect(confirm).toBeVisible();
    for (let press = 0; press < 4; press += 1) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest(".sheet-discard-confirm")))).toBe(true);
    }
  });
});

test.describe("sheets take focus on open and give it back", () => {
  test("Summary: Pick a month, View and scope", async ({ page }) => {
    await page.goto("/summary?view=person-tim&month=2026-04");
    await waitUsable(page);
    const monthControl = page.locator(".mobile-month-choice").first();
    await monthControl.focus();
    await page.keyboard.press("Enter");
    const sheet = page.getByRole("dialog", { name: "Pick a month" });
    await expect(sheet).toBeVisible();
    await settleAnimations(page);
    expect(await axeViolations(page), "Pick a month sheet").toEqual([]);
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(monthControl).toBeFocused();

    // Picking a month changes the control, so focus goes to the page's main
    // landmark rather than to the page itself.
    await monthControl.focus();
    await page.keyboard.press("Enter");
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: /^May/ }).click();
    await expect(sheet).toHaveCount(0);
    await expect.poll(() => activeElementName(page)).not.toBe("BODY");

    // View and scope: focus enters the sheet, Escape returns it.
    const scope = page.locator(".mobile-context-trigger");
    await scope.focus();
    await page.keyboard.press("Enter");
    const scopeSheet = page.getByRole("dialog", { name: "View and scope" });
    await expect(scopeSheet).toBeVisible();
    await expect(scopeSheet).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(scopeSheet).toHaveCount(0);
    await expect(scope).toBeFocused();
  });

  test("Splits: All groups and Create group", async ({ page }) => {
    await page.goto(`/splits?view=person-tim&month=${MONTH}`);
    await waitUsable(page);
    const all = page.locator(".splits-strip-all");
    await all.focus();
    await page.keyboard.press("Enter");
    const sheet = page.getByRole("dialog", { name: "All groups" });
    await expect(sheet).toBeVisible();
    await expect(sheet).toBeFocused();
    await settleAnimations(page);
    expect(await axeViolations(page), "All groups sheet").toEqual([]);
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(all).toBeFocused();

    const create = page.locator(".splits-strip-new");
    await create.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Create group" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(create).toBeFocused();
  });

  test("Entries: the category picker sheet takes focus and Escape closes only it", async ({ page }) => {
    const { entryId } = await postJson(page, "/api/entries/create", {
      date: `${MONTH}-24`, description: "A11y entry", accountName: "UOB One", categoryName: "Groceries", amountMinor: 3210,
      entryType: "expense", ownershipType: "direct", ownerName: "Tim"
    });
    await page.goto(`/entries?view=person-tim&month=${MONTH}&editing_entry=${entryId}`);
    const sheet = page.locator('.entry-mobile-sheet[aria-label="Edit entry"]');
    await expect(sheet).toBeVisible({ timeout: 60_000 });
    expect(await axeViolations(page), "Edit entry sheet").toEqual([]);
    const row = sheet.locator('[data-row="category"]');
    await row.focus();
    await page.keyboard.press("Enter");
    const picker = page.getByRole("dialog", { name: "Category" });
    await expect(picker).toBeVisible();
    await expect(picker).toBeFocused();
    await settleAnimations(page);
    expect(await axeViolations(page), "category picker sheet").toEqual([]);
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    await expect(sheet).toBeVisible();
    await expect(row).toBeFocused();
  });
});

test.describe("the Splits strip for assistive technology", () => {
  test("the tiles are a named group, the floating bar says the group and what it opens, axe is clean", async ({ page }) => {
    await page.goto(`/splits?view=person-tim&month=${MONTH}`);
    await waitUsable(page);
    await settleAnimations(page);
    expect(await axeViolations(page), "Splits phone").toEqual([]);
    await expect(page.locator(".splits-strip").getByRole("group", { name: "Split groups" }).getByRole("button").first()).toBeVisible();

    // Scrolled past the strip, the floating bar names the open group and "All groups".
    const groupName = await page.locator(".splits-strip-tile.is-active .splits-strip-tile-name").innerText();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const bar = page.locator(".splits-group-bar");
    await expect(bar).toBeVisible();
    await expect(bar).toHaveAccessibleName(new RegExp(`${groupName}.*All groups`));
    // Negative: the strip's own All button keeps the plain name.
    await expect(page.locator(".splits-strip-all")).toHaveAccessibleName("All groups");
  });
});
