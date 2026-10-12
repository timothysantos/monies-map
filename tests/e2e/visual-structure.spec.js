import { expect, test } from "@playwright/test";

import { reseedDemo } from "./helpers";

// The desktop chrome (design.md "Desktop Chrome") shares one set of tokens:
// a 36 px control height, a 10 px control radius, a 14 px group radius and
// one 1.7 rem page title. These specs pin the computed values, not the CSS,
// at the three desktop layouts the header has to survive: a wide window, a
// 1,280 px window with the Ask panel docked (a 920 px page) and 1,024 px.

const LAYOUTS = [
  { name: "1,440 px", width: 1440, docked: false },
  { name: "1,280 px with Ask docked", width: 1280, docked: true },
  { name: "1,024 px", width: 1024, docked: false }
];

const TITLE_PAGES = [
  "/summary?view=household&month=2026-05",
  "/entries?view=person-tim&month=2026-04",
  "/splits?view=household&month=2026-05",
  "/imports?view=household&month=2026-05",
  "/settings?view=household&month=2026-05"
];

async function setLayout(page, { width, docked }, { moneyVisible = true } = {}) {
  await page.evaluate(([open, visible]) => {
    window.sessionStorage.setItem("monies.askDock.v1", JSON.stringify({ version: 1, open, mode: "docked", intent: { mode: "chat", from: "", savedEntryId: "", splitGroupId: "" } }));
    window.localStorage.setItem("monies-map:money-totals-visible", String(visible));
  }, [docked, moneyVisible]);
  await page.setViewportSize({ width, height: 800 });
}

async function openPage(page, path, { docked = false } = {}) {
  await page.goto(path);
  await expect(page.locator("nav.tab-strip > a.tab").first()).toBeVisible();
  await expect(page.locator(".period-display")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".app-loading-overlay, .app-loading-status")).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  if (docked) await expect(page.locator(".ask-dock.is-docked")).toBeVisible();
}

// The colour a CSS colour expression computes to, so a token built with
// color-mix compares equal to what an element paints with it.
function computedColour(page, expression) {
  return page.evaluate((value) => {
    const probe = document.createElement("span");
    probe.style.backgroundColor = value;
    document.body.append(probe);
    const colour = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return colour;
  }, expression);
}

const WHITE = "rgb(255, 255, 255)";

test.describe("desktop chrome tokens", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await reseedDemo(page);
  });

  test("the pills, tabs, period buttons, period box and eye are one 36 px control height with the 10 px radius", async ({ page }) => {
    for (const layout of LAYOUTS) {
      await setLayout(page, layout);
      for (const path of ["/summary?view=household&month=2026-05", "/entries?view=person-tim&month=2026-04"]) {
        await openPage(page, path, layout);
        const where = `${path} at ${layout.name}`;
        const measured = await page.evaluate(() => {
          const read = (element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return { height: Math.round(rect.height * 10) / 10, radius: style.borderTopLeftRadius, fontSize: style.fontSize };
          };
          const visible = (selector) => [...document.querySelectorAll(selector)].filter((element) => element.offsetParent);
          return {
            pillRow: read(document.querySelector(".context-block .pill-row")),
            tabs: visible("nav.tab-strip > a.tab").map(read),
            period: ["Previous period", "Next period"].map((label) => read(document.querySelector(`[aria-label="${label}"]`))),
            display: read(document.querySelector(".period-display")),
            eye: read(document.querySelector(".totals-visibility-toggle--header"))
          };
        });
        expect(measured.pillRow.height, where).toBe(36);
        expect(measured.tabs.length, where).toBeGreaterThanOrEqual(3);
        for (const tab of measured.tabs) {
          expect(tab.height, `${where}: a tab`).toBe(36);
          expect(tab.radius, `${where}: a tab`).toBe("10px");
        }
        for (const control of [...measured.period, measured.display, measured.eye]) {
          expect(control.height, `${where}: a period control`).toBe(36);
          expect(control.radius, `${where}: a period control`).toBe("10px");
        }
        // The group the pills sit in has the larger group radius.
        expect(measured.pillRow.radius, where).toBe("14px");
        expect(measured.tabs[0].fontSize, where).toBe("14px");
      }
    }
  });

  test("the active person view is that person's colour and Household is raised white", async ({ page }) => {
    const tim = await computedColour(page, "color-mix(in srgb, #33A471 16%, white)");
    expect(tim).not.toBe(WHITE);
    for (const layout of LAYOUTS) {
      await setLayout(page, layout);
      await openPage(page, "/entries?view=person-tim&month=2026-04", layout);
      const where = `Tim at ${layout.name}`;
      const active = page.locator(".context-block .pill.is-active");
      await expect(active, where).toHaveText("Tim");
      await expect(active, where).toHaveCSS("background-color", tim);
      await expect(active, where).toHaveCSS("font-weight", "600");
      // An inactive view stays on the grey track with no fill of its own.
      const inactive = page.locator(".context-block .pill:not(.is-active)").first();
      await expect(inactive, where).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await expect(page.locator(".context-block .pill-row"), where).toHaveCSS("background-color", await computedColour(page, "rgba(38, 35, 31, 0.05)"));

      await openPage(page, "/summary?view=household&month=2026-05", layout);
      const household = page.locator(".context-block .pill.is-active");
      await expect(household, `Household at ${layout.name}`).toHaveText("Household");
      await expect(household, `Household at ${layout.name}`).toHaveCSS("background-color", WHITE);
    }
  });

  test("every page title is the same 1.7 rem, and Month's name is ink, not terracotta", async ({ page }) => {
    for (const layout of LAYOUTS) {
      await setLayout(page, layout);
      for (const path of TITLE_PAGES) {
        await openPage(page, path, layout);
        const title = page.locator(".panel-head h2").first();
        await expect(title, `${path} at ${layout.name}`).toBeVisible();
        await expect(title, `${path} at ${layout.name}`).toHaveCSS("font-size", "27.2px");
      }
      await openPage(page, "/month?view=person-tim&month=2026-05", layout);
      const monthName = page.locator(".panel-head .month-label-period").first();
      await expect(monthName, layout.name).toBeVisible();
      await expect(monthName, layout.name).toHaveCSS("font-size", "27.2px");
      await expect(monthName, layout.name).toHaveCSS("color", await computedColour(page, "rgb(38, 35, 31)"));
    }
  });

  test("the scope switch and the month row are quiet: the selected one is white, not terracotta", async ({ page }) => {
    for (const layout of LAYOUTS) {
      await setLayout(page, layout);
      const where = layout.name;

      await openPage(page, "/entries?view=person-tim&month=2026-04", layout);
      const scope = page.locator(".desktop-scope-toggle");
      await expect(scope, where).toHaveCSS("background-color", await computedColour(page, "rgba(38, 35, 31, 0.05)"));
      const selected = scope.locator(".pill.is-active");
      await expect(selected, where).toHaveCount(1);
      await expect(selected, where).toHaveCSS("background-color", WHITE);
      const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent-strong").trim());
      expect(await selected.evaluate((element) => getComputedStyle(element).color), where).not.toBe(await computedColour(page, accent));

      await openPage(page, "/summary?view=person-tim&month=2026-05", layout);
      const row = page.locator(".summary-focus-button.is-active");
      await expect(row, where).toHaveCount(1);
      await expect(row, where).toHaveCSS("background-color", WHITE);
      await expect(row, where).toHaveCSS("font-weight", "600");
      await expect(page.locator(".summary-focus-button:not(.is-active)").first(), where).toHaveCSS("background-color", await computedColour(page, "rgba(38, 35, 31, 0.05)"));
    }
  });

  test("the Entries strip is a 14 px group with Spend as the larger key figure", async ({ page }) => {
    for (const layout of LAYOUTS) {
      await setLayout(page, layout);
      await openPage(page, "/entries?view=person-tim&month=2026-04", layout);
      const where = layout.name;
      const strip = page.locator(".entries-totals-strip");
      await expect(strip, where).toHaveCSS("border-radius", "14px");
      const sizes = await page.evaluate(() => {
        const [first, ...rest] = [...document.querySelectorAll(".entries-totals-strip > .entries-totals-item")].map((item) => parseFloat(getComputedStyle(item.querySelector("strong")).fontSize));
        return { first, rest };
      });
      expect(sizes.first, where).toBeGreaterThan(Math.max(...sizes.rest));
      expect(sizes.rest.length, where).toBeGreaterThanOrEqual(3);
    }
  });

  // Audit items: on a page narrowed by the docked panel or a 1,024 px window
  // nothing may be clipped at the page edge (the Entries totals, the Summary
  // month row), and the Entries search keeps a usable width.
  test("a narrow desktop page clips nothing: Entries totals, search and the Summary month row", async ({ page }) => {
    for (const layout of LAYOUTS.filter((item) => item.width < 1440)) {
      await setLayout(page, layout);
      const where = layout.name;

      await openPage(page, "/entries?view=person-tim&month=2026-04", layout);
      const entries = await page.evaluate(() => {
        const strip = document.querySelector(".entries-totals-strip");
        const search = document.querySelector(".entries-filter-bar .search-filter-input");
        const label = document.querySelector(".entries-filter-bar .search-filter .entries-filter-label");
        return {
          stripClipped: strip.scrollWidth > strip.clientWidth + 1,
          searchWidth: Math.round(search.getBoundingClientRect().width),
          labelAboveField: label.getBoundingClientRect().bottom <= search.getBoundingClientRect().top
        };
      });
      expect(entries.stripClipped, `${where}: Entries totals`).toBe(false);
      expect(entries.searchWidth, `${where}: Entries search`).toBeGreaterThanOrEqual(150);
      expect(entries.labelAboveField, `${where}: search label above the field`).toBe(true);

      await openPage(page, "/summary?view=household&month=2026-05", layout);
      const chips = await page.evaluate(() => {
        const edge = document.querySelector(".summary-month-selector").getBoundingClientRect().right;
        return [...document.querySelectorAll(".summary-month-selector .summary-focus-button")].map((chip) => chip.getBoundingClientRect().right <= edge + 0.5);
      });
      expect(chips.length, `${where}: month chips`).toBeGreaterThanOrEqual(13);
      expect(chips.filter((inside) => !inside), `${where}: month chips past the edge`).toEqual([]);
    }
  });

  // The period does not apply on Splits and Settings. It reads as a plain
  // label with dimmed arrows, not as a disabled box, and still takes no input.
  test("a period that does not apply is a plain label with dimmed, inert arrows", async ({ page }) => {
    for (const layout of LAYOUTS) {
      await setLayout(page, layout);
      for (const path of ["/splits?view=household&month=2026-05", "/settings?view=household&month=2026-05"]) {
        await openPage(page, path, layout);
        const where = `${path} at ${layout.name}`;
        const display = page.locator(".period-display");
        await expect(display, where).toHaveCSS("opacity", "1");
        await expect(display, where).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
        await expect(display, where).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
        for (const label of ["Previous period", "Next period"]) {
          const arrow = page.locator(`[aria-label="${label}"]`);
          await expect(arrow, where).toBeDisabled();
          expect(Number(await arrow.evaluate((element) => getComputedStyle(element).opacity)), `${where}: ${label}`).toBeLessThan(1);
        }
      }
      // Negative: a page that uses the period keeps its bordered box and live arrows.
      await openPage(page, "/entries?view=person-tim&month=2026-04", layout);
      await expect(page.locator(".period-display"), layout.name).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await expect(page.locator('[aria-label="Next period"]'), layout.name).toBeEnabled();
    }
  });

  // Negative: hiding money must not leave a figure, its sign or its tone
  // behind in the larger key figure.
  test("hidden money still shows dots, with no digits, in the Entries key figure", async ({ page }) => {
    for (const layout of LAYOUTS) {
      await setLayout(page, layout, { moneyVisible: false });
      await openPage(page, "/entries?view=person-tim&month=2026-04", layout);
      const where = layout.name;
      const key = page.locator(".entries-totals-strip > .entries-totals-item").first().locator("strong");
      await expect(key, where).toBeVisible();
      const text = (await key.innerText()).trim();
      expect(text, where).toMatch(/^[•·]+$/);
      expect(text, where).not.toMatch(/\d/);
      // No tone reveals its sign: the figure takes the plain ink.
      await expect(key, where).toHaveCSS("color", await computedColour(page, "rgb(38, 35, 31)"));
      await expect(page.locator(".entries-totals-strip"), where).not.toContainText(/\d/);
    }
  });
});
