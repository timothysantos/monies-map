import { expect, test } from "@playwright/test";

import { gotoPageAfterApi, reseedDemo } from "./helpers";

// The Entries filter bar on a desktop (docs/flows/entries-flow.md "From and
// To"): adding the From and To fields (31f575bd) squeezed the older controls
// until their words were cut ("Merchan", "All wall...", "All cate..."). The
// older controls keep the room they had before, and the dates wrap onto a
// row of their own.
//
// Widths below were measured once on 31f575bd^ (the bar without From and To,
// demo data, 1 px of slack taken off): the search box and each of the wallet,
// category, type and trip controls. Never lower them to make a change pass.
// Note the search placeholder was already longer than its box from 1,100 px
// before From and To (it needs about 246 px of text, the box showed 142), so
// the placeholder is checked for fit only below 1,100 px, where it fit.
const MIN_WIDTHS = {
  961: { search: 689, control: 162 },
  1024: { search: 752, control: 178 },
  1100: { search: 197, control: 131 },
  1280: { search: 224, control: 149 },
  1440: { search: 224, control: 149 },
  1680: { search: 224, control: 149 }
};
const WIDTHS = Object.keys(MIN_WIDTHS).map(Number);

async function measure(page) {
  return page.evaluate(() => {
    const bar = document.querySelector(".entries-filter-bar");
    const width = (selector) => bar.querySelector(selector)?.getBoundingClientRect().width ?? 0;
    const ctx = document.createElement("canvas").getContext("2d");
    const search = bar.querySelector(".search-filter-input");
    const style = getComputedStyle(search);
    ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const room = search.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const labels = [...bar.querySelectorAll(".entries-filter-multiselect-value, .entries-filter-trip-button > span, .entries-filter select")].map((el) => ({
      text: el.textContent?.trim() || "",
      cut: el.scrollWidth > el.clientWidth + 1
    }));
    const days = bar.querySelector('[data-filter-target="days"]');
    return {
      search: width(".search-filter-input"),
      wallet: width('[data-filter-target="wallet"] button'),
      category: width('[data-filter-target="category"] button'),
      type: width('[data-filter-target="type"] select, [data-filter-target="type"] button'),
      trip: width('[data-filter-target="trip"] button'),
      placeholderNeeds: ctx.measureText(search.placeholder).width,
      room,
      labels,
      daysTop: days ? days.getBoundingClientRect().top : null,
      searchTop: search.getBoundingClientRect().top,
      barRight: bar.getBoundingClientRect().right,
      daysRight: days ? days.getBoundingClientRect().right : null,
      scrollsSideways: document.documentElement.scrollWidth > window.innerWidth
    };
  });
}

async function openEntries(page, width) {
  await page.setViewportSize({ width, height: 900 });
  await gotoPageAfterApi(page, "/entries?view=household", "/api/entries-page", () => page.locator(".entry-row").first());
  const toggle = page.locator(".entries-filter-toggle");
  if (await toggle.isVisible()) await toggle.click();
  await expect(page.locator('[data-filter-target="days"]')).toBeVisible();
}

test.describe("Entries filter bar on a desktop", () => {
  test.beforeEach(async ({ page }) => {
    await reseedDemo(page);
  });

  for (const width of WIDTHS) {
    test(`${width} px: every older control keeps its old width, reads whole, and the dates wrap below`, async ({ page }) => {
      await openEntries(page, width);
      const m = await measure(page);
      const min = MIN_WIDTHS[width];

      expect(m.search, "search box is narrower than before From and To").toBeGreaterThanOrEqual(min.search);
      for (const name of ["wallet", "category", "type", "trip"]) {
        expect(m[name], `${name} is narrower than before From and To`).toBeGreaterThanOrEqual(min.control);
      }
      if (width < 1100) expect(m.placeholderNeeds, "search placeholder is cut").toBeLessThanOrEqual(m.room);
      expect(m.labels.length).toBeGreaterThan(2);
      // At exactly 1,100 px "All trips & events" (132 px box) was already
      // cut before From and To; every other width read whole.
      const cut = m.labels.filter((label) => label.cut && !(width === 1100 && label.text === "All trips & events"));
      expect(cut, "a filter label is cut").toEqual([]);
      // The dates sit under the search, never beside it taking its room.
      expect(m.daysTop).toBeGreaterThan(m.searchTop + 20);
      expect(m.daysRight).toBeLessThanOrEqual(m.barRight);
      expect(m.scrollsSideways).toBe(false);
    });
  }
});
