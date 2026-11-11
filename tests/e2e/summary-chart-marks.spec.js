import { expect, test } from "@playwright/test";

import { postJson, reseedDemo } from "./helpers";

// Summary's marks that draw in and the new marks (design.md "Motion" and
// "Summary tiles"): tile marks (a week bar chart, Bank fees by month with the
// biggest month marked, a Miles ring, Tax percents), What changed's bars from a
// centre line, the progress bar under each month tile, and the pill a tapped
// column shows. Marks play once on first view by transform or stroke dash only;
// every figure is in the page from the start; reduced motion and hidden money
// leave the final state or no marks at all.

const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Singapore" }));
const monthsAgo = (back) => {
  const at = new Date(now.getFullYear(), now.getMonth() - back, 1);
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}`;
};

async function addEntry(page, date, description, categoryName, amountMinor) {
  await postJson(page, "/api/entries/create", {
    date, description, accountName: "Citi Rewards", categoryName, entryType: "expense", ownershipType: "direct", ownerName: "Joyce", amountMinor
  });
}

async function addFixtures(page) {
  for (let back = 4; back >= 1; back -= 1) {
    await addEntry(page, `${monthsAgo(back)}-14`, "NETFLIX.COM 866-579-7172", "Subscriptions MO", 1998);
  }
  // Two months with a bank fee, the annual fee the biggest.
  await addEntry(page, `${now.getFullYear()}-01-05`, "ANNUAL FEE CITI REWARDS", "Fees", 19260);
  await addEntry(page, `${monthsAgo(0)}-02`, "LATE PAYMENT CHARGE", "Fees", 8000);
  // What changed: food up, home down against the same days of last month.
  for (let back = 3; back >= 1; back -= 1) {
    await addEntry(page, `${monthsAgo(back)}-01`, "KOUFU FOOD COURT", "Food & Drinks", 2_000);
  }
  await addEntry(page, `${monthsAgo(1)}-01`, "COURTS MEGASTORE", "Home", 30_000);
  await addEntry(page, `${monthsAgo(0)}-01`, "BURNT ENDS", "Food & Drinks", 80_000);
}

async function open(page, { money = true } = {}) {
  await page.addInitScript((shown) => window.localStorage.setItem("monies-map:money-totals-visible", shown), String(money));
  await page.goto("/?view=household");
  await expect(page.locator(".summary-cards-arrange button")).toBeVisible({ timeout: 30_000 });
}

const transformOf = (locator) => locator.evaluate((node) => getComputedStyle(node).transform);
const animationOf = (locator) => locator.evaluate((node) => getComputedStyle(node).animationName);

test.describe("tile marks draw in", () => {
  test.use({ viewport: { width: 1440, height: 420 } });
  // The fee fixture needs two different months this year.
  test.skip(now.getMonth() === 0, "January has only one month with a fee to draw by month");

  test.beforeEach(async ({ page }) => {
    await reseedDemo(page);
    await addFixtures(page);
  });

  test("Bank fees by month and Coming up's weeks wait flat off screen, draw once on first view, and rest at their size", async ({ page }) => {
    await open(page);
    const fees = page.locator('[data-tile="bankfees"]');
    const coming = page.locator('[data-tile="coming"]');
    await expect(fees).toHaveAttribute("data-chart-motion", /^(armed|playing|done)$/, { timeout: 30_000 });
    const bars = fees.locator(".summary-tile-months > span");
    await expect(bars).toHaveCount(2);
    // The biggest month (the annual fee) is marked and the full height of the chart.
    await expect(fees.locator(".summary-tile-months > .is-biggest")).toHaveCount(1);
    const heights = await bars.evaluateAll((nodes) => nodes.map((node) => node.style.height));
    expect(heights).toContain("100%");
    expect(heights[0], "January (the annual fee) is the biggest").toBe("100%");
    expect(Number.parseInt(heights[1], 10)).toBeLessThan(100);

    // Waiting below the fold: marks flat, figures already there.
    if ((await fees.getAttribute("data-chart-motion")) === "armed") {
      expect(await transformOf(bars.first())).toBe("matrix(1, 0, 0, 0, 0, 0)");
      await expect(fees.locator(".summary-tile-headline")).toContainText("$272.60");
      expect(await fees.locator(".summary-tile-headline").evaluate((node) => getComputedStyle(node).opacity)).toBe("1");
    }
    await fees.scrollIntoViewIfNeeded();
    await expect(fees).toHaveAttribute("data-chart-motion", "playing");
    expect(await animationOf(bars.first())).toBe("tile-grow-y");
    await expect(fees).toHaveAttribute("data-chart-motion", "done", { timeout: 5_000 });
    expect(await transformOf(bars.first())).toBe("none");
    expect(await animationOf(bars.first())).toBe("none");

    // Coming up's week bars do the same, on their own view.
    await coming.scrollIntoViewIfNeeded();
    await expect(coming).toHaveAttribute("data-chart-motion", "done", { timeout: 6_000 });
    expect(await transformOf(coming.locator(".summary-tile-weeks > span").first())).toBe("none");
  });

  test("reduced motion: the marks are at their final size at once and nothing is armed", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 420 }, reducedMotion: "reduce", baseURL });
    const page = await context.newPage();
    await open(page);
    const fees = page.locator('[data-tile="bankfees"]');
    await expect(fees).toHaveAttribute("data-chart-motion", "off", { timeout: 30_000 });
    expect(await transformOf(fees.locator(".summary-tile-months > span").first())).toBe("none");
    expect(await animationOf(fees.locator(".summary-tile-months > span").first())).toBe("none");
    await context.close();
  });

  test("money hidden: no marks, no percent", async ({ page }) => {
    await open(page, { money: false });
    const fees = page.locator('[data-tile="bankfees"]');
    await expect(fees).toBeVisible({ timeout: 30_000 });
    await expect(fees.locator(".summary-tile-months")).toBeHidden();
    await expect(fees.locator(".summary-tile-months > span").first()).toBeHidden();
  });
});

test.describe("What changed bars", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await reseedDemo(page);
    await addFixtures(page);
  });

  test("a bar from the centre line per row: up goes right in rose, down goes left in mint, lengths in step with the changes", async ({ page }) => {
    await open(page);
    const card = page.locator(".chg-card");
    await expect(card).toBeVisible({ timeout: 30_000 });
    const food = card.locator('[data-category="Food & Drinks"]');
    const home = card.locator('[data-category="Home"]');
    await expect(food.locator(".chg-bar-fill.is-up")).toHaveCount(1);
    await expect(home.locator(".chg-bar-fill.is-down")).toHaveCount(1);
    const parse = async (row) => Number((await row.locator(".chg-diff").innerText()).replace(/[^0-9.]/g, ""));
    const [upAmount, downAmount] = [await parse(food), await parse(home)];
    const width = (row) => row.locator(".chg-bar-fill").evaluate((node) => Number.parseInt(node.style.width, 10));
    // The biggest change takes half the track (from the centre to its edge); the other, its share of it.
    const biggest = Math.max(upAmount, downAmount);
    expect(await width(food)).toBe(Math.round((upAmount / biggest) * 50));
    expect(await width(home)).toBe(Math.round((downAmount / biggest) * 50));
    // Rose for up, mint for down, from opposite sides of the centre.
    const colours = await card.locator(".chg-bar-fill").evaluateAll((nodes) => nodes.map((node) => [node.className, getComputedStyle(node).backgroundColor, getComputedStyle(node).left, getComputedStyle(node).right]));
    const up = colours.find(([name]) => name.includes("is-up"));
    const down = colours.find(([name]) => name.includes("is-down"));
    expect(up[1]).not.toBe(down[1]);
    await expect(card).toHaveAttribute("data-chart-motion", /^(armed|playing|done|off)$/);
  });

  test("money hidden: no bars, which would show which way a category moved", async ({ page }) => {
    await open(page, { money: false });
    const card = page.locator(".chg-card");
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card.locator(".chg-bar")).toHaveCount(0);
  });
});

test.describe("month tiles' progress bars and the tapped column's pill", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  const URL = "/summary?view=person-tim&month=2025-10&summary_start=2025-06&summary_end=2025-10";

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await reseedDemo(page);
    await page.addInitScript(() => {
      window.localStorage.setItem("monies-map:money-totals-visible", "true");
      window.localStorage.setItem("monies-map:lead-view", "plan");
    });
  });

  test("each month tile has a bar of the share of its plan spent, rose once over", async ({ page }) => {
    await page.goto(URL);
    const tiles = page.locator(".summary-intent-tile");
    await expect(tiles.first()).toBeVisible({ timeout: 30_000 });
    const count = await tiles.count();
    expect(count).toBeGreaterThan(1);
    expect(await page.locator(".summary-intent-tile-bar").count(), "the seeded months have plans").toBeGreaterThan(0);
    for (let index = 0; index < count; index += 1) {
      const tile = tiles.nth(index);
      const bar = tile.locator(".summary-intent-tile-bar");
      if ((await bar.count()) === 0) {
        // No plan, no bar (spending with no plan still says "over plan" in words).
        continue;
      }
      const percent = Number(await bar.getAttribute("data-percent"));
      expect(percent).toBeGreaterThanOrEqual(0);
      expect(percent).toBeLessThanOrEqual(100);
      expect(await bar.locator("span").evaluate((node) => node.style.width)).toBe(`${percent}%`);
      const words = await tile.locator(".summary-intent-tile-line").innerText();
      expect(await bar.evaluate((node) => node.classList.contains("is-over")), `${words}`).toBe(/over plan/.test(words));
    }
  });

  test("hidden money: no progress bars", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "false"));
    await page.goto(URL);
    await expect(page.locator(".summary-intent-tile").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".summary-intent-tile-bar")).toHaveCount(0);
  });

  test("a tapped column shows a pill with its exact figure; another tap moves it; it takes no room", async ({ page }) => {
    await page.goto(URL);
    const chart = page.locator("[data-earned-spent-chart]");
    await chart.scrollIntoViewIfNeeded();
    await expect(chart).toHaveAttribute("data-chart-motion", "done", { timeout: 15_000 });
    await expect(page.locator(".ec-pill")).toHaveCount(0);
    const before = await chart.evaluate((node) => node.getBoundingClientRect().height);
    const columns = chart.locator('.ec-point.is-bar[data-ec-series="spent"]');
    const first = columns.nth(0);
    await first.focus();
    await expect(page.locator(".ec-pill")).toHaveText(await first.getAttribute("aria-label"));
    expect(await page.locator(".ec-pill").innerText()).toMatch(/\$[\d,]+\.\d\d/);
    const second = columns.nth(1);
    await second.focus();
    await expect(page.locator(".ec-pill")).toHaveText(await second.getAttribute("aria-label"));
    expect(await first.getAttribute("aria-label")).not.toBe(await second.getAttribute("aria-label"));
    expect(await chart.evaluate((node) => node.getBoundingClientRect().height)).toBe(before);
  });
});
