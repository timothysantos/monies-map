import { expect, test } from "@playwright/test";

import { loadSplitsPage, reseedDemo } from "./helpers";

const SPLITS_URL = "/splits?view=person-tim&month=2025-10&split_group=split-group-none";

async function openAddExpenseDialog(page) {
  // Money is hidden by default; these scenarios assert visible amounts.
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await page.goto("/");
  await reseedDemo(page);
  await page.goto(SPLITS_URL);
  await expect(page.locator("article.panel-splits")).toBeVisible();

  await page.locator(".splits-summary-strip").getByRole("button", { name: "+ Add expense" }).click();
  const dialog = page.getByRole("dialog", { name: "Create split expense" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("a split expense added through the dialog is listed with its shares and persists", async ({ page }) => {
  const description = `Dialog hardware run ${Date.now()}`;
  const dialog = await openAddExpenseDialog(page);

  // A new expense starts in the open group, paid by the viewing person.
  await expect(dialog.getByLabel("Group")).toHaveValue("split-group-none");
  await expect(dialog.getByLabel("Currency")).toHaveValue("SGD");
  await expect(dialog.getByLabel("Paid by")).toHaveValue("Tim");

  await dialog.getByLabel("Date").fill("2025-10-14");
  await dialog.getByLabel("Category").selectOption("Home");
  await dialog.getByLabel("Expense total").fill("86.40");
  await dialog.getByLabel("Tim share %").fill("25");
  await dialog.getByLabel("Tim share %").blur();
  await dialog.getByLabel("Description").fill(description);
  await dialog.getByLabel("Note").fill("Shelf brackets for the study");

  const preview = dialog.getByLabel("Split share amounts");
  await expect(preview).toContainText("Tim share$21.60");
  await expect(preview).toContainText("Joyce share$64.80");
  await expect(dialog.getByLabel("Tim share amount")).toHaveValue("21.60");

  const createRequest = page.waitForRequest((request) => request.url().includes("/api/splits/expenses/create"));
  await dialog.getByRole("button", { name: "Save expense" }).click();
  expect((await createRequest).postDataJSON()).toMatchObject({
    groupId: null,
    date: "2025-10-14",
    description,
    categoryName: "Home",
    payerPersonName: "Tim",
    amountMinor: 8640,
    note: "Shelf brackets for the study",
    splitBasisPoints: 2500,
    splitAmountMinor: 2160
  });
  await expect(dialog).toHaveCount(0);

  // Tim paid, so the card shows Joyce's 75% as the amount Tim lent.
  const card = page.locator(".split-activity-card").filter({ hasText: description });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("You paid $86.40");
  await expect(card).toContainText("Shelf brackets for the study");
  await expect(card.locator(".split-activity-trailing")).toContainText("you lent");
  await expect(card.locator(".split-activity-amount-line > span").first()).toHaveText("$64.80");
  await expect(card).toContainText("Manual split");

  await page.reload();
  const reloadedCard = page.locator(".split-activity-card").filter({ hasText: description });
  await expect(reloadedCard).toHaveCount(1);
  await expect(reloadedCard.locator(".split-activity-amount-line > span").first()).toHaveText("$64.80");

  const data = await loadSplitsPage(page, { view: "person-tim", month: "2025-10" });
  const saved = data.splitsPage.activity.find((item) => item.description === description);
  expect(saved).toMatchObject({
    kind: "expense",
    groupId: "split-group-none",
    date: "2025-10-14",
    categoryName: "Home",
    paidByPersonName: "Tim",
    totalAmountMinor: 8640,
    viewerAmountMinor: 6480,
    viewerDirectionLabel: "you lent",
    note: "Shelf brackets for the study"
  });
  expect(saved.shares).toEqual(expect.arrayContaining([
    expect.objectContaining({ personName: "Tim", amountMinor: 2160 }),
    expect.objectContaining({ personName: "Joyce", amountMinor: 6480 })
  ]));
});

test("the add expense dialog refuses to save without a description and sends nothing", async ({ page }) => {
  const dialog = await openAddExpenseDialog(page);
  let createRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/splits/expenses/create")) {
      createRequests += 1;
    }
  });

  await dialog.getByLabel("Expense total").fill("19.90");
  await dialog.getByRole("button", { name: "Save expense" }).click();

  await expect(dialog.getByText("Expense description, date, payer, and category are required.")).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Expense total")).toHaveValue("19.90");

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  expect(createRequests).toBe(0);
  const data = await loadSplitsPage(page, { view: "person-tim", month: "2025-10" });
  expect(data.splitsPage.activity.some((item) => item.totalAmountMinor === 1990)).toBe(false);
});
