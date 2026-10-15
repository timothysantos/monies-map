import { expect, test } from "@playwright/test";

import { gotoPageAfterApi, postJson, reseedDemo } from "./helpers";

// Plan Studio's two columns stay balanced (design.md "Plan Studio", "Balanced
// columns"). The mockup put the big picture in a left lane and every row in a
// right lane, so a month with many rows in one job left the left lane with
// unused space beside a very long right lane. The studio now lays its cards
// and each job's rows out in CSS columns that the browser balances by height.
// Measured here at 1280, 1440 and 1920 px with the demo household and with a
// month that has 16 more rows in Spend: the two columns end within 20% of each
// other's height, and the shorter one leaves a gap smaller than one block (the
// tallest card or row that could have moved over).

const MONTH = "2026-05";
const URL = `/month?view=person-tim&month=${MONTH}&scope=direct_plus_shared`;
const WIDTHS = [1280, 1440, 1920];
const TOLERANCE = 0.2;

async function seed(page, { manyRows }) {
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
async function measureColumns(page) {
  return page.locator("[data-ps-columns]").evaluate((container) => {
    const box = container.getBoundingClientRect();
    const middle = box.left + box.width / 2;
    const blocks = [...container.querySelectorAll(":scope > :not(.ps-group), :scope > .ps-group > *")].map((element) => {
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
