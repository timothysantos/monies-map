import { expect, test } from "@playwright/test";

import { postJson, reseedDemo } from "./helpers";

// Every Splits URL action, on a desktop and a phone (docs/flows/splits-flow.md):
//   split_action=add-expense      opens New split expense for the open group
//                                 (Ask's "Edit in form" from the receipt button)
//   editing_split_expense=<id>    opens that split's card, an open one from the
//                                 page, a settled one after its section is read
//   split_group / split_mode=matches / split_search  pick what the list shows
// The add-expense link once crashed the page (a render loop: the dialog
// reopened on every render until the router dropped the parameter), so each
// test also proves the page stayed up.

const SCREENS = [
  { name: "desktop 1280x800", phone: false, viewport: { width: 1280, height: 800 } },
  { name: "phone 390x844", phone: true, viewport: { width: 390, height: 844 } }
];
const SETTLED_MONTH = "2026-05";

function watchPageErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function expectPageStayedUp(page, errors) {
  await expect(page.getByText("This page hit a problem and could not be shown.")).toHaveCount(0);
  expect(errors).toEqual([]);
}

async function createSettledExpense(page, stamp) {
  const group = await postJson(page, "/api/splits/groups/create", { name: `Deep link ${stamp}`, currency: "SGD", expenseSource: "mixed" });
  const expense = await postJson(page, "/api/splits/expenses/create", {
    groupId: group.groupId,
    date: `${SETTLED_MONTH}-03`,
    description: `Settled dinner ${stamp}`,
    categoryName: "Food & Drinks",
    payerPersonName: "Tim",
    amountMinor: 8_000,
    splitAmountMinor: 4_000,
    currency: "SGD",
    paymentMethod: "cash",
    paymentStatus: "recorded"
  });
  const checkpoint = await postJson(page, "/api/splits/checkpoints/create", { viewerPersonId: "person-tim", date: `${SETTLED_MONTH}-20`, currency: "SGD" });
  const transfer = await postJson(page, "/api/entries/create", {
    date: `${SETTLED_MONTH}-21`,
    description: `Deep link settle-up ${stamp}`,
    accountName: "UOB One",
    categoryName: "Transfer",
    amountMinor: checkpoint.amountMinor,
    entryType: "transfer",
    transferDirection: "in",
    ownershipType: "direct",
    ownerName: "Tim"
  });
  await postJson(page, "/api/splits/checkpoints/match", { checkpointId: checkpoint.checkpointId, transactionId: transfer.entryId });
  return { groupId: group.groupId, expenseId: expense.splitExpenseId };
}

for (const screen of SCREENS) {
  test.describe(`Splits deep links, ${screen.name}`, () => {
    test.use({ viewport: screen.viewport, hasTouch: screen.phone });

    test.beforeEach(async ({ page }) => {
      await page.goto("/");
      await reseedDemo(page);
    });

    test("split_action=add-expense opens New split expense once, and the link is dropped", async ({ page }) => {
      const errors = watchPageErrors(page);
      await page.goto("/splits?view=person-tim&month=2025-10&split_group=split-group-none&split_action=add-expense");
      const dialog = page.getByRole("dialog", { name: "New split expense" });
      await expect(dialog).toBeVisible({ timeout: 60_000 });
      await expect(page).not.toHaveURL(/split_action/);
      await expect(page).toHaveURL(/split_group=split-group-none/);
      await expect(dialog.getByRole("textbox", { name: "Description" })).toHaveValue("");
      await expectPageStayedUp(page, errors);

      // Closing it keeps it closed: the dropped link does not reopen it.
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toHaveCount(0);
      await page.waitForTimeout(300);
      await expect(dialog).toHaveCount(0);
      await expectPageStayedUp(page, errors);
    });

    test("split_action=add-expense with a group opens the form for that group", async ({ page }) => {
      const errors = watchPageErrors(page);
      await page.goto("/splits?view=person-tim&month=2025-10&split_group=split-group-baby-river&split_action=add-expense");
      const dialog = page.getByRole("dialog", { name: "New split expense" });
      await expect(dialog).toBeVisible({ timeout: 60_000 });
      await expect(dialog.locator(".split-expense-card-head")).toContainText("Baby River");
      await expect(page).not.toHaveURL(/split_action/);
      await expectPageStayedUp(page, errors);
    });

    test("negative: an unknown split_action opens no form", async ({ page }) => {
      const errors = watchPageErrors(page);
      await page.goto("/splits?view=person-tim&month=2025-10&split_group=split-group-none&split_action=add-settlement");
      await expect(page.locator(".splits-lead")).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(500);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expectPageStayedUp(page, errors);
    });

    test("editing_split_expense opens an open split's card", async ({ page }) => {
      const errors = watchPageErrors(page);
      await page.goto("/splits?view=person-tim&month=2025-10&editing_split_expense=split-expense-baby-river-family");
      const card = screen.phone
        ? page.getByRole("dialog", { name: "Edit split" })
        : page.locator(".split-inline-editor-card");
      await expect(card).toBeVisible({ timeout: 60_000 });
      await expect(card.getByRole("button", { name: "Save expense" })).toBeVisible();
      await expect(page).not.toHaveURL(/editing_split_expense/);
      await expect(page).toHaveURL(/split_group=split-group-baby-river/);
      await expectPageStayedUp(page, errors);
    });

    test("editing_split_expense opens a settled split's card after reading its section", async ({ page }) => {
      const errors = watchPageErrors(page);
      const settled = await createSettledExpense(page, Date.now());
      await page.goto(`/splits?view=person-tim&month=${SETTLED_MONTH}&editing_split_expense=${settled.expenseId}`);
      const lock = page.locator(".settlement-lock-error").first();
      await expect(lock).toBeVisible({ timeout: 60_000 });
      await expect(lock).toContainText("Undo the simplification to change it.");
      await expect(page.getByRole("button", { name: "Save expense" })).toHaveCount(0);
      await expect(page).toHaveURL(new RegExp(`split_group=${settled.groupId}`));
      await expect(page).not.toHaveURL(/editing_split_expense/);
      await expectPageStayedUp(page, errors);
    });

    test("negative: editing_split_expense for an unknown split opens no card", async ({ page }) => {
      const errors = watchPageErrors(page);
      await page.goto("/splits?view=person-tim&month=2025-10&split_group=split-group-none&editing_split_expense=split-expense-missing");
      await expect(page.locator(".splits-lead")).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(500);
      await expect(page.getByRole("dialog", { name: "Edit split" })).toHaveCount(0);
      await expect(page.locator(".split-inline-editor-card")).toHaveCount(0);
      await expectPageStayedUp(page, errors);
    });

    test("split_mode=matches opens the bank match review, split_search fills the search", async ({ page }) => {
      const errors = watchPageErrors(page);
      await page.goto("/splits?view=person-tim&month=2025-10&split_group=split-group-none&split_mode=matches");
      await expect(page.locator(".split-match-review-section")).toBeVisible({ timeout: 60_000 });
      await page.goto("/splits?view=person-tim&month=2025-10&split_group=split-group-baby-river&split_search=family");
      await expect(page.getByRole("combobox", { name: "Search" }).first()).toHaveValue("family", { timeout: 60_000 });
      await expectPageStayedUp(page, errors);
    });

    test("Ask's Edit in form from the Splits receipt button opens New split expense for the group", async ({ page }) => {
      const errors = watchPageErrors(page);
      await page.goto("/ask?view=person-tim&month=2025-10&mode=expense&from=splits&split_group=split-group-baby-river");
      const editInForm = page.getByRole("button", { name: "Edit in form" });
      await expect(editInForm).toBeVisible({ timeout: 60_000 });
      await editInForm.click();
      const dialog = page.getByRole("dialog", { name: "New split expense" });
      await expect(dialog).toBeVisible({ timeout: 60_000 });
      await expect(page).toHaveURL(/\/splits\?/);
      await expect(page).not.toHaveURL(/split_action/);
      await expect(dialog.locator(".split-expense-card-head")).toContainText("Baby River");
      await expectPageStayedUp(page, errors);
    });
  });
}
