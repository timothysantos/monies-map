import { devices, expect, test } from "@playwright/test";

import { gotoPageAfterApi, reseedDemo } from "./helpers";

// While a sheet, a dialog or an inline editor is open on a phone, the page
// hides the controls that would sit on top of it or pull the person away:
// the tab strip, the sticky View and scope bar, the floating add and totals
// buttons and the floating Splits group row. They come back when it closes.
// The Splits page also paints its own background on a phone.
//
// These rules used to be `body:has(...)` selectors. They are now scoped so
// that a style change does not search the whole page (see "Mobile Sheet" in
// design.md); this spec pins the visible behaviour they must keep.

const iPhone = devices["iPhone 12 Pro"].viewport;

function displayOf(locator) {
  return locator.evaluate((element) => getComputedStyle(element).display);
}

test.describe("page chrome while editing on a phone", () => {
  test.use({ viewport: iPhone });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.goto("/");
    await reseedDemo(page);
  });

  test("the Entries edit sheet hides the tab strip and the sticky scope bar until it closes", async ({ page }) => {
    await gotoPageAfterApi(
      page,
      "/entries?view=person-tim&month=2026-04",
      "/api/entries-page",
      () => page.locator(".mobile-context-sticky-wrap")
    );
    const tabStrip = page.locator("nav.tab-strip");
    const stickyBar = page.locator(".mobile-context-sticky-wrap");
    const shell = page.locator("main.shell");
    const sheet = page.locator(".entry-mobile-sheet");
    await expect(tabStrip).toBeVisible();
    await expect(stickyBar).toBeVisible();
    const closedPadding = await shell.evaluate((element) => getComputedStyle(element).paddingBottom);

    await page.locator(".entry-row").nth(2).locator(".entry-row-main").click();
    await expect(sheet).toBeVisible();
    await expect(tabStrip).toBeHidden();
    await expect(stickyBar).toBeHidden();
    // The page gets room below it, so the edited row can scroll above the sheet.
    const openPadding = await shell.evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingBottom));
    expect(openPadding).toBeGreaterThan(Number.parseFloat(closedPadding) + 100);
    // The floating add button stays; the sheet's backdrop covers it.
    await expect(page.locator(".entries-fab")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(tabStrip).toBeVisible();
    await expect(stickyBar).toBeVisible();
    await expect.poll(() => shell.evaluate((element) => getComputedStyle(element).paddingBottom)).toBe(closedPadding);
  });

  test("the Month plan sheet hides the tab strip until it closes", async ({ page }) => {
    await gotoPageAfterApi(
      page,
      "/month?view=person-tim&month=2026-05&scope=direct_plus_shared",
      "/api/month-page",
      () => page.getByRole("button", { name: "+ Add planned item" })
    );
    const tabStrip = page.locator("nav.tab-strip");
    const sheet = page.locator('.entry-mobile-sheet[aria-label="+ Add planned item"]');
    await expect(tabStrip).toBeVisible();

    await page.getByRole("button", { name: "+ Add planned item" }).click();
    await expect(sheet).toBeVisible();
    await expect(tabStrip).toBeHidden();

    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(tabStrip).toBeVisible();
  });

  test("a dialog hides the floating add and totals buttons and the sticky scope bar until it closes", async ({ page }) => {
    await gotoPageAfterApi(
      page,
      "/entries?view=person-tim&month=2026-04",
      "/api/entries-page",
      () => page.locator(".mobile-context-sticky-wrap")
    );
    const addButton = page.locator(".entries-fab:not(.splits-fab)");
    const totalsButton = page.locator(".totals-visibility-toggle--floating");
    const stickyBar = page.locator(".mobile-context-sticky-wrap");
    const tabStrip = page.locator("nav.tab-strip");
    await expect(addButton).toBeVisible();
    await expect(totalsButton).toBeVisible();

    await stickyBar.locator(".mobile-context-trigger").click();
    const dialog = page.locator(".mobile-context-dialog");
    await expect(dialog).toBeVisible();
    await expect(addButton).toBeHidden();
    await expect(totalsButton).toBeHidden();
    await expect(stickyBar).toBeHidden();
    // A dialog, unlike a sheet or an inline editor, keeps the tab strip.
    await expect(tabStrip).toBeVisible();

    await page.locator(".mobile-context-dialog-close").click();
    await expect(dialog).toHaveCount(0);
    await expect(addButton).toBeVisible();
    await expect(totalsButton).toBeVisible();
    await expect(stickyBar).toBeVisible();
  });

  test("a Splits dialog hides the floating totals button and group row, and Splits keeps its own background", async ({ page }) => {
    await gotoPageAfterApi(
      page,
      "/splits?view=person-tim&month=2025-10&split_group=split-group-baby-river",
      "/api/splits-page",
      () => page.locator(".split-activity-card").filter({ hasText: "Family support" }).first()
    );
    const addButton = page.locator(".splits-fab");
    const totalsButton = page.locator(".totals-visibility-toggle--floating");
    const groupRow = page.locator(".splits-groups-row-floating");
    const splitsBackground = await page.evaluate(() => ({
      body: getComputedStyle(document.body).backgroundImage,
      shell: getComputedStyle(document.querySelector("main.shell")).backgroundImage
    }));
    expect(splitsBackground.body).toContain("linear-gradient");
    expect(splitsBackground.shell).toContain("linear-gradient");
    await expect(addButton).toBeVisible();
    await expect(totalsButton).toBeVisible();
    expect(await displayOf(groupRow)).not.toBe("none");

    // On a phone a split opens in a dialog, not inline.
    await page.locator(".split-activity-card").filter({ hasText: "Family support" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Edit split" });
    await expect(dialog).toBeVisible();
    await expect(totalsButton).toBeHidden();
    await expect.poll(() => displayOf(groupRow)).toBe("none");
    // Only the Entries add button gives way to a dialog.
    expect(await displayOf(addButton)).not.toBe("none");

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(totalsButton).toBeVisible();
    await expect.poll(() => displayOf(groupRow)).not.toBe("none");

    // Other pages keep the shared page background.
    await page.locator("nav.tab-strip").getByRole("link", { name: "Entries" }).click();
    await expect(page.locator(".entry-row").first()).toBeVisible();
    const entriesBackground = await page.evaluate(() => ({
      body: getComputedStyle(document.body).backgroundImage,
      shell: getComputedStyle(document.querySelector("main.shell")).backgroundImage
    }));
    expect(entriesBackground.body).not.toBe(splitsBackground.body);
    expect(entriesBackground.shell).not.toBe(splitsBackground.shell);
  });
});

// Inline editors open only in the wide layout, where the floating add button
// still shows. It gives way to the editor.
test.describe("page chrome while an inline editor is open", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await reseedDemo(page);
  });

  test("the Entries inline editor hides the floating add button until it closes", async ({ page }) => {
    await gotoPageAfterApi(
      page,
      "/entries?view=person-tim&month=2026-04",
      "/api/entries-page",
      () => page.locator(".entry-row").first()
    );
    const addButton = page.locator(".entries-fab");
    const row = page.locator(".entry-row").nth(2);
    await expect(addButton).toBeVisible();

    await row.locator(".entry-row-main").click();
    await expect(row.locator(".entry-inline-editor")).toBeVisible();
    await expect(addButton).toBeHidden();

    await row.getByRole("button", { name: "Cancel editing entry" }).click();
    await expect(page.locator(".entry-inline-editor")).toHaveCount(0);
    await expect(addButton).toBeVisible();
  });

  test("the Splits inline editor hides the floating add button until it closes", async ({ page }) => {
    await gotoPageAfterApi(
      page,
      "/splits?view=person-tim&month=2025-10&split_group=split-group-baby-river",
      "/api/splits-page",
      () => page.locator(".split-activity-card").filter({ hasText: "Family support" }).first()
    );
    const addButton = page.locator(".splits-fab");
    await expect(addButton).toBeVisible();

    await page.locator(".split-activity-card").filter({ hasText: "Family support" }).first().click();
    const editor = page.locator(".split-inline-editor-card");
    await expect(editor).toBeVisible();
    await expect(addButton).toBeHidden();

    await editor.getByRole("button", { name: "Cancel editing split" }).click();
    await expect(editor).toHaveCount(0);
    await expect(addButton).toBeVisible();
  });
});
