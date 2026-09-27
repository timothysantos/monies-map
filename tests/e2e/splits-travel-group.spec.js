import { expect, test } from "@playwright/test";

import { loadSplitsPage, reseedDemo } from "./helpers";

// The group pills render twice on desktop (inline and floating); use the inline row.
function inlineGroupPill(page, name) {
  return page.locator(".splits-groups-row:not(.splits-groups-row-floating) .split-group-pill").filter({ hasText: name });
}

test("a JPY cash-only travel group created in Splits keeps its expense in yen", async ({ page }) => {
  const groupName = `Tokyo trip ${Date.now()}`;
  const description = "Shinjuku ramen dinner";

  // Money is hidden by default; this scenario asserts visible amounts.
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await page.goto("/");
  await reseedDemo(page);
  await page.goto("/splits?view=person-tim&month=2025-10&split_group=split-group-none");
  await expect(page.locator("article.panel-splits")).toBeVisible();
  const nonGroupPill = inlineGroupPill(page, "Non-group expenses");
  await expect(nonGroupPill).toContainText("3 entries");
  await expect(nonGroupPill).toContainText("You owe Joyce $260.25");

  await page.locator(".splits-groups-row:not(.splits-groups-row-floating)").getByRole("button", { name: "Create group" }).click();
  const groupDialog = page.getByRole("dialog", { name: "Create group" });
  await groupDialog.getByLabel("Group name").fill(groupName);
  await groupDialog.getByLabel("Group currency").selectOption("JPY");
  await groupDialog.getByLabel("Purchase source").selectOption("cash");
  await groupDialog.getByRole("button", { name: "Save group" }).click();
  await expect(groupDialog).toHaveCount(0);

  // Saving the group opens it, and its pill names the currency and source.
  const groupPill = inlineGroupPill(page, groupName);
  await expect(groupPill).toHaveClass(/is-active/);
  await expect(groupPill).toContainText("JPY · Cash only");
  await expect(groupPill).toContainText("0 entries");
  await expect(page).toHaveURL(/split_group=split-group-tokyo-trip-/);
  const groupId = new URL(page.url()).searchParams.get("split_group");

  await page.locator(".splits-summary-strip").getByRole("button", { name: "+ Add expense" }).click();
  const expenseDialog = page.getByRole("dialog", { name: "Create split expense" });
  // "Group" alone would also match the cash-only help text under "Paid using".
  const groupSelect = expenseDialog.locator("label.split-dialog-field", { has: page.getByText("Group", { exact: true }) }).locator("select");
  await expect(groupSelect).toHaveValue(groupId);
  await expect(expenseDialog.getByLabel("Currency")).toHaveValue("JPY");
  // A cash-only group offers no card or bank payment.
  await expect(expenseDialog.getByLabel("Paid using").locator("option")).toHaveText(["Cash"]);
  await expect(expenseDialog.getByText("Cash-only group: no bank or card match is expected.")).toBeVisible();

  await expenseDialog.getByLabel("Date").fill("2025-10-14");
  await expenseDialog.getByLabel("Paid by").selectOption("Joyce");
  await expenseDialog.getByLabel("Category").selectOption("Food & Drinks");
  // An amount with an odd stored hundredth offers the extra step in yen.
  await expenseDialog.getByLabel("Expense total").fill("12000.01");
  const oddCentChoice = expenseDialog.getByRole("group", { name: "Choose odd cent recipient" });
  await expect(oddCentChoice.getByRole("button")).toHaveText([/^\w+ gets \+JP¥0\.01$/, /^\w+ gets \+JP¥0\.01$/]);

  // The share preview is in the group currency with yen's whole-unit digits.
  await expenseDialog.getByLabel("Expense total").fill("12000");
  await expect(oddCentChoice).toHaveCount(0);
  const sharePreview = expenseDialog.getByLabel("Split share amounts");
  await expect(sharePreview.locator("strong")).toHaveText(["JP¥6,000", "JP¥6,000"]);
  await expenseDialog.getByLabel("Description").fill(description);

  const createRequest = page.waitForRequest((request) => request.url().includes("/api/splits/expenses/create"));
  await expenseDialog.getByRole("button", { name: "Save expense" }).click();
  expect((await createRequest).postDataJSON()).toMatchObject({
    groupId,
    description,
    payerPersonName: "Joyce",
    amountMinor: 1_200_000,
    currency: "JPY",
    paymentMethod: "cash",
    paymentStatus: "recorded"
  });
  await expect(expenseDialog).toHaveCount(0);

  // Joyce paid ¥12,000 and Tim owes half of it, shown in yen, not dollars.
  const card = page.locator(".split-activity-card").filter({ hasText: description });
  await expect(card).toContainText("Joyce paid JP¥12,000");
  await expect(card.locator(".split-activity-trailing")).toContainText("you borrowed");
  await expect(card.locator(".split-activity-amount-line > span").first()).toHaveText("JP¥6,000");
  await expect(groupPill.locator(".split-group-pill-content > span").nth(1)).toHaveText("1 entry");

  // The pill balance and the totals strip use the group currency too.
  await expect(groupPill).toContainText("You owe Joyce JP¥6,000");
  const summaryMetrics = page.locator(".splits-summary-strip .entries-summary-metrics");
  await expect(summaryMetrics).toContainText("You owe JP¥6,000");
  await expect(summaryMetrics).toContainText("Spend JP¥12,000");
  await expect(summaryMetrics).not.toContainText("$");

  // Negative: the yen expense stays out of the SGD non-group list and balance.
  await nonGroupPill.click();
  await expect(nonGroupPill).toHaveClass(/is-active/);
  await expect(page.locator(".split-activity-card").filter({ hasText: description })).toHaveCount(0);
  await expect(page.locator(".split-activity-card").filter({ hasText: "JP¥" })).toHaveCount(0);
  await expect(nonGroupPill).toContainText("3 entries");
  await expect(nonGroupPill).toContainText("You owe Joyce $260.25");
  // Negative: the SGD group's totals strip keeps dollars.
  await expect(summaryMetrics).toContainText("You owe $260.25");
  await expect(summaryMetrics).not.toContainText("JP¥");

  // Money privacy still hides the yen amounts.
  await groupPill.click();
  await expect(groupPill).toHaveClass(/is-active/);
  await page.getByRole("button", { name: "Hide money totals" }).first().click();
  await expect(groupPill).toContainText("Balance hidden");
  await expect(groupPill).not.toContainText("JP¥");
  await expect(summaryMetrics).not.toContainText("JP¥");
  await expect(summaryMetrics.locator("strong")).toHaveText(["••••", "••••"]);
  await expect(card).not.toContainText("JP¥");
  await page.getByRole("button", { name: "Show money totals" }).first().click();
  await expect(groupPill).toContainText("You owe Joyce JP¥6,000");

  const data = await loadSplitsPage(page, { view: "person-tim", month: "2025-10" });
  expect(data.splitsPage.groups.find((group) => group.id === groupId)).toMatchObject({
    name: groupName,
    currency: "JPY",
    expenseSource: "cash",
    entryCount: 1
  });
  expect(data.splitsPage.activity.find((item) => item.description === description)).toMatchObject({
    groupId,
    currency: "JPY",
    paymentMethod: "cash",
    totalAmountMinor: 1_200_000,
    viewerAmountMinor: 600_000,
    viewerDirectionLabel: "you borrowed"
  });
});
