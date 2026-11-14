import { expect, test } from "@playwright/test";

import { loadMonthPage, postJson, reseedDemo } from "./helpers";

// The month wrap-up (design.md "Month wrap-up"; DOMAIN.md "Month Wrap-up"):
// on the Month page, for a month that has ended, one calm checklist after
// Money insights. Each check is a row with a count or figure and one action
// that opens the place that deals with it; a done check stays as a quiet
// tick; with every check done the card is one line. Proved on a phone (390)
// and a desktop (1440) on the demo household, Tim's view.

const OCTOBER = "2025-10";
const SEPTEMBER = "2025-09";
const RANGE_QUERY = "summary_start=2025-06&summary_end=2025-10";
const monthUrl = (month, view = "person-tim") => `/month?view=${view}&month=${month}&${RANGE_QUERY}`;

async function open(page, url, { money = true } = {}) {
  await page.addInitScript((shown) => {
    window.localStorage.setItem("monies-map:money-totals-visible", String(shown));
    window.localStorage.setItem("monies-map:lead-view", "plan");
  }, money);
  await page.goto(url);
  await expect.poll(() => page.evaluate(() => window.__MONIES_MAP_ROUTE_WORK__?.usable ?? false), { timeout: 45_000 }).toBe(true);
}

const card = (page) => page.locator('[data-month-card="wrapUp"] #month-wrap-up');
const check = (page, id) => card(page).locator(`[data-wrapup-check="${id}"]`);

// October in Tim's view: an expense left in Other and Food over its plan, on
// top of the demo's open Splits balances; the monthly note is written.
async function seedOctober(page) {
  await postJson(page, "/api/entries/create", {
    date: "2025-10-12", description: "Wrap-up mystery shop", accountName: "UOB One", categoryName: "Other",
    entryType: "expense", ownershipType: "direct", ownerName: "Tim", amountMinor: 4_500
  });
  await postJson(page, "/api/month-plan/save", {
    rowId: "wrap-up-food", month: OCTOBER, sectionKey: "budget_buckets", categoryName: "Food & Drinks", label: "Food",
    plannedMinor: 30_000, planDate: null, accountName: "", note: "", ownershipType: "direct", ownerName: "Tim"
  });
}

for (const size of [{ width: 390, height: 844, name: "phone" }, { width: 1440, height: 900, name: "desktop" }]) {
  test(`${size.name}: a month with things to do lists every check with one action, and each action opens its place`, async ({ page }) => {
    await reseedDemo(page);
    await seedOctober(page);
    await page.setViewportSize(size);
    await open(page, monthUrl(OCTOBER));
    await expect(card(page)).toBeVisible({ timeout: 30_000 });
    await expect(card(page).locator(".summary-card-title")).toHaveText("Wrap up");
    await expect(card(page).locator(".summary-card-sub")).toHaveText("October: 3 of 6 checks done");

    // The checks in order, done ones as quiet ticks.
    const rows = await card(page).locator("[data-wrapup-check]").evaluateAll((items) => items.map((item) => [item.dataset.wrapupCheck, item.dataset.done, item.querySelector(".wrapup-label").textContent, item.querySelector(".wrapup-action")?.textContent ?? null]));
    expect(rows).toEqual([
      ["other", "false", "Left in Other (no category)", "Open in Entries"],
      ["estimates", "true", "Foreign currency estimates", null],
      ["statements", "true", "Statements imported", null],
      ["splits", "false", "Splits to settle", "Open Splits"],
      ["plan", "false", "Over plan", "Open plan"],
      ["note", "true", "Monthly note", null]
    ]);
    await expect(check(page, "other").locator(".wrapup-value")).toHaveText("1 entry · $45.00");
    await expect(check(page, "statements").locator(".wrapup-value")).toHaveText("All 3");
    await expect(check(page, "note").locator(".wrapup-value")).toHaveText("Written");
    await expect(check(page, "splits").locator(".wrapup-lines li")).toHaveText(["Non-group expenses: You owe Joyce $260.25", "Baby River: You owe Joyce $117.03"]);
    // A debt is rose text; Food is over its plan, in rose.
    await expect(check(page, "splits").locator('[data-fig="splits"]').first()).toHaveClass(/money-short/);
    await expect(check(page, "plan").locator(".wrapup-lines li")).toHaveText([/^Food \$[\d,.]+ over$/]);
    await expect(check(page, "plan").locator('[data-fig="plan"]')).toHaveClass(/money-short/);
    // What changed: the card's biggest rows for October against September.
    await expect(card(page).locator(".wrapup-changed-against")).toHaveText("Against September");
    await expect(card(page).locator("[data-wrapup-changed]").first()).toContainText("Food & Drinks");
    // Every figure is openable, never a button look.
    const otherFigure = check(page, "other").locator('[data-fig="spent"]');
    await expect(otherFigure).toHaveAttribute("data-fig-ids", /txn-/);
    // Nothing scrolls sideways.
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    if (size.name === "phone") {
      // Each action is a 44px target.
      for (const box of await card(page).locator(".wrapup-row .wrapup-action").evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().height))) {
        expect(box).toBeGreaterThanOrEqual(44);
      }
    }

    // Open in Entries: the month's expenses in Other.
    await check(page, "other").getByRole("button", { name: "Open in Entries" }).click();
    await expect(page).toHaveURL(/\/entries\?/);
    const params = new URL(page.url()).searchParams;
    expect([params.get("month"), params.get("entry_category"), params.get("entry_type"), params.get("view")]).toEqual([OCTOBER, "Other", "expense", "person-tim"]);
    await expect(page.getByText("Wrap-up mystery shop").first()).toBeVisible({ timeout: 30_000 });

    // See all opens the What changed card for October on the Month page.
    await page.goBack();
    await expect(card(page)).toBeVisible({ timeout: 30_000 });
    await card(page).getByRole("button", { name: "See all" }).click();
    const changed = page.locator('[data-month-card="changed"] .chg-card');
    await expect(changed).toBeVisible({ timeout: 30_000 });
    await expect(changed.locator(".summary-card-sub")).toHaveText("October so far, against the same days of September");

    // Open plan lands on the plan; Open Splits opens Splits.
    await check(page, "plan").getByRole("button", { name: "Open plan" }).click();
    await expect(page).toHaveURL(/#month-plan$/);
    await check(page, "splits").getByRole("button", { name: "Open Splits" }).click();
    await expect(page).toHaveURL(/\/splits\?view=person-tim&month=2025-10/);
  });
}

test("the monthly note's action opens the note dialog, and saving the note ticks its check", async ({ page }) => {
  await reseedDemo(page);
  await postJson(page, "/api/month-note/update", { month: OCTOBER, personScope: "person-tim", note: "" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, monthUrl(OCTOBER));
  await expect(card(page)).toBeVisible({ timeout: 30_000 });
  const note = check(page, "note");
  await expect(note).toHaveAttribute("data-done", "false");
  await expect(note.locator(".wrapup-value")).toHaveText("Not written yet");
  await note.getByRole("button", { name: "Write the note" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.locator("textarea").fill("Quiet October");
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  // Once saved, the note's check is a tick.
  await expect(note).toHaveAttribute("data-done", "true", { timeout: 30_000 });
});

test("with everything done the card is one line; hidden money shows no amount, no tone and never who owes whom", async ({ page }) => {
  await reseedDemo(page);
  // September in Tim's view: settle Splits and raise Food to what was spent.
  await postJson(page, "/api/splits/checkpoints/create", { viewerPersonId: "person-tim", date: new Date().toISOString().slice(0, 10), currency: "SGD" });
  const september = await loadMonthPage(page, { view: "person-tim", month: SEPTEMBER });
  const food = september.monthPage.planSections.find((section) => section.key === "budget_buckets").rows.find((row) => row.label === "Food");
  await postJson(page, "/api/month-plan/save", {
    rowId: food.id, month: SEPTEMBER, sectionKey: "budget_buckets", categoryName: food.categoryName, label: food.label,
    plannedMinor: food.actualMinor, planDate: null, accountName: "", note: "", ownershipType: "direct", ownerName: "Tim"
  });
  for (const size of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(size);
    await open(page, monthUrl(SEPTEMBER));
    await expect(card(page)).toHaveAttribute("data-wrapped-up", "true", { timeout: 30_000 });
    await expect(card(page)).toHaveText("September is wrapped up");
    expect(await card(page).boundingBox().then((box) => box.height)).toBeLessThan(80);
  }

  // October with money hidden: counts and names only.
  await seedOctober(page);
  await open(page, monthUrl(OCTOBER), { money: false });
  await expect(card(page)).toHaveAttribute("data-wrapped-up", "false", { timeout: 30_000 });
  const text = await card(page).innerText();
  expect(text).not.toMatch(/\$|owe/i);
  await expect(check(page, "other").locator(".wrapup-value")).toHaveText("1 entry");
  await expect(check(page, "plan").locator(".wrapup-value")).toHaveText("1 category");
  expect(await card(page).locator("[data-fig], .money-short, .money-in").count()).toBe(0);
});

test("no wrap-up for the month in progress before its last days, or for a month with no entries", async ({ page }) => {
  await reseedDemo(page);
  const today = new Date();
  const lastDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)).getUTCDate();
  // March 2026 has a plan line and no entries.
  await postJson(page, "/api/month-plan/save", {
    rowId: "wrap-up-empty", month: "2026-03", sectionKey: "budget_buckets", categoryName: "Groceries", label: "Groceries",
    plannedMinor: 30_000, planDate: null, accountName: "", note: "", ownershipType: "direct", ownerName: "Tim"
  });
  const requests = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/month-wrap-up")) requests.push(request.url());
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "/month?view=person-tim&month=2026-03&summary_start=2026-03&summary_end=2026-03");
  await expect(page.locator(".month-panel")).toBeVisible({ timeout: 30_000 });
  expect(new URL(page.url()).searchParams.get("month")).toBe("2026-03");
  // The read never starts for a month with no entries, and the slot takes no room.
  await page.waitForTimeout(1_500);
  await expect(page.locator('[data-month-card="wrapUp"]')).toBeEmpty();
  expect(await page.locator('[data-month-card="wrapUp"]').evaluate((slot) => slot.getBoundingClientRect().height)).toBe(0);
  expect(requests).toEqual([]);
  const api = await page.request.get(`/api/month-wrap-up?view=person-tim&month=${today.toISOString().slice(0, 7)}`);
  const body = await api.json();
  if (today.getUTCDate() <= lastDay - 3) {
    expect(body.wrapUp).toBeNull();
  }
});

test("the month checklist reminder's link (#month-wrap-up) lands on the card", async ({ page }) => {
  await reseedDemo(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, `${monthUrl(OCTOBER)}#month-wrap-up`);
  await expect(card(page)).toBeVisible({ timeout: 30_000 });
  await expect(card(page)).toBeInViewport();
});
