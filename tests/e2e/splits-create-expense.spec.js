import { expect, test } from "@playwright/test";

import { loadSplitsPage, postJson, reseedDemo } from "./helpers";

test("creating a split expense shows the row immediately and persists it", async ({ page }) => {
  const description = `Playwright split expense ${Date.now()}`;
  const note = "Created from the splits test.";

  await page.goto("/");
  await reseedDemo(page);

  await postJson(page, "/api/splits/expenses/create", {
    date: "2025-10-12",
    description,
    categoryName: "Groceries",
    payerPersonName: "Tim",
    amountMinor: 4200,
    note,
    groupId: null
  });

  const data = await loadSplitsPage(page, { view: "person-tim", month: "2025-10" });
  const createdItem = data.splitsPage.activity.find((item) => item.description === description);
  expect(createdItem).toBeTruthy();
  expect(createdItem?.note).toBe(note);
});
