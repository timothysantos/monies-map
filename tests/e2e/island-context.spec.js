import { expect, test } from "@playwright/test";

import { postJson, reseedDemo } from "./helpers";

// The phone island's contextual line (design.md, "Island context line"):
// while Entries is narrowed, the island says what narrows it and has a Clear
// button; on the Summary tab, a month other than this one gets a way back.
// With the default scope the line takes the scope text's place in the same
// row, so the island keeps its height; a scope that is not the default stays
// visible and the line goes on a row above. Desktop and tablet (wider than
// 760 px) have no island.

const PHONE = { width: 390, height: 844 };
const MONTH = "2025-10";
const ENTRIES = `/entries?view=person-tim&month=${MONTH}&entries_scope=direct_plus_shared`;
const TODAY = new Date("2025-10-15T10:00:00+08:00");

test.use({ hasTouch: true });

async function phone(page) {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await page.clock.setFixedTime(TODAY);
  await page.setViewportSize(PHONE);
  await reseedDemo(page);
}

async function openUsable(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await expect.poll(() => page.evaluate(() => window.__MONIES_MAP_ROUTE_WORK__?.usable ?? false), { timeout: 60_000 }).toBe(true);
  await expect(page.locator(".mobile-context-sticky-bar")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

async function addEntries(page, count = 1, month = MONTH) {
  for (let index = 0; index < count; index += 1) {
    await postJson(page, "/api/entries/create", {
      date: `${month}-${String(index + 1).padStart(2, "0")}`,
      description: `Island groceries ${index + 1}`,
      accountName: "UOB One", categoryName: "Groceries", amountMinor: 1200 + index,
      entryType: "expense", ownershipType: "direct", ownerName: "Tim"
    });
  }
}

const bar = (page) => page.locator(".mobile-context-sticky-bar");
const barBox = async (page) => (await bar(page).boundingBox());
const params = (page) => Object.fromEntries(new URL(page.url()).searchParams);

// Picks a category through the View and scope sheet (the same steps a person takes).
async function filterByCategory(page, name) {
  const sheet = page.locator(".mobile-context-dialog");
  await page.locator(".mobile-context-trigger").click();
  await sheet.locator(".entries-filter").filter({ hasText: "By category" }).getByRole("button").click();
  const picker = page.getByRole("dialog", { name: "By category" });
  await picker.locator(`[data-category-option='${name}']`).click();
  await picker.getByRole("button", { name: "Done" }).click();
  await expect(picker).toHaveCount(0);
  await sheet.getByRole("button", { name: "Done", exact: true }).last().click();
  await expect(sheet).toHaveCount(0);
}

test.describe("Entries on a phone", () => {
  test("search summary focuses search; the person chip opens without a search keyboard @webkit", async ({ page }) => {
    await phone(page);
    await openUsable(page, `${ENTRIES}&entry_search=coffee`);
    await page.locator(".mobile-context-line-text").click();
    const sheet = page.locator(".mobile-context-dialog");
    await expect(sheet.locator(".search-filter-input")).toBeFocused();
    await sheet.getByRole("button", { name: "Done", exact: true }).last().click();
    await page.locator(".mobile-context-trigger").click();
    await expect(sheet.locator(".search-filter-input")).not.toBeFocused();
  });

  test("category summary opens the category picker directly @webkit", async ({ page }) => {
    await phone(page);
    await openUsable(page, `${ENTRIES}&entry_category=Groceries`);
    await page.locator(".mobile-context-line-text").click();
    const picker = page.getByRole("dialog", { name: "By category", exact: true });
    const selected = picker.locator('[data-category-option="Groceries"]');
    await expect(selected).toHaveAttribute("aria-selected", "true");
    await selected.click();
    await expect(selected).toHaveAttribute("aria-selected", "false");
    await picker.getByRole("button", { name: "Done", exact: true }).click();
    await page.locator(".mobile-context-dialog").getByRole("button", { name: "Done", exact: true }).last().click();
    await expect.poll(() => new URL(page.url()).searchParams.has("entry_category")).toBe(false);
    await expect(page.locator(".mobile-context-scope")).toHaveText("Direct + Shared");
  });

  test("a category filter shows its name, the count and Clear in the same row; Clear keeps month and scope", async ({ page }) => {
    await phone(page);
    await addEntries(page);
    await openUsable(page, ENTRIES);
    await expect(page.locator(".mobile-context-scope")).toHaveText("Direct + Shared");
    await expect(page.getByRole("button", { name: "Clear all filters" })).toHaveCount(0);
    const baseline = await barBox(page);
    const unfilteredRows = await page.locator(".entry-row").count();

    await filterByCategory(page, "Groceries");
    const summary = page.locator(".mobile-context-line-text");
    await expect(summary).toHaveText(/^Groceries · \d+ entr(y|ies)$/);
    const filteredRows = await page.locator(".entry-row").count();
    expect(filteredRows).toBeGreaterThan(0);
    expect(filteredRows).toBeLessThan(unfilteredRows);
    await expect(summary).toContainText(`${filteredRows} ${filteredRows === 1 ? "entry" : "entries"}`);

    // Default scope: the scope text steps aside and the island keeps its height.
    await expect(page.locator(".mobile-context-scope")).toHaveCount(0);
    await expect(page.locator(".mobile-context-line.is-stacked")).toHaveCount(0);
    const filtered = await barBox(page);
    expect(Math.abs(filtered.height - baseline.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(filtered.y - baseline.y)).toBeLessThanOrEqual(1);

    // Every control keeps a 44 px target, nothing is cut but the summary's text, and the page does not scroll sideways.
    const clear = page.getByRole("button", { name: "Clear all filters" });
    await expect(clear).toHaveText("Clear");
    const clearBox = await clear.boundingBox();
    expect(clearBox.width).toBeGreaterThanOrEqual(44);
    expect(clearBox.height).toBeGreaterThanOrEqual(44);
    expect(await clear.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    const summaryBox = await summary.boundingBox();
    expect(summaryBox.height).toBeGreaterThanOrEqual(44);
    for (const name of ["Previous period", "Next period"]) {
      const box = await page.getByRole("button", { name }).first().boundingBox();
      expect(box.x + box.width).toBeLessThanOrEqual(filtered.x + filtered.width);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // The polite status says what is applied.
    await expect(bar(page).getByRole("status")).toHaveText(`Filtered by Groceries, ${filteredRows} ${filteredRows === 1 ? "entry" : "entries"}`);

    await clear.click();
    await expect.poll(() => params(page)).toEqual({ view: "person-tim", month: MONTH, entries_scope: "direct_plus_shared" });
    await expect(page.locator(".entry-row")).toHaveCount(unfilteredRows);
    await expect(page.getByRole("button", { name: "Clear all filters" })).toHaveCount(0);
    // The scope text returns, the height is as it was, focus is on the island's trigger (no trap), and the change is announced.
    await expect(page.locator(".mobile-context-scope")).toHaveText("Direct + Shared");
    const after = await barBox(page);
    expect(Math.abs(after.height - baseline.height)).toBeLessThanOrEqual(1);
    await expect(page.locator(".mobile-context-trigger")).toBeFocused();
    await expect(bar(page).getByRole("status")).toHaveText("Filters cleared");
  });

  test("the summary opens the filters, scrolled to them, and does not clear", async ({ page }) => {
    await phone(page);
    await openUsable(page, `${ENTRIES}&entry_category=Groceries&entry_type=expense&entry_search=coffee`);
    const summary = page.locator(".mobile-context-line-text");
    await expect(summary).toBeVisible();
    await summary.click();
    const sheet = page.locator(".mobile-context-dialog");
    await expect(sheet).toBeVisible();
    const filters = sheet.locator(".mobile-context-filters");
    await expect(filters).toBeVisible();
    await expect.poll(async () => {
      const box = await filters.boundingBox();
      const dialog = await sheet.boundingBox();
      return box.y >= dialog.y - 1 && box.y < dialog.y + dialog.height;
    }).toBe(true);
    expect(params(page).entry_category).toBe("Groceries");
  });

  test("search alone, and three filters, are summarised in words", async ({ page }) => {
    await phone(page);
    await openUsable(page, `${ENTRIES}&entry_search=fairprice`);
    await expect(page.locator(".mobile-context-line-text")).toHaveText(/^Searching “fairprice” · (\d+ entr(y|ies)|No entries)$/);
    await openUsable(page, `${ENTRIES}&entry_search=fairprice&entry_category=Groceries&entry_type=expense`);
    await expect(page.locator(".mobile-context-line-text")).toHaveText(/^3 filters · (\d+ entr(y|ies)|No entries)$/);
    await openUsable(page, `${ENTRIES}&entry_search=${"x".repeat(60)}`);
    const text = await page.locator(".mobile-context-line-text").textContent();
    expect(text).toMatch(/^Searching “x{20}…” · No entries$/);
  });

  test("a default list shows no line, no Clear and no status text", async ({ page }) => {
    await phone(page);
    await openUsable(page, ENTRIES);
    await expect(page.locator(".mobile-context-line-text, .mobile-context-line-action, .mobile-context-line")).toHaveCount(0);
    await expect(bar(page).getByRole("status")).toHaveText("");
    // Scope and view are not filters.
    await openUsable(page, `/entries?view=person-tim&month=${MONTH}&entries_scope=shared`);
    await expect(page.locator(".mobile-context-line-action")).toHaveCount(0);
    await expect(page.locator(".mobile-context-scope")).toHaveText("Shared");
  });

  test("a scope that is not the default stays visible and the line goes on a row above", async ({ page }) => {
    await phone(page);
    await openUsable(page, `/entries?view=person-tim&month=${MONTH}&entries_scope=shared`);
    const baseline = await barBox(page);
    await openUsable(page, `/entries?view=person-tim&month=${MONTH}&entries_scope=shared&entry_category=Groceries`);
    const line = page.locator(".mobile-context-line.is-stacked");
    await expect(line).toBeVisible();
    await expect(page.locator(".mobile-context-scope")).toHaveText("Shared");
    await expect(line.locator(".mobile-context-line-text")).toHaveText(/^Groceries · /);
    const stacked = await barBox(page);
    expect(stacked.height).toBeGreaterThan(baseline.height + 40);
    // The island grows upward; its bottom edge, and the tab bar below it, do not move.
    expect(Math.abs(stacked.y + stacked.height - (baseline.y + baseline.height))).toBeLessThanOrEqual(1);
    // The round buttons above lift clear of it.
    const fab = await page.locator(".entries-fab").first().boundingBox();
    expect(fab.y + fab.height).toBeLessThanOrEqual(stacked.y);
    expect(await page.evaluate(() => document.body.hasAttribute("data-island-stacked"))).toBe(true);

    await line.getByRole("button", { name: "Clear all filters" }).click();
    await expect.poll(() => params(page)).toEqual({ view: "person-tim", month: MONTH, entries_scope: "shared" });
    await expect(page.locator(".mobile-context-line")).toHaveCount(0);
    await expect(page.locator(".mobile-context-scope")).toHaveText("Shared");
    expect(await page.evaluate(() => document.body.hasAttribute("data-island-stacked"))).toBe(false);
    const after = await barBox(page);
    expect(Math.abs(after.height - baseline.height)).toBeLessThanOrEqual(1);
  });

  test("the line appearing does not move the list, and the last row clears the island", async ({ page }) => {
    await phone(page);
    // A month containing only these entries lets a real category selection
    // keep every row, so a movement would be chrome rather than filtering.
    const scrollMonth = "2027-01";
    await addEntries(page, 14, scrollMonth);
    await openUsable(page, ENTRIES.replace(MONTH, scrollMonth));
    const rows = page.locator(".entry-row");
    const total = await rows.count();
    expect(total).toBeGreaterThan(12);
    // Scroll through the rows as a person does: content-visibility remembers
    // their rendered heights. A direct jump leaves earlier rows estimated.
    for (let index = 0; index <= 10; index += 1) {
      await rows.nth(index).scrollIntoViewIfNeeded();
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    }
    await page.evaluate(() => window.scrollBy({ top: 40, behavior: "instant" }));
    const before = await page.evaluate(() => ({ y: window.scrollY, top: document.querySelectorAll(".entry-row")[10].getBoundingClientRect().top }));
    // Use the real sheet while scrolled down; every row passes this filter.
    await filterByCategory(page, "Groceries");
    await expect(page.locator(".mobile-context-line-text")).toHaveText(`Groceries · ${total} entries`);
    await expect(rows).toHaveCount(total);
    const during = await page.evaluate(() => ({ y: window.scrollY, top: document.querySelectorAll(".entry-row")[10].getBoundingClientRect().top }));
    expect(Math.abs(during.y - before.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(during.top - before.top)).toBeLessThanOrEqual(1);
    // At the very end the last row sits above the island, which sits above the tab bar.
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
    await page.waitForTimeout(150);
    const last = await rows.last().boundingBox();
    const island = await barBox(page);
    const tabs = await page.locator("nav.tab-strip").boundingBox();
    expect(last.y + last.height).toBeLessThanOrEqual(island.y + 1);
    expect(island.y + island.height).toBeLessThanOrEqual(tabs.y + 1);
  });


  test("Clear removes every narrowing together and keeps the person, month and non-default scope", async ({ page }) => {
    await phone(page);
    await openUsable(page, `${ENTRIES.replace("direct_plus_shared", "shared")}&entry_category=Groceries&entry_wallet=UOB+One&entry_type=expense&entry_search=coffee&entry_min=1&entry_max=9000&entry_id=missing&entry_invest_moves=1&entry_figure=spent&entry_from=2025-09&entry_to=2025-10&from_ask=1`);
    await page.getByRole("button", { name: "Clear all filters" }).click();
    await expect.poll(() => params(page)).toEqual({ view: "person-tim", month: MONTH, entries_scope: "shared" });
    await expect(page.locator(".mobile-context-scope")).toHaveText("Shared");
    await expect(page.locator(".mobile-context-line-action")).toHaveCount(0);
  });

  test("with reduced motion the line does not animate", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await phone(page);
    await openUsable(page, `/entries?view=person-tim&month=${MONTH}&entries_scope=shared&entry_category=Groceries`);
    const line = page.locator(".mobile-context-line.is-stacked");
    await expect(line).toBeVisible();
    expect(await line.evaluate((node) => getComputedStyle(node).animationName)).toBe("none");
  });
});

test.describe("Summary tab on a phone", () => {
  const MONTH_URL = "/month?view=person-tim&month=2025-08&summary_start=2025-06&summary_end=2025-10&scope=direct_plus_shared";

  test("a month other than this one has Back to this month in the island's row", async ({ page }) => {
    await phone(page);
    await openUsable(page, "/month?view=person-tim&month=2025-10&summary_start=2025-06&summary_end=2025-10&scope=direct_plus_shared");
    // This month: nothing to go back to.
    await expect(page.getByRole("button", { name: "Back to this month" })).toHaveCount(0);
    const baseline = await barBox(page);

    await openUsable(page, MONTH_URL);
    const back = page.getByRole("button", { name: "Back to this month" });
    await expect(back).toBeVisible();
    const inRow = await barBox(page);
    expect(Math.abs(inRow.height - baseline.height)).toBeLessThanOrEqual(1);
    const box = await back.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeLessThanOrEqual(inRow.x + inRow.width);
    for (const selector of [".mobile-month-choice-step", ".mobile-month-choice-open"]) {
      for (const control of await page.locator(selector).all()) {
        const bounds = await control.boundingBox();
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(inRow.x + inRow.width);
        expect(bounds.width).toBeGreaterThanOrEqual(44);
      }
    }
    await expect(page.locator(".mobile-context-scope")).toHaveCount(0);

    await back.click();
    await expect.poll(() => params(page).month).toBe("2025-10");
    await expect(page.getByRole("button", { name: "Back to this month" })).toHaveCount(0);
    await expect(page.locator(".mobile-context-scope")).toHaveText("Direct + Shared");
    await expect(page.locator(".mobile-context-trigger")).toBeFocused();
  });

  test("a scope that is not the default keeps its text and names the month on a row above", async ({ page }) => {
    await phone(page);
    await openUsable(page, MONTH_URL.replace("direct_plus_shared", "shared"));
    const line = page.locator(".mobile-context-line.is-stacked");
    await expect(line).toBeVisible();
    await expect(line.locator(".mobile-context-line-text")).toHaveText("Viewing Aug 2025");
    await expect(page.locator(".mobile-context-scope")).toHaveText("Shared");
    await line.getByRole("button", { name: "Back to this month" }).click();
    await expect.poll(() => params(page).month).toBe("2025-10");
  });
});

test.describe("Wider screens", () => {
  for (const width of [768, 1280]) {
    test(`at ${width}px there is no island and no line`, async ({ page }) => {
      await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
      await page.setViewportSize({ width, height: 900 });
      await reseedDemo(page);
      await page.goto(`${ENTRIES}&entry_category=Groceries`, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: /Entries/ })).toBeVisible();
      await expect(page.locator(".mobile-context-sticky-wrap")).toBeHidden();
      await expect(page.locator(".mobile-context-line-action")).toHaveCount(0);
    });
  }
});

test("Splits' floating group bar clears a search while keeping its group and month", async ({ page }) => {
  await phone(page);
  await page.setViewportSize({ width: 390, height: 640 });
  await page.goto(`/splits?view=person-tim&month=${MONTH}&split_group=split-group-none&split_search=coffee`);
  await expect(page.locator(".splits-strip")).toBeVisible();
  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" }));
  const groupBar = page.locator(".splits-group-bar");
  await expect(groupBar).toBeVisible();
  const clear = groupBar.getByRole("button", { name: "Clear all filters" });
  await expect(clear).toBeVisible();
  const box = await clear.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.width).toBeGreaterThanOrEqual(44);
  await clear.click();
  await expect.poll(() => params(page)).toEqual({ view: "person-tim", month: MONTH, split_group: "split-group-none" });
  await expect(groupBar.getByRole("button", { name: "Clear all filters" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "All groups" })).toHaveCount(0);
});

test("desktop Reset keeps its existing multi-month period behavior", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await reseedDemo(page);
  await page.goto(`${ENTRIES}&entry_from=2025-09&entry_to=2025-10&entry_category=Groceries`);
  const reset = page.locator(".entries-filter-stack").getByRole("button", { name: "Reset filters", exact: true });
  await expect(reset).toBeVisible();
  await reset.click();
  await expect.poll(() => params(page)).toEqual({ view: "person-tim", month: MONTH, entries_scope: "direct_plus_shared", entry_from: "2025-09", entry_to: "2025-10" });
});
