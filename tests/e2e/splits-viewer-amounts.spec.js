import { expect, test } from "@playwright/test";

import { loadSplitsPage, postJson, reseedDemo } from "./helpers";

test("person splits view tones lent and borrowed amounts with income and expense colors", async ({ page }) => {
  // Hidden money shows no tone (money-tones.spec.js), so reveal it here.
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await page.goto("/");
  await reseedDemo(page);

  await page.goto("/splits?view=person-joyce&month=2025-10&split_group=split-group-baby-river");
  await expect(page.locator("article.panel-splits")).toBeVisible();
  const lentCard = page.locator(".split-activity-card").filter({ hasText: "Family support" }).first();
  await expect(lentCard.getByText("you lent")).toBeVisible();
  await expect(lentCard.locator(".split-activity-amount-line > span").first()).toHaveCSS("color", "rgb(23, 104, 74)"); // --pastel-mint-ink

  await page.goto("/splits?view=person-tim&month=2025-10&split_group=split-group-baby-river");
  await expect(page.locator("article.panel-splits")).toBeVisible();
  const borrowedCard = page.locator(".split-activity-card").filter({ hasText: "Family support" }).first();
  await expect(borrowedCard.getByText("you borrowed")).toBeVisible();
  await expect(borrowedCard.locator(".split-activity-amount-line > span").first()).toHaveCSS("color", "rgb(163, 53, 42)"); // --pastel-rose-ink
});

test("split editor can choose the odd-cent recipient explicitly", async ({ page }) => {
  const description = `M1 recurring ${Date.now()}`;

  // Money is hidden by default; this scenario asserts visible dollar amounts.
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
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
  await expect(editor.getByText("Tim share", { exact: true })).toBeVisible();
  await expect(editor.getByText("$20.32")).toBeVisible();
  await expect(editor.getByText("Joyce share", { exact: true })).toBeVisible();
  await expect(editor.getByText("$20.33")).toBeVisible();
  await expect(editor.getByText("Tim owes")).toHaveCount(0);
  await expect(editor.getByText("Joyce owes")).toHaveCount(0);
  await expect(editor.getByText("Odd cent")).toBeVisible();
  await editor.getByRole("button", { name: "Tim gets +$0.01" }).click();
  // Read the stored shares only after the save has answered; reading while it
  // is in flight can return the pre-save split.
  const saved = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/splits/expenses/update" && response.ok());
  await editor.getByRole("button", { name: /Save|Done editing split/ }).click();
  await saved;

  const updatedData = await loadSplitsPage(page, { view: "person-tim", month: "2025-10" });
  const updatedItem = updatedData.splitsPage.activity.find((item) => item.description === description);
  expect(updatedItem?.shares).toEqual(expect.arrayContaining([
    expect.objectContaining({ personName: "Tim", amountMinor: 2033 }),
    expect.objectContaining({ personName: "Joyce", amountMinor: 2032 })
  ]));
});

test("split editor hides odd-cent choice when one share is zero percent", async ({ page }) => {
  const description = `Zero share odd cent ${Date.now()}`;

  await page.goto("/");
  await reseedDemo(page);

  await postJson(page, "/api/splits/expenses/create", {
    date: "2025-10-12",
    description,
    categoryName: "Groceries",
    payerPersonName: "Tim",
    amountMinor: 101,
    splitBasisPoints: 0,
    groupId: null,
    note: ""
  });

  await page.goto("/splits?view=person-tim&month=2025-10&split_group=split-group-none");
  await expect(page.locator("article.panel-splits")).toBeVisible();
  const splitCard = page.locator(".split-activity-card").filter({ hasText: description }).first();
  await splitCard.click();

  const editor = page.locator(".split-inline-editor-card").filter({ hasText: description }).first();
  await expect(editor.getByText("Tim share", { exact: true })).toBeVisible();
  await expect(editor.getByText("Odd cent", { exact: true })).toHaveCount(0);
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
