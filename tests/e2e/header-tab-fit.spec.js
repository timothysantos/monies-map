import { expect, test } from "@playwright/test";

import { reseedDemo } from "./helpers";

// From 1,100 px the header is one row: view pills, page tabs and period
// controls side by side, as on a wide desktop. At desktop spacing that row
// needs about 1,160 px, so below 1,200 px its spacing tightens instead of
// the tab strip running under the "‹" button or the period controls moving
// to a second row (which pushed the page down). Every page has the same
// header, except that Imports, Settings and FAQ do not use a period and show
// no period controls. A wide desktop and a phone keep their own header
// unchanged.

const PAGES = [
  "/summary?view=household&month=2026-05",
  "/month?view=person-tim&month=2026-05",
  "/entries?view=person-tim&month=2026-04",
  "/splits?view=household&month=2026-05",
  "/imports?view=household&month=2026-05",
  "/settings?view=household&month=2026-05",
  "/faq"
];
// Pages without a period show only the money toggle after the tabs.
const PAGES_WITHOUT_PERIOD = new Set(["/imports?view=household&month=2026-05", "/settings?view=household&month=2026-05", "/faq"]);

async function openPage(page, path) {
  await page.goto(path);
  await expect(page.locator("nav.tab-strip > a.tab").first()).toBeVisible();
  if (PAGES_WITHOUT_PERIOD.has(path)) {
    await expect(page.locator(".period-display")).toHaveCount(0);
  } else {
    await expect(page.locator(".period-display")).toBeVisible();
  }
  // The "Loading latest data" overlay sits over the period controls while a
  // page fetch runs; the header is read once the page has loaded.
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".app-loading-overlay, .app-loading-status")).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
}

// For each tab, whether a press at its left edge, centre and right edge
// reaches the tab itself; whether the period controls are reached at their
// centres; and where the header row's parts sit vertically.
function readHeader(page) {
  return page.evaluate(() => {
    const reaches = (element, x, y) => {
      const hit = document.elementFromPoint(x, y);
      return Boolean(hit && element.contains(hit));
    };
    const tabs = [...document.querySelectorAll("nav.tab-strip > a.tab")].filter((tab) => tab.offsetParent);
    const tabHits = tabs.map((tab) => {
      const rect = tab.getBoundingClientRect();
      const y = rect.top + rect.height / 2;
      return {
        name: tab.textContent.trim(),
        left: reaches(tab, rect.left + 1, y),
        centre: reaches(tab, rect.left + rect.width / 2, y),
        right: reaches(tab, rect.right - 1, y)
      };
    });
    const controlElements = ['[aria-label="Previous period"]', ".period-display", '[aria-label="Next period"]', ".totals-visibility-toggle--header"]
      .map((selector) => document.querySelector(selector))
      .filter((element) => element?.offsetParent);
    const controls = controlElements.map((element) => {
      const rect = element.getBoundingClientRect();
      return reaches(element, rect.left + rect.width / 2, rect.top + rect.height / 2);
    });
    const middle = (element) => {
      const rect = element.getBoundingClientRect();
      return Math.round(rect.top + rect.height / 2);
    };
    return {
      tabHits,
      controls,
      // The vertical centre of the pills, the tab strip and each period control.
      rowMiddles: [document.querySelector(".context-block .pill-row"), document.querySelector("nav.tab-strip"), ...controlElements].map(middle),
      headerHeight: document.querySelector(".control-bar").getBoundingClientRect().height,
      pageScrollsSideways: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
}

// The spacing rules the narrow-desktop header tightens.
function readHeaderSpacing(page) {
  return page.evaluate(() => {
    const style = (selector) => getComputedStyle(document.querySelector(selector));
    return {
      barGap: style(".control-bar").columnGap,
      pillPadding: style(".context-block .pill").paddingInline,
      stripGap: style("nav.tab-strip").columnGap,
      tabPadding: style("nav.tab-strip > a.tab").paddingInline,
      tabFontSize: style("nav.tab-strip > a.tab").fontSize,
      periodGap: style(".period-inline").columnGap,
      displayMinWidth: style(".period-display").minWidth,
      displayPadding: style(".period-display").paddingInline,
      displayGap: style(".period-display").columnGap
    };
  });
}

test.describe("header on a narrow desktop window", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await reseedDemo(page);
  });

  test("the header is one row with no tab covered from 1,100 to 1,279 px", async ({ page }) => {
    // The one-row header height of each page on a wide desktop.
    await page.setViewportSize({ width: 1440, height: 800 });
    const wideHeight = {};
    for (const path of PAGES) {
      await openPage(page, path);
      wideHeight[path] = (await readHeader(page)).headerHeight;
    }

    for (const width of [1100, 1120, 1200, 1279]) {
      await page.setViewportSize({ width, height: 800 });
      for (const path of PAGES) {
        await openPage(page, path);
        const where = `${path} at ${width} px`;
        const header = await readHeader(page);
        expect(header.tabHits.map((tab) => tab.name), where).toEqual(["Summary", "Month", "Entries", "Splits", "Imports", "Settings", "FAQ"]);
        expect(header.tabHits.filter((tab) => !tab.left || !tab.centre || !tab.right), where).toEqual([]);
        expect(header.controls, where).toEqual(PAGES_WITHOUT_PERIOD.has(path) ? [true] : [true, true, true, true]);
        // One row: the pills, the tabs and every period control share one
        // vertical centre, and the header is as tall as on a wide desktop.
        const [first, ...rest] = header.rowMiddles;
        expect(rest.map((middle) => Math.abs(middle - first) <= 2), where).toEqual(rest.map(() => true));
        expect(header.headerHeight, where).toBe(wideHeight[path]);
        expect(header.pageScrollsSideways, where).toBe(false);
      }
    }
  });

  // Linux's default sans fonts set text wider than the Mac's, which once made
  // the Month tables push the page sideways at 1,100 px on CI only. Extra
  // letter spacing widens text the same way on any OS. Money is shown, as it
  // is for most people, because amounts widen the table columns too. Below
  // 1,200 px the Month tables tighten so they fit whole: nothing scrolls
  // sideways and every note's edit icon stays fully on screen.
  test("with wider text no page scrolls sideways from 1,100 to 1,279 px", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("monies-map:money-totals-visible", "true");
      document.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style");
        style.textContent = "body, body * { letter-spacing: 0.05em !important; }";
        document.head.append(style);
      });
    });
    for (const width of [1100, 1120, 1200, 1279]) {
      await page.setViewportSize({ width, height: 800 });
      for (const path of PAGES) {
        await openPage(page, path);
        const where = `${path} at ${width} px`;
        expect((await readHeader(page)).pageScrollsSideways, where).toBe(false);
        if (path.startsWith("/month")) {
          const noteIcons = await page.evaluate(() => [...document.querySelectorAll(".month-table-wrap .note-trigger svg")].map((icon) => {
            const rect = icon.getBoundingClientRect();
            const wrap = icon.closest(".month-table-wrap").getBoundingClientRect();
            return rect.left >= wrap.left && rect.right <= wrap.right + 0.5 && rect.right <= document.documentElement.clientWidth;
          }));
          expect(noteIcons.length, where).toBeGreaterThan(10);
          expect(noteIcons.filter((inside) => !inside).length, `note edit icons cut off: ${where}`).toBe(0);
        }
      }
    }
  });

  test("a 1,440 px desktop and a 390 px phone keep their own header spacing", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 800 });
    await openPage(page, "/summary?view=household&month=2026-05");
    expect(await readHeaderSpacing(page)).toEqual({
      barGap: "16px",
      pillPadding: "18px",
      stripGap: "4px",
      tabPadding: "10px",
      tabFontSize: "14.72px",
      periodGap: "6px",
      displayMinWidth: "260px",
      displayPadding: "12px",
      displayGap: "10px"
    });
    expect((await readHeader(page)).headerHeight).toBe(70);

    await page.setViewportSize({ width: 390, height: 844 });
    await openPage(page, "/month?view=person-tim&month=2026-05");
    expect(await readHeaderSpacing(page)).toEqual({
      barGap: "10px",
      pillPadding: "10px",
      stripGap: "6px",
      tabPadding: "8px",
      tabFontSize: "13.76px",
      periodGap: "8px",
      displayMinWidth: "0px",
      displayPadding: "10px",
      displayGap: "10px"
    });
  });
});
