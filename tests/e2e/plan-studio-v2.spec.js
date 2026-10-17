import { devices, expect, test } from "@playwright/test";

import { chooseStudio, gotoPageAfterApi, loadMonthPage, postJson, reseedDemo } from "./helpers";

// Plan Studio v2 (DOMAIN.md "Plan Studio", "Plan history", "Plan view"): the
// slider popover, the one list grouped by what the money does, the Studio |
// Tables switch, adding a line and reaching notes, matching and removing from
// Studio, Planned in by source, and money that arrived beyond the plan.
// Tim's May 2026 has plan rows but no planned income, so each test adds a
// $6,000 salary. Month 2025-09 is the demo month with earlier months behind
// it, so its rows carry plan history.

const VIEW = "person-tim";
const MONTH = "2026-05";
const URL = `/month?view=${VIEW}&month=${MONTH}&scope=direct_plus_shared`;
const HISTORY_URL = `/month?view=${VIEW}&month=2025-09&scope=direct_plus_shared`;
const { defaultBrowserType: _browser, ...iPhone13 } = devices["iPhone 13"];

async function seed(page, { reveal = true, extraIncome = 0 } = {}) {
  await chooseStudio(page);
  await reseedDemo(page);
  await postJson(page, "/api/month-plan/save", {
    rowId: "plan-studio-v2-salary", month: MONTH, sectionKey: "income", categoryName: "Salary", label: "Salary",
    planDate: null, accountName: "", plannedMinor: 600_000, note: "", ownershipType: "direct", ownerName: "Tim"
  });
  if (extraIncome) {
    await postJson(page, "/api/entries/create", {
      date: `${MONTH}-26`, description: "Salary received", accountName: "UOB One", categoryName: "Salary",
      amountMinor: 600_000 + extraIncome, entryType: "income", ownershipType: "direct", ownerName: "Tim"
    });
  }
  if (reveal) {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  }
}

async function open(page, url = URL) {
  await gotoPageAfterApi(page, url, "/api/month-page", () => page.locator("[data-plan-studio]"));
}

const studio = (page) => page.locator("[data-plan-studio]");
const row = (page, name) => page.locator("[data-ps-row]").filter({ has: page.locator(".ps-row-label", { hasText: new RegExp(`^${name}$`) }) });
const planned = (page, name) => row(page, name).locator("[data-ps-amount]");
const saveButton = (page) => page.locator("[data-ps-save]");
const popover = (page) => page.locator("[data-ps-info]");
const modeSwitch = (page) => page.locator("#month-plan [data-plan-mode-switch]");
const islandModeSwitch = (page) => page.locator(".mobile-context-sticky-bar [data-plan-mode-switch]");
const tables = (page) => page.locator(".month-plan-stack");

async function typeAmount(page, name, text) {
  await planned(page, name).click();
  const field = page.getByRole("textbox", { name: "Planned amount" });
  await field.fill(text);
  await field.press("Enter");
}

async function allRows(page, month = MONTH) {
  const data = await loadMonthPage(page, { view: VIEW, month });
  return data.monthPage.planSections.flatMap((section) => section.rows);
}

test.describe("Plan Studio v2 on desktop", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  for (const popup of ["menu", "amount"]) {
    test(`${popup} dismisses without editing the slider behind it`, async ({ page }) => {
      await seed(page);
      await open(page);
      const food = row(page, "Food");
      const slider = food.getByRole("slider");
      await slider.scrollIntoViewIfNeeded();
      const before = await slider.getAttribute("aria-valuenow");
      const box = await slider.boundingBox();
      if (popup === "menu") await food.locator("[data-ps-menu-button]").click();
      else await planned(page, "Food").click();
      await expect(page.locator(popup === "menu" ? ".ps-menu" : ".ps-pop:has(.ps-amount-field)")).toBeVisible();
      await page.mouse.click(box.x + 10, box.y + 20);
      await expect(page.locator(popup === "menu" ? ".ps-menu" : ".ps-pop:has(.ps-amount-field)")).toHaveCount(0);
      await expect(slider).toHaveAttribute("aria-valuenow", before);
    });
  }

  test("the header period picker consumes a dismissal click on a slider", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 6000 });
    await seed(page);
    await open(page);
    const slider = row(page, "Food").getByRole("slider");
    const before = await slider.getAttribute("aria-valuenow");
    const box = await slider.boundingBox();
    await page.locator(".control-bar .period-range-segment").first().click();
    await expect(page.locator(".period-picker-popover")).toBeVisible();
    expect(box.y + 20).toBeLessThan(6000);
    await page.mouse.click(box.x + 10, box.y + 20);
    await expect(page.locator(".period-picker-popover")).toHaveCount(0);
    await expect(slider).toHaveAttribute("aria-valuenow", before);
  });

  test("one list grouped by what the money does: dated lines sit in Spend with a due tag", async ({ page }) => {
    await seed(page);
    await open(page);
    const groups = await page.locator("[data-ps-group]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-ps-group")));
    expect(groups).toEqual(["income", "spend", "save", "invest"]);
    for (const heading of ["Money in", "Spend", "Save", "Invest"]) {
      await expect(page.locator(".ps-group-head b", { hasText: new RegExp(`^${heading}$`) })).toBeVisible();
    }
    // A planned item with a date is Spend, with a small tag; an undated budget has none.
    const loan = page.locator('[data-ps-group="spend"] [data-ps-row]').filter({ hasText: "House loan" });
    await expect(loan.locator("[data-ps-due]")).toHaveText("due 2 May");
    await expect(row(page, "Food").locator("[data-ps-due]")).toHaveCount(0);
    await expect(page.locator('[data-ps-group="save"] [data-ps-row]').filter({ hasText: "Savings" })).toBeVisible();
    // Neither storage section name is a heading anywhere in Studio.
    await expect(studio(page)).not.toContainText(/Planned Items|Budget Buckets|Bills and dated payments|Monthly budget/);
    // The tables are hidden until asked for.
    await expect(tables(page)).toHaveCount(0);
  });

  test("hovering a slider shows last month, the average, so far and the live effect on Left over; leaving closes it", async ({ page }) => {
    await seed(page);
    await open(page, HISTORY_URL);
    const food = row(page, "Food");
    await food.scrollIntoViewIfNeeded();
    await food.getByRole("slider").hover();
    await expect(popover(page)).toBeVisible();
    await expect(popover(page)).toContainText("Last month");
    await expect(popover(page)).toContainText(/Planned \$[\d,.]+, spent \$[\d,.]+/);
    await expect(popover(page)).toContainText("Average");
    await expect(popover(page)).toContainText(/a month over [123] months?/);
    await expect(popover(page)).toContainText("So far");
    await expect(popover(page).locator('[data-kind="effect"]')).toHaveCount(0);
    await food.getByRole("slider").focus();
    await food.getByRole("slider").press("ArrowRight");
    await expect(popover(page).locator('[data-kind="effect"]')).toContainText(/^If you save this\+\$[\d,.]+ → Left over -?\$[\d,.]+/);
    await page.mouse.move(5, 5);
    await food.getByRole("slider").blur();
    await expect(popover(page)).toHaveCount(0);
  });

  test("keyboard focus opens the popover and Escape closes it", async ({ page }) => {
    await seed(page);
    await open(page, HISTORY_URL);
    await row(page, "Food").getByRole("slider").focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowLeft");
    await expect(popover(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(popover(page)).toHaveCount(0);
  });

  test("the popover shows while a slider is dragged, with Left over following the thumb", async ({ page }) => {
    await seed(page);
    await open(page);
    const slider = row(page, "Food").getByRole("slider");
    await slider.scrollIntoViewIfNeeded();
    const box = await slider.boundingBox();
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 6 });
    await expect(popover(page)).toBeVisible();
    await expect(popover(page).locator('[data-kind="effect"]')).toContainText("Left over");
    const first = await popover(page).locator('[data-kind="effect"]').innerText();
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2, { steps: 6 });
    await expect(popover(page).locator('[data-kind="effect"]')).not.toHaveText(first);
    await page.mouse.up();
  });

  test("with money hidden no popover opens and no info button is drawn", async ({ page }) => {
    await seed(page, { reveal: false });
    await open(page, HISTORY_URL);
    const slider = row(page, "Food").getByRole("slider");
    await slider.hover();
    await slider.focus();
    await slider.press("ArrowRight");
    await expect(popover(page)).toHaveCount(0);
    await expect(page.locator("[data-ps-info-button]")).toHaveCount(0);
    await expect(page.locator("[data-ps-extra]")).toHaveCount(0);
    await expect(studio(page)).not.toContainText(/\$\d/);
  });

  test("Studio is the default, Tables is a switch away, and held changes survive the trip", async ({ page }) => {
    await seed(page);
    await open(page);
    await expect(modeSwitch(page).getByRole("radio", { name: "Sliders" })).toBeChecked();
    await expect(page.locator("[data-plan-mode-dirty]")).toHaveCount(0);
    await typeAmount(page, "Food", "137");
    await expect(saveButton(page)).toBeEnabled();
    await expect(page.locator("[data-plan-mode-dirty]")).toHaveCount(1);

    await modeSwitch(page).getByText("List").click();
    await expect(tables(page)).toBeVisible();
    await expect(studio(page)).toBeHidden();
    await expect(page.locator("[data-plan-mode-dirty]")).toHaveCount(1);

    await modeSwitch(page).getByText("Sliders").click();
    await expect(studio(page)).toBeVisible();
    await expect(tables(page)).toHaveCount(0);
    await expect(planned(page, "Food")).toHaveText("$137");
    await expect(saveButton(page)).toBeEnabled();
    const saved = page.waitForResponse((response) => response.url().includes("/api/month-plan/apply-changes") && response.ok());
    await saveButton(page).click();
    expect((await saved).request().postDataJSON().changes).toHaveLength(1);
    await expect(page.locator("[data-plan-mode-dirty]")).toHaveCount(0);
  });

  test("the mode is remembered: Tables stays Tables after a reload, and the plan tables do everything they did", async ({ page }) => {
    await seed(page);
    await open(page);
    await modeSwitch(page).getByText("List").click();
    await expect(tables(page)).toBeVisible();
    await page.reload();
    await expect(tables(page)).toBeVisible();
    await expect(modeSwitch(page).getByRole("radio", { name: "List" })).toBeChecked();
    await expect(page.getByRole("button", { name: /Add (monthly budget|bill|income)/i }).first()).toBeVisible();
    await expect(studio(page)).toHaveCount(0);
  });

  test("a month with nothing planned shows the tables without a switch", async ({ page }) => {
    await reseedDemo(page);
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    // A month with an entry and no plan at all (the demo plans 2025-06 to 2026-05).
    await postJson(page, "/api/entries/create", {
      date: "2024-03-12", description: "Bare month salary", accountName: "UOB One", categoryName: "Salary",
      amountMinor: 50_000, entryType: "income", ownershipType: "direct", ownerName: "Tim"
    });
    await gotoPageAfterApi(page, `/month?view=${VIEW}&month=2024-03&scope=direct_plus_shared`, "/api/month-page", () => page.locator(".month-plan-stack"));
    await expect(studio(page)).toHaveCount(0);
    await expect(modeSwitch(page)).toHaveCount(0);
  });

  test("add a line from Studio: undated lands in a budget bucket, dated in planned items, both in Spend", async ({ page }) => {
    await seed(page);
    await open(page);
    await page.locator('[data-ps-add="spend"]').click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toContainText("Add a line");
    await sheet.getByLabel("Item name").fill("Gym pass");
    await sheet.getByLabel("Planned", { exact: true }).fill("45");
    await sheet.getByRole("button", { name: "Done" }).first().click();
    await expect(row(page, "Gym pass")).toBeVisible();
    await expect(row(page, "Gym pass").locator("[data-ps-due]")).toHaveCount(0);
    await expect(page.locator('[data-ps-group="spend"] [data-ps-row]').filter({ hasText: "Gym pass" })).toHaveCount(1);

    await page.locator('[data-ps-add="spend"]').click();
    const second = page.getByRole("dialog");
    await second.getByLabel("Item name").fill("Phone bill");
    await second.getByLabel("Planned", { exact: true }).fill("30");
    await second.getByLabel("Due date (optional)").fill(`${MONTH}-09`);
    await second.getByRole("button", { name: "Done" }).first().click();
    await expect(row(page, "Phone bill").locator("[data-ps-due]")).toHaveText("due 9 May");

    const rows = await allRows(page);
    expect(rows.find((item) => item.label === "Gym pass")).toMatchObject({ section: "budget_buckets", plannedMinor: 4_500 });
    expect(rows.find((item) => item.label === "Phone bill")).toMatchObject({ section: "planned_items", plannedMinor: 3_000, planDate: `${MONTH}-09` });
    // Dated lines come first in Spend, by date.
    const order = await page.locator('[data-ps-group="spend"] .ps-row-label').allInnerTexts();
    expect(order.indexOf("Phone bill")).toBeLessThan(order.indexOf("Gym pass"));
  });

  test("reach notes, details, matching and removing from a row's menu", async ({ page }) => {
    await seed(page);
    await open(page);
    const food = row(page, "Food");
    await food.getByRole("button", { name: "More for Food" }).click();
    const items = await page.getByRole("menuitem").allInnerTexts();
    expect(items).toEqual(["Edit note", "Edit name, date or category", "Remove line"]);
    await page.getByRole("menuitem", { name: "Edit note" }).click();
    const note = page.getByRole("dialog").filter({ hasText: "Edit note" });
    await note.locator("textarea").fill("Studio note");
    await note.locator('button[type="submit"]').click();
    await expect(note).toHaveCount(0);
    await expect.poll(async () => (await allRows(page)).find((item) => item.label === "Food")?.note).toBe("Studio note");

    // A dated line can also match entries.
    const loan = page.locator('[data-ps-group="spend"] [data-ps-row]').filter({ hasText: "House loan" });
    await loan.getByRole("button", { name: "More for House loan" }).click();
    await expect(page.getByRole("menuitem", { name: "Pick matching entries" })).toBeVisible();
    await page.getByRole("menuitem", { name: "Pick matching entries" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");

    // Remove asks first; Cancel does nothing, Remove line removes it.
    await food.getByRole("button", { name: "More for Food" }).click();
    await page.getByRole("menuitem", { name: "Remove line" }).click();
    const ask = page.getByRole("dialog").filter({ hasText: "Remove Food" });
    await expect(ask).toContainText("Remove Food from this month's plan?");
    await ask.getByRole("button", { name: "Cancel" }).click();
    await expect(row(page, "Food")).toBeVisible();
    expect((await allRows(page)).some((item) => item.label === "Food")).toBe(true);
    await food.getByRole("button", { name: "More for Food" }).click();
    await page.getByRole("menuitem", { name: "Remove line" }).click();
    await page.getByRole("dialog").filter({ hasText: "Remove Food" }).getByRole("button", { name: "Remove line" }).click();
    await expect(row(page, "Food")).toHaveCount(0);
    expect((await allRows(page)).some((item) => item.label === "Food")).toBe(false);
  });

  test("Planned in shows one stripe segment and one legend item per income row", async ({ page }) => {
    await seed(page);
    await postJson(page, "/api/month-plan/save", {
      rowId: "plan-studio-v2-bonus", month: MONTH, sectionKey: "income", categoryName: "Salary", label: "Bonus",
      planDate: null, accountName: "", plannedMinor: 100_000, note: "", ownershipType: "direct", ownerName: "Tim"
    });
    await open(page);
    await expect(page.locator("[data-ps-income-seg]")).toHaveCount(2);
    await expect(page.locator("[data-ps-income-legend] [data-ps-income-part]")).toHaveText([/Salary\s*\$6,000/, /Bonus\s*\$1,000/]);
    await expect(page.locator("[data-ps-flag]")).toContainText("Planned money in $7,000");
  });

  test("money that arrived beyond the plan: a quiet line, and Add to Savings asks, then saves through Save plan", async ({ page }) => {
    await seed(page, { extraIncome: 50_000 });
    await open(page);
    const line = page.locator("[data-ps-extra]");
    await expect(line).toContainText("You got $500 that isn't in the plan");
    const before = (await allRows(page)).find((item) => item.label === "Savings").plannedMinor;

    // Cancel does nothing.
    let writes = 0;
    page.on("request", (request) => { if (request.url().includes("/api/month-plan/apply-changes")) writes += 1; });
    const balanceBefore = await page.locator("[data-ps-balance]").textContent();
    const plannedInBefore = await page.locator("[data-ps-flag]").innerText();
    await line.getByRole("button", { name: "Add to Savings" }).click();
    const ask = page.getByRole("dialog");
    await expect(ask).toContainText("Add $500 to Savings?");
    await expect(ask).toContainText("This adds $500 to your Savings and counts it as extra money in, so the plan still adds up.");
    await expect(ask).not.toContainText("Left over");
    await ask.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(writes).toBe(0);
    expect((await allRows(page)).find((item) => item.label === "Savings").plannedMinor).toBe(before);
    await expect(saveButton(page)).toBeDisabled();
    await expect(page.locator("[data-ps-flag]")).toHaveText(plannedInBefore);

    // Confirm raises Savings AND adds the amount as planned money in, in the one Save plan request.
    await line.getByRole("button", { name: "Add to Savings" }).click();
    const saved = page.waitForResponse((response) => response.url().includes("/api/month-plan/apply-changes") && response.ok());
    await page.getByRole("dialog").getByRole("button", { name: "Add to Savings" }).click();
    const request = (await saved).request().postDataJSON();
    expect(request.changes).toHaveLength(2);
    expect(request.changes[0]).toMatchObject({ action: "update", expectedMinor: before, plannedMinor: before + 50_000 });
    expect(request.changes[1]).toMatchObject({
      action: "create", sectionKey: "income", categoryName: "Income", label: "Extra income", plannedMinor: 50_000, ownershipType: "direct", ownerName: "Tim"
    });
    await expect(page.locator("[data-ps-notice]")).toHaveText("Added to Savings and saved.");
    expect((await allRows(page)).find((item) => item.label === "Savings").plannedMinor).toBe(before + 50_000);
    // Planned money in rose by the same $500, Left over did not move, and the line is gone.
    await expect(page.locator("[data-ps-flag]")).toContainText("Planned money in $6,500");
    expect(plannedInBefore).toContain("Planned money in $6,000");
    await expect(page.locator("[data-ps-balance]")).toHaveText(balanceBefore);
    await expect(page.locator("[data-ps-extra]")).toHaveCount(0);
    await expect(row(page, "Extra income").locator("[data-ps-amount]")).toHaveText("$500");
    // After the reload the stored plan agrees: one Extra income line of $500 for Tim.
    const month = await loadMonthPage(page, { view: VIEW, month: MONTH });
    expect(month.monthPage.incomeRows.filter((item) => item.label === "Extra income").map((item) => item.plannedMinor)).toEqual([50_000]);
  });

  test("a second Add to Savings raises the Extra income line instead of adding another", async ({ page }) => {
    await seed(page, { extraIncome: 50_000 });
    await postJson(page, "/api/month-plan/save", {
      rowId: "plan-studio-v2-extra", month: MONTH, sectionKey: "income", categoryName: "Income", label: "Extra income",
      planDate: null, accountName: "", plannedMinor: 20_000, note: "", ownershipType: "direct", ownerName: "Tim"
    });
    await open(page);
    // $6,500 arrived against $6,200 planned: $300 is not in the plan.
    await expect(page.locator("[data-ps-extra]")).toContainText("You got $300 that isn't in the plan");
    const saved = page.waitForResponse((response) => response.url().includes("/api/month-plan/apply-changes") && response.ok());
    await page.locator("[data-ps-extra-add]").click();
    await page.getByRole("dialog").getByRole("button", { name: "Add to Savings" }).click();
    const request = (await saved).request().postDataJSON();
    expect(request.changes.map((change) => change.action)).toEqual(["update", "update"]);
    expect(request.changes.find((change) => change.rowId === "plan-studio-v2-extra")).toMatchObject({ expectedMinor: 20_000, plannedMinor: 50_000 });
    await expect(page.locator("[data-ps-extra]")).toHaveCount(0);
    const month = await loadMonthPage(page, { view: VIEW, month: MONTH });
    expect(month.monthPage.incomeRows.filter((item) => item.label === "Extra income").map((item) => item.plannedMinor)).toEqual([50_000]);
  });

  test("when the plan changed underneath, Add to Savings says so and changes nothing", async ({ page }) => {
    await seed(page, { extraIncome: 50_000 });
    await open(page);
    const data = await loadMonthPage(page, { view: VIEW, month: MONTH });
    const section = data.monthPage.planSections.find((item) => item.rows.some((candidate) => candidate.label === "Savings"));
    const savings = section.rows.find((candidate) => candidate.label === "Savings");
    await postJson(page, "/api/month-plan/save", {
      rowId: savings.id, month: MONTH, sectionKey: section.key, categoryName: "Savings", label: "Savings",
      planDate: null, accountName: "", plannedMinor: savings.plannedMinor + 100, note: "", ownershipType: savings.ownershipType, ownerName: "Tim"
    });
    await page.locator("[data-ps-extra-add]").click();
    await page.getByRole("dialog").getByRole("button", { name: "Add to Savings" }).click();
    await expect(page.locator("[data-ps-save-error]")).toBeVisible();
    const month = await loadMonthPage(page, { view: VIEW, month: MONTH });
    expect(month.monthPage.incomeRows.filter((item) => item.label === "Extra income")).toHaveLength(0);
  });

  test("the switch sits in the toolbar's row beside Save plan: no row of its own, 44px tall", async ({ page }) => {
    await seed(page);
    await open(page);
    const toolbar = await page.locator(".ps-toolbar").first().boundingBox();
    const switchBox = await modeSwitch(page).boundingBox();
    expect(switchBox.y).toBeGreaterThanOrEqual(toolbar.y - 1);
    expect(switchBox.y + switchBox.height).toBeLessThanOrEqual(toolbar.y + toolbar.height + 1);
    await expect(modeSwitch(page)).toHaveAttribute("aria-label", "How to show the plan");
    await expect(page.locator("[data-plan-mode-bar]")).toHaveCount(0);
    const target = await modeSwitch(page).locator("input").first().boundingBox();
    expect(target.height).toBeGreaterThanOrEqual(43.5);
    // In the list view there is no toolbar, so the switch has a row of its own.
    await modeSwitch(page).getByText("List").click();
    await expect(page.locator("[data-plan-mode-bar]")).toHaveCount(1);
  });

  test("the confirm says when other held changes are saved with it", async ({ page }) => {
    await seed(page, { extraIncome: 50_000 });
    await open(page);
    await typeAmount(page, "Food", "137");
    await page.locator("[data-ps-extra-add]").click();
    await expect(page.getByRole("dialog")).toContainText("This also saves your 1 other change to the plan.");
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await expect(planned(page, "Food")).toHaveText("$137");
  });

  test("no extra-income line when nothing arrived beyond the plan", async ({ page }) => {
    await seed(page);
    await open(page);
    await expect(page.locator("[data-ps-extra]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add to Savings" })).toHaveCount(0);
  });

  test("with money hidden there is no extra-income line, no figures and no action", async ({ page }) => {
    await seed(page, { reveal: false, extraIncome: 50_000 });
    await open(page);
    await expect(page.locator("[data-ps-extra]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add to Savings" })).toHaveCount(0);
  });

  test("another person's plan is untouched: the action applies to the person viewed", async ({ page }) => {
    await seed(page, { extraIncome: 50_000 });
    await open(page);
    const before = (await loadMonthPage(page, { view: "person-joyce", month: MONTH })).monthPage.incomeRows.length;
    await page.locator("[data-ps-extra-add]").click();
    await page.getByRole("dialog").getByRole("button", { name: "Add to Savings" }).click();
    await expect(page.locator("[data-ps-extra]")).toHaveCount(0);
    const joyce = (await loadMonthPage(page, { view: "person-joyce", month: MONTH })).monthPage.incomeRows;
    expect(joyce).toHaveLength(before);
    expect(joyce.some((item) => item.label === "Extra income")).toBe(false);
  });

  test("the household view is read only: no add, no menu, and the extra-income line has no button", async ({ page }) => {
    await seed(page, { extraIncome: 50_000 });
    await open(page, `/month?view=household&month=${MONTH}&scope=direct_plus_shared`);
    await expect(page.locator("[data-ps-add], [data-ps-menu-button], [data-ps-extra-add]")).toHaveCount(0);
  });
});

test.describe("Plan Studio v2 on a phone", () => {
  test.use({ ...iPhone13, hasTouch: true });

  test("island Undo shares the slider draft and List returns to held changes", async ({ page }) => {
    await seed(page);
    await open(page);
    const slider = row(page, "Food").getByRole("slider");
    const before = await slider.getAttribute("aria-valuenow");
    const baseline = await page.locator(".mobile-context-sticky-bar").boundingBox();
    await typeAmount(page, "Food", "1234");
    await expect(slider).toHaveAttribute("aria-valuenow", "1234");
    const island = page.locator(".mobile-context-sticky-bar");
    await expect(island.locator("[data-plan-island-undo]")).toBeVisible();
    const personChip = await island.locator(".mobile-context-person-chip").boundingBox();
    const switchBox = await islandModeSwitch(page).boundingBox();
    // Month's labelled picker already owns its previous/next actions. A
    // second bare-arrow pair would crowd out the Sliders | List switch.
    await expect(island.locator(".mobile-month-jump")).toHaveCount(0);
    await expect(island.locator(".mobile-context-scope")).toBeHidden();
    const monthNavigation = await island.locator(".mobile-month-choice").boundingBox();
    const islandBox = await island.boundingBox();
    expect(personChip.x + personChip.width).toBeLessThanOrEqual(switchBox.x);
    expect(switchBox.x + switchBox.width).toBeLessThanOrEqual(monthNavigation.x);
    expect(monthNavigation.x + monthNavigation.width).toBeLessThanOrEqual(islandBox.x + islandBox.width);
    const changed = await island.boundingBox();
    expect(Math.abs(changed.height - baseline.height)).toBeLessThanOrEqual(1);
    for (const action of await island.locator("#mobile-plan-actions button").all()) {
      const box = await action.boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.x + box.width).toBeLessThanOrEqual(changed.x + changed.width);
    }
    await island.locator("[data-plan-island-undo]").click();
    await expect(slider).toHaveAttribute("aria-valuenow", before);
    await expect(island.locator("[data-plan-island-undo]")).toHaveCount(0);
    const switchInIsland = islandModeSwitch(page);
    await expect(switchInIsland.locator('[data-plan-mode="studio"]')).toBeFocused();
    await switchInIsland.locator('[data-plan-mode="tables"]').check();
    await expect(tables(page)).toBeVisible();
    await expect(switchInIsland.locator('[data-plan-mode="studio"]')).toBeVisible();
    await switchInIsland.locator('[data-plan-mode="studio"]').check();
    await expect(studio(page)).toBeVisible();
  });

  test("island actions respect a plan save in flight", async ({ page }) => {
    await seed(page);
    await open(page);
    await typeAmount(page, "Food", "1234");
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    await page.route("**/api/month-plan/apply-changes", async (route) => { await held; await route.continue(); });
    const sent = page.waitForRequest("**/api/month-plan/apply-changes");
    await saveButton(page).click();
    await sent;
    const island = page.locator(".mobile-context-sticky-bar");
    try {
      await expect(island.locator("[data-plan-island-undo]")).toBeDisabled();
      await expect(islandModeSwitch(page).locator("input")).toHaveCount(2);
      for (const input of await islandModeSwitch(page).locator("input").all()) await expect(input).toBeDisabled();
    } finally {
      release();
    }
    await expect(studio(page)).not.toHaveAttribute("aria-busy", "true");
    await expect(island.locator("[data-plan-island-undo]")).toHaveCount(0);
    for (const input of await islandModeSwitch(page).locator("input").all()) await expect(input).toBeEnabled();
  });

  test("non-default scope stays visible beside contextual plan actions", async ({ page }) => {
    await seed(page);
    await open(page, URL.replace("direct_plus_shared", "direct"));
    const island = page.locator(".mobile-context-sticky-bar");
    await expect(island.locator(".mobile-context-scope")).toHaveText("Direct");
    await expect(island.locator(".mobile-context-scope")).toBeVisible();
    await expect(islandModeSwitch(page)).toBeVisible();
    const scope = await island.locator(".mobile-context-scope").boundingBox();
    const action = await islandModeSwitch(page).boundingBox();
    expect(action.y + action.height).toBeLessThanOrEqual(scope.y);
  });

  test("a figure menu consumes a dismissal tap on a slider", async ({ page }) => {
    await seed(page);
    await open(page, HISTORY_URL);
    const food = row(page, "Food");
    const slider = food.getByRole("slider");
    await slider.scrollIntoViewIfNeeded();
    const before = await slider.getAttribute("aria-valuenow");
    await food.locator(".ps-row-figure").click();
    await expect(page.locator(".figure-menu")).toBeVisible();
    const box = await slider.boundingBox();
    await page.touchscreen.tap(box.x + 20, box.y + 20);
    await expect(page.locator(".figure-menu")).toHaveCount(0);
    await expect(slider).toHaveAttribute("aria-valuenow", before);
  });

  test("More pages locks background scrolling until dismissed", async ({ page }) => {
    await seed(page);
    await open(page);
    const slider = row(page, "Food").getByRole("slider");
    const before = await slider.getAttribute("aria-valuenow");
    await page.getByRole("button", { name: "More pages" }).tap();
    await expect(page.locator(".tab-overflow-popover")).toBeVisible();
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await page.mouse.move(20, 200);
    await page.mouse.wheel(0, 800);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(scrollBefore, 0);
    await page.touchscreen.tap(20, 200);
    await expect(page.locator(".tab-overflow-popover")).toHaveCount(0);
    await expect(slider).toHaveAttribute("aria-valuenow", before);
  });

  test("dismissing pinned information on a slider consumes the tap", async ({ page }) => {
    await seed(page);
    await open(page);
    const food = row(page, "Food");
    const slider = food.getByRole("slider");
    await slider.scrollIntoViewIfNeeded();
    const before = await slider.getAttribute("aria-valuenow");
    await food.locator("[data-ps-info-button]").tap();
    await expect(popover(page)).toBeVisible();
    const box = await slider.boundingBox();
    await page.touchscreen.tap(box.x + 20, box.y + 20);
    await expect(popover(page)).toHaveCount(0);
    await expect(slider).toHaveAttribute("aria-valuenow", before);
    await page.touchscreen.tap(box.x + 20, box.y + 20);
    await expect(slider).not.toHaveAttribute("aria-valuenow", before);
  });

  test("the info button pins the popover, a second tap closes it, and every new control is 44px", async ({ page }) => {
    await seed(page);
    await open(page, HISTORY_URL);
    const info = row(page, "Food").locator("[data-ps-info-button]");
    await info.tap();
    await expect(popover(page)).toBeVisible();
    await expect(popover(page)).toContainText("Last month");
    const box = await info.boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await expect(popover(page)).toHaveCount(0);
    const small = await page.evaluate(() => [...document.querySelectorAll("[data-ps-info-button], [data-ps-menu-button], [data-ps-add], [data-plan-mode-switch] input, [data-ps-extra-add]")]
      .filter((element) => { const r = element.getBoundingClientRect(); return r.width > 0 && (r.height < 43.5 || r.width < 43.5); })
      .map((element) => `${element.tagName}:${element.getAttribute("aria-label") ?? element.getAttribute("data-plan-mode") ?? element.className}`));
    expect(small).toEqual([]);
  });

  test("the popover shows while a thumb is dragged and the amount sheet still opens", async ({ page }) => {
    await seed(page);
    await open(page);
    const slider = row(page, "Food").getByRole("slider");
    await slider.scrollIntoViewIfNeeded();
    const box = await slider.boundingBox();
    const client = await page.context().newCDPSession(page);
    const touch = (type, x) => client.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y: box.y + box.height / 2 }] });
    await touch("touchStart", box.x + box.width * 0.3);
    await touch("touchMove", box.x + box.width * 0.45);
    await touch("touchMove", box.x + box.width * 0.6);
    await expect(popover(page)).toBeVisible();
    await touch("touchEnd");
    await expect(popover(page)).toHaveCount(0);
  });

  test("Add to Savings on a phone: Cancel changes nothing, confirm raises Savings and Planned money in together", async ({ page }) => {
    await seed(page, { extraIncome: 50_000 });
    await open(page);
    const extra = page.locator("[data-ps-extra]");
    await extra.scrollIntoViewIfNeeded();
    const plannedInBefore = await page.locator("[data-ps-flag]").innerText();
    await extra.getByRole("button", { name: "Add to Savings" }).tap();
    await expect(page.getByRole("dialog")).toContainText("Add $500 to Savings?");
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).tap();
    await expect(page.locator("[data-ps-flag]")).toHaveText(plannedInBefore);
    await extra.getByRole("button", { name: "Add to Savings" }).tap();
    const saved = page.waitForResponse((response) => response.url().includes("/api/month-plan/apply-changes") && response.ok());
    await page.getByRole("dialog").getByRole("button", { name: "Add to Savings" }).tap();
    expect((await saved).request().postDataJSON().changes.map((change) => change.action)).toEqual(["update", "create"]);
    await expect(page.locator("[data-ps-flag]")).toContainText("Planned money in $6,500");
    await expect(page.locator("[data-ps-extra]")).toHaveCount(0);
  });

  test("the switch shares the toolbar's row on a phone, with nothing scrolling sideways", async ({ page }) => {
    await seed(page);
    await open(page);
    // First row with Undo and Discard changes; Save plan keeps its own row. No row is spent on the switch.
    const undo = await page.locator("[data-ps-undo]").boundingBox();
    const switchBox = await modeSwitch(page).boundingBox();
    expect(Math.abs((switchBox.y + switchBox.height / 2) - (undo.y + undo.height / 2))).toBeLessThan(6);
    const toolbar = await page.locator(".ps-toolbar").first().boundingBox();
    expect(switchBox.y + switchBox.height).toBeLessThanOrEqual(toolbar.y + toolbar.height + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("Sliders | List switches on a phone and List keeps the tap-to-edit row sheet", async ({ page }) => {
    await seed(page);
    await open(page);
    await islandModeSwitch(page).locator('[data-plan-mode="tables"]').check();
    await expect(tables(page)).toBeVisible();
    await expect(studio(page)).toBeHidden();
    await islandModeSwitch(page).locator('[data-plan-mode="studio"]').check();
    await expect(studio(page)).toBeVisible();
  });

  test("a row's menu, the details sheet and add a line work on a phone", async ({ page }) => {
    await seed(page);
    await open(page);
    await row(page, "Food").getByRole("button", { name: "More for Food" }).tap();
    await page.getByRole("menuitem", { name: "Edit name, date or category" }).tap();
    await expect(page.getByRole("dialog")).toContainText("Food");
    await page.keyboard.press("Escape");
    await page.locator('[data-ps-add="spend"]').tap();
    await expect(page.getByRole("dialog")).toContainText("Add a line");
  });
});
