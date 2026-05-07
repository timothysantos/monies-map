import { expect, test } from "@playwright/test";

import { loadSplitsPage, reseedDemo } from "./helpers";

test("split activity uses the borrowed amount for both borrower and lender views", async ({ page }) => {
  await page.goto("/");
  await reseedDemo(page);

  const [timData, joyceData] = await Promise.all([
    loadSplitsPage(page, { view: "person-tim", month: "2025-10" }),
    loadSplitsPage(page, { view: "person-joyce", month: "2025-10" })
  ]);

  const findTarget = (activity) => activity.find((item) => (
    item.kind === "expense"
      && item.description === "Family support"
      && item.paidByPersonName === "Joyce"
      && item.totalAmountMinor === 23407
      && item.groupName === "Baby River"
  ));

  const timEntry = findTarget(timData.splitsPage.activity);
  const joyceEntry = findTarget(joyceData.splitsPage.activity);

  expect(timEntry?.viewerDirectionLabel).toBe("you borrowed");
  expect(timEntry?.viewerAmountMinor).toBe(11703);
  expect(joyceEntry?.viewerDirectionLabel).toBe("you lent");
  expect(joyceEntry?.viewerAmountMinor).toBe(11703);
});

test("person splits view tones lent and borrowed amounts with income and expense colors", async ({ page }) => {
  await page.goto("/");
  await reseedDemo(page);

  await page.goto("/splits?view=person-joyce&month=2025-10&split_group=split-group-baby-river");
  await expect(page.locator("article.panel-splits")).toBeVisible();
  const lentCard = page.locator(".split-activity-card").filter({ hasText: "Family support" }).first();
  await expect(lentCard.getByText("you lent")).toBeVisible();
  await expect(lentCard.locator(".split-activity-amount-line > span").first()).toHaveCSS("color", "rgb(29, 122, 87)");

  await page.goto("/splits?view=person-tim&month=2025-10&split_group=split-group-baby-river");
  await expect(page.locator("article.panel-splits")).toBeVisible();
  const borrowedCard = page.locator(".split-activity-card").filter({ hasText: "Family support" }).first();
  await expect(borrowedCard.getByText("you borrowed")).toBeVisible();
  await expect(borrowedCard.locator(".split-activity-amount-line > span").first()).toHaveCSS("color", "rgb(178, 58, 46)");
});
