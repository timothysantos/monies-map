import { expect, test } from "@playwright/test";

import { postJson, reseedDemo } from "./helpers";

// Summary on a phone (design.md "Summary phone type scale"): every big figure
// fits its tile on one line, a chip is one line with room on both sides, a
// mark (bar, ring, chart) never covers text, nothing is cut off at a tile's
// edge, and the last card scrolls fully above the floating bars. Run at
// 320 to 430 wide (and a tablet) with the demo data and with long figures.

const WIDTHS = [320, 360, 375, 390, 412, 430, 768];
const BAR_WIDTHS = [360, 390, 430];

const now = new Date();
const monthsAgo = (back) => {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
};

async function addCharges(page, { long = false } = {}) {
  for (let back = 4; back >= 1; back -= 1) {
    await postJson(page, "/api/entries/create", {
      date: `${monthsAgo(back)}-14`, description: "NETFLIX.COM 866-579-7172", accountName: "Citi Rewards", categoryName: "Subscriptions MO",
      entryType: "expense", ownershipType: "direct", ownerName: "Joyce", amountMinor: 1998
    });
  }
  await postJson(page, "/api/entries/create", {
    date: `${monthsAgo(1)}-20`, description: "ANNUAL FEE CITI REWARDS", accountName: "Citi Rewards", categoryName: "Fees",
    entryType: "expense", ownershipType: "direct", ownerName: "Joyce", amountMinor: long ? 123456789 : 19260
  });
}

async function openSummary(page) {
  await page.goto("/?view=household");
  await expect(page.locator(".summary-cards-arrange button")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".summary-tiles .summary-tile").first()).toBeVisible({ timeout: 30_000 });
  await page.locator('[data-tile="bankfees"]').scrollIntoViewIfNeeded();
  // Marks draw in on first view; wait for the page to settle.
  await page.waitForTimeout(1500);
}

// What is wrong inside one tile, as plain strings (empty when the tile is right).
async function tileProblems(tile) {
  return tile.evaluate((element) => {
    const problems = [];
    const id = element.dataset.tile;
    const tileBox = element.getBoundingClientRect();
    const rect = (node) => node.getBoundingClientRect();
    const lineHeight = (node) => {
      const style = getComputedStyle(node);
      const px = Number.parseFloat(style.lineHeight);
      return Number.isFinite(px) ? px : Number.parseFloat(style.fontSize) * 1.3;
    };
    const textRect = (node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return [...range.getClientRects()].filter((box) => box.width > 0);
    };

    if (element.scrollWidth > element.clientWidth + 1) problems.push(`${id}: tile scrolls sideways`);
    if (element.scrollHeight > element.clientHeight + 1) problems.push(`${id}: tile content is cut off at the bottom`);

    // The headline figure: one line.
    const figure = element.querySelector(".summary-tile-figure");
    if (figure) {
      const lines = new Set(textRect(figure).map((box) => Math.round(box.top)));
      if (lines.size > 1) problems.push(`${id}: headline wraps onto ${lines.size} lines`);
      if (rect(figure).height > lineHeight(figure) * 1.25) problems.push(`${id}: headline is taller than one line`);
      if (figure.scrollWidth > figure.clientWidth + 1) problems.push(`${id}: headline is wider than its box`);
    }

    // Nothing reaches past the tile's box.
    for (const node of element.querySelectorAll("*")) {
      const box = rect(node);
      if (box.width === 0 || box.height === 0) continue;
      if (box.right > tileBox.right + 0.5 || box.left < tileBox.left - 0.5) problems.push(`${id}: ${node.className || node.tagName} spills sideways`);
      if (box.bottom > tileBox.bottom + 0.5) problems.push(`${id}: ${node.className || node.tagName} ends below the tile`);
    }

    // The title takes at most two lines; "Open" stays on one.
    const head = element.querySelector(".summary-tile-head");
    for (const node of head.children) {
      const lines = new Set(textRect(node).map((box) => Math.round(box.top))).size;
      if (lines > (node.classList.contains("summary-tile-title") ? 2 : 1)) problems.push(`${id}: ${node.className} wraps onto ${lines} lines`);
    }

    // A chip: one line, text inside with room on both sides.
    for (const chip of element.querySelectorAll(".summary-tile-chip")) {
      const chipBox = rect(chip);
      const lines = textRect(chip);
      // One line; only a long chip (the days left and the date) may take a second line inside its pill.
      const chipLines = new Set(lines.map((box) => Math.round(box.top))).size;
      if (chipLines > (chip.textContent.length > 20 ? 2 : 1)) problems.push(`${id}: chip "${chip.textContent}" wraps onto ${chipLines} lines`);
      const left = Math.min(...lines.map((box) => box.left));
      const right = Math.max(...lines.map((box) => box.right));
      if (left - chipBox.left < 8 || chipBox.right - right < 8) problems.push(`${id}: chip "${chip.textContent}" has under 8px of room on a side`);
      if (chip.scrollWidth > chip.clientWidth + 1) problems.push(`${id}: chip "${chip.textContent}" is cut`);
      if (Number.parseFloat(getComputedStyle(chip).fontSize) < 12) problems.push(`${id}: chip text under 12px`);
    }

    // A mark never meets text.
    const marks = [...element.querySelectorAll(".summary-tile-line, .summary-tile-stack, .summary-tile-bars, .summary-tile-weeks, .summary-tile-months, .summary-tile-gauge")];
    const texts = [...element.querySelectorAll(".summary-tile-title, .summary-tile-open, .summary-tile-label, .summary-tile-figure, .summary-tile-headline small, .summary-tile-chip, .summary-tile-note, .summary-tile-row")];
    for (const mark of marks) {
      const markBox = rect(mark);
      if (markBox.width === 0 || markBox.height === 0) continue;
      for (const text of texts) {
        const textBox = rect(text);
        const overlaps = markBox.left < textBox.right && markBox.right > textBox.left && markBox.top < textBox.bottom - 0.5 && markBox.bottom > textBox.top + 0.5;
        if (overlaps) problems.push(`${id}: ${mark.className} covers ${text.className} "${text.textContent.slice(0, 24)}"`);
      }
    }

    // No type under 12px.
    for (const node of element.querySelectorAll(".summary-tile-title, .summary-tile-open, .summary-tile-label, .summary-tile-headline small, .summary-tile-note, .summary-tile-row, .summary-tile-gauge-caption")) {
      if (Number.parseFloat(getComputedStyle(node).fontSize) < 12) problems.push(`${id}: ${node.className} under 12px`);
    }
    return problems;
  });
}

async function allTileProblems(page) {
  const tiles = page.locator(".summary-tiles .summary-tile");
  const count = await tiles.count();
  expect(count).toBeGreaterThanOrEqual(4);
  const problems = [];
  for (let index = 0; index < count; index += 1) problems.push(...await tileProblems(tiles.nth(index)));
  return problems;
}

// Tiles in the same row of two keep one height.
async function rowHeightsMatch(page) {
  return page.locator(".summary-tiles .summary-tile").evaluateAll((tiles) => {
    const rows = new Map();
    for (const tile of tiles) {
      const box = tile.getBoundingClientRect();
      const key = Math.round(box.top);
      rows.set(key, [...(rows.get(key) ?? []), Math.round(box.height)]);
    }
    return [...rows.values()].filter((heights) => new Set(heights).size > 1);
  });
}

test.describe("Summary on a phone: type, chips and marks", () => {
  for (const long of [false, true]) {
    for (const width of WIDTHS) {
      test(`${width}px${long ? " with long figures" : ""}: tiles fit their figures, chips and marks`, async ({ page }) => {
        await reseedDemo(page);
        await addCharges(page, { long });
        await page.setViewportSize({ width, height: 900 });
        await openSummary(page);
        expect(await allTileProblems(page)).toEqual([]);
        expect(await rowHeightsMatch(page), "tiles in a row share a height").toEqual([]);
        const horizontal = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(horizontal, "the page does not scroll sideways").toBeLessThanOrEqual(0);
      });
    }
  }

  test("the money-hidden tiles keep their words inside their boxes at 360px", async ({ page }) => {
    await reseedDemo(page);
    await addCharges(page);
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "false"));
    await page.setViewportSize({ width: 360, height: 900 });
    await openSummary(page);
    expect(await allTileProblems(page)).toEqual([]);
  });

  for (const width of [390]) {
    test(`${width}px: the big figures on the lead card, Spending Mix, Subscriptions and What changed fit one line`, async ({ page }) => {
      await reseedDemo(page);
      await addCharges(page, { long: true });
      await page.setViewportSize({ width, height: 900 });
      await openSummary(page);
      const sizes = await page.evaluate(() => {
        const size = (selector) => {
          const node = document.querySelector(selector);
          return node ? Number.parseFloat(getComputedStyle(node).fontSize) : null;
        };
        return {
          lead: size(".summary-lead-slot .lsd-figure .lsd-amount"),
          mix: size(".summary-mix-total-amount"),
          tile: size(".summary-tile-figure"),
          subs: size(".summary-card-slot .subs-card .subs-total-figure"),
          invest: size(".summary-card-slot .invest-worth"),
          diff: size(".chg-diff")
        };
      });
      expect(sizes.lead).toBeLessThanOrEqual(40);
      expect(sizes.tile).toBeLessThanOrEqual(26);
      expect(sizes.tile).toBeGreaterThanOrEqual(16);
      if (sizes.mix) expect(sizes.mix).toBeLessThanOrEqual(32);
      if (sizes.subs) expect(sizes.subs).toBeLessThanOrEqual(36);
      if (sizes.invest) expect(sizes.invest).toBeLessThanOrEqual(28);
      const spills = await page.evaluate(() => [...document.querySelectorAll(".summary-lead-slot .lsd-amount, .summary-mix-total-amount, .invest-worth, .chg-diff, .subs-total-figure")]
        .filter((node) => node.getBoundingClientRect().width > 0 && (node.scrollWidth > node.clientWidth + 1 || node.getBoundingClientRect().right > window.innerWidth))
        .map((node) => `${node.className}: ${node.textContent}`));
      expect(spills).toEqual([]);
    });
  }

  for (const width of BAR_WIDTHS) {
    test(`${width}px: the last card scrolls fully above the floating bars`, async ({ page }) => {
      await reseedDemo(page);
      await addCharges(page);
      await page.setViewportSize({ width, height: 800 });
      await openSummary(page);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(600);
      const result = await page.evaluate(() => {
        const viewport = window.innerHeight;
        const bars = [...document.querySelectorAll("body *")].filter((node) => {
          const style = getComputedStyle(node);
          if (style.position !== "fixed" || style.visibility === "hidden" || style.display === "none") return false;
          const box = node.getBoundingClientRect();
          return box.width > 120 && box.height > 20 && box.height < 140 && box.top > viewport * 0.5 && box.bottom <= viewport + 1;
        });
        const cards = [...document.querySelectorAll("[data-summary-card]")].filter((node) => node.getBoundingClientRect().height > 0);
        const last = cards[cards.length - 1];
        return {
          barTop: bars.length ? Math.min(...bars.map((node) => node.getBoundingClientRect().top)) : null,
          barNames: bars.map((node) => node.className),
          lastBottom: last.getBoundingClientRect().bottom,
          lastName: last.dataset.summaryCard
        };
      });
      expect(result.barTop, `floating bars found: ${result.barNames}`).not.toBeNull();
      expect(result.lastBottom, `last card ${result.lastName}`).toBeLessThanOrEqual(result.barTop - 4);
    });
  }

  test("390px: the sheet each tile opens keeps its figures under 36px and inside the sheet, pills with room", async ({ page }) => {
    await reseedDemo(page);
    await addCharges(page, { long: true });
    await page.setViewportSize({ width: 390, height: 900 });
    await openSummary(page);
    const ids = await page.locator(".summary-tiles .summary-tile").evaluateAll((tiles) => tiles.map((tile) => tile.dataset.tile));
    expect(ids.length).toBeGreaterThanOrEqual(4);
    for (const id of ids) {
      await page.locator(`[data-tile="${id}"]`).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await page.waitForTimeout(700);
      const found = await dialog.evaluate((root, tileId) => {
        const problems = [];
        const rootBox = root.getBoundingClientRect();
        for (const node of root.querySelectorAll("*")) {
          const box = node.getBoundingClientRect();
          if (box.width === 0 || box.height === 0 || !node.textContent.trim()) continue;
          const ownText = [...node.childNodes].some((child) => child.nodeType === 3 && child.textContent.trim());
          if (!ownText) continue;
          const size = Number.parseFloat(getComputedStyle(node).fontSize);
          if (size > 36) problems.push(`${tileId}: ${node.className} is ${size}px`);
          if (box.right > rootBox.right + 0.5) problems.push(`${tileId}: ${node.className} "${node.textContent.slice(0, 20)}" runs past the sheet`);
        }
        for (const pill of root.querySelectorAll(".subs-chip, .chg-chip, .cr-estimate, .cr-owner, [class*='deadline'], [class*='-pill']")) {
          const box = pill.getBoundingClientRect();
          if (box.width === 0) continue;
          const range = document.createRange();
          range.selectNodeContents(pill);
          const lines = [...range.getClientRects()].filter((rectBox) => rectBox.width > 0);
          if (!lines.length) continue;
          const left = Math.min(...lines.map((rectBox) => rectBox.left));
          const right = Math.max(...lines.map((rectBox) => rectBox.right));
          if (left - box.left < 8 || box.right - right < 8) problems.push(`${tileId}: pill "${pill.textContent}" is tight`);
        }
        return problems;
      }, id);
      expect(found).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    }
  });

  test("390px: a pill on the lead card, Subscriptions, What changed and the opened sheets keeps room around its text", async ({ page }) => {
    await reseedDemo(page);
    await addCharges(page);
    await page.setViewportSize({ width: 390, height: 900 });
    await openSummary(page);
    const bad = await page.evaluate(() => {
      const found = [];
      const pills = document.querySelectorAll(".summary-lead-headroom, .chg-chip, .subs-chip, .summary-support-pill, .subs-glance-chips > *");
      for (const pill of pills) {
        const box = pill.getBoundingClientRect();
        if (box.width === 0) continue;
        const range = document.createRange();
        range.selectNodeContents(pill);
        const lines = [...range.getClientRects()].filter((rectBox) => rectBox.width > 0);
        if (new Set(lines.map((rectBox) => Math.round(rectBox.top))).size > 1 && !pill.classList.contains("summary-support-pill")) found.push(`${pill.className} wraps: ${pill.textContent}`);
        const left = Math.min(...lines.map((rectBox) => rectBox.left));
        const right = Math.max(...lines.map((rectBox) => rectBox.right));
        if (left - box.left < 8 || box.right - right < 8) found.push(`${pill.className} tight: ${pill.textContent}`);
        if (Number.parseFloat(getComputedStyle(pill).fontSize) < 12) found.push(`${pill.className} under 12px`);
      }
      return found;
    });
    expect(bad).toEqual([]);
  });
});
