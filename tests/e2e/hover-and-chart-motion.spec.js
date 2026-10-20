import { devices, expect, test } from "@playwright/test";

import { reseedDemo } from "./helpers";

// Hover and chart motion (design.md "Motion"): rows and cards take a faint
// wash of their category colour under a mouse or keyboard focus, their
// category icon makes its category's move, and nothing sticks or moves on a
// touch screen; the Summary charts play once on first view (the donut sweeps
// in, the columns grow, the lines draw, the points pop) and end exactly
// where a still chart starts, without moving anything else on the page.
// Nothing moves for reduced motion. The tint's contrast is
// tests/colour-contrast.test.mjs; the rules are tests/row-motion.test.mjs.

const VIEW = "person-tim";
const MONTH = "2026-05";
const SUMMARY_URL = `/summary?view=${VIEW}&month=${MONTH}&scope=direct_plus_shared&summary_start=2025-06&summary_end=${MONTH}`;
const ENTRIES_URL = `/entries?view=${VIEW}&month=${MONTH}`;
const { defaultBrowserType: _browser, ...iPhone13 } = devices["iPhone 13"];

const CLEAR = "rgba(0, 0, 0, 0)";
const background = (locator) => locator.evaluate((node) => getComputedStyle(node).backgroundColor);
const glyphAnimation = (locator) => locator.evaluate((node) => getComputedStyle(node.querySelector(".category-icon svg")).animationName);

async function showMoney(page, lead = "plan") {
  await page.addInitScript((value) => {
    window.localStorage.setItem("monies-map:lead-view", value);
    window.localStorage.setItem("monies-map:money-totals-visible", "true");
  }, lead);
}

async function openEntries(page) {
  await page.goto(ENTRIES_URL);
  await expect(page.locator(".entry-row-main").first()).toBeVisible({ timeout: 30_000 });
}

// Points at a row once it has stopped moving (the cards above the list keep
// arriving for a moment after the rows show and push them down).
async function pointAt(page, row) {
  let last = "";
  await expect.poll(async () => {
    await row.scrollIntoViewIfNeeded();
    const box = JSON.stringify(await row.boundingBox());
    const still = box === last;
    last = box;
    return still;
  }, { intervals: [300] }).toBe(true);
  await row.hover({ position: { x: 400, y: 30 } });
  await expect.poll(() => row.evaluate((node) => node.matches(":hover"))).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await reseedDemo(page);
});

test.describe("rows on a desktop", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await showMoney(page);
  });

  test("an Entries row takes its category's wash under the pointer, its icon makes its move, and both go when the pointer leaves", async ({ page }) => {
    await openEntries(page);
    const food = page.locator('.entry-row-main[data-glyph="tilt"]').first();
    await expect(food).toBeVisible();
    await expect(food.locator(".entry-row-category strong")).toHaveText("Food & Drinks");
    expect(await food.getAttribute("style")).toMatch(/--row-tint: var\(--cat-[0-9a-f]{6}, #[0-9A-F]{6}\)/i);
    expect(await background(food)).toBe(CLEAR);
    await pointAt(page, food);
    await expect.poll(() => background(food)).toMatch(/\/ 0\.06\)$/);
    expect(await glyphAnimation(food)).toBe("glyph-tilt");
    await expect.poll(() => food.locator(".category-icon").evaluate((node) => getComputedStyle(node).transform)).toMatch(/matrix\(1, 0, 0, 1, 0, -1\.5\)/);
    await page.mouse.move(5, 5);
    await expect.poll(() => background(food)).toBe(CLEAR);
    expect(await glyphAnimation(food)).toBe("none");
  });

  test("each category flavours its icon's move; one without a move of its own pops", async ({ page }) => {
    await openEntries(page);
    const expected = { "Food & Drinks": "glyph-tilt", Bills: "glyph-shake", Savings: "glyph-rise", Transfer: "glyph-pop" };
    for (const [name, animation] of Object.entries(expected)) {
      const row = page.locator(".entry-row-main").filter({ has: page.locator(".entry-row-category strong", { hasText: new RegExp(`^${name.replace("&", "\\&")}$`) }) }).first();
      await row.scrollIntoViewIfNeeded();
      await page.mouse.move(5, 5);
      await pointAt(page, row);
      expect(await glyphAnimation(row), name).toBe(animation);
    }
  });

  test("the keyboard focus gets the same wash without the icon's move", async ({ page }) => {
    await openEntries(page);
    const row = page.locator(".entry-row-main").first();
    await row.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(row).toBeFocused();
    await expect.poll(() => background(row)).toMatch(/\/ 0\.06\)$/);
    expect(await glyphAnimation(row)).toBe("none");
  });

  test("Summary's Spending Mix rows, month cards and Month plan rows share the wash", async ({ page }) => {
    await page.goto(SUMMARY_URL);
    const mixRow = page.locator(".summary-mix-row.motion-row").first();
    await expect(mixRow).toBeVisible({ timeout: 30_000 });
    await mixRow.hover();
    await expect.poll(() => background(mixRow)).toMatch(/\/ 0\.06\)$/);
    expect(await mixRow.locator(".category-icon").evaluate((node) => getComputedStyle(node, "::before").animationName)).toBe("glyph-pop");
    const card = page.locator(".summary-intent-month.motion-row").first();
    await card.scrollIntoViewIfNeeded();
    const rest = await background(card);
    await card.hover({ position: { x: 20, y: 20 } });
    await expect.poll(() => background(card)).not.toBe(rest);
    await page.goto(`/month?view=${VIEW}&month=${MONTH}&scope=direct_plus_shared`);
    const planRow = page.locator(".month-table-wrap tbody tr.motion-row").first();
    await expect(planRow).toBeVisible({ timeout: 30_000 });
    await planRow.hover();
    await expect.poll(() => background(planRow)).toMatch(/\/ 0\.06\)$/);
  });

  test("reduced motion keeps the wash and drops every move", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openEntries(page);
    const food = page.locator('.entry-row-main[data-glyph="tilt"]').first();
    await pointAt(page, food);
    expect(await background(food)).toMatch(/\/ 0\.06\)$/);
    expect(await glyphAnimation(food)).toBe("none");
    expect(await food.locator(".category-icon").evaluate((node) => getComputedStyle(node).transform)).toBe("none");
    expect(await food.evaluate((node) => getComputedStyle(node).transitionDuration)).toBe("0s");
  });
});

test.describe("rows on a touch screen", () => {
  test.use(iPhone13);

  test("there is no hover: a tap leaves no wash behind and no icon moves", async ({ page }) => {
    await showMoney(page);
    await page.goto(SUMMARY_URL);
    expect(await page.evaluate(() => matchMedia("(hover: none)").matches)).toBe(true);
    const mixRow = page.locator(".summary-mix-row.motion-row").first();
    await expect(mixRow).toBeVisible({ timeout: 30_000 });
    const main = mixRow.locator(".summary-mix-main");
    await main.tap();
    await expect(main).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => background(mixRow)).toBe(CLEAR);
    expect(await mixRow.locator(".category-icon").evaluate((node) => getComputedStyle(node, "::before").animationName)).toBe("none");
    await main.tap();
    await expect(main).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => background(mixRow)).toBe(CLEAR);
  });
});

// Every bar's box, line's path and dot's place, to compare a played chart
// with a still one.
async function chartGeometry(page) {
  return page.locator("[data-earned-spent-chart]").evaluate((chart, origin = chart.getBoundingClientRect()) => ({
    bars: [...chart.querySelectorAll(".ec-bar")].map((node) => { const box = node.getBoundingClientRect(); return [box.x - origin.x, box.y - origin.y, box.width, box.height].map(Math.round); }),
    lines: [...chart.querySelectorAll(".ec-line")].map((node) => node.getAttribute("d")),
    dots: [...chart.querySelectorAll(".ec-dot")].map((node) => { const box = node.getBoundingClientRect(); return [box.x - origin.x, box.y - origin.y, box.width, box.height].map(Math.round); }),
    clips: [...chart.querySelectorAll(".ec-line, .ec-bar, .ec-dot")].map((node) => getComputedStyle(node).clipPath).filter((clip) => clip !== "none")
  }));
}

async function donutGeometry(page) {
  return page.locator(".spending-mix-chart").first().evaluate((donut, origin = donut.getBoundingClientRect()) => ({
    sectors: [...donut.querySelectorAll(".recharts-pie-sector path")].map((node) => node.getAttribute("d")),
    labels: [...donut.querySelectorAll(".donut-slice-label")].map((node) => { const box = node.getBoundingClientRect(); return [box.x - origin.x, box.y - origin.y, box.width, box.height].map(Math.round); }),
    clip: getComputedStyle(donut.querySelector(".recharts-pie")).clipPath,
    labelOpacity: [...donut.querySelectorAll(".donut-slice-label")].map((node) => getComputedStyle(node.closest(".recharts-surface > g")).opacity)
  }));
}

test.describe("charts", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await showMoney(page);
    await page.addInitScript(() => {
      window.__layoutShifts = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) window.__layoutShifts.push({ at: entry.startTime, value: entry.value });
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
  });

  test("the month chart plays once on first view and ends exactly as a still chart draws it, with nothing on the page moving", async ({ page, browser }) => {
    await page.goto(SUMMARY_URL);
    const chart = page.locator("[data-earned-spent-chart]");
    await expect(chart).toHaveAttribute("data-chart-motion", "armed", { timeout: 30_000 });
    // Waiting off screen: the columns are flat, the dashed totals clipped
    // away and the points hidden.
    expect(await chart.locator(".ec-bar").first().evaluate((node) => getComputedStyle(node).transform)).toBe("matrix(1, 0, 0, 0, 0, 0)");
    expect(await chart.locator(".ec-line.is-spentSoFar").evaluate((node) => getComputedStyle(node).clipPath)).toMatch(/inset/);
    const start = await page.evaluate(() => performance.now());
    await chart.scrollIntoViewIfNeeded();
    await expect(chart).toHaveAttribute("data-chart-motion", "playing");
    expect(await chart.locator(".ec-bar").first().evaluate((node) => getComputedStyle(node).animationName)).toBe("ec-grow");
    expect(await chart.locator(".ec-line.is-plan").first().evaluate((node) => getComputedStyle(node).animationName)).toBe("ec-draw");
    expect(await chart.locator(".ec-line.is-plannedSoFar").evaluate((node) => getComputedStyle(node).animationName)).toBe("ec-reveal");
    expect(await chart.locator(".ec-dot").first().evaluate((node) => getComputedStyle(node).animationName)).toBe("ec-pop");
    await expect(chart).toHaveAttribute("data-chart-motion", "done", { timeout: 5_000 });
    const played = await chartGeometry(page);
    expect(played.clips).toEqual([]);
    // The page did not shift while it played.
    const shifts = await page.evaluate((from) => window.__layoutShifts.filter((shift) => shift.at >= from).reduce((sum, shift) => sum + shift.value, 0), start);
    expect(shifts).toBeLessThan(0.01);

    const stillContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce", storageState: { cookies: [], origins: [] } });
    const still = await stillContext.newPage();
    await showMoney(still);
    await still.goto(new URL(SUMMARY_URL, page.url()).toString());
    await expect(still.locator("[data-earned-spent-chart]")).toHaveAttribute("data-chart-motion", "off", { timeout: 30_000 });
    await still.locator("[data-earned-spent-chart]").scrollIntoViewIfNeeded();
    await page.locator("[data-earned-spent-chart]").evaluate((node) => node.scrollIntoView({ block: "start" }));
    await still.locator("[data-earned-spent-chart]").evaluate((node) => node.scrollIntoView({ block: "start" }));
    expect(await chartGeometry(page)).toEqual(await chartGeometry(still));
    expect(await still.locator(".ec-bar").first().evaluate((node) => getComputedStyle(node).animationName)).toBe("none");
    await stillContext.close();
  });

  test("the Spending Mix donut sweeps in on first view, leaves no clip, and rests exactly as a still donut", async ({ page, browser }) => {
    await page.setViewportSize({ width: 1440, height: 480 });
    await page.goto(SUMMARY_URL);
    const donut = page.locator(".spending-mix-chart").first();
    await expect(donut).toHaveAttribute("data-donut-motion", /^(armed|playing|done)$/, { timeout: 30_000 });
    await donut.locator(".recharts-pie-sector").first().waitFor({ state: "attached" });
    const start = await page.evaluate(() => performance.now());
    await donut.evaluate((node) => node.scrollIntoView({ block: "center" }));
    await expect(donut).toHaveAttribute("data-donut-motion", "playing");
    const playing = await donutGeometry(page);
    expect(playing.clip).toMatch(/polygon/);
    await expect(donut).toHaveAttribute("data-donut-motion", "done", { timeout: 5_000 });
    const rested = await donutGeometry(page);
    expect(rested.clip).toBe("none");
    expect(new Set(rested.labelOpacity)).toEqual(new Set(["1"]));
    const shifts = await page.evaluate((from) => window.__layoutShifts.filter((shift) => shift.at >= from).reduce((sum, shift) => sum + shift.value, 0), start);
    expect(shifts).toBeLessThan(0.01);

    const stillContext = await browser.newContext({ viewport: { width: 1440, height: 480 }, reducedMotion: "reduce", storageState: { cookies: [], origins: [] } });
    const still = await stillContext.newPage();
    await showMoney(still);
    await still.goto(new URL(SUMMARY_URL, page.url()).toString());
    const stillDonut = still.locator(".spending-mix-chart").first();
    await expect(stillDonut).toHaveAttribute("data-donut-motion", "off", { timeout: 30_000 });
    await stillDonut.locator(".recharts-pie-sector").first().waitFor({ state: "attached" });
    await stillDonut.evaluate((node) => node.scrollIntoView({ block: "center" }));
    await donut.evaluate((node) => node.scrollIntoView({ block: "center" }));
    const stillGeometry = await donutGeometry(still);
    expect(stillGeometry.clip).toBe("none");
    expect((await donutGeometry(page)).sectors).toEqual(stillGeometry.sectors);
    expect((await donutGeometry(page)).labels).toEqual(stillGeometry.labels);
    await stillContext.close();
  });

  test("a pointer on a slice lifts it in its own colour, and on a column widens it and dims the others", async ({ page }) => {
    await page.goto(SUMMARY_URL);
    const donut = page.locator(".spending-mix-chart").first();
    await donut.evaluate((node) => node.scrollIntoView({ block: "center" }));
    await expect(donut).toHaveAttribute("data-donut-motion", "done", { timeout: 10_000 });
    // A point on the ring inside one slice: the middle of its arc.
    const target = await donut.evaluate((node) => {
      for (const [index, slice] of [...node.querySelectorAll(".donut-slice")].entries()) {
        const hit = slice.querySelector(".donut-slice-hit");
        const length = hit.getTotalLength();
        const svg = hit.ownerSVGElement.getBoundingClientRect();
        const centre = { x: svg.x + svg.width / 2, y: svg.y + svg.height / 2 };
        const matrix = hit.getScreenCTM();
        // The outer arc's middle: of points sampled along the outline, the
        // ones farthest from the centre are on the outer arc.
        const samples = Array.from({ length: 60 }, (_, step) => {
          const at = hit.getPointAtLength((length * step) / 60);
          return { x: matrix.a * at.x + matrix.e, y: matrix.d * at.y + matrix.f };
        });
        const far = Math.max(...samples.map((at) => Math.hypot(at.x - centre.x, at.y - centre.y)));
        const outer = samples.filter((at) => Math.hypot(at.x - centre.x, at.y - centre.y) > far - 1);
        const onEdge = outer[Math.floor(outer.length / 2)];
        const point = { x: onEdge.x + (centre.x - onEdge.x) * 0.1, y: onEdge.y + (centre.y - onEdge.y) * 0.1 };
        if (document.elementFromPoint(point.x, point.y)?.closest(".donut-slice") === slice) return { index, ...point };
      }
      return null;
    });
    expect(target).not.toBeNull();
    const slice = donut.locator(".donut-slice").nth(target.index);
    const colour = await slice.evaluate((node) => getComputedStyle(node).getPropertyValue("--slice-colour"));
    expect(colour).toMatch(/var\(--cat-|#/);
    await page.mouse.move(target.x, target.y);
    await expect.poll(() => slice.locator(".donut-slice-hit").evaluate((node) => getComputedStyle(node).transform)).toMatch(/^matrix\(1\.04/);
    expect(await slice.locator(".donut-slice-hit").evaluate((node) => getComputedStyle(node).fill)).not.toBe("rgba(0, 0, 0, 0)");

    const chart = page.locator("[data-earned-spent-chart]");
    await chart.scrollIntoViewIfNeeded();
    await expect(chart).toHaveAttribute("data-chart-motion", "done", { timeout: 10_000 });
    const column = chart.locator('.ec-point.is-bar[data-ec-series="spent"]').last();
    const box = await column.locator(".ec-bar").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect.poll(() => column.locator(".ec-bar").evaluate((node) => getComputedStyle(node).transform)).toMatch(/^matrix\(1\.18/);
    await expect.poll(() => chart.locator('.ec-point.is-bar[data-ec-series="spent"]').first().locator(".ec-bar").evaluate((node) => getComputedStyle(node).opacity)).toBe("0.55");
  });
});
