import { devices, expect, test } from "@playwright/test";

import { gotoPageAfterApi, reseedDemo } from "./helpers";

// Leaving Ask after the Entries + or the Splits receipt button opened it on
// a phone (docs/flows/ask-flow.md "Back to where you were"): the header's
// back link and the phone's back gesture (history.back) both return to the
// page exactly as it was (its URL with the month, view, scope and filters,
// the scroll position, and an edit sheet with its draft); a card that was
// started stays in the conversation store, with the Ask tab's dot, and is
// there on return. Runs in Chromium at a phone width and in WebKit on an
// iPhone 13 (@webkit, playwright.webkit.config.js).

const iPhone = devices["iPhone 12 Pro"].viewport;
const MONTH = "2026-05";
// 16 expense rows on the demo data's newest month: a list that scrolls.
const ENTRIES_PATH = `/entries?view=household&month=${MONTH}&scope=direct_plus_shared&entry_type=expense`;
const SPLITS_PATH = "/splits?view=person-tim&month=2025-10&split_group=split-group-baby-river";
const SCROLL_TOLERANCE = 40;

const addButton = (page) => page.locator(".entries-fab:not(.splits-fab)");
const headerBack = (page, label) => page.locator(".ask-head").getByRole("link", { name: `Back to ${label}` });
const suggestions = (page) => page.getByRole("group", { name: "Suggestions" });

async function openEntries(page) {
  await gotoPageAfterApi(page, ENTRIES_PATH, "/api/entries-page", () => page.locator(".entry-row").first());
  await expect(page.locator(".entry-row")).toHaveCount(16);
  await expect(addButton(page)).toBeVisible();
}

// Scrolls the window part way down the list and waits for it to settle.
async function scrollDown(page, wanted = 520) {
  const top = await page.evaluate((target) => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo({ top: Math.min(target, max - 20), behavior: "instant" });
    return window.scrollY;
  }, wanted);
  expect(top).toBeGreaterThan(200);
  await page.waitForTimeout(150);
  return page.evaluate(() => window.scrollY);
}

async function expectScrollNear(page, top) {
  await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 5_000 })
    .toBeGreaterThan(top - SCROLL_TOLERANCE);
  const now = await page.evaluate(() => window.scrollY);
  expect(Math.abs(now - top)).toBeLessThanOrEqual(SCROLL_TOLERANCE);
}

async function openAskFromEntries(page) {
  await addButton(page).click();
  await expect(page).toHaveURL(/\/ask\?.*mode=add.*from=entries/);
  await expect(page.locator('[data-ask-card="draft"]')).toBeVisible();
}

test.describe("leaving Ask back to where the person was, on a phone", { tag: "@webkit" }, () => {
  test.use({ viewport: iPhone });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.goto("/");
    await reseedDemo(page);
  });

  test("the header's back link returns to the same filtered list at the same place", async ({ page }) => {
    await openEntries(page);
    const before = page.url();
    const top = await scrollDown(page);

    await openAskFromEntries(page);
    // The back link sits at the header's top left, above the title; the
    // chip row's "‹ Entries" stays while the card is untouched.
    const back = headerBack(page, "Entries");
    await expect(back).toBeVisible();
    await expect(back).toHaveText("‹ Entries");
    const backBox = await back.boundingBox();
    const titleBox = await page.getByRole("heading", { name: "New entry" }).boundingBox();
    expect(backBox.y + backBox.height).toBeLessThanOrEqual(titleBox.y + 2);
    expect(backBox.x).toBeLessThan(40);
    expect(backBox.height).toBeGreaterThanOrEqual(44);
    await expect(suggestions(page).getByRole("button").first()).toHaveText("‹ Entries");

    await back.click();
    await expect(page).toHaveURL(before);
    await expect(page.locator(".entry-row")).toHaveCount(16);
    await expectScrollNear(page, top);
    // An untouched card leaves nothing in progress: no dot on the Ask tab.
    await expect(page.locator("nav.tab-strip").getByRole("link", { name: "Ask", exact: true })).toBeVisible();
    await expect(page.locator(".tab-dot")).toHaveCount(0);
  });

  test("the back gesture (history.back) returns the same way, and the chip row's ‹ Entries does too", async ({ page }) => {
    await openEntries(page);
    const before = page.url();
    const top = await scrollDown(page);

    await openAskFromEntries(page);
    await page.evaluate(() => window.history.back());
    await expect(page).toHaveURL(before);
    await expect(page.locator(".entry-row")).toHaveCount(16);
    await expectScrollNear(page, top);

    // Forward again is the Ask page; the chip's way back is the same.
    const second = await scrollDown(page, 360);
    await openAskFromEntries(page);
    await suggestions(page).getByRole("button", { name: "‹ Entries" }).click();
    await expect(page).toHaveURL(before);
    await expectScrollNear(page, second);
    // The + pushed a real history entry, and the way back went back to it:
    // forward is the Ask page again.
    await page.goForward();
    await expect(page).toHaveURL(/\/ask\?.*mode=add.*from=entries/);
  });

  test("a half-filled card is kept: the Ask tab shows the dot and the card is there on return", async ({ page }) => {
    await openEntries(page);
    const before = page.url();
    await openAskFromEntries(page);
    await page.getByRole("textbox", { name: "Amount" }).fill("23.40");
    await page.getByRole("textbox", { name: "What it was" }).fill("Half-filled kopi");
    // Once the card is started, the chip row drops "‹ Entries"; the header
    // link stays, far from Save.
    await expect(suggestions(page).getByRole("button", { name: "‹ Entries" })).toHaveCount(0);
    await expect(headerBack(page, "Entries")).toBeVisible();

    await headerBack(page, "Entries").click();
    // No confirm dialog: straight back, with the card kept.
    await expect(page).toHaveURL(before);
    await expect(page.locator(".entry-row").first()).toBeVisible();
    const askTab = page.getByRole("link", { name: "Ask, conversation in progress" });
    await expect(askTab).toBeVisible();
    await expect(page.locator(".tab-dot")).toBeVisible();

    await askTab.click();
    await expect(page).toHaveURL(/\/ask\?.*mode=add.*from=entries/);
    await expect(page.getByRole("textbox", { name: "Amount" })).toHaveValue("23.40");
    await expect(page.getByRole("textbox", { name: "What it was" })).toHaveValue("Half-filled kopi");
    // Reopened from the tab, the back link still goes to Entries as it was.
    await headerBack(page, "Entries").click();
    await expect(page).toHaveURL(before);
  });

  test("an edit sheet open when Ask opened comes back with its draft", async ({ page }) => {
    await openEntries(page);
    const before = page.url();
    await page.locator(".entry-row").filter({ hasText: "Vivify" }).first().click();
    const sheet = page.locator('.entry-mobile-sheet[aria-label="Edit entry"]');
    await expect(sheet).toBeVisible();
    const draft = `Sheet draft ${Date.now()}`;
    await sheet.getByLabel("Description").fill(draft);

    // On a phone the sheet's backdrop covers the + (page-chrome-while-
    // editing.spec.js), so it is pressed directly: whatever opens Ask while
    // a sheet is open, the sheet and its draft are part of the place kept.
    await addButton(page).dispatchEvent("click");
    await expect(page).toHaveURL(/\/ask\?.*mode=add.*from=entries/);
    await expect(sheet).toHaveCount(0);

    await headerBack(page, "Entries").click();
    await expect(page).toHaveURL(before);
    await expect(sheet).toBeVisible();
    await expect(sheet.getByLabel("Description")).toHaveValue(draft);
    // Close still discards the draft back to the saved entry.
    await sheet.getByRole("button", { name: "Close" }).click();
    await expect(sheet).toHaveCount(0);
    await expect(page.locator(".entry-row").filter({ hasText: draft })).toHaveCount(0);
    await expect(page.locator(".entry-row").filter({ hasText: "Vivify" }).first()).toBeVisible();
  });

  test("the Splits receipt button's way back returns to the same group and place", async ({ page }) => {
    await gotoPageAfterApi(page, SPLITS_PATH, "/api/splits-page", () => page.locator(".splits-fab"));
    await expect(page.locator(".split-activity-card").first()).toBeVisible();
    const before = page.url();
    const top = await page.evaluate(() => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo({ top: Math.max(0, Math.min(300, max - 20)), behavior: "instant" });
      return window.scrollY;
    });

    await page.locator(".splits-fab").click();
    await expect(page).toHaveURL(/\/ask\?.*mode=expense.*from=splits.*split_group=split-group-baby-river/);
    await expect(headerBack(page, "Splits")).toHaveText("‹ Splits");
    await headerBack(page, "Splits").click();
    await expect(page).toHaveURL(before);
    await expect(page.locator(".split-activity-card").first()).toBeVisible();
    await expectScrollNear(page, top);

    // And by the back gesture.
    await page.locator(".splits-fab").click();
    await expect(page).toHaveURL(/\/ask\?.*from=splits/);
    await page.goBack();
    await expect(page).toHaveURL(before);
    await expectScrollNear(page, top);
  });

  test("with no page to go back to (an /ask link opened directly), the back link opens Entries for the same view and month", async ({ page }) => {
    await page.goto(`/ask?view=household&month=${MONTH}&scope=direct_plus_shared&mode=add&from=entries`);
    await expect(page.locator('[data-ask-card="draft"]')).toBeVisible({ timeout: 30_000 });
    await headerBack(page, "Entries").click();
    await expect(page).toHaveURL(/\/entries\?/);
    const url = new URL(page.url());
    expect(url.searchParams.get("view")).toBe("household");
    expect(url.searchParams.get("month")).toBe(MONTH);
    expect(url.searchParams.get("entry_type")).toBeNull();
    await expect(page.locator(".entry-row").first()).toBeVisible();
  });
});
