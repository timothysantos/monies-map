import { devices, expect, test } from "@playwright/test";

import { gotoPageAfterApi, loadMonthPage, loadSummaryPage, reseedDemo } from "./helpers";

// The Lead · Support · Detail language on the Month plan-row sheet and the
// Summary top (design.md). The sheet must edit and save exactly as before,
// with Done and Cancel in the bottom bar and every tappable at least 44px;
// the Summary lead must show the same figures the metric cards did.

const MONTH = "2026-05";
const MONTH_URL = `/month?view=person-tim&month=${MONTH}&scope=direct_plus_shared`;
const SUMMARY_RANGE = { view: "person-tim", month: MONTH, summaryStart: "2025-06", summaryEnd: MONTH };
const SUMMARY_URL = `/summary?view=person-tim&month=${MONTH}&scope=direct_plus_shared&summary_start=2025-06&summary_end=${MONTH}`;
const INK = { in: "rgb(74, 92, 34)", short: "rgb(147, 54, 41)", plan: "rgb(45, 93, 94)", text: "rgb(53, 43, 36)" };
const money = (minor) => new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" }).format(minor / 100);
// The phone the owner tests on; the WebKit run (npm run test:e2e:webkit)
// uses the same profile in WebKit.
const { defaultBrowserType: _browser, ...iPhone13 } = devices["iPhone 13"];

async function monthRows(page) {
  const data = await loadMonthPage(page, { month: MONTH });
  return [
    ...data.monthPage.incomeRows.map((row) => ({ ...row, sectionKey: "income" })),
    ...data.monthPage.planSections.flatMap((section) => section.rows.map((row) => ({ ...row, sectionKey: section.key })))
  ];
}

const entryCountText = (count) => count === 1 ? "1 entry" : `${count} entries`;
const ownerText = (row) => row.ownershipType === "shared" ? "Shared" : row.ownerName;
// A budget bucket with entries behind its actual (the demo's May has a few).
async function bucketWithEntries(page) {
  const bucket = (await monthRows(page)).find((row) => row.sectionKey === "budget_buckets" && (row.actualEntryIds?.length ?? 0) > 0 && row.plannedMinor > 0);
  expect(bucket, "a budget bucket with entries").toBeTruthy();
  return bucket;
}

async function openMonth(page) {
  await gotoPageAfterApi(page, MONTH_URL, "/api/month-page", () => page.getByRole("button", { name: "+ Add planned item" }));
}

// The phone opens a row by tapping it (the row's own button is for wider
// layouts).
async function openRowSheet(page, label, title) {
  await page.locator("tr").filter({ hasText: label }).first().locator(".month-cell-item").click();
  const sheet = page.locator(`.entry-mobile-sheet[aria-label="${title}"]`);
  await expect(sheet).toBeVisible();
  return sheet;
}

function box(locator) {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
  });
}

test.describe("Month plan-row sheet on a phone", { tag: "@webkit" }, () => {
  test.use(iPhone13);

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.goto("/");
    await reseedDemo(page);
  });

  test("the planned amount leads and edits, the fields edit in their rows, and Done saves exactly as before", async ({ page }) => {
    const savings = (await monthRows(page)).find((row) => row.sectionKey === "planned_items" && row.label === "Savings");
    expect(savings).toBeTruthy();
    await openMonth(page);
    const sheet = await openRowSheet(page, "Savings", "Edit planned item");

    // Lead: the planned amount as a decimal-keypad input in the plan tone,
    // labelled "planned", under the row's name and kind.
    const lead = sheet.locator(".lsd-card");
    const planned = sheet.getByRole("textbox", { name: "Planned" });
    await expect(planned).toHaveValue("1800.00");
    await expect(planned).toHaveAttribute("inputmode", "decimal");
    expect(await planned.evaluate((input) => Boolean(input.closest(".lsd-amount.is-editable")))).toBe(true);
    expect(await planned.evaluate((input) => getComputedStyle(input).color)).toBe(INK.plan);
    await expect(lead.locator(".lsd-title")).toHaveText("Savings");
    await expect(lead.locator(".lsd-subtitle")).toHaveText("Planned item");
    await expect(lead.locator(".lsd-amount-caption")).toHaveText("planned");
    // Support: month and owner chips; the owner chip is Tim's colour.
    await expect(lead.locator(".lsd-chip").first()).toHaveText("May 2026");
    const owner = lead.locator(".lsd-chip.is-person");
    await expect(owner).toHaveText("Tim");
    expect(await owner.evaluate((chip) => chip.style.getPropertyValue("--person-colour"))).toBe("#46788E");
    await expect(sheet.locator(".entry-composer-copy p")).toHaveText("Tim · May 2026");

    // Detail rows hold every field the sheet had: actual, item, category,
    // date, account and note.
    const rows = sheet.locator(".lsd-row .lsd-row-label");
    await expect(rows).toHaveText(["Actual", "Item name", "Category", "Date", "Account", "Note"]);

    await planned.fill("1825.50");
    await sheet.locator("label").filter({ hasText: "Item name" }).locator("input").fill("Savings plan");
    await sheet.locator("label").filter({ hasText: "Note" }).locator("textarea").fill("Topped up in May");
    const saved = page.waitForResponse((response) => response.url().includes("/api/month-plan/save") && response.ok());
    await sheet.locator(".lsd-bottom").getByRole("button", { name: "Done" }).click();
    const request = (await saved).request().postDataJSON();
    await expect(sheet).toHaveCount(0);
    expect(request).toMatchObject({ rowId: savings.id, month: MONTH, sectionKey: "planned_items", label: "Savings plan", plannedMinor: 182_550, note: "Topped up in May" });

    const after = (await monthRows(page)).find((row) => row.id === savings.id);
    expect(after).toMatchObject({ label: "Savings plan", plannedMinor: 182_550, note: "Topped up in May" });
    await expect(page.locator("tr").filter({ hasText: "Savings plan" }).first()).toContainText("$1,825.50");
  });

  test("a budget bucket shows actual against its plan, and the Actual row opens its entries", async ({ page }) => {
    const bucket = await bucketWithEntries(page);
    await openMonth(page);
    const sheet = await openRowSheet(page, bucket.label, "Edit budget bucket");
    const lead = sheet.locator(".lsd-card");

    const headroom = bucket.plannedMinor - bucket.actualMinor;
    await expect(lead.locator(".lsd-progress-line")).toHaveText(
      `${money(bucket.actualMinor)} spent${money(Math.abs(headroom))} ${headroom >= 0 ? "left" : "over"}`
    );
    const end = lead.locator(".lsd-progress-line > span").nth(1).locator("span");
    expect(await end.evaluate((element) => getComputedStyle(element).color)).toBe(headroom >= 0 ? INK.in : INK.short);
    const fill = lead.locator(".lsd-bar-fill");
    const expectedPercent = Math.min(100, Math.round((bucket.actualMinor / bucket.plannedMinor) * 100));
    expect(await fill.evaluate((element) => element.style.width)).toBe(`${expectedPercent}%`);
    await expect(fill).toHaveClass(headroom >= 0 ? /money-neutral/ : /money-short/);
    await expect(lead.locator(".lsd-chip")).toHaveText(["May 2026", ownerText(bucket), entryCountText(bucket.actualEntryIds.length)]);

    // Typing a new plan moves the bar and the headroom with it.
    await sheet.getByRole("textbox", { name: "Planned" }).fill(((bucket.actualMinor - 1_000) / 100).toFixed(2));
    await expect(lead.locator(".lsd-progress-line")).toContainText(`${money(1_000)} over`);
    await expect(fill).toHaveClass(/money-short/);

    const actual = sheet.locator(".month-actual-drilldown-mobile");
    const count = bucket.actualEntryIds.length;
    await expect(actual).toHaveText(`Actual${count === 1 ? "See the entry" : `See the ${count} entries`}`);
    await expect(actual).toHaveClass(/is-action/);
    await actual.click();
    await expect(page).toHaveURL(/\/entries\?/);
  });

  test("Done and Cancel sit in the bottom bar, every tappable is at least 44px, and Cancel discards", async ({ page }) => {
    await openMonth(page);
    let saves = 0;
    page.on("request", (request) => { if (request.url().includes("/api/month-plan/save")) saves += 1; });
    const sheet = await openRowSheet(page, "Savings", "Edit planned item");
    const viewport = page.viewportSize();
    const bar = await box(sheet.locator(".lsd-bottom"));
    const cancel = sheet.locator(".lsd-bottom").getByRole("button", { name: "Cancel" });
    const done = sheet.locator(".lsd-bottom").getByRole("button", { name: "Done" });
    const cancelBox = await box(cancel);
    const doneBox = await box(done);

    // The bar is the bottom of the screen; Done on the right, Cancel left.
    expect(bar.bottom).toBeGreaterThan(viewport.height - 2);
    expect(doneBox.x).toBeGreaterThan(cancelBox.right);
    expect(doneBox.x - cancelBox.right).toBeGreaterThanOrEqual(8);
    expect(doneBox.bottom).toBeGreaterThan(viewport.height * 0.85);

    const targets = {
      close: sheet.getByRole("button", { name: "Close edit planned item" }),
      cancel,
      done,
      bubble: sheet.getByRole("button", { name: "Edit Savings" }),
      planned: sheet.getByRole("textbox", { name: "Planned" }),
      ...Object.fromEntries(["Actual", "Item name", "Category", "Date", "Account", "Note"].map((label) => [
        label,
        sheet.locator(".lsd-row").filter({ has: page.locator(".lsd-row-label", { hasText: new RegExp(`^${label}$`) }) })
      ]))
    };
    const sizes = {};
    for (const [name, locator] of Object.entries(targets)) {
      const size = await box(locator);
      sizes[name] = `${Math.round(size.width)}x${Math.round(size.height)}`;
      expect(size.width, `${name} width`).toBeGreaterThanOrEqual(44);
      expect(size.height, `${name} height`).toBeGreaterThanOrEqual(44);
    }
    // Separate targets keep at least 8px between them (the rows are one list).
    const bubble = await box(targets.bubble);
    const plannedBox = await box(targets.planned);
    expect(plannedBox.x - bubble.right).toBeGreaterThanOrEqual(8);
    test.info().annotations.push({ type: "tap targets", description: JSON.stringify(sizes) });

    await targets.planned.fill("9999.00");
    await cancel.click();
    await expect(sheet).toHaveCount(0);
    expect(saves).toBe(0);
    const reopened = await openRowSheet(page, "Savings", "Edit planned item");
    await expect(reopened.getByRole("textbox", { name: "Planned" })).toHaveValue("1800.00");
  });

  test("a failed save keeps the sheet, the draft and the inline error, and Done stays in reach", async ({ page }) => {
    await openMonth(page);
    const sheet = await openRowSheet(page, "Savings", "Edit planned item");
    await page.route("**/api/month-plan/save", (route) => route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Month plan save failed." })
    }));
    await sheet.getByRole("textbox", { name: "Planned" }).fill("1810.00");
    const done = sheet.locator(".lsd-bottom").getByRole("button", { name: "Done" });
    await done.click();

    await expect(sheet.getByRole("alert")).toHaveText("Month plan save failed.");
    await expect(sheet.getByRole("alert")).toHaveClass(/entry-submit-error/);
    await expect(sheet.getByRole("textbox", { name: "Planned" })).toHaveValue("1810.00");
    await expect(done).toBeEnabled();
    expect((await box(done)).bottom).toBeGreaterThan(page.viewportSize().height * 0.85);
    // Nothing was saved.
    expect((await monthRows(page)).find((row) => row.label === "Savings")?.plannedMinor).toBe(180_000);
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });

  test("hidden money: dots in plain ink, the bar's track only, no left or over, chips stay", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "false"));
    await page.reload();
    const bucket = await bucketWithEntries(page);
    await openMonth(page);
    await expect(page.getByRole("button", { name: "Show money totals" }).first()).toBeAttached();
    const sheet = await openRowSheet(page, bucket.label, "Edit budget bucket");
    const lead = sheet.locator(".lsd-card");
    const planned = sheet.getByRole("textbox", { name: "Planned" });

    const look = await planned.evaluate((input) => ({ color: getComputedStyle(input).color, security: getComputedStyle(input).webkitTextSecurity }));
    expect(look.color).toBe(INK.text);
    expect(look.security).toBe("disc");
    await expect(sheet.locator(".month-plan-lead-currency")).toBeHidden();
    await expect(lead.locator(".lsd-bar")).toBeVisible();
    await expect(lead.locator(".lsd-bar-fill")).toHaveCount(0);
    await expect(lead.locator(".lsd-progress-line")).toHaveText("Spent ••••");
    expect(await sheet.innerText()).not.toMatch(/\b(left|over|to come)\b/);
    await expect(lead.locator(".lsd-chip")).toHaveText(["May 2026", ownerText(bucket), entryCountText(bucket.actualEntryIds.length)]);
  });
});

test("desktop keeps inline editing for plan rows: no sheet opens", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await reseedDemo(page);
  await openMonth(page);
  const row = page.locator("tr").filter({ hasText: "Savings" }).first();
  await row.getByRole("button", { name: "Edit Savings row" }).click();
  await expect(page.locator("tr.is-editing .table-edit-input-money")).toHaveValue("1800.00");
  await expect(page.locator(".entry-mobile-sheet")).toHaveCount(0);
  await expect(page.locator(".month-plan-lead")).toHaveCount(0);
  await page.getByTestId("month-inline-cancel-button").click();
});

test.describe("Summary lead", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.goto("/");
    await reseedDemo(page);
  });

  async function expectLeadMatchesCards(page) {
    const data = await loadSummaryPage(page, SUMMARY_RANGE);
    const card = (label) => data.summaryPage.metricCards.find((item) => item.label === label).amountMinor;
    await gotoPageAfterApi(page, SUMMARY_URL, "/api/summary-page", () => page.locator(".summary-lead"));

    const actual = card("Actual spend");
    const planned = card("Planned spend");
    await expect(page.locator(".summary-lead .lsd-eyebrow")).toHaveText("Spent · Jun 2025 – May 2026");
    await expect(page.locator(".summary-lead-spent")).toHaveText(money(actual));
    await expect(page.locator(".summary-lead-plan")).toHaveText(`of ${money(planned)} plan`);
    const headroom = planned - actual;
    await expect(page.locator(".summary-lead .lsd-progress-line")).toHaveText(
      `${Math.round((actual / planned) * 100)}% of plan${money(Math.abs(headroom))} ${headroom >= 0 ? "under plan" : "over plan"}`
    );
    const income = page.locator('.summary-support-pill[data-metric="income"]');
    await expect(income.locator("strong")).toHaveText(money(card("Actual income")));
    await expect(income.locator("small")).toHaveText(`plan ${money(card("Planned income"))}`);
    const saved = page.locator('.summary-support-pill[data-metric="saved"]');
    await expect(saved.locator("strong")).toHaveText(money(card("Realized savings")));
    await expect(saved.locator("small")).toHaveText(`target ${money(card("Savings target"))}`);
    // The six cards are gone from Summary; their figures are all above.
    await expect(page.locator(".panel-head .metric")).toHaveCount(0);
  }

  test("desktop: the lead card with the Income and Saved pills in a column to its right", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await expectLeadMatchesCards(page);
    const lead = await box(page.locator(".summary-lead"));
    const income = await box(page.locator('.summary-support-pill[data-metric="income"]'));
    const saved = await box(page.locator('.summary-support-pill[data-metric="saved"]'));
    expect(income.x).toBeGreaterThan(lead.right);
    expect(saved.x).toBe(income.x);
    expect(saved.y).toBeGreaterThan(income.bottom);
    const title = await box(page.locator(".summary-head h2"));
    expect(lead.x).toBeGreaterThan(title.right);
  });

  test("phone: the lead card full width, the pills side by side under it, nothing scrolls sideways", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await expectLeadMatchesCards(page);
    const lead = await box(page.locator(".summary-lead"));
    const income = await box(page.locator('.summary-support-pill[data-metric="income"]'));
    const saved = await box(page.locator('.summary-support-pill[data-metric="saved"]'));
    expect(lead.width).toBeGreaterThan(390 - 2 * 24);
    expect(income.y).toBeGreaterThan(lead.bottom);
    expect(saved.y).toBe(income.y);
    expect(saved.x).toBeGreaterThan(income.right);
    const widths = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
    expect(widths.document).toBeLessThanOrEqual(widths.viewport + 1);
  });
});
