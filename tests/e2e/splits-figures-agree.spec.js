import { expect, test } from "@playwright/test";

import { gotoPageAfterApi, loadSplitsPage, postJson, reseedDemo } from "./helpers";

// Every Splits figure for a group describes ONE set: the open period, the
// expenses no settle-up has covered. The lead chip, the entry count, the
// balance, the donut's centre and its list, and the share-of-costs
// insight must agree to the cent; a figure about the whole group says so.
// Another group's open expense and the settled ones must change none of them.

const month = "2026-05";
const PHONE = { width: 390, height: 844 };

async function createExpense(page, groupId, description, date, amountMinor, payerPersonName = "Tim") {
  return postJson(page, "/api/splits/expenses/create", {
    groupId,
    date,
    description,
    categoryName: "Food & Drinks",
    payerPersonName,
    amountMinor,
    splitAmountMinor: amountMinor / 2,
    currency: "SGD",
    paymentMethod: "cash",
    paymentStatus: "recorded"
  });
}

// One group settled once: $300.00 settled by a checkpoint, then $30.00 and
// $45.00 open. A second SGD group has its own open $60.00.
async function createSettledGroup(page, stamp) {
  const group = await postJson(page, "/api/splits/groups/create", { name: `Okaeri ${stamp}`, currency: "SGD", expenseSource: "mixed" });
  await createExpense(page, group.groupId, `Old rent ${stamp}`, `${month}-02`, 10_000);
  await createExpense(page, group.groupId, `Old flights ${stamp}`, `${month}-03`, 20_000);
  await postJson(page, "/api/splits/checkpoints/create", { viewerPersonId: "person-tim", date: `${month}-20`, currency: "SGD" });
  await createExpense(page, group.groupId, `New dinner ${stamp}`, `${month}-25`, 3_000);
  await createExpense(page, group.groupId, `New taxi ${stamp}`, `${month}-26`, 4_500);
  const other = await postJson(page, "/api/splits/groups/create", { name: `Elsewhere ${stamp}`, currency: "SGD", expenseSource: "mixed" });
  await createExpense(page, other.groupId, `Other villa ${stamp}`, `${month}-27`, 6_000);
  return { groupId: group.groupId };
}

async function openGroup(page, groupId, view) {
  await gotoPageAfterApi(page, `/splits?view=${view}&month=${month}&split_group=${groupId}`, "/api/splits-page", () => page.locator(".splits-lead"));
}

async function showMoney(page) {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
}

const money = (text) => Number(text.replace(/[^0-9.-]/g, ""));

for (const [name, size] of [["desktop", { width: 1280, height: 800 }], ["phone", PHONE]]) {
  test.describe(name, () => {
    test.beforeEach(async ({ page }) => {
      await showMoney(page);
      await page.goto("/");
      await reseedDemo(page);
      await page.setViewportSize(size);
    });

    test("chip, balance, entry count and the page's own data are one set: not the settled expenses, not another group's", async ({ page }) => {
      const { groupId } = await createSettledGroup(page, Date.now());
      await openGroup(page, groupId, "person-tim");
      const lead = page.locator(".splits-lead");
      // $75.00 spent in the two open expenses; Tim paid both, so Joyce owes him half.
      await expect(lead.locator("[data-chip='group-spend'] .splits-lead-spend")).toHaveText("$75.00");
      await expect(lead.locator(".lsd-subtitle")).toHaveText("SGD · 2 entries");
      await expect(lead.locator(".lsd-amount")).toHaveText("$37.50");
      const data = await loadSplitsPage(page, { view: "person-tim", month });
      expect(data.splitsPage.groups.find((group) => group.id === groupId).entryCount).toBe(2);
      // The page sends activity only: no second, page-wide donut copy that could disagree.
      expect("donutChart" in data.splitsPage).toBe(false);
      expect("donutChartsByCurrency" in data.splitsPage).toBe(false);
      const open = data.splitsPage.activity.filter((item) => item.groupId === groupId && item.kind === "expense" && item.settlementStatus !== "settled");
      expect(open.reduce((sum, item) => sum + item.totalAmountMinor, 0)).toBe(7_500);
    });

    test("person view: the chip is the group's spend, the donut is your share and says so", async ({ page }) => {
      const { groupId } = await createSettledGroup(page, Date.now());
      await openGroup(page, groupId, "person-tim");
      const lead = page.locator(".splits-lead");
      const chip = lead.locator("[data-chip='group-spend']");
      await expect(chip).toContainText("Spent since last settle-up");
      await expect(chip.locator(".splits-lead-spend")).toHaveText("$75.00");

      await chip.click();
      const panel = page.locator(".split-donut-panel");
      await expect(panel).toBeVisible();
      // Tim's half of $75.00, never Joyce's $60.00-villa share or the settled $300.00.
      await expect(panel.locator(".donut-center > span")).toHaveText("Your share since last settle-up");
      await expect(panel.locator(".donut-center strong")).toHaveText("$37.50");
      const rows = panel.locator(".entries-breakdown-list .category-row");
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText("$37.50");
      await expect(rows.first()).toContainText("2 entries");
      // The two labels cannot be mistaken for each other.
      expect(await chip.innerText()).not.toContain("Your share");
      await expect(panel).not.toContainText("$22.50");
      await expect(panel).not.toContainText("$67.50");
      await expect(panel).not.toContainText("$187.50");
    });

    test("the share-of-costs insight adds up the same open expenses, and a whole-group fun fact says it counts everything", async ({ page }) => {
      const { groupId } = await createSettledGroup(page, Date.now());
      await openGroup(page, groupId, "person-tim");
      const insight = page.locator(".financial-insight-splits");
      // A phone shows a one-line teaser first; opening it shows the headline.
      const fold = insight.locator(".financial-insight-fold");
      if (await fold.count() && await fold.getAttribute("aria-expanded") === "false") {
        await fold.click();
      }
      await insight.getByRole("button", { name: "See all insights" }).click();
      const longView = insight.locator(".checkin-long-view");
      await expect(longView).toContainText("$75.00");
      await expect(longView).toContainText("shared costs");
      await expect(longView).not.toContainText("$375.00");
      await expect(longView).not.toContainText("$300.00");
      // A fun fact counts the whole group, settled or not, and names the first day.
      const fun = insight.locator(".checkin-fun");
      if (await fun.count()) {
        await expect(fun).toContainText(/\(settled or not, since 2 May( \d{4})?\)/);
      }
    });

    test("a group never settled keeps Group spend, and Your share, with nothing labelled all-time", async ({ page }) => {
      const stamp = Date.now();
      const group = await postJson(page, "/api/splits/groups/create", { name: `Never settled ${stamp}`, currency: "SGD", expenseSource: "mixed" });
      await createExpense(page, group.groupId, `First ${stamp}`, `${month}-02`, 10_000);
      await createExpense(page, group.groupId, `Second ${stamp}`, `${month}-03`, 20_000);
      await openGroup(page, group.groupId, "person-tim");
      const chip = page.locator(".splits-lead [data-chip='group-spend']");
      await expect(chip).toContainText("Group spend");
      await expect(chip.locator(".splits-lead-spend")).toHaveText("$300.00");
      await chip.click();
      const panel = page.locator(".split-donut-panel");
      await expect(panel.locator(".donut-center > span")).toHaveText("Your share");
      await expect(panel.locator(".donut-center strong")).toHaveText("$150.00");
      const centre = money(await panel.locator(".donut-center strong").innerText());
      const chipFigure = money(await chip.locator(".splits-lead-spend").innerText());
      expect(centre * 2).toBe(chipFigure);
      await expect(page.locator(".financial-insight-splits")).not.toContainText("settled or not");
    });

    test("the donut switch: Whole group centre equals the chip, the choice survives a reload and a group change", async ({ page }) => {
      const { groupId } = await createSettledGroup(page, Date.now());
      await openGroup(page, groupId, "person-tim");
      const chip = page.locator(".splits-lead [data-chip='group-spend']");
      await chip.click();
      const panel = page.locator(".split-donut-panel");
      const group = panel.getByRole("radiogroup", { name: "What the chart adds up" });
      await expect(group.locator("label")).toHaveText(["Your share", "Whole group"]);
      // Default: Your share, as before.
      await expect(group.getByRole("radio", { name: "Your share" })).toBeChecked();
      await expect(panel.locator(".donut-center strong")).toHaveText("$37.50");
      // Each radio covers a 44 px target.
      for (const radio of await group.getByRole("radio").all()) {
        expect((await radio.boundingBox()).height).toBeGreaterThanOrEqual(44);
      }

      await group.getByText("Whole group").click();
      await expect(panel.locator(".donut-center > span")).toHaveText("Since last settle-up");
      await expect(panel.locator(".donut-center strong")).toHaveText("$75.00");
      const rows = panel.locator(".entries-breakdown-list .category-row");
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText("$75.00");
      await expect(rows.first()).toContainText("2 entries");
      expect(money(await panel.locator(".donut-center strong").innerText())).toBe(money(await chip.locator(".splits-lead-spend").innerText()));
      await expect(panel).not.toContainText("$37.50");

      // Remembered on this device.
      await page.reload();
      await page.locator(".splits-lead").waitFor();
      await page.locator(".splits-lead [data-chip='group-spend']").click();
      await expect(page.locator(".split-donut-panel .donut-center strong")).toHaveText("$75.00");
      await expect(page.getByRole("radio", { name: "Whole group" })).toBeChecked();

      // Another group keeps the choice (and a never-settled group says Group spend).
      const stamp = Date.now();
      const never = await postJson(page, "/api/splits/groups/create", { name: `Never ${stamp}`, currency: "SGD", expenseSource: "mixed" });
      await createExpense(page, never.groupId, `Only ${stamp}`, `${month}-02`, 10_000);
      await openGroup(page, never.groupId, "person-tim");
      await page.locator(".splits-lead [data-chip='group-spend']").click();
      await expect(page.getByRole("radio", { name: "Whole group" })).toBeChecked();
      await expect(page.locator(".split-donut-panel .donut-center > span")).toHaveText("Group spend");
      await expect(page.locator(".split-donut-panel .donut-center strong")).toHaveText("$100.00");
    });

    test("the donut switch works from the keyboard", async ({ page }) => {
      const { groupId } = await createSettledGroup(page, Date.now());
      await openGroup(page, groupId, "person-tim");
      await page.locator(".splits-lead [data-chip='group-spend']").click();
      const panel = page.locator(".split-donut-panel");
      await panel.getByRole("radio", { name: "Your share" }).focus();
      await page.keyboard.press("ArrowRight");
      await expect(panel.getByRole("radio", { name: "Whole group" })).toBeChecked();
      await expect(panel.locator(".donut-center strong")).toHaveText("$75.00");
      await page.keyboard.press("ArrowLeft");
      await expect(panel.getByRole("radio", { name: "Your share" })).toBeChecked();
      await expect(panel.locator(".donut-center strong")).toHaveText("$37.50");
    });

    test("Splits has no everyone reading to switch: a household address falls back to a person, who has the switch", async ({ page }) => {
      const { groupId } = await createSettledGroup(page, Date.now());
      await openGroup(page, groupId, "household");
      // The Household pill is disabled on Splits, so the donut is always a
      // person's; the household's single chart (no switch) is unit-tested.
      await expect(page.locator(".pill-disabled")).toHaveText("Household");
      await page.locator(".splits-lead [data-chip='group-spend']").click();
      await expect(page.locator("[data-donut-mode-switch]")).toBeVisible();
    });

    test("hidden money: Whole group keeps its label and shows no figure", async ({ page }) => {
      const { groupId } = await createSettledGroup(page, Date.now());
      await openGroup(page, groupId, "person-tim");
      await page.locator(".splits-lead [data-chip='group-spend']").click();
      await page.getByRole("button", { name: "Hide money totals" }).first().click();
      const panel = page.locator(".split-donut-panel");
      await panel.getByText("Whole group").click();
      await expect(panel.locator(".donut-center > span")).toHaveText("Since last settle-up");
      await expect(panel.locator(".donut-center strong")).toHaveText("••••");
      await expect(panel).not.toContainText("$75.00");
    });

    test("hidden money keeps the labels and shows no figure anywhere", async ({ page }) => {
      const { groupId } = await createSettledGroup(page, Date.now());
      await openGroup(page, groupId, "person-tim");
      await page.locator(".splits-lead [data-chip='group-spend']").click();
      await page.getByRole("button", { name: "Hide money totals" }).first().click();
      const panel = page.locator(".split-donut-panel");
      await expect(panel.locator(".donut-center > span")).toHaveText("Your share since last settle-up");
      await expect(panel.locator(".donut-center strong")).toHaveText("••••");
      await expect(page.locator(".splits-lead .splits-lead-spend")).toHaveText("••••");
    });
  });
}
