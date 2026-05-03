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
