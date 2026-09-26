import { expect, test } from "@playwright/test";

import { gotoPageAfterApi, reseedDemo } from "./helpers";

// Between the phone layout (760 px) and the width the desktop Month tables
// need (about 1,100 px), the Month page must fit its width: the page never
// scrolls sideways, and "+ Add planned item", the row open buttons and the
// edit sheet stay inside the part of the page the person can see.
//
// The portrait tablet uses full mobile emulation (isMobile), as a real
// tablet does: there the layout viewport grows to the page's width, so a
// too-wide page pushes controls and the fixed sheet past the screen edge.
// Presses go to viewport coordinates (page.mouse or page.touchscreen),
// because a locator click scrolls its target into view first and would hide
// a control that starts off screen.
const MID_WIDTHS = [
  {
    name: "820x1180 portrait tablet",
    layout: "sheet",
    use: { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true }
  },
  {
    name: "1024x768 landscape window",
    layout: "inline",
    use: { viewport: { width: 1024, height: 768 } }
  }
];

// What the person can see: the visual viewport, against the page's own
// scroll width.
function readPageFit(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const visible = window.visualViewport ?? { offsetLeft: 0, width: window.innerWidth };
    return {
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      innerWidth: window.innerWidth,
      visibleLeft: visible.offsetLeft,
      visibleRight: visible.offsetLeft + visible.width
    };
  });
}

// Scrolls the page vertically only, so the control is on screen top to
// bottom without the browser also scrolling it in from the side.
async function scrollToVertically(locator) {
  await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    window.scrollTo({ left: window.scrollX, top: window.scrollY + rect.top - window.innerHeight / 3, behavior: "instant" });
  });
}

// Where a control is, and whether a press at its centre reaches it.
function readControlPlacement(locator) {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const hit = document.elementFromPoint(center.x, center.y);
    const visible = window.visualViewport ?? { offsetLeft: 0, width: window.innerWidth };
    return {
      left: rect.left,
      right: rect.right,
      visibleLeft: visible.offsetLeft,
      visibleRight: visible.offsetLeft + visible.width,
      center,
      isHit: Boolean(hit && element.contains(hit))
    };
  });
}

function expectInsideVisibleWidth(placement) {
  expect(placement.left).toBeGreaterThanOrEqual(placement.visibleLeft);
  expect(placement.right).toBeLessThanOrEqual(placement.visibleRight + 0.5);
  expect(placement.isHit).toBe(true);
}

async function pressAt(page, point, touch) {
  if (touch) {
    await page.touchscreen.tap(point.x, point.y);
  } else {
    await page.mouse.click(point.x, point.y);
  }
}

for (const size of MID_WIDTHS) {
  test.describe(`Month fits a mid-width screen (${size.name})`, () => {
    test.use(size.use);
    const touch = Boolean(size.use.hasTouch);

    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
      await page.goto("/");
      await reseedDemo(page);
      await gotoPageAfterApi(
        page,
        "/month?view=person-tim&month=2026-05&scope=direct_plus_shared",
        "/api/month-page",
        () => page.getByRole("button", { name: "+ Add planned item" })
      );
    });

    test("the page does not scroll sideways and every table column stays reachable", async ({ page }) => {
      const fit = await readPageFit(page);
      expect(fit.scrollWidth).toBeLessThanOrEqual(fit.clientWidth);
      // Full mobile emulation must not have widened the layout viewport.
      expect(fit.innerWidth).toBeLessThanOrEqual(size.use.viewport.width);

      // Each table fits its section or scrolls inside it; the Note column
      // (the last one) can always be brought into view without the page
      // itself moving sideways.
      const planned = page.locator(".month-plan-section-planned");
      const wrap = planned.locator(".month-table-wrap");
      const lastHeader = wrap.locator("thead th").last();
      await expect(lastHeader).toHaveText(/note/i);
      await wrap.evaluate((element) => {
        element.scrollLeft = element.scrollWidth;
      });
      await scrollToVertically(lastHeader);
      const header = await readControlPlacement(lastHeader);
      expectInsideVisibleWidth(header);
      expect(await page.evaluate(() => window.scrollX)).toBe(0);

      // The money columns are on screen with the table scrolled back.
      await wrap.evaluate((element) => {
        element.scrollLeft = 0;
      });
      for (const name of ["Planned", "Actual", "Variance"]) {
        const cell = wrap.locator("thead th").filter({ hasText: name });
        expectInsideVisibleWidth(await readControlPlacement(cell));
      }
    });

    test("every page tab and month control in the header is on screen and not covered", async ({ page }) => {
      const tabs = page.locator("nav.tab-strip > a.tab:visible");
      const tabNames = await tabs.allTextContents();
      expect(tabNames.map((name) => name.trim())).toEqual(expect.arrayContaining(["Summary", "Month", "Entries", "Settings", "FAQ"]));
      const controls = [
        ...(await tabs.all()),
        page.getByRole("button", { name: "Previous period" }),
        page.getByRole("button", { name: "Next period" }),
        page.locator(".totals-visibility-toggle--header")
      ];
      for (const control of controls) {
        expectInsideVisibleWidth(await readControlPlacement(control));
      }
    });

    test("+ Add planned item is on screen and opens the new item", async ({ page }) => {
      const add = page.getByRole("button", { name: "+ Add planned item" });
      await scrollToVertically(add);
      const placement = await readControlPlacement(add);
      expectInsideVisibleWidth(placement);

      await pressAt(page, placement.center, touch);
      if (size.layout === "sheet") {
        const sheet = page.locator('.entry-mobile-sheet[aria-label="+ Add planned item"]');
        await expect(sheet).toBeVisible();
        await sheet.getByRole("button", { name: "Cancel", exact: true }).click();
        await expect(sheet).toHaveCount(0);
      } else {
        const editing = page.locator(".month-plan-section-planned tr.is-editing");
        await expect(editing).toHaveCount(1);
        const save = page.getByTestId("month-inline-save-button");
        await scrollToVertically(save);
        expectInsideVisibleWidth(await readControlPlacement(save));
        const fit = await readPageFit(page);
        expect(fit.scrollWidth).toBeLessThanOrEqual(fit.clientWidth);
      }
    });

    test("a plan row's open button is on screen and opens the row", async ({ page }) => {
      const opener = page.getByRole("button", { name: "Edit Netflix row" });
      await scrollToVertically(opener);
      const placement = await readControlPlacement(opener);
      expectInsideVisibleWidth(placement);
      // The row's table sits inside the visible width too, so the rest of the
      // row is reached by scrolling the table, not the page.
      const table = await readControlPlacement(page.locator(".month-plan-section-planned .month-table-wrap"));
      expect(table.left).toBeGreaterThanOrEqual(table.visibleLeft);
      expect(table.right).toBeLessThanOrEqual(table.visibleRight + 0.5);

      await pressAt(page, placement.center, touch);
      if (size.layout === "sheet") {
        await expect(page.locator('.entry-mobile-sheet[aria-label="Edit planned item"]')).toBeVisible();
        return;
      }
      // Desktop editing: the inputs widen the row, but the page still fits
      // and Save stays on screen, inside the table's own scroll area if the
      // table is wider than its section.
      const row = page.locator("tr.is-editing");
      await expect(row.locator(".table-edit-input-money")).toBeVisible();
      const save = page.getByTestId("month-inline-save-button");
      await scrollToVertically(save);
      const savePlacement = await readControlPlacement(save);
      expectInsideVisibleWidth(savePlacement);
      const fit = await readPageFit(page);
      expect(fit.scrollWidth).toBeLessThanOrEqual(fit.clientWidth);

      await row.locator(".table-edit-input-money").fill("24.50");
      await pressAt(page, savePlacement.center, false);
      await expect(page.locator("tr.is-editing")).toHaveCount(0);
      await expect(page.locator("tr").filter({ hasText: "Netflix" }).first()).toContainText("$24.50");
    });

    if (size.layout === "sheet") {
      test("the edit sheet fits the screen width and saves from its own button", async ({ page }) => {
        const opener = page.getByRole("button", { name: "Edit Netflix row" });
        await scrollToVertically(opener);
        await pressAt(page, (await readControlPlacement(opener)).center, touch);
        const sheet = page.locator('.entry-mobile-sheet[aria-label="Edit planned item"]');
        await expect(sheet).toBeVisible();

        const placement = await sheet.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const save = element.querySelector("button.dialog-primary");
          const saveRect = save.getBoundingClientRect();
          const saveCenter = { x: saveRect.left + saveRect.width / 2, y: saveRect.top + saveRect.height / 2 };
          const hit = document.elementFromPoint(saveCenter.x, saveCenter.y);
          const visible = window.visualViewport ?? { offsetLeft: 0, width: window.innerWidth };
          return {
            left: rect.left,
            right: rect.right,
            width: rect.width,
            visibleLeft: visible.offsetLeft,
            visibleRight: visible.offsetLeft + visible.width,
            visibleWidth: visible.width,
            saveRight: saveRect.right,
            saveCenter,
            saveIsHit: Boolean(hit && save.contains(hit))
          };
        });
        expect(placement.left).toBeGreaterThanOrEqual(placement.visibleLeft);
        expect(placement.right).toBeLessThanOrEqual(placement.visibleRight + 0.5);
        expect(placement.width).toBeLessThanOrEqual(placement.visibleWidth + 0.5);
        expect(placement.saveRight).toBeLessThanOrEqual(placement.visibleRight + 0.5);
        expect(placement.saveIsHit).toBe(true);

        await sheet.locator('input[value="22.97"]').fill("23.50");
        await pressAt(page, placement.saveCenter, touch);
        await expect(sheet).toHaveCount(0);
        await expect(page.locator("tr").filter({ hasText: "Netflix" }).first()).toContainText("$23.50");
      });
    }
  });
}

// The mid-width rules stop at both ends of their range: a wide desktop keeps
// full-size cells, one-line notes and a one-row header, and a phone keeps
// its own header grid.
function readOutOfRangeLayout(page) {
  return page.evaluate(() => {
    const cell = document.querySelector(".month-plan-section-planned .month-table-wrap td");
    const note = document.querySelector(".month-plan-section-planned .note-trigger span");
    const tabs = document.querySelector("nav.tab-strip").getBoundingClientRect();
    const period = document.querySelector(".period-display").getBoundingClientRect();
    return {
      cellPadding: getComputedStyle(cell).paddingLeft,
      noteWhiteSpace: getComputedStyle(note).whiteSpace,
      periodInlineDisplay: getComputedStyle(document.querySelector(".period-inline")).display,
      periodBelowTabs: period.top >= tabs.bottom
    };
  });
}

test.describe("Month outside the mid-width range", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.goto("/");
    await reseedDemo(page);
  });

  test("a 1280 px desktop keeps full-size cells, one-line notes and a one-row header", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoPageAfterApi(page, "/month?view=person-tim&month=2026-05&scope=direct_plus_shared", "/api/month-page", () => page.getByRole("button", { name: "+ Add planned item" }));
    expect(await readOutOfRangeLayout(page)).toEqual({
      cellPadding: "10px",
      noteWhiteSpace: "nowrap",
      periodInlineDisplay: "flex",
      periodBelowTabs: false
    });
  });

  test("a 390 px phone keeps its own header grid and one-line notes", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoPageAfterApi(page, "/month?view=person-tim&month=2026-05&scope=direct_plus_shared", "/api/month-page", () => page.getByRole("button", { name: "+ Add planned item" }));
    const layout = await readOutOfRangeLayout(page);
    expect(layout.periodInlineDisplay).toBe("grid");
    expect(layout.noteWhiteSpace).toBe("nowrap");
    expect(layout.cellPadding).toBe("10px");
  });
});
