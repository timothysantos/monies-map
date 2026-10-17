import { devices, expect, test } from "@playwright/test";

import { gotoPageAfterApi, loadSplitsPage, postJson, reseedDemo } from "./helpers";

// The Splits group strip (design.md, "Splits group strip"): in the page flow
// under the person switcher, a solid New/All control in its own left column,
// the groups scrolling to its right, the open group leading as a white tile,
// and a floating bar when the strip has scrolled away. The phone runs on the
// iPhone 13 profile (and in WebKit via @webkit).

const { defaultBrowserType: _browser, ...iPhone13 } = devices["iPhone 13"];
const URL_NO_GROUP = "/splits?view=person-tim&month=2025-10";
const VISIBLE_KEY = "monies-map:money-totals-visible";

async function openSplits(page, path = URL_NO_GROUP) {
  await gotoPageAfterApi(page, path, "/api/splits-page", () => page.locator(".splits-strip"));
}

async function seed(page, { hidden = false } = {}) {
  await page.addInitScript(([key, value]) => {
    if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, value);
  }, [VISIBLE_KEY, hidden ? "false" : "true"]);
  await reseedDemo(page);
}

async function groupsFromApi(page) {
  return (await loadSplitsPage(page)).splitsPage.groups;
}

// Make sure the household has enough groups for a narrow desktop row to overflow.
async function ensureGroupCount(page, count) {
  let groups = await groupsFromApi(page);
  for (let index = groups.length; index < count; index += 1) {
    await postJson(page, "/api/splits/groups/create", { name: `Strip extra ${index}`, currency: "SGD", expenseSource: "mixed" });
  }
  groups = await groupsFromApi(page);
  return groups;
}

// Settled groups sit behind one folded row in the sheet; open it to see them.
async function unfoldSettled(sheet) {
  const fold = sheet.getByRole("button", { name: /settled groups?$/ });
  if (await fold.count()) await fold.click();
}

const box = async (locator) => {
  const value = await locator.boundingBox();
  expect(value).not.toBeNull();
  return value;
};

test.describe("Splits group strip on a phone", { tag: "@webkit" }, () => {
  test.use(iPhone13);

  test("sits in the page flow with a solid New/All control outside the scroller", async ({ page }) => {
    await seed(page);
    await openSplits(page);
    const strip = page.locator(".splits-strip");
    const scroller = strip.locator(".splits-strip-scroll");
    const control = strip.locator(".splits-strip-control");

    for (const selector of [".splits-strip", ".splits-strip-control", ".splits-strip-scroll"]) {
      const position = await page.locator(selector).evaluate((element) => getComputedStyle(element).position);
      expect(["fixed", "sticky"], selector).not.toContain(position);
    }
    // In the flow: above the heading and the insights, not floating over rows.
    const stripBox = await box(strip);
    expect(stripBox.y).toBeLessThan((await box(page.locator(".financial-insight-splits"))).y);
    // The control is its own column, not a child of the scroller, and the
    // scroller starts at the control's right edge.
    await expect(scroller.locator(".splits-strip-control")).toHaveCount(0);
    expect(await page.locator(".splits-strip-scroll").evaluate((node) => node.contains(document.querySelector(".splits-strip-control")))).toBe(false);
    const controlBox = await box(control);
    const scrollerBox = await box(scroller);
    expect(scrollerBox.x).toBeGreaterThanOrEqual(controlBox.x + controlBox.width - 0.5);
    expect(controlBox.width).toBeGreaterThanOrEqual(54);
    expect(controlBox.width).toBeLessThanOrEqual(60);
    // Solid cream, a soft 1px border, no dashed outline (not a translucent group tile).
    const look = await control.evaluate((element) => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, borderStyle: style.borderTopStyle, borderWidth: style.borderTopWidth };
    });
    expect(look.borderStyle).toBe("solid");
    expect(look.borderWidth).toBe("1px");
    expect(look.background).toMatch(/^rgb\(|^rgba\(\d+, \d+, \d+, 0?\.9\d*\)$/);
  });

  test("New and All are 44 px buttons that open the right things", async ({ page }) => {
    await seed(page);
    await openSplits(page);
    const newButton = page.getByRole("button", { name: "Create group" }).first();
    const allButton = page.getByRole("button", { name: "All groups" }).first();
    for (const button of [newButton, allButton]) {
      const rect = await box(button);
      expect(rect.height).toBeGreaterThanOrEqual(44);
      expect(rect.width).toBeGreaterThanOrEqual(44);
    }
    await expect(newButton).toContainText("New");
    await expect(allButton).toContainText("All");

    await newButton.click();
    await expect(page.getByRole("dialog", { name: "Create group" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Create group" })).toHaveCount(0);

    await allButton.click();
    const sheet = page.getByRole("dialog", { name: "All groups" });
    await expect(sheet).toBeVisible();
    const groups = await groupsFromApi(page);
    await unfoldSettled(sheet);
    for (const group of groups) {
      await expect(sheet.getByRole("button", { name: new RegExp(group.name) }).first()).toBeVisible();
    }
    await expect(sheet.getByRole("button", { name: "Create group" })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Done" })).toBeVisible();

    // Choosing a row opens that group and closes the sheet.
    const other = groups.find((group) => group.name !== "Non-group expenses");
    await sheet.getByRole("button", { name: new RegExp(other.name) }).first().click();
    await expect(sheet).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`split_group=${other.id}`));
  });

  test("groups scroll to the right of the control and never slide under or behind it", async ({ page }) => {
    await seed(page);
    await ensureGroupCount(page, 5);
    await openSplits(page);
    const strip = page.locator(".splits-strip");
    const scroller = strip.locator(".splits-strip-scroll");
    const control = strip.locator(".splits-strip-control");
    const before = await box(control);
    const maskImage = await scroller.evaluate((element) => getComputedStyle(element).maskImage || getComputedStyle(element).webkitMaskImage);
    expect(maskImage).toContain("linear-gradient");

    expect(await scroller.evaluate((element) => element.scrollWidth > element.clientWidth + 40)).toBe(true);
    await scroller.evaluate((element) => element.scrollTo({ left: element.scrollWidth, behavior: "instant" }));
    await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(40);

    // The control did not move; the scroller (which clips the tiles) starts
    // at its right edge, so no tile box shows left of it.
    const after = await box(control);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    const scrollerBox = await box(scroller);
    expect(scrollerBox.x).toBeGreaterThanOrEqual(after.x + after.width - 0.5);
    const clipping = await scroller.evaluate((element) => getComputedStyle(element).overflowX);
    expect(clipping).toBe("auto");
    const visibleTiles = await scroller.locator(".splits-strip-tile").evaluateAll((tiles, scrollerLeft) => (
      tiles.map((tile) => tile.getBoundingClientRect()).filter((rect) => rect.right > scrollerLeft + 1 && rect.left < scrollerLeft)
    ), scrollerBox.x);
    // A tile that is partly scrolled off is clipped by the scroller, not drawn over the control.
    for (const rect of visibleTiles) {
      expect(rect.left).toBeLessThan(scrollerBox.x);
    }
  });

  test("a long open-group name stays on one line with an ellipsis and every tile is the same height", async ({ page }) => {
    await seed(page);
    const longName = "Weekend trip to Chiang Mai with the whole family";
    await postJson(page, "/api/splits/groups/create", { name: longName, currency: "SGD", expenseSource: "mixed" });
    const created = (await groupsFromApi(page)).find((group) => group.name === longName);
    expect(created).toBeTruthy();
    await openSplits(page, `${URL_NO_GROUP}&split_group=${created.id}`);

    const tiles = page.locator(".splits-strip-tile");
    await expect(tiles.first()).toBeVisible();
    await expect(page.locator(".splits-strip-tile.is-active .splits-strip-tile-name")).toHaveText(longName);
    expect(await tiles.count()).toBeGreaterThan(1);

    const name = page.locator(".splits-strip-tile.is-active .splits-strip-tile-name");
    const look = await name.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        overflow: style.textOverflow,
        whiteSpace: style.whiteSpace,
        lineHeight: Number.parseFloat(style.lineHeight),
        height: element.getBoundingClientRect().height,
        clipped: element.scrollWidth > element.clientWidth,
      };
    });
    expect(look.overflow).toBe("ellipsis");
    expect(look.whiteSpace).toBe("nowrap");
    expect(look.height).toBeLessThanOrEqual(look.lineHeight + 1);
    expect(look.clipped).toBe(true);

    // The name never makes its tile taller than the others.
    const heights = await tiles.evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().height)));
    expect(new Set(heights).size, `tile heights ${heights}`).toBe(1);
  });

  test("the open group leads as a white tile and is remembered across a reload", async ({ page }) => {
    await seed(page);
    await openSplits(page);
    const tiles = page.locator(".splits-strip-tile");
    const groups = await groupsFromApi(page);
    const target = groups.find((group) => group.name !== "Non-group expenses" && group.id !== (new URL(page.url()).searchParams.get("split_group")));
    await tiles.filter({ hasText: target.name }).first().click();
    await expect(page).toHaveURL(new RegExp(`split_group=${target.id}`));
    const lead = tiles.first();
    await expect(lead).toContainText(target.name);
    await expect(lead).toHaveAttribute("aria-current", "true");
    await expect(lead).toHaveClass(/is-active/);
    await expect(lead).toContainText(/\d+ entr(y|ies)/);
    const look = await lead.evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(look).toMatch(/^rgba?\(255, 255, 255/);
    await expect(page.locator(".splits-strip-tile[aria-current='true']")).toHaveCount(1);

    // Back to Splits with no group in the address: the last-used group opens, first.
    await openSplits(page, URL_NO_GROUP);
    await expect(page).toHaveURL(new RegExp(`split_group=${target.id}`));
    await expect(page.locator(".splits-strip-tile").first()).toContainText(target.name);
    await expect(page.locator(".splits-strip-tile").first()).toHaveAttribute("aria-current", "true");
  });

  test("open balances come first, then Non-group expenses, which never says Settled", async ({ page }) => {
    await seed(page);
    await openSplits(page);
    const texts = await page.locator(".splits-strip-tile:not(.is-active)").allInnerTexts();
    const lines = texts.map((text) => text.replace(/\s+/g, " ").trim());
    const owed = lines.map((line, index) => (/owes you/.test(line) ? index : -1)).filter((index) => index >= 0);
    const owe = lines.map((line, index) => (/You owe/.test(line) ? index : -1)).filter((index) => index >= 0);
    const nonGroup = lines.findIndex((line) => line.startsWith("Non-group expenses"));
    expect(owed.every((index) => owe.every((other) => index < other))).toBe(true);
    for (const index of [...owed, ...owe]) {
      if (nonGroup >= 0) expect(index).toBeLessThan(nonGroup);
    }
    for (const line of lines.filter((value) => value.startsWith("Non-group expenses"))) {
      expect(line).not.toContain("Settled");
    }
    const lead = (await page.locator(".splits-strip-tile").first().innerText()).replace(/\s+/g, " ");
    if (lead.startsWith("Non-group expenses")) expect(lead).not.toContain("Settled");
  });

  test("hidden money reads Balance hidden on every tile and in the sheet", async ({ page }) => {
    await seed(page, { hidden: true });
    await openSplits(page);
    const tiles = page.locator(".splits-strip-tile");
    const total = await tiles.count();
    expect(total).toBeGreaterThan(1);
    for (let index = 0; index < total; index += 1) {
      const text = (await tiles.nth(index).innerText()).replace(/\s+/g, " ");
      expect(text).toContain("Balance hidden");
      expect(text).not.toMatch(/owes|owe |Settled|No balance|\$\d/);
    }
    await page.getByRole("button", { name: "All groups" }).first().click();
    const sheet = page.getByRole("dialog", { name: "All groups" });
    await expect(sheet).toBeVisible();
    const sheetText = await sheet.innerText();
    expect(sheetText).toContain("Balance hidden");
    expect(sheetText).not.toMatch(/owes you|You owe|settled group|\$\d/);
  });

  test("scrolling down collapses the strip into a floating bar; scrolling back up restores it", async ({ page }) => {
    await seed(page);
    await openSplits(page, `${URL_NO_GROUP}&split_group=split-group-none`);
    const bar = page.locator(".splits-group-bar");
    await expect(bar).toHaveCount(0);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(bar).toBeVisible();
    await expect(bar).toContainText("Non-group expenses");
    const position = await bar.evaluate((element) => getComputedStyle(element).position);
    expect(position).toBe("fixed");
    // The Splits receipt button and the eye stay where they are.
    await expect(page.locator(".splits-fab")).toBeVisible();
    const barBox = await box(bar);
    const fabBox = await box(page.locator(".splits-fab"));
    expect(barBox.x + barBox.width).toBeLessThanOrEqual(fabBox.x);

    await bar.click();
    await expect(page.getByRole("dialog", { name: "All groups" })).toBeVisible();
    await page.getByRole("dialog", { name: "All groups" }).getByRole("button", { name: "Done" }).click();

    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(bar).toHaveCount(0);
    await expect(page.locator(".splits-strip")).toBeInViewport();
  });
});

test.describe("Splits group strip on a desktop", () => {
  test("one row with the split New/All control first, in the flow, never wrapping", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await seed(page);
    await openSplits(page);
    const strip = page.locator(".splits-strip");
    expect(await strip.evaluate((element) => getComputedStyle(element).position)).not.toBe("fixed");
    const control = await box(strip.locator(".splits-strip-control"));
    const tileBoxes = [];
    const tiles = strip.locator(".splits-strip-tile");
    for (let index = 0; index < await tiles.count(); index += 1) tileBoxes.push(await box(tiles.nth(index)));
    expect(tileBoxes.length).toBeGreaterThan(1);
    for (const rect of tileBoxes) {
      expect(Math.abs(rect.y - control.y)).toBeLessThanOrEqual(1);
      expect(rect.x).toBeGreaterThanOrEqual(control.x + control.width);
    }
    expect(await strip.locator(".splits-strip-scroll").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await expect(page.getByRole("button", { name: "Create group" }).first()).toContainText("New");
    await expect(page.locator(".splits-group-bar")).toHaveCount(0);

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(page.locator(".splits-group-bar")).toHaveCount(0);
    const tabs = page.locator(".desktop-splits-floating-tabs");
    await expect(tabs).toBeVisible();
    await expect(tabs.getByRole("link", { name: "Summary" })).toBeVisible();
    await expect(tabs.getByRole("link", { name: "Splits" })).toHaveAttribute("aria-current", "page");
    const groupActions = tabs.locator(".desktop-splits-group-actions");
    await expect(groupActions).toBeVisible();
    await expect(groupActions.getByRole("button", { name: "Non-group expenses" })).toBeVisible();
    // Groups are direct choices in the shared bar; the list icon still opens
    // the complete sheet when more groups exist than fit.
    await expect(groupActions.getByRole("button", { name: "All groups" })).toBeVisible();
    const tabsBox = await box(tabs);
    expect(tabsBox.x).toBeLessThanOrEqual(23);
    expect(Math.abs(tabsBox.y + tabsBox.height - 800 + 29)).toBeLessThanOrEqual(2);
  });

  test("a narrow row shows what fits and All carries the rest", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await seed(page);
    const groups = await ensureGroupCount(page, 6);
    await openSplits(page);
    const strip = page.locator(".splits-strip");
    const shown = await strip.locator(".splits-strip-tile").count();
    expect(shown).toBeLessThan(groups.length);
    const hidden = groups.length - shown;
    await expect(strip.getByRole("button", { name: "All groups" })).toContainText(`All · ${hidden} more`);
    // Never wraps: every tile shares the row.
    const tops = await strip.locator(".splits-strip-tile").evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
    expect(await strip.locator(".splits-strip-scroll").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);

    // The sheet still lists every group, including the ones not on the row.
    await strip.getByRole("button", { name: "All groups" }).click();
    const sheet = page.getByRole("dialog", { name: "All groups" });
    await unfoldSettled(sheet);
    for (const group of groups) {
      await expect(sheet.getByRole("button", { name: new RegExp(group.name) }).first()).toBeVisible();
    }
  });

  test("hidden money keeps the row and hides every balance", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await seed(page, { hidden: true });
    await openSplits(page);
    const tiles = page.locator(".splits-strip-tile");
    for (let index = 0; index < await tiles.count(); index += 1) {
      await expect(tiles.nth(index)).toContainText("Balance hidden");
    }
  });
});
