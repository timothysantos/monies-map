import { expect, test } from "@playwright/test";

import { loadSplitsPage, postJson, reseedDemo } from "./helpers";

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

test("split editor can choose the odd-cent recipient explicitly", async ({ page }) => {
  const description = `M1 recurring ${Date.now()}`;

  await page.goto("/");
  await reseedDemo(page);

  await postJson(page, "/api/splits/expenses/create", {
    date: "2025-10-12",
    description,
    categoryName: "Groceries",
    payerPersonName: "Tim",
    amountMinor: 4065,
    splitBasisPoints: 5000,
    groupId: null,
    note: ""
  });

  const data = await loadSplitsPage(page, { view: "person-tim", month: "2025-10" });
  const createdItem = data.splitsPage.activity.find((item) => item.description === description);
  expect(createdItem?.shares).toEqual(expect.arrayContaining([
    expect.objectContaining({ personName: "Tim", amountMinor: 2032 }),
    expect.objectContaining({ personName: "Joyce", amountMinor: 2033 })
  ]));

  await page.goto("/splits?view=person-tim&month=2025-10&split_group=split-group-none");
  await expect(page.locator("article.panel-splits")).toBeVisible();
  const splitCard = page.locator(".split-activity-card").filter({ hasText: description }).first();
  await expect(splitCard.getByText("You paid $40.65")).toBeVisible();
  await expect(splitCard.locator(".split-share-breakdown")).toHaveCount(0);

  await splitCard.click();
  const editor = page.locator(".split-inline-editor-card").filter({ hasText: description }).first();
  await expect(editor.getByText("Tim owes")).toBeVisible();
  await expect(editor.getByText("$20.32")).toBeVisible();
  await expect(editor.getByText("Joyce owes")).toBeVisible();
  await expect(editor.getByText("$20.33")).toBeVisible();
  await expect(editor.getByText("Odd cent")).toBeVisible();
  await editor.getByRole("button", { name: "Tim gets +$0.01" }).click();
  await editor.getByRole("button", { name: /Save|Done editing split/ }).click();

  const updatedData = await loadSplitsPage(page, { view: "person-tim", month: "2025-10" });
  const updatedItem = updatedData.splitsPage.activity.find((item) => item.description === description);
  expect(updatedItem?.shares).toEqual(expect.arrayContaining([
    expect.objectContaining({ personName: "Tim", amountMinor: 2033 }),
    expect.objectContaining({ personName: "Joyce", amountMinor: 2032 })
  ]));
});

test("closing a split opened from an entries link returns to that split card", async ({ page }) => {
  const description = `Deep linked split ${Date.now()}`;

  await page.goto("/");
  await reseedDemo(page);

  const response = await postJson(page, "/api/splits/expenses/create", {
    date: "2025-10-28",
    description,
    categoryName: "Groceries",
    payerPersonName: "Tim",
    amountMinor: 1710,
    splitBasisPoints: 4684,
    groupId: null,
    note: "polyclinic"
  });

  const splitExpenseId = response.splitExpenseId;
  await page.goto(`/splits?view=person-tim&month=2025-10&split_group=split-group-none&editing_split_expense=${splitExpenseId}`);
  await expect(page.getByRole("dialog", { name: "Edit split" })).toBeVisible();
  await page.getByRole("dialog", { name: "Edit split" }).getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog", { name: "Edit split" })).toHaveCount(0);

  const splitCard = page.locator(`#split-activity-expense-${splitExpenseId}`);
  await expect(splitCard).toBeVisible();
  await expect.poll(async () => splitCard.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= window.innerHeight;
  })).toBe(true);
});
