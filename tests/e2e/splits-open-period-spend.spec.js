import { expect, test } from "@playwright/test";

import { gotoPageAfterApi, loadSplitsPage, postJson, reseedDemo } from "./helpers";

// The lead card's spend chip describes the open period only: the group's
// expenses no settle-up has covered. A settled group says "Spent since last
// settle-up"; a group that was never settled keeps "Group spend". The entry
// count under the title, the balance and the donut describe the same set
// (tests/e2e/splits-figures-agree.spec.js checks every figure against it).

const month = "2026-05";
const PHONE = { width: 390, height: 844 };

async function createExpense(page, groupId, description, date, amountMinor) {
  return postJson(page, "/api/splits/expenses/create", {
    groupId,
    date,
    description,
    categoryName: "Food & Drinks",
    payerPersonName: "Tim",
    amountMinor,
    splitAmountMinor: amountMinor / 2,
    currency: "SGD",
    paymentMethod: "cash",
    paymentStatus: "recorded"
  });
}

// A group with two settled expenses ($300.00 together, covered by one
// settle-up) and two newer open ones ($30.00 and $45.00).
async function createSettledGroup(page, stamp) {
  const group = await postJson(page, "/api/splits/groups/create", { name: `Okaeri ${stamp}`, currency: "SGD", expenseSource: "mixed" });
  await createExpense(page, group.groupId, `Old rent ${stamp}`, `${month}-02`, 10_000);
  await createExpense(page, group.groupId, `Old flights ${stamp}`, `${month}-03`, 20_000);
  await postJson(page, "/api/splits/checkpoints/create", { viewerPersonId: "person-tim", date: `${month}-20`, currency: "SGD" });
  await createExpense(page, group.groupId, `New dinner ${stamp}`, `${month}-25`, 3_000);
  await createExpense(page, group.groupId, `New taxi ${stamp}`, `${month}-26`, 4_500);
  return { groupId: group.groupId, name: group.name ?? `Okaeri ${stamp}` };
}

async function openGroup(page, groupId) {
  await gotoPageAfterApi(page, `/splits?view=person-tim&month=${month}&split_group=${groupId}`, "/api/splits-page", () => page.locator(".splits-lead"));
}

async function showMoney(page) {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
}

for (const [name, size] of [["desktop", { width: 1280, height: 800 }], ["phone", PHONE]]) {
  test.describe(name, () => {
    test.beforeEach(async ({ page }) => {
      await showMoney(page);
      await page.goto("/");
      await reseedDemo(page);
      await page.setViewportSize(size);
    });

    test("a settled group's chip, entry count and donut describe the open period only", async ({ page }) => {
      const stamp = Date.now();
      const { groupId } = await createSettledGroup(page, stamp);
      await openGroup(page, groupId);

      const lead = page.locator(".splits-lead");
      const chip = lead.locator("[data-chip='group-spend']");
      // Two expenses are still open: $30.00 and $45.00. Not the $375.00 ever recorded.
      await expect(chip).toContainText("Spent since last settle-up");
      await expect(chip.locator(".splits-lead-spend")).toHaveText("$75.00");
      await expect(lead).not.toContainText("$375.00");
      await expect(lead.locator(".lsd-subtitle")).toHaveText("SGD · 2 entries");
      // Tim paid both: Joyce owes him half of the open ones.
      await expect(lead.locator(".lsd-amount")).toHaveText("$37.50");

      // The donut behind the chip charts the same two expenses and carries the same words.
      const data = await loadSplitsPage(page, { view: "person-tim", month });
      const group = data.splitsPage.groups.find((item) => item.id === groupId);
      expect(group.entryCount).toBe(2);
      await chip.click();
      const panel = page.locator(".split-donut-panel");
      await expect(panel).toBeVisible();
      await expect(panel).toContainText("Your share since last settle-up");
      await expect(panel.locator(".entries-breakdown-list")).toContainText("2 entries");
      await expect(panel.locator(".entries-breakdown-list")).toContainText("$37.50");
      // Negative: the old centre words are gone and the settled $300.00 is not charted.
      await expect(panel).not.toContainText("Total spend");
      await expect(panel).not.toContainText("$187.50");
    });

    test("a group that was never settled keeps Group spend and counts everything", async ({ page }) => {
      const stamp = Date.now();
      const group = await postJson(page, "/api/splits/groups/create", { name: `Never settled ${stamp}`, currency: "SGD", expenseSource: "mixed" });
      await createExpense(page, group.groupId, `First ${stamp}`, `${month}-02`, 10_000);
      await createExpense(page, group.groupId, `Second ${stamp}`, `${month}-03`, 20_000);
      await openGroup(page, group.groupId);

      const lead = page.locator(".splits-lead");
      const chip = lead.locator("[data-chip='group-spend']");
      await expect(chip).toContainText("Group spend");
      await expect(chip).not.toContainText("Spent since");
      await expect(chip.locator(".splits-lead-spend")).toHaveText("$300.00");
      await expect(lead.locator(".lsd-subtitle")).toHaveText("SGD · 2 entries");
      await chip.click();
      await expect(page.locator(".split-donut-panel")).toContainText("Your share");
      await expect(page.locator(".split-donut-panel .donut-center > span")).not.toContainText("since last settle-up");
    });

    test("hidden money hides the open-period figure and keeps the label", async ({ page }) => {
      const { groupId } = await createSettledGroup(page, Date.now());
      await openGroup(page, groupId);
      await page.getByRole("button", { name: "Hide money totals" }).first().click();
      const lead = page.locator(".splits-lead");
      await expect(lead.locator(".splits-lead-spend")).toHaveText("••••");
      await expect(lead).toContainText("Spent since last settle-up");
      await expect(lead).not.toContainText("$");
    });
  });
}
