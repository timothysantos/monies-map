import { expect, test } from "@playwright/test";

import { chooseStudio, gotoPageAfterApi, postJson, reseedDemo } from "./helpers";

// Plan Studio's arrangement (design.md "Plan Studio", "Balanced columns"). The
// big picture takes the full width; the two cards under it (how the month is
// going, What if I save more?) share one row, stacked on a phone; the one list
// of lines under them is laid out in CSS columns that the browser balances by
// height. The mockup put the big picture in a left lane and every row in a
// right lane, so a month with many rows in one job left the left lane with
// unused space beside a very long right lane. Measured here at 1280, 1440 and
// 1920 px with the demo household and with a month that has 16 more rows in
// Spend: the two columns end within 20% of each other's height, and the
// shorter one leaves a gap smaller than one block (the tallest row that could
// have moved over).

const MONTH = "2026-05";
const URL = `/month?view=person-tim&month=${MONTH}&scope=direct_plus_shared`;
const WIDTHS = [1280, 1440, 1920];
const TOLERANCE = 0.2;

async function seed(page, { manyRows }) {
  await chooseStudio(page);
  await reseedDemo(page);
  await postJson(page, "/api/month-plan/save", {
    rowId: "plan-studio-layout-salary", month: MONTH, sectionKey: "income", categoryName: "Salary", label: "Salary",
    planDate: null, accountName: "", plannedMinor: 600_000, note: "", ownershipType: "direct", ownerName: "Tim"
  });
  if (manyRows) {
    for (let index = 1; index <= 16; index += 1) {
      await postJson(page, "/api/month-plan/save", {
        rowId: `plan-studio-layout-bucket-${index}`, month: MONTH, sectionKey: "budget_buckets", categoryName: "Gifts",
        label: `Layout bucket ${index}`, planDate: null, accountName: "", plannedMinor: 5_000 + index * 100, note: "",
        ownershipType: "direct", ownerName: "Tim"
      });
    }
  }
}

// Each column's height and the blocks it holds, from where the browser put
// every card, job header and row.
async function measureColumns(page, selector = "[data-ps-columns]") {
  return page.locator(selector).evaluate((container) => {
    const box = container.getBoundingClientRect();
    const middle = box.left + box.width / 2;
    const blocks = [...container.querySelectorAll(".ps-card, .ps-row, .ps-group-head")].map((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left < middle ? "left" : "right", top: rect.top - box.top, bottom: rect.bottom - box.top, height: rect.height };
    });
    const bottom = (side) => Math.max(0, ...blocks.filter((block) => block.left === side).map((block) => block.bottom));
    return {
      left: bottom("left"),
      right: bottom("right"),
      tallestBlock: Math.max(...blocks.map((block) => block.height)),
      leftBlocks: blocks.filter((block) => block.left === "left").length,
      rightBlocks: blocks.filter((block) => block.left === "right").length
    };
  });
}

for (const manyRows of [false, true]) {
  for (const width of WIDTHS) {
    test(`two balanced columns at ${width}px with ${manyRows ? "many rows in Spend" : "the demo rows"}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await seed(page, { manyRows });
      await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
      await gotoPageAfterApi(page, URL, "/api/month-page", () => page.locator("[data-ps-columns]"));
      await expect(page.locator('[data-ps-group="spend"] .ps-row').first()).toBeVisible();
      const columns = await measureColumns(page);
      const taller = Math.max(columns.left, columns.right);
      const shorter = Math.min(columns.left, columns.right);
      expect(columns.leftBlocks, "something in the left column").toBeGreaterThan(0);
      expect(columns.rightBlocks, "something in the right column").toBeGreaterThan(0);
      expect(taller - shorter, `columns ${Math.round(columns.left)}px and ${Math.round(columns.right)}px`).toBeLessThanOrEqual(TOLERANCE * taller);
      expect(taller - shorter, "the gap under the shorter column is less than one block").toBeLessThan(columns.tallestBlock);
      if (manyRows) {
        expect(await page.locator('[data-ps-group="spend"] .ps-row').count()).toBeGreaterThanOrEqual(30);
      }
    });
  }
}

test("the cards and rows stay whole: no card or row is split across the two columns", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await seed(page, { manyRows: true });
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await gotoPageAfterApi(page, URL, "/api/month-page", () => page.locator("[data-ps-columns]"));
  const split = await page.locator("[data-ps-columns]").evaluate((container) => {
    const box = container.getBoundingClientRect();
    const half = box.width / 2;
    return [...container.querySelectorAll(".ps-card, .ps-row")].filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.left < box.left + half && rect.right > box.left + half + 4;
    }).length;
  });
  expect(split).toBe(0);
});

test("the check catches the mockup's two lanes: cards on the left, every row on the right", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await seed(page, { manyRows: true });
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await gotoPageAfterApi(page, URL, "/api/month-page", () => page.locator("[data-ps-columns]"));
  await page.locator("[data-ps-columns]").evaluate((columns) => {
    const lanes = document.createElement("div");
    lanes.setAttribute("data-before-lanes", "");
    const studio = document.querySelector("[data-plan-studio]");
    lanes.style.cssText = "display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:14px;align-items:start";
    const left = document.createElement("div");
    const right = document.createElement("div");
    left.append(studio.querySelector("[data-ps-big]"), ...studio.querySelectorAll("[data-ps-cards] > *"));
    for (const child of [...columns.children]) {
      if (child.classList.contains("ps-group")) right.append(...child.children);
    }
    lanes.append(left, right);
    columns.replaceWith(lanes);
  });
  const lanes = await measureColumns(page, "[data-before-lanes]");
  const taller = Math.max(lanes.left, lanes.right);
  expect(taller - Math.min(lanes.left, lanes.right), "the old layout leaves the left lane short").toBeGreaterThan(TOLERANCE * taller);
});

// The cards' arrangement: the big picture is as wide as the studio, and the
// two cards under it sit side by side (same top, same height, together as wide
// as the studio) from 860 px of studio width.
for (const width of WIDTHS) {
  test(`the big picture takes the full width and the two cards share one row at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await seed(page, { manyRows: false });
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await gotoPageAfterApi(page, URL, "/api/month-page", () => page.locator("[data-ps-columns]"));
    const boxes = await page.locator("[data-plan-studio]").evaluate((studio) => {
      const rect = (element) => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
      const cards = [...studio.querySelectorAll("[data-ps-cards] > .ps-card")].map(rect);
      return { studio: rect(studio), big: rect(studio.querySelector("[data-ps-big]")), cards, columns: rect(studio.querySelector("[data-ps-columns]")) };
    });
    expect(boxes.big.width, "the big picture spans the studio").toBeGreaterThanOrEqual(boxes.studio.width - 2);
    expect(boxes.cards).toHaveLength(2);
    const [pace, whatIf] = boxes.cards;
    expect(Math.abs(pace.top - whatIf.top), "the two cards start together").toBeLessThanOrEqual(1);
    expect(Math.abs(pace.height - whatIf.height), "and are as tall as each other").toBeLessThanOrEqual(1);
    expect(pace.right, "side by side").toBeLessThanOrEqual(whatIf.left);
    expect(whatIf.right - pace.left, "together as wide as the studio").toBeGreaterThanOrEqual(boxes.studio.width - 2);
    expect(Math.abs(pace.width - whatIf.width), "of equal width").toBeLessThanOrEqual(2);
    expect(pace.top, "under the big picture").toBeGreaterThanOrEqual(boxes.big.bottom);
    expect(boxes.columns.top, "and the list under them").toBeGreaterThanOrEqual(Math.max(pace.bottom, whatIf.bottom));
  });
}

test("on a phone the cards stack under the full-width big picture and the list is one column", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page, { manyRows: false });
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await gotoPageAfterApi(page, URL, "/api/month-page", () => page.locator("[data-ps-columns]"));
  const boxes = await page.locator("[data-plan-studio]").evaluate((studio) => {
    const rect = (element) => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width }; };
    return {
      studio: rect(studio),
      big: rect(studio.querySelector("[data-ps-big]")),
      cards: [...studio.querySelectorAll("[data-ps-cards] > .ps-card")].map(rect),
      rows: [...studio.querySelectorAll(".ps-row")].slice(0, 6).map(rect),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  });
  expect(boxes.big.width).toBeGreaterThanOrEqual(boxes.studio.width - 2);
  const [pace, whatIf] = boxes.cards;
  expect(whatIf.top, "the second card is under the first").toBeGreaterThanOrEqual(pace.bottom);
  expect(pace.width).toBeGreaterThanOrEqual(boxes.studio.width - 2);
  expect(whatIf.width).toBeGreaterThanOrEqual(boxes.studio.width - 2);
  for (const row of boxes.rows) expect(row.width, "every row spans the single column").toBeGreaterThanOrEqual(boxes.studio.width - 2);
  expect(boxes.overflow, "no sideways scroll").toBeLessThanOrEqual(0);
});

test("the household view's read-only studio has one card, as wide as the studio", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await seed(page, { manyRows: false });
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await gotoPageAfterApi(page, "/month?view=household&month=2026-05&scope=direct_plus_shared", "/api/month-page", () => page.locator("[data-ps-cards]"));
  const widths = await page.locator("[data-plan-studio]").evaluate((studio) => ({
    studio: studio.getBoundingClientRect().width,
    cards: [...studio.querySelectorAll("[data-ps-cards] > .ps-card")].map((card) => card.getBoundingClientRect().width)
  }));
  expect(widths.cards).toHaveLength(1);
  expect(widths.cards[0]).toBeGreaterThanOrEqual(widths.studio - 2);
});
