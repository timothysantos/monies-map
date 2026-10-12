import { expect, test } from "@playwright/test";

import { gotoPageAfterApi, postJson, reseedDemo } from "./helpers";

// On a phone the Money insights fold to one row (financial-insight.jsx,
// InsightFoldRow). Folded is the default; the choice is remembered in this
// browser. A To do headline stays in the row, so a warning is never hidden.
const PHONE = { width: 390, height: 664 };
const OPEN_KEY = "monies-map:money-insights-phone";

const SUMMARY = ["/summary?view=household&month=2026-05&scope=direct_plus_shared&summary_start=2026-05&summary_end=2026-05", "/api/summary-page", "Summary"];
const MONTH = ["/month?view=person-tim&month=2026-05&scope=direct_plus_shared", "/api/month-page", "Month"];

async function open(page, [path, api]) {
  await gotoPageAfterApi(page, path, api, () => page.locator(".financial-insight").first());
}

const foldRow = (page) => page.locator(".financial-insight .financial-insight-fold");

async function waitUsable(page) {
  await expect.poll(() => page.evaluate(() => window.__MONIES_MAP_ROUTE_WORK__?.usable ?? false), { timeout: 30_000 }).toBe(true);
}

async function seedTripSplits(page) {
  const { groupId } = await postJson(page, "/api/splits/groups/create", { name: "Tokyo trip", currency: "JPY", expenseSource: "cash" });
  await postJson(page, "/api/splits/expenses/create", {
    groupId, date: "2026-05-12", description: "Shinjuku hotel", categoryName: "Travel", payerPersonName: "Tim",
    amountMinor: 1_200_000, splitBasisPoints: 2500, currency: "JPY", paymentMethod: "cash", paymentStatus: "recorded"
  });
  return [`/splits?view=person-tim&month=2026-05&split_group=${groupId}`, "/api/splits-page", "Splits"];
}

test.describe("money insights fold on a phone", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await reseedDemo(page);
  });

  // The teaser card: at most ~96px with the eyebrow above it; a "+N more"
  // pill and the stacked edges exist only when more insights wait behind it.
  async function expectDeckHint(page, row) {
    const more = Number((await row.getAttribute("data-more")) ?? 0);
    const shadow = await row.evaluate((element) => getComputedStyle(element).boxShadow);
    if (more > 0) {
      await expect(row.locator(".financial-insight-more")).toHaveText(`+${more} more`);
      expect(shadow).not.toBe("none");
    } else {
      await expect(row.locator(".financial-insight-more")).toHaveCount(0);
      expect(shadow).toBe("none");
    }
    return more;
  }

  // Card rows: the headline and the start of its think line are one line each
  // with an ellipsis rule, and the card is as wide as the content column.
  async function expectSingleLines(row) {
    const lines = await row.evaluate((card) => [...card.querySelectorAll(":scope > strong, :scope > .financial-insight-think")].map((element) => {
      const style = getComputedStyle(element);
      const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.3;
      return { cls: element.className || element.tagName, ellipsis: style.textOverflow, wrap: style.whiteSpace, tall: element.getBoundingClientRect().height > lineHeight * 1.5 };
    }));
    expect(lines.map((line) => line.ellipsis)).toEqual(lines.map(() => "ellipsis"));
    expect(lines.map((line) => line.wrap)).toEqual(lines.map(() => "nowrap"));
    expect(lines.filter((line) => line.tall)).toEqual([]);
    return lines.length;
  }

  async function expectFullWidth(page, row) {
    const card = await row.boundingBox();
    const column = await page.locator(".financial-insight").boundingBox();
    expect(Math.abs(card.width - column.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(card.x - column.x)).toBeLessThanOrEqual(2);
  }

  test("Summary folds to a teaser card of its top insight and opens to the full block", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await open(page, SUMMARY);
    const row = foldRow(page);
    const section = page.locator(".financial-insight");
    await expect(row).toHaveAttribute("aria-expanded", "false");
    await expect(section.locator(".financial-insight-label")).toHaveText("Household money insights");
    // The card shows the real headline (also in the block's own text).
    const headline = (await section.locator(".checkin-fact").evaluate((element) => element.textContent)).trim();
    await expect(row.locator("strong")).toHaveText(headline);
    await expect(row).toBeVisible();
    expect((await row.boundingBox()).height).toBeLessThanOrEqual(96);
    expect((await row.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await expect(section.locator(".checkin-fact")).toBeHidden();
    const more = await expectDeckHint(page, row);

    await row.click();
    await expect(row).toHaveAttribute("aria-expanded", "true");
    await expect(section.locator(".checkin-fact")).toBeVisible();
    await expect(row.locator("strong")).toHaveCount(0);
    await expect.poll(async () => (await section.boundingBox()).height).toBeGreaterThan(120);
    // "+N more" counts the insights "See all insights" lists.
    if (more > 0) {
      await page.getByRole("button", { name: "See all insights" }).click();
      await expect(section.locator(".checkin-also li")).toHaveCount(more);
    }

    await row.click();
    await expect(row).toHaveAttribute("aria-expanded", "false");
    expect((await row.boundingBox()).height).toBeLessThanOrEqual(96);
  });

  test("Splits teaser keeps the To do chip and headline, at most two lines, on the orange", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await open(page, await seedTripSplits(page));
    const row = foldRow(page);
    await expect(row).toHaveAttribute("aria-expanded", "false");
    await expect(row.locator(".checkin-chip")).toHaveText("To do");
    await expect(row.locator("strong")).toContainText("Joyce owes you JP¥9,000");
    expect((await foldRow(page).boundingBox()).height).toBeLessThanOrEqual(96);
    await expectSingleLines(row);
    await expectDeckHint(page, row);
    await expect(row.locator(".financial-insight-think")).toBeVisible();
    await expectFullWidth(page, row);
    await row.click();
    await expect(page.locator(".financial-insight-content .checkin-fact")).toContainText("Joyce owes you JP¥9,000");
  });

  test("Month teaser shows its To do headline with a +N more pill and stacked edges, and the choice survives a reload", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await open(page, MONTH);
    const row = foldRow(page);
    await expect(row.locator(".checkin-chip")).toHaveText("To do");
    await expect(row.locator("strong")).toContainText(/\bbills? (?:you )?planned\b|\bplanned at\b/);
    expect(await expectDeckHint(page, row)).toBeGreaterThan(0);
    // Rows: headline, then the start of the think line, single-line each.
    expect(await expectSingleLines(row)).toBe(2);
    const think = (await page.locator(".financial-insight-content .checkin-think").evaluate((element) => element.textContent)).trim();
    await expect(row.locator(".financial-insight-think")).toHaveText(think);
    await expectFullWidth(page, row);
    expect((await foldRow(page).boundingBox()).height).toBeLessThanOrEqual(96);
    await row.click();
    await expect(row).toHaveAttribute("aria-expanded", "true");
    expect(await page.evaluate((key) => window.localStorage.getItem(key), OPEN_KEY)).toBe("true");

    await page.reload();
    await waitUsable(page);
    await expect(foldRow(page)).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".financial-insight .checkin-fact")).toBeVisible();

    await foldRow(page).click();
    await page.reload();
    await waitUsable(page);
    await expect(foldRow(page)).toHaveAttribute("aria-expanded", "false");
  });

  test("hidden money folds to a card with only a count: no headline, chip, pill or amounts", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "false"));
    await open(page, MONTH);
    const row = foldRow(page);
    await expect(row).toBeVisible();
    await expect(row.locator(".checkin-chip")).toHaveCount(0);
    await expect(row.locator(".financial-insight-more")).toHaveCount(0);
    await expect(row.locator(".financial-insight-think")).toHaveCount(0);
    await expect(row.locator("strong")).toHaveCount(0);
    const text = (await row.innerText()).replace(/\s+/g, " ").trim();
    expect(text).toMatch(/^\d+ insights? · tap to see$/);
    expect(text).not.toMatch(/\$|\d{2,}|owe|short|over|under|plan/i);
    expect((await foldRow(page).boundingBox()).height).toBeLessThanOrEqual(96);
  });

  test("desktop starts expanded on a first visit, can fold, and remembers it apart from the phone", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page, MONTH);
    const row = foldRow(page);
    await expect(row).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".financial-insight .checkin-fact")).toBeVisible();
    await expect(page.getByRole("button", { name: "See all insights" })).toBeVisible();

    await row.click();
    await expect(row).toHaveAttribute("aria-expanded", "false");
    await expect(row.locator(".checkin-chip")).toHaveText("To do");
    await expect(page.locator(".financial-insight .checkin-fact")).toBeHidden();
    expect((await foldRow(page).boundingBox()).height).toBeLessThanOrEqual(96);
    // The desktop choice is its own key; the phone's key is untouched.
    expect(await page.evaluate(() => [localStorage.getItem("monies-map:money-insights-desktop"), localStorage.getItem("monies-map:money-insights-phone")])).toEqual(["false", null]);

    await page.reload();
    await waitUsable(page);
    await expect(foldRow(page)).toHaveAttribute("aria-expanded", "false");
    // Narrowing to a phone: still its own default (folded), and opening it
    // there leaves the desktop choice alone.
    await page.setViewportSize(PHONE);
    await expect(foldRow(page)).toHaveAttribute("aria-expanded", "false");
    await foldRow(page).click();
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(foldRow(page)).toHaveAttribute("aria-expanded", "false");
  });

  test("a phone fold choice does not change desktop", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await open(page, MONTH);
    await foldRow(page).click();
    await expect(foldRow(page)).toHaveAttribute("aria-expanded", "true");
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(foldRow(page)).toHaveAttribute("aria-expanded", "true");
    await foldRow(page).click();
    await page.setViewportSize(PHONE);
    await expect(foldRow(page)).toHaveAttribute("aria-expanded", "true");
  });

  test("Splits folds and opens on desktop too", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page, await seedTripSplits(page));
    const row = foldRow(page);
    await expect(row).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".financial-insight .checkin-fact")).toContainText("Joyce owes you JP¥9,000");
    await row.click();
    await expect(row.locator("strong")).toContainText("Joyce owes you JP¥9,000");
    await expect(page.locator(".financial-insight .checkin-fact")).toBeHidden();
  });

  test("without usable storage the phone block still renders folded and toggles", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.addInitScript(() => {
      const realGet = Storage.prototype.getItem;
      const realSet = Storage.prototype.setItem;
      Storage.prototype.getItem = function (key) {
        if (key.startsWith("monies-map:money-insights-")) throw new Error("blocked");
        return realGet.call(this, key);
      };
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith("monies-map:money-insights-")) throw new Error("blocked");
        return realSet.call(this, key, value);
      };
    });
    await open(page, MONTH);
    await expect(foldRow(page)).toHaveAttribute("aria-expanded", "false");
    await foldRow(page).click();
    await expect(foldRow(page)).toHaveAttribute("aria-expanded", "true");
  });
});
