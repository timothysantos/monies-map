import { devices, expect, test } from "@playwright/test";

import { categoryList, categorySearch, gotoPageAfterApi, postJson, reseedDemo } from "./helpers";

// The category sheet on a phone with the keyboard up (design.md "Category
// list", "Sheets and the keyboard"). Playwright cannot raise the iOS keyboard,
// so an init script replaces window.visualViewport with a stand-in whose
// height the test sets (what iOS Safari does: the layout viewport stays, the
// visual viewport shrinks). The sheet must keep the same height whatever the
// result count, with the search field and rows above the keyboard.

const MONTH = "2026-05";
const { defaultBrowserType: _browser, ...iPhone13 } = devices["iPhone 13"];
// Layout height and keyboard height as on an iPhone SE, 8 and 13.
const PHONES = [
  { height: 568, keyboard: 260 },
  { height: 667, keyboard: 291 },
  { height: 844, keyboard: 336 }
];

async function fakeVisualViewport(page) {
  await page.addInitScript(() => {
    const target = new EventTarget();
    const viewport = { height: window.innerHeight, width: window.innerWidth, offsetTop: 0, offsetLeft: 0, scale: 1, pageTop: 0, pageLeft: 0 };
    viewport.addEventListener = target.addEventListener.bind(target);
    viewport.removeEventListener = target.removeEventListener.bind(target);
    Object.defineProperty(window, "visualViewport", { configurable: true, get: () => viewport });
    // @ts-ignore test hook
    window.__setKeyboard = (height) => {
      viewport.height = window.innerHeight - height;
      target.dispatchEvent(new Event("resize"));
    };
  });
}

async function openSheet(page) {
  const shop = `Zzyzx Studio ${Date.now()}`;
  await reseedDemo(page);
  await postJson(page, "/api/entries/create", {
    date: `${MONTH}-24`,
    description: shop,
    accountName: "UOB One",
    categoryName: "Other",
    amountMinor: 3210,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });
  const row = page.locator(".entry-row").filter({ hasText: shop }).first();
  await gotoPageAfterApi(page, `/entries?view=person-tim&month=${MONTH}`, "/api/entries-page", () => row);
  await row.locator(".entry-row-category-button").tap();
  await expect(categoryList(page)).toBeVisible();
}

const sheetBox = (page) => page.locator(".is-picker-sheet").boundingBox();

for (const phone of PHONES) {
  test.describe(`phone ${phone.height}px`, () => {
    test.use({ ...iPhone13, viewport: { width: 375, height: phone.height } });

    test("with the keyboard up the sheet keeps one height from many to 0 results, with the search and rows above the keyboard", async ({ page }) => {
      await fakeVisualViewport(page);
      await openSheet(page);
      await categorySearch(page).tap();
      await page.evaluate((height) => window.__setKeyboard(height), phone.keyboard);
      const keyboardTop = phone.height - phone.keyboard;
      const heights = [];
      for (const query of ["", "groc", "ho", "zzz"]) {
        await categorySearch(page).fill(query);
        const box = await sheetBox(page);
        heights.push(box.height);
        // The whole sheet sits in the visible area: top on screen, bottom on the keyboard.
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height).toBeLessThanOrEqual(keyboardTop + 2);
        const search = await categorySearch(page).boundingBox();
        expect(search.y).toBeGreaterThanOrEqual(box.y);
        expect(search.y + search.height).toBeLessThanOrEqual(keyboardTop);
        const header = await page.locator(".is-picker-sheet .mobile-select-head").boundingBox();
        expect(header.y).toBeGreaterThanOrEqual(0);
        if (query === "") {
          // At least four whole rows above the keyboard.
          const rows = await page
            .locator(".category-pick-row")
            .evaluateAll((nodes, top) => nodes.filter((node) => { const r = node.getBoundingClientRect(); return r.top >= 0 && r.bottom <= top; }).length, keyboardTop);
          expect(rows).toBeGreaterThanOrEqual(4);
        }
        if (query === "groc") {
          const first = await page.locator(".category-pick-row").first().boundingBox();
          expect(first.y + first.height).toBeLessThanOrEqual(keyboardTop);
          expect(first.height).toBeGreaterThanOrEqual(44);
        }
        if (query === "zzz") {
          const empty = await page.locator(".category-pick-empty").boundingBox();
          expect(empty.y + empty.height).toBeLessThanOrEqual(keyboardTop);
        }
      }
      expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(2);
      // The list scrolls inside the visible area.
      await categorySearch(page).fill("");
      const scroll = await page.locator(".category-pick-options").evaluate((node) => ({ client: node.clientHeight, scroll: node.scrollHeight }));
      expect(scroll.scroll).toBeGreaterThan(scroll.client);
    });

    test("with the keyboard down the sheet has one height too, and returns to it after the keyboard closes", async ({ page }) => {
      await fakeVisualViewport(page);
      await openSheet(page);
      const heights = [(await sheetBox(page)).height];
      await categorySearch(page).tap();
      await categorySearch(page).fill("groc");
      heights.push((await sheetBox(page)).height);
      await categorySearch(page).fill("zzz");
      heights.push((await sheetBox(page)).height);
      expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(2);
      const down = heights[0];
      await page.evaluate((height) => window.__setKeyboard(height), phone.keyboard);
      await page.evaluate(() => window.__setKeyboard(0));
      await expect.poll(async () => Math.abs((await sheetBox(page)).height - down)).toBeLessThanOrEqual(2);
      expect(down).toBeLessThanOrEqual(phone.height * 0.7 + 2);
    });
  });
}
