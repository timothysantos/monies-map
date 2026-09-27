import { expect, test } from "@playwright/test";

import { reseedDemo } from "./helpers";

// On a phone the money-privacy eye button floats over the page at the
// right. Money insights keep their text out of that column, so no line of
// an insight (or of the expanded map) ever sits under the button while the
// page scrolls. Tagged @webkit: `npm run test:e2e:webkit` runs it in WebKit
// with the iPhone 13 profile; the default suite runs it at iPhone width.
const IPHONE_13 = { width: 390, height: 664 };

const PAGES = [
  ["Summary", "/summary?view=household&month=2026-05&scope=direct_plus_shared"],
  ["Month", "/month?view=person-tim&month=2026-05&scope=direct_plus_shared"],
  ["Entries", "/entries?view=household&month=2026-05&scope=direct_plus_shared"],
  ["Splits", "/splits?view=person-tim&month=2026-05"]
];

// Every rendered text line in the insights, and the floating button's box.
function measure(page) {
  return page.evaluate(() => {
    const insight = document.querySelector(".financial-insight");
    const button = [...document.querySelectorAll(".totals-visibility-toggle--floating")]
      .find((element) => getComputedStyle(element).display !== "none");
    const lines = [];
    const walker = document.createTreeWalker(insight, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        if (rect.width > 0 && rect.height > 0) {
          lines.push({ text: node.textContent.trim().slice(0, 60), left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
        }
      }
    }
    const box = button?.getBoundingClientRect();
    return { lines, button: box ? { left: box.left, right: box.right, top: box.top, bottom: box.bottom } : null };
  });
}

const intersects = (line, box) => line.left < box.right && line.right > box.left && line.top < box.bottom && line.bottom > box.top;

// Scrolls one line to the button's height, then checks no line under the
// button intersects it. The insights sit near the top of a page, so spacers
// above and below the page let any line reach the button's height.
async function expectLineClearOfButton(page, pick, label) {
  await page.evaluate(() => {
    if (document.querySelector("[data-test-scroll-spacer]")) return;
    for (const where of ["afterbegin", "beforeend"]) {
      const spacer = document.createElement("div");
      spacer.dataset.testScrollSpacer = where;
      spacer.style.height = "1200px";
      document.body.insertAdjacentElement(where, spacer);
    }
  });
  const before = await measure(page);
  expect(before.button, `${label}: floating button`).not.toBeNull();
  const line = pick(before.lines);
  const buttonMiddle = (before.button.top + before.button.bottom) / 2;
  await page.evaluate((delta) => window.scrollBy({ top: delta, behavior: "instant" }), (line.top + line.bottom) / 2 - buttonMiddle);
  const after = await measure(page);
  const moved = after.lines.find((candidate) => candidate.text === line.text && Math.abs(candidate.left - line.left) < 1 && Math.abs(candidate.right - line.right) < 1);
  expect(moved, `${label}: the line is still on screen`).toBeTruthy();
  expect(Math.abs((moved.top + moved.bottom) / 2 - buttonMiddle), `${label}: scrolled to the button`).toBeLessThan(12);
  expect(after.lines.filter((candidate) => intersects(candidate, after.button)), `${label}: text under the button`).toEqual([]);
  // The button is fixed and the page scrolls only vertically, so no line
  // anywhere in the insights may reach into the button's column.
  expect(after.lines.filter((candidate) => candidate.right > after.button.left).map((candidate) => candidate.text), `${label}: text in the button's column`).toEqual([]);
}

test.describe("money insights on a phone", { tag: "@webkit" }, () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.route("**/api/ai-assist/financial-insight", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false }) }));
    await page.setViewportSize(IPHONE_13);
    await reseedDemo(page);
  });

  for (const [heading, path] of PAGES) {
    test(`${heading}: no insights text sits under the floating money button`, async ({ page }) => {
      await page.goto(path);
      await expect.poll(() => page.evaluate(() => window.__MONIES_MAP_ROUTE_WORK__?.usable ?? false), { timeout: 30_000 }).toBe(true);
      const insight = page.locator(".financial-insight").first();
      await expect(insight.locator(".financial-insight-narrative")).toBeVisible();
      await expect(page.locator(".totals-visibility-toggle--floating").filter({ visible: true })).toHaveCount(1);

      // The last text line of the collapsed insights, and the widest line.
      await expectLineClearOfButton(page, (lines) => lines.filter((line) => !/^See all insights$/.test(line.text)).at(-1), `${heading} last line`);
      await expectLineClearOfButton(page, (lines) => [...lines].sort((left, right) => right.right - left.right)[0], `${heading} widest line`);

      // Expanded: the extra lines, the quote and the map stay clear too.
      await insight.getByRole("button", { name: "See all insights" }).click();
      await expect(insight.getByLabel("Money consequence map")).toBeVisible();
      await expectLineClearOfButton(page, (lines) => [...lines].sort((left, right) => right.right - left.right)[0], `${heading} expanded widest line`);
    });
  }
});
