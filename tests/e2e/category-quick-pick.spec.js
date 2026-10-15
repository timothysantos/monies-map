import { devices, expect, test } from "@playwright/test";

import { categoryList, categoryOption, categorySearch, gotoPageAfterApi, loadEntriesPage, postJson, reseedDemo } from "./helpers";

// The category list behind an Entries row's category label (design.md
// "Category list"): a search on top, the best guess first with a "Best guess"
// tag, then every other category alphabetically, the current one checked.
// Desktop: a popover that focuses its search. Phone: a sheet that does not
// (the keyboard would cover the list).

const MONTH = "2026-05";
const { defaultBrowserType: _browser, ...iPhone13 } = devices["iPhone 13"];

async function seedShop(page, shop, { sameShopEntries = 3, category = "Entertainment", openCategory = "Other" } = {}) {
  for (let index = 0; index < sameShopEntries; index += 1) {
    await postJson(page, "/api/entries/create", {
      date: `${MONTH}-1${index}`,
      description: shop,
      accountName: "UOB One",
      categoryName: category,
      amountMinor: 1200 + index,
      entryType: "expense",
      ownershipType: "direct",
      ownerName: "Tim"
    });
  }
  const { entryId } = await postJson(page, "/api/entries/create", {
    date: `${MONTH}-24`,
    description: shop,
    accountName: "UOB One",
    categoryName: openCategory,
    amountMinor: 3210,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });
  return entryId;
}

async function openEntries(page, shop) {
  const row = page.locator(".entry-row").filter({ hasText: shop }).first();
  await gotoPageAfterApi(page, `/entries?view=person-tim&month=${MONTH}`, "/api/entries-page", () => row);
  return row;
}

const labelOf = (row) => row.locator(".entry-row-category-button");
const optionLabels = (page) => categoryList(page).locator(".category-pick-row-label").allTextContents();

test.describe("desktop", () => {
  test("the label opens a popover with the search focused, the best guess first and the rest alphabetical", async ({ page }) => {
    const shop = `Zzyzx Studio ${Date.now()}`;
    await reseedDemo(page);
    await seedShop(page, shop);
    const row = await openEntries(page, shop);

    await labelOf(row).click();
    await expect(categoryList(page)).toBeVisible();
    await expect(categorySearch(page)).toBeFocused();

    const labels = await optionLabels(page);
    expect(labels[0]).toBe("Entertainment");
    await expect(categoryOption(page, "Entertainment")).toContainText("Best guess");
    await expect(page.locator(".category-pick-tag")).toHaveCount(1);
    const rest = labels.slice(1);
    expect(rest).toEqual([...rest].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base", numeric: true })));
    expect(rest).toContain("Other");
    expect(labels).toHaveLength(new Set(labels).size);
    expect(labels).not.toContain("Transfer");
    // The current category is checked, wherever it sits.
    await expect(categoryOption(page, "Other")).toHaveAttribute("aria-selected", "true");
    await expect(categoryOption(page, "Entertainment")).toHaveAttribute("aria-selected", "false");
  });

  test("typing filters by name and by everyday word; arrow keys and Enter pick; the row updates after the save", async ({ page }) => {
    const shop = `Zzyzx Studio ${Date.now()}`;
    await reseedDemo(page);
    await seedShop(page, shop);
    const row = await openEntries(page, shop);

    await labelOf(row).click();
    await categorySearch(page).fill("foo");
    expect(await optionLabels(page)).toEqual(["Food & Drinks"]);
    await categorySearch(page).fill("kopi");
    expect(await optionLabels(page)).toEqual(["Food & Drinks"]);
    await categorySearch(page).fill("COFFEE");
    expect(await optionLabels(page)).toEqual(["Food & Drinks"]);

    await categorySearch(page).fill("");
    await categorySearch(page).press("ArrowDown");
    await expect(page.locator(".category-pick-row.is-active")).toHaveAttribute("data-category-option", "Entertainment");
    await categorySearch(page).fill("tax");
    await expect(page.locator(".category-pick-row.is-active")).toHaveCount(1);
    await categorySearch(page).press("ArrowDown");
    const picked = await page.locator(".category-pick-row.is-active").getAttribute("data-category-option");

    const update = page.waitForResponse((response) => response.url().includes("/api/entries/update") && response.ok());
    await categorySearch(page).press("Enter");
    const response = await update;
    expect(JSON.parse(response.request().postData() ?? "{}")).toMatchObject({ categoryName: picked });
    await expect(categoryList(page)).toHaveCount(0);
    await expect(labelOf(row)).toHaveText(picked);
    await expect(labelOf(row)).toBeFocused();

    const saved = await loadEntriesPage(page, { view: "person-tim", month: MONTH });
    expect(saved.monthPage.entries.find((entry) => entry.description === shop && entry.date === `${MONTH}-24`)?.categoryName).toBe(picked);
  });

  test("Escape closes it with focus back on the label and nothing saved", async ({ page }) => {
    const shop = `Zzyzx Studio ${Date.now()}`;
    await reseedDemo(page);
    await seedShop(page, shop);
    const row = await openEntries(page, shop);
    let updates = 0;
    page.on("request", (request) => { if (request.url().includes("/api/entries/update")) updates += 1; });

    await labelOf(row).click();
    await expect(categorySearch(page)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(categoryList(page)).toHaveCount(0);
    await expect(labelOf(row)).toBeFocused();
    expect(updates).toBe(0);
    await expect(labelOf(row)).toHaveText("Other");
    // The row did not open its editor.
    await expect(page.locator(".entry-edit-card")).toHaveCount(0);
  });

  test("an unknown shop has no best guess: a plain alphabetical list; no match shows the empty line with Clear search", async ({ page }) => {
    const shop = `Qqq Nobody ${Date.now()}`;
    await reseedDemo(page);
    await seedShop(page, shop, { sameShopEntries: 0 });
    const row = await openEntries(page, shop);

    await labelOf(row).click();
    await expect(categoryList(page)).toBeVisible();
    await expect(page.locator(".category-pick-tag")).toHaveCount(0);
    const labels = await optionLabels(page);
    expect(labels).toEqual([...labels].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base", numeric: true })));
    await expect(categoryOption(page, "Other")).toHaveAttribute("aria-selected", "true");

    await categorySearch(page).fill("zzzz");
    await expect(page.getByText('No category matches "zzzz"')).toBeVisible();
    await expect(categoryList(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Clear search" }).last().click();
    await expect(categoryList(page)).toBeVisible();
    await expect(categorySearch(page)).toHaveValue("");
    expect((await optionLabels(page)).length).toBe(labels.length);
  });

  test("a refused save keeps the list open with the message and the row unchanged", async ({ page }) => {
    const shop = `Zzyzx Studio ${Date.now()}`;
    await reseedDemo(page);
    await seedShop(page, shop);
    const row = await openEntries(page, shop);
    await page.route("**/api/entries/update", (route) => route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ ok: false, error: "That entry cannot change right now." }) }));

    await labelOf(row).click();
    await categoryOption(page, "Groceries").click();
    await expect(page.getByRole("alert").filter({ hasText: "That entry cannot change right now." })).toBeVisible();
    await expect(categoryList(page)).toBeVisible();
    await expect(labelOf(row)).toHaveText("Other");
    await expect(categoryOption(page, "Other")).toHaveAttribute("aria-selected", "true");
  });

  test("the Edit entry card's category row opens the same list", async ({ page }) => {
    const shop = `Zzyzx Studio ${Date.now()}`;
    await reseedDemo(page);
    await seedShop(page, shop);
    const row = await openEntries(page, shop);

    await row.locator(".entry-row-description > strong").first().click();
    const editor = page.locator(".entry-edit-card").first();
    await expect(editor).toBeVisible();
    await editor.locator("[data-row='category']").click();
    await expect(categorySearch(page)).toBeFocused();
    await expect(page.locator(".category-pick-tag")).toContainText("Best guess");
    // The popover hangs from the row it was opened from, not from the page corner.
    const [rowBox, popoverBox] = await Promise.all([editor.locator("[data-row='category']").boundingBox(), page.locator(".category-popover").boundingBox()]);
    expect(Math.abs((popoverBox?.x ?? -999) - (rowBox?.x ?? 0))).toBeLessThan(24);
    expect(Math.abs((popoverBox?.y ?? -999) - (rowBox?.y ?? 0))).toBeLessThan(500);
    await categorySearch(page).fill("groc");
    await categorySearch(page).press("Enter");
    await expect(page.getByText("Save this category?")).toBeVisible();
    await expect(editor.locator("[data-row='category']")).toContainText("Groceries");
  });

  test("the Entries category filter is searchable and keeps several checked", async ({ page }) => {
    await reseedDemo(page);
    await page.goto(`/entries?view=person-tim&month=${MONTH}`);
    await page.getByRole("button", { name: "By category", exact: true }).click();
    await expect(categorySearch(page)).toBeFocused();
    await categorySearch(page).fill("gro");
    expect(await optionLabels(page)).toEqual(["Groceries"]);
    await categoryOption(page, "Groceries").click();
    await categorySearch(page).fill("tra");
    await categoryOption(page, "Transfer").click();
    await expect(categoryOption(page, "Transfer")).toHaveAttribute("aria-selected", "true");
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page).toHaveURL(/entry_category=Groceries/);
    await expect(page).toHaveURL(/entry_category=Transfer/);
  });
});

test.describe("phone", () => {
  test.use({ ...iPhone13 });

  test("the sheet opens without focusing the search; tapping the search focuses it; picking works", async ({ page }) => {
    const shop = `Zzyzx Studio ${Date.now()}`;
    await reseedDemo(page);
    await seedShop(page, shop);
    const row = await openEntries(page, shop);

    await labelOf(row).tap();
    await expect(categoryList(page)).toBeVisible();
    await expect(categorySearch(page)).toBeVisible();
    await expect(categorySearch(page)).not.toBeFocused();
    expect(await page.evaluate(() => document.activeElement?.tagName === "INPUT")).toBe(false);
    await expect(page.locator(".category-pick-tag")).toContainText("Best guess");
    expect((await optionLabels(page))[0]).toBe("Entertainment");

    await categorySearch(page).tap();
    await expect(categorySearch(page)).toBeFocused();
    await categorySearch(page).fill("groc");
    expect(await optionLabels(page)).toEqual(["Groceries"]);
    const box = await categoryOption(page, "Groceries").boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

    const update = page.waitForResponse((response) => response.url().includes("/api/entries/update") && response.ok());
    await categoryOption(page, "Groceries").tap();
    const response = await update;
    expect(JSON.parse(response.request().postData() ?? "{}")).toMatchObject({ categoryName: "Groceries" });
    await expect(categoryList(page)).toHaveCount(0);
    await expect(labelOf(row)).toHaveText("Groceries");
  });

  test("the list scrolls and every row is at least 44px", async ({ page }) => {
    const shop = `Zzyzx Studio ${Date.now()}`;
    await reseedDemo(page);
    await seedShop(page, shop);
    const row = await openEntries(page, shop);

    await labelOf(row).tap();
    const scroller = page.locator(".category-pick-options");
    await expect(categoryList(page)).toBeVisible();
    const heights = await categoryList(page).locator(".category-pick-row").evaluateAll((rows) => rows.map((element) => element.getBoundingClientRect().height));
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
    const scrolled = await scroller.evaluate(async (element) => {
      const before = element.scrollTop;
      element.scrollBy({ top: 400 });
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return { before, after: element.scrollTop, canScroll: element.scrollHeight > element.clientHeight };
    });
    expect(scrolled.canScroll).toBe(true);
    expect(scrolled.after).toBeGreaterThan(scrolled.before);
  });
});

// Screenshots for the audit note (docs/audits/category-quick-pick/): set
// CATEGORY_PICK_SHOT_DIR to take them. They show the list in each family on a
// wide screen and a phone, in light and dark, with the demo data only.
const shotDir = process.env.CATEGORY_PICK_SHOT_DIR;

async function shoot(page, name) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${shotDir}/${name}.png` });
}

for (const scheme of ["light", "dark"]) {
  test.describe(`screenshots ${scheme}`, () => {
    test.skip(!shotDir, "set CATEGORY_PICK_SHOT_DIR to take the audit screenshots");

    test(`desktop ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 1280, height: 860 });
      await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
      const shop = `Zzyzx Studio ${Date.now()}`;
      await reseedDemo(page);
      await seedShop(page, shop);
      const row = await openEntries(page, shop);

      await labelOf(row).click();
      await expect(categoryList(page)).toBeVisible();
      await shoot(page, `desktop-${scheme}-entries-row-best-guess`);
      await categorySearch(page).fill("kopi");
      await shoot(page, `desktop-${scheme}-entries-row-search-kopi`);
      await categorySearch(page).fill("zzzz");
      await shoot(page, `desktop-${scheme}-entries-row-no-match`);
      await page.keyboard.press("Escape");

      await row.locator(".entry-row-description > strong").first().click();
      const editor = page.locator(".entry-edit-card").first();
      await editor.locator("[data-row='category']").click();
      await expect(categoryList(page)).toBeVisible();
      await shoot(page, `desktop-${scheme}-edit-card`);
      await page.keyboard.press("Escape");

      await page.goto(`/entries?view=person-tim&month=${MONTH}`);
      await page.getByRole("button", { name: "By category", exact: true }).click();
      await expect(categoryList(page)).toBeVisible();
      await categoryOption(page, "Groceries").click();
      await shoot(page, `desktop-${scheme}-filter`);
    });

    test(`phone ${scheme}`, async ({ browser }) => {
      const context = await browser.newContext({ ...iPhone13, colorScheme: scheme });
      const page = await context.newPage();
      await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
      const shop = `Zzyzx Studio ${Date.now()}`;
      await reseedDemo(page);
      await seedShop(page, shop);
      const row = await openEntries(page, shop);

      await labelOf(row).tap();
      await expect(categoryList(page)).toBeVisible();
      await shoot(page, `phone-${scheme}-entries-row-best-guess`);
      await categorySearch(page).tap();
      await categorySearch(page).fill("coffee");
      await shoot(page, `phone-${scheme}-entries-row-search-coffee`);
      await context.close();
    });
  });
}
