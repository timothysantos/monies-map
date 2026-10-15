import { devices, expect, test } from "@playwright/test";

import { chooseStudio, gotoPageAfterApi, loadMonthPage, postJson, reseedDemo } from "./helpers";

// Plan Studio (DOMAIN.md "Plan Studio", design.md "Plan Studio"): the Month
// plan view as money jobs. Tim's May 2026 in the demo household has plan rows
// but no planned income, so each test adds a $6,000 salary: $6,000 in against
// about $3,997 of spend and the $1,800 savings target leaves money over.

const VIEW = "person-tim";
const MONTH = "2026-05";
const URL = `/month?view=${VIEW}&month=${MONTH}&scope=direct_plus_shared`;
const { defaultBrowserType: _browser, ...iPhone13 } = devices["iPhone 13"];

async function seed(page, { reveal = true } = {}) {
  await chooseStudio(page);
  await reseedDemo(page);
  await postJson(page, "/api/month-plan/save", {
    rowId: "plan-studio-e2e-salary", month: MONTH, sectionKey: "income", categoryName: "Salary", label: "Salary",
    planDate: null, accountName: "", plannedMinor: 600_000, note: "", ownershipType: "direct", ownerName: "Tim"
  });
  if (reveal) {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  }
}

async function open(page) {
  await gotoPageAfterApi(page, URL, "/api/month-page", () => page.locator("[data-plan-studio]"));
}

const studio = (page) => page.locator("[data-plan-studio]");
const row = (page, name) => page.locator("[data-ps-row]").filter({ has: page.locator(".ps-row-label", { hasText: new RegExp(`^${name}$`) }) });
const balance = (page) => page.locator("[data-ps-balance]");
const saveButton = (page) => page.locator("[data-ps-save]");
const planned = (page, name) => row(page, name).locator("[data-ps-amount]");

async function typeAmount(page, name, text) {
  await planned(page, name).click();
  const field = page.getByRole("textbox", { name: "Planned amount" });
  await field.fill(text);
  await field.press("Enter");
}

test.describe("Plan Studio on desktop", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("shows where planned money in goes and says the plan covers everything", async ({ page }) => {
    await seed(page);
    await open(page);
    await expect(balance(page)).toHaveAttribute("data-kind", "covered");
    await expect(balance(page)).toContainText("Your plan covers everything.");
    await expect(balance(page)).toContainText("is left over.");
    await expect(page.locator("[data-ps-flag]")).toContainText("Planned in $6,000");
    for (const id of ["spend", "save", "invest", "left"]) {
      await expect(page.locator(`[data-ps-seg="${id}"]`)).toBeAttached();
    }
    await expect(page.locator("[data-ps-pace]")).toContainText("How the month is going");
    await expect(studio(page).getByRole("button", { name: "Save plan" })).toBeDisabled();
  });

  test("tap an amount, type 137, press Enter: the row and the balance update, and Save plan keeps it after a reload", async ({ page }) => {
    await seed(page);
    await open(page);
    const before = await balance(page).innerText();
    await expect(planned(page, "Food")).toHaveText("$650");
    await typeAmount(page, "Food", "137");
    await expect(planned(page, "Food")).toHaveText("$137");
    await expect(row(page, "Food").locator(".ps-delta")).toContainText("−$513 from saved");
    await expect(balance(page)).not.toHaveText(before);
    await expect(saveButton(page)).toBeEnabled();

    const saved = page.waitForResponse((response) => response.url().includes("/api/month-plan/apply-changes") && response.ok());
    await saveButton(page).click();
    const request = (await saved).request().postDataJSON();
    expect(request.changes).toHaveLength(1);
    expect(request.changes[0]).toMatchObject({ action: "update", expectedMinor: 65_000, plannedMinor: 13_700 });
    await expect(page.locator("[data-ps-notice]")).toHaveText("Plan saved.");
    await expect(saveButton(page)).toBeDisabled();

    await page.reload();
    await studio(page).waitFor();
    await expect(planned(page, "Food")).toHaveText("$137");
    const data = await loadMonthPage(page, { view: VIEW, month: MONTH });
    expect(data.monthPage.planSections.flatMap((section) => section.rows).find((item) => item.label === "Food").plannedMinor).toBe(13_700);
  });

  test("an amount that is not dollars and cents is refused with a reason, and Escape cancels", async ({ page }) => {
    await seed(page);
    await open(page);
    await planned(page, "Food").click();
    const field = page.getByRole("textbox", { name: "Planned amount" });
    await field.fill("abc");
    await field.press("Enter");
    await expect(page.getByRole("alert")).toContainText("Use numbers only");
    await field.fill("12.345");
    await field.press("Enter");
    await expect(page.getByRole("alert")).toContainText("dollars and cents");
    await field.fill("");
    await field.press("Enter");
    await expect(page.getByRole("alert")).toContainText("Type an amount.");
    await expect(planned(page, "Food")).toHaveText("$650");
    await field.fill("900");
    await expect(page.getByText("+$250 from saved")).toBeVisible();
    await field.press("Escape");
    await expect(field).toBeHidden();
    await expect(planned(page, "Food")).toHaveText("$650");
    await expect(saveButton(page)).toBeDisabled();
    // The chips and Reset to saved work on the field.
    await planned(page, "Food").click();
    await page.getByRole("button", { name: "+$50" }).click();
    await expect(page.getByRole("textbox", { name: "Planned amount" })).toHaveValue("700");
    await page.locator(".ps-pop").getByRole("button", { name: "Reset to saved" }).click();
    await expect(page.getByRole("textbox", { name: "Planned amount" })).toHaveValue("650");
  });

  test("a row's slider moves by key: arrows one step, Shift five, Alt one dollar, and the nudge buttons by a step", async ({ page }) => {
    await seed(page);
    await open(page);
    const slider = row(page, "Food").getByRole("slider", { name: "Planned amount for Food" });
    await slider.focus();
    await slider.press("ArrowRight");
    await expect(planned(page, "Food")).toHaveText("$700");
    await slider.press("Shift+ArrowRight");
    await expect(planned(page, "Food")).toHaveText("$950");
    await slider.press("Alt+ArrowLeft");
    await expect(planned(page, "Food")).toHaveText("$949");
    await slider.press("Home");
    await expect(planned(page, "Food")).toHaveText("$0");
    await row(page, "Food").getByRole("button", { name: /^Raise Food/ }).click();
    await expect(planned(page, "Food")).toHaveText("$50");
    await row(page, "Food").getByRole("button", { name: /^Lower Food/ }).click();
    await expect(planned(page, "Food")).toHaveText("$0");
  });

  test("holding Shift while dragging gives fine control in one-dollar steps", async ({ page }) => {
    await seed(page);
    await open(page);
    await row(page, "Food").scrollIntoViewIfNeeded();
    const track = row(page, "Food").locator("[data-ps-slider]");
    const box = await track.boundingBox();
    const thumb = await row(page, "Food").locator(".ps-thumb").boundingBox();
    const x = thumb.x + thumb.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.keyboard.down("Shift");
    await page.mouse.move(x + 40, y, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up("Shift");
    // Numbers roll to their new value; read it once it has settled.
    await page.waitForTimeout(700);
    const text = await planned(page, "Food").innerText();
    const value = Number(text.replace(/[^0-9.]/g, ""));
    expect(value).toBeGreaterThan(650);
    expect(value).toBeLessThan(700);
    expect(Number.isInteger(value)).toBe(true);
  });

  test("Undo steps back one drag at a time and Reset to saved drops every change", async ({ page }) => {
    await seed(page);
    await open(page);
    await typeAmount(page, "Food", "100");
    await typeAmount(page, "Groceries", "10");
    await expect(page.locator("[data-ps-undo]")).toBeEnabled();
    await page.locator("[data-ps-undo]").click();
    await expect(planned(page, "Groceries")).toHaveText("$140");
    await expect(planned(page, "Food")).toHaveText("$100");
    await expect(page.locator("[data-ps-notice]")).toHaveText("Undone.");
    await page.locator("[data-ps-reset]").click();
    await expect(planned(page, "Food")).toHaveText("$650");
    await expect(saveButton(page)).toBeDisabled();
    await page.locator("[data-ps-undo]").click();
    await expect(planned(page, "Food")).toHaveText("$100");
  });

  test("dragging the last line past planned money in says the plan doesn't add up, and the fix lowers a category", async ({ page }) => {
    await seed(page);
    await open(page);
    const bar = await page.locator("[data-ps-bar]").boundingBox();
    const divider = await page.locator('[data-ps-divider="2"]').boundingBox();
    const x = divider.x + divider.width / 2;
    const y = bar.y + bar.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(bar.x + bar.width - 2, y, { steps: 8 });
    await page.mouse.up();
    await expect(balance(page)).toHaveAttribute("data-kind", "covered");
    // Left over is used up by the drag; push it further by typing on the invest row.
    await typeAmount(page, "Stashaway", "9000");
    await expect(balance(page)).toHaveAttribute("data-kind", "over");
    await expect(balance(page)).toContainText("The plan doesn't add up.");
    await expect(balance(page)).toContainText("more goes out than comes in.");
    await expect(page.locator("[data-ps-over]")).toBeVisible();
    const fix = page.locator("[data-ps-fix]");
    await expect(fix).toContainText(/^Lower /);
    await fix.click();
    await expect(page.locator("[data-ps-undo]")).toBeEnabled();
  });

  test("a locked row holds, and Take from moves money between two rows instead of using left over", async ({ page }) => {
    await seed(page);
    await open(page);
    await row(page, "Food").getByRole("button", { name: "Lock Food" }).click();
    await expect(row(page, "Food").getByRole("slider")).toHaveAttribute("aria-disabled", "true");
    await expect(planned(page, "Food")).toBeDisabled();
    await expect(row(page, "Food").getByRole("button", { name: /^Raise Food/ })).toBeDisabled();
    await expect(planned(page, "Food")).toHaveText("$650");
    await row(page, "Food").getByRole("button", { name: "Unlock Food" }).click();
    await studio(page).locator(".ps-take select").selectOption({ label: "Groceries" });
    await typeAmount(page, "Food", "700");
    await expect(planned(page, "Food")).toHaveText("$700");
    await expect(planned(page, "Groceries")).toHaveText("$90");
  });

  test("What if I save more: try a target, see where the money comes from, apply it to the plan, then Save plan", async ({ page }) => {
    await seed(page);
    await open(page);
    const card = page.locator("[data-ps-whatif]");
    await expect(card).toContainText("Changes the plan only. Spending is not predicted.");
    await expect(card.getByRole("button", { name: "Apply to plan" })).toBeDisabled();
    await card.locator("[data-ps-amount]").click();
    const field = page.getByRole("textbox", { name: "Planned amount" });
    await field.fill("2500");
    await field.press("Enter");
    await expect(card).toContainText("from left over");
    await expect(card.locator(".ps-whatif-grid")).toContainText("$2,500");
    await expect(saveButton(page)).toBeDisabled();
    await card.getByRole("button", { name: "Cancel" }).click();
    await expect(card.getByRole("button", { name: "Apply to plan" })).toBeDisabled();
    await card.locator("[data-ps-amount]").click();
    await page.getByRole("textbox", { name: "Planned amount" }).fill("2500");
    await page.getByRole("textbox", { name: "Planned amount" }).press("Enter");
    await card.getByRole("button", { name: "Apply to plan" }).click();
    await expect(planned(page, "Savings")).toHaveText("$2,500");
    await expect(page.locator("[data-ps-notice]")).toContainText("Applied to the plan. Save plan to keep it.");
    await saveButton(page).click();
    await expect(page.locator("[data-ps-notice]")).toHaveText("Plan saved.");
    const data = await loadMonthPage(page, { view: VIEW, month: MONTH });
    expect(data.monthPage.planSections.flatMap((section) => section.rows).find((item) => item.label === "Savings").plannedMinor).toBe(250_000);
  });

  test("a failed save keeps the edits and offers to try again; a plan that changed underneath is refused whole", async ({ page }) => {
    await seed(page);
    await open(page);
    await typeAmount(page, "Food", "200");
    await page.route("**/api/month-plan/apply-changes", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false, error: "boom" }) }));
    await saveButton(page).click();
    await expect(page.locator("[data-ps-save-error]")).toContainText("could not be saved. Your changes are still here.");
    await expect(planned(page, "Food")).toHaveText("$200");
    await page.unroute("**/api/month-plan/apply-changes");

    // Someone else changes the same row meanwhile: nothing is written.
    const data = await loadMonthPage(page, { view: VIEW, month: MONTH });
    const food = data.monthPage.planSections.flatMap((section) => section.rows).find((item) => item.label === "Food");
    await postJson(page, "/api/month-plan/save", {
      rowId: food.id, month: MONTH, sectionKey: "budget_buckets", categoryName: food.categoryName, label: food.label,
      plannedMinor: 66_000, ownershipType: food.ownershipType, ownerName: food.ownerName, splitBasisPoints: food.splits[0]?.ratioBasisPoints
    });
    await page.locator("[data-ps-save-error]").getByRole("button", { name: "Try again" }).click();
    await expect(page.locator("[data-ps-save-error]")).toContainText("The plan changed while you were editing");
    await expect(planned(page, "Food")).toHaveText("$200");
    const after = await loadMonthPage(page, { view: VIEW, month: MONTH });
    expect(after.monthPage.planSections.flatMap((section) => section.rows).find((item) => item.label === "Food").plannedMinor).toBe(66_000);
  });

  test("with money hidden every figure is dots, the headline gives no sign away and sliders still work", async ({ page }) => {
    await seed(page, { reveal: false });
    await open(page);
    await expect(planned(page, "Food")).toHaveText("••••");
    await expect(balance(page)).toHaveAttribute("data-kind", "hidden");
    await expect(balance(page)).toContainText("Plan balance");
    await expect(balance(page)).not.toContainText("$");
    const slider = row(page, "Food").getByRole("slider");
    await expect(slider).toHaveAttribute("aria-valuetext", "Amount hidden");
    await expect(row(page, "Food").locator(".ps-row-status")).toHaveText("");
    await slider.focus();
    await slider.press("ArrowRight");
    await expect(saveButton(page)).toBeEnabled();
    await expect(planned(page, "Food")).toHaveText("••••");
    await expect(studio(page)).not.toContainText(/\$\d/);
  });

  test("under reduced motion numbers change at once and bars do not animate", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await seed(page);
    await open(page);
    await typeAmount(page, "Food", "137");
    await expect(planned(page, "Food")).toHaveText("$137", { timeout: 300 });
    const duration = await page.locator('[data-ps-seg="spend"]').evaluate((element) => getComputedStyle(element).transitionDuration);
    expect(duration).toBe("0s");
  });

  test("the combined household view is read only: the picture, no sliders, lines, Save plan or What if", async ({ page }) => {
    await seed(page);
    await gotoPageAfterApi(page, `/month?view=household&month=${MONTH}&scope=direct_plus_shared`, "/api/month-page", () => page.locator("[data-plan-studio]"));
    await expect(page.locator("[data-ps-readonly]")).toContainText("Combined household view is read-only.");
    await expect(studio(page).locator("[data-ps-row]").first()).toBeVisible();
    await expect(studio(page).getByRole("slider")).toHaveCount(0);
    await expect(page.locator("[data-ps-save], [data-ps-whatif], [data-ps-fix], [data-ps-amount]")).toHaveCount(0);
    await expect(page.locator("[data-ps-seg]").first()).toBeAttached();
  });

  test("Simple view does not load Plan Studio at all", async ({ page }) => {
    await seed(page);
    const chunks = [];
    page.on("request", (request) => { if (/plan-studio(?!-add-copy)/.test(request.url())) chunks.push(request.url()); });
    await page.addInitScript(() => window.localStorage.setItem("monies-map:lead-view", "simple"));
    await gotoPageAfterApi(page, URL, "/api/month-page", () => page.locator("[data-money-in]"));
    await expect(page.locator("[data-plan-studio]")).toHaveCount(0);
    expect(chunks).toEqual([]);
  });
});

test.describe("Plan Studio on a phone", () => {
  test.use({ ...iPhone13, hasTouch: true });

  test("the amount opens a bottom sheet with the field, and Set amount applies it", async ({ page }) => {
    await seed(page);
    await open(page);
    await planned(page, "Food").tap();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Planned amount for Food")).toBeVisible();
    const field = dialog.getByRole("textbox", { name: "Planned amount" });
    await expect(field).toHaveAttribute("inputmode", "decimal");
    await field.fill("137");
    await dialog.getByRole("button", { name: "Set amount" }).tap();
    await expect(dialog).toBeHidden();
    await expect(planned(page, "Food")).toHaveText("$137");
  });

  test("every Plan Studio control is at least 44px tall and nothing scrolls sideways", async ({ page }) => {
    await seed(page);
    await open(page);
    const small = await studio(page).evaluate((root) => {
      const bad = [];
      for (const element of root.querySelectorAll("button, [role=slider], select, input")) {
        const rect = element.getBoundingClientRect();
        if (rect.width && rect.height && rect.height < 43.5) bad.push(`${element.className || element.tagName}:${Math.round(rect.height)}`);
      }
      return bad;
    });
    expect(small).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("a single column on a phone, the lines drag with a finger-sized handle", async ({ page }) => {
    await seed(page);
    await open(page);
    const columns = await page.locator("[data-ps-columns]").evaluate((element) => getComputedStyle(element).columnCount);
    expect(columns).toBe("auto");
    const divider = await page.locator('[data-ps-divider="0"]').boundingBox();
    expect(divider.width).toBeGreaterThanOrEqual(44);
  });
});
