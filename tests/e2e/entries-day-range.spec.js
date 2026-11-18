import { devices, expect, test } from "@playwright/test";

import { expectFits, fakeKeyboard, setKeyboard } from "./fit-check.js";
import { STRESS, seedStressHousehold } from "./fit-stress-fixture.js";
import { gotoPageAfterApi, loadEntriesPage, postJson, reseedDemo } from "./helpers";

// Days on Entries and in Ask (Ask audit B25; docs/flows/entries-flow.md
// "From and To"; docs/flows/ask-flow.md "Days"): the Filters' From and To
// list a run of days in place of the month, shown as a chip that clears
// it; Ask's "what did I spend between 27 apr and 3 may" answers with the
// total Entries then shows for those days, to the cent. The test Worker has
// no AI, so Ask reads with its rules here.

const MAY = "2026-05";
const WEEK = { from: "2026-04-27", to: "2026-05-03" };

// What the household spent on those days, as the Entries page DTO has it.
async function weekRows(page) {
  const data = await loadEntriesPage(page, { view: "household", month: MAY });
  const april = await loadEntriesPage(page, { view: "household", month: "2026-04" });
  return [...april.monthPage.entries, ...data.monthPage.entries].filter((entry) => entry.date >= WEEK.from && entry.date <= WEEK.to);
}

async function seedWeek(page) {
  for (const [date, description, amountMinor] of [["2026-04-26", "Day before range", 9_999], ["2026-04-28", "Range Tuesday", 1_234], ["2026-05-02", "Range Saturday", 5_600], ["2026-05-04", "Day after range", 8_888]]) {
    await postJson(page, "/api/entries/create", { date, description, accountName: "UOB One", categoryName: "Groceries", amountMinor, entryType: "expense", ownershipType: "direct", ownerName: "Tim" });
  }
}

test.describe("a run of days", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await reseedDemo(page);
    await seedWeek(page);
  });

  test("wide screen: From and To list just those days across two months, the chip names them, and ✕ goes back to the month", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoPageAfterApi(page, `/entries?view=household&month=${MAY}`, "/api/entries-page", () => page.locator(".entry-row").first());
    const toggle = page.locator(".entries-filter-toggle");
    if (await toggle.isVisible()) await toggle.click();
    const days = page.locator('[data-filter-target="days"]');
    await days.getByLabel("From").fill(WEEK.from);
    await expect(page).toHaveURL(/entry_day_from=2026-04-27/);
    await days.getByLabel("To").fill(WEEK.to);
    await expect(page).toHaveURL(/entry_day_to=2026-05-03/);
    await expect(page).toHaveURL(/month=2026-05/);

    const chip = page.locator("[data-figure-chip]");
    await expect(chip).toContainText("27 Apr to 3 May");
    await expect(page.locator(".entries-totals")).toContainText("27 Apr to 3 May");
    const expected = await weekRows(page);
    await expect(page.locator(".entry-row")).toHaveCount(expected.length);
    await expect(page.locator(".entry-row").filter({ hasText: "Range Tuesday" })).toHaveCount(1);
    await expect(page.locator(".entry-row").filter({ hasText: "Day before range" })).toHaveCount(0);
    await expect(page.locator(".entry-row").filter({ hasText: "Day after range" })).toHaveCount(0);

    // ✕: the month's whole list again.
    await chip.getByRole("button").click();
    await expect(page).not.toHaveURL(/entry_day_/);
    await expect(page.locator(".entry-row").filter({ hasText: "Day after range" })).toHaveCount(1);
  });

  test("negative: another month picked in the header drops the days", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoPageAfterApi(page, `/entries?view=household&month=${MAY}&entry_day_from=${WEEK.from}&entry_day_to=${WEEK.to}`, "/api/entries-page", () => page.locator(".entry-row").first());
    await expect(page.locator("[data-figure-chip]")).toContainText("27 Apr to 3 May");
    await gotoPageAfterApi(page, `/entries?view=household&month=2026-04&entry_day_from=${WEEK.from}&entry_day_to=${WEEK.to}`, "/api/entries-page", () => page.locator(".entry-row").first());
    await expect(page.locator("[data-figure-chip]")).toHaveCount(0);
    await expect(page.locator(".entry-row").filter({ hasText: "Day before range" })).toHaveCount(1);
  });

  test("phone, Ask with AI off: the days' answer and the Entries it opens show the same total", async ({ page }) => {
    await page.setViewportSize(devices["iPhone 12 Pro"].viewport);
    await page.goto(`/ask?view=household&month=${MAY}&scope=direct_plus_shared`);
    const box = page.getByRole("textbox", { name: "Message" });
    await expect(box).toBeVisible({ timeout: 60_000 });
    await box.fill("what did I spend between 27 apr and 3 may");
    await box.press("Enter");
    const answer = page.locator(".ask-answer").last();
    await expect(answer).toHaveAttribute("data-ask-answer", /^\d+$/, { timeout: 30_000 });
    await expect(answer.locator('[data-part="days"]')).toHaveText("27 Apr to 3 May");
    const askTotal = (await answer.locator(".ask-answer-amount").innerText()).trim();
    const expected = await weekRows(page);
    expect(Number(await answer.getAttribute("data-ask-answer"))).toBe(expected.length);

    await page.getByRole("group", { name: "Suggestions" }).getByRole("button", { name: "Open in Entries" }).click();
    await expect(page).toHaveURL(/\/entries\?.*entry_day_from=2026-04-27/);
    await expect(page).toHaveURL(/entry_day_to=2026-05-03/);
    await expect(page.locator(".entries-ask-chip")).toContainText("27 Apr to 3 May");
    await expect(page.locator(".entries-totals")).toContainText(askTotal);
    await expect(page.locator(".entry-row")).toHaveCount(expected.length);
  });
});

// The phone fit check (docs/code-spec.md "Phone fit check") with the heavy
// household: the View and scope sheet's From and To, set and focused with
// the keyboard (or date picker) up, on three small phones.
test("phone fit: From and To in the filter sheet", async ({ page }) => {
  test.setTimeout(240_000);
  await fakeKeyboard(page);
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await seedStressHousehold(page);
  for (const phone of [{ width: 320, height: 568, keyboard: 260 }, { width: 375, height: 557, keyboard: 291 }, { width: 390, height: 844, keyboard: 336 }]) {
    await page.setViewportSize({ width: phone.width, height: phone.height });
    await page.goto(`/entries?view=household&month=${STRESS.month}`);
    await expect(page.locator(".entry-row").first()).toBeVisible({ timeout: 60_000 });
    await page.locator(".entries-totals .lsd-rows").getByRole("button", { name: /^Filters/ }).click();
    const sheet = page.getByRole("dialog", { name: "View and scope" });
    const from = sheet.getByLabel("From");
    await from.fill(`${STRESS.month}-01`);
    await sheet.getByLabel("To").fill(STRESS.today);
    await expect(page).toHaveURL(/entry_day_to=/);
    await expectFits(page);
    await from.focus();
    await setKeyboard(page, phone.keyboard);
    // The sheet's body is the View and scope sheet, not a list to choose
    // from: with the keyboard up on a 557 px phone it keeps about 93 px,
    // the same with the search field focused (as before this change), so it
    // is held to the plain scroll-box rule here, not the chooser's 2.5 rows.
    await expectFits(page, { mustSee: [":focus"], notChoosers: [".mobile-context-body"] });
    await setKeyboard(page, 0);
    await sheet.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.locator("[data-figure-chip]")).toBeVisible();
    await expectFits(page, { root: "[data-figure-chip]" });
  }
});
