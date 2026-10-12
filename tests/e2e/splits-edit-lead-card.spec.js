import { expect, test } from "@playwright/test";

import { loadSplitsPage, postJson, reseedDemo } from "./helpers";

// Editing and viewing a saved split expense in the Lead · Support · Detail
// style (design.md), the card New split expense already uses: the total in
// the group currency as the lead, tappable Support chips, a row per share
// with the share editor, Category, Group, More details, and Delete, Cancel
// and Save expense in the bottom bar. These prove the card sends the very
// request the old form sent (the expected bodies below are what the form
// sent for the same changes), keeps the in-app delete confirmation, locks
// what the linked entry set, keeps every tap target at 44 px or more, and
// hides money.
//
// The phone tests are tagged @webkit: `npm run test:e2e:webkit` runs them in
// WebKit on an iPhone 13 profile too (390 x 664, as below).

const PHONE = { width: 390, height: 664 };
const MONTH = "2026-05";
const INK = { text: "rgb(38, 35, 31)", rose: "rgb(163, 53, 42)" };

async function setUp(page, { hidden = false, phone = true } = {}) {
  await page.addInitScript((value) => window.localStorage.setItem("monies-map:money-totals-visible", value), hidden ? "false" : "true");
  if (phone) {
    await page.setViewportSize(PHONE);
  }
  await reseedDemo(page);
}

// A non-group split Tim paid in cash, saved through the API as the form
// saves one.
async function createSplit(page, patch = {}) {
  const { splitExpenseId } = await postJson(page, "/api/splits/expenses/create", {
    groupId: null,
    date: `${MONTH}-10`,
    description: `Lead edit ${Date.now()}`,
    categoryName: "Groceries",
    payerPersonName: "Tim",
    amountMinor: 8640,
    note: "Before",
    splitBasisPoints: 5000,
    splitAmountMinor: 4320,
    currency: "SGD",
    paymentMethod: "cash",
    paymentStatus: "recorded",
    ...patch
  });
  return splitExpenseId;
}

async function createLinkedSplit(page) {
  const entry = await postJson(page, "/api/entries/create", {
    date: `${MONTH}-24`,
    description: `Lead edit linked ${Date.now()}`,
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 2550,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });
  const { splitExpenseId } = await postJson(page, "/api/splits/expenses/from-entry", { entryId: entry.entryId, splitGroupId: null });
  return { entryId: entry.entryId, splitExpenseId };
}

async function openSplit(page, splitExpenseId, { view = "person-tim", title = "Edit split" } = {}) {
  await page.goto(`/splits?view=${view}&month=${MONTH}&split_group=split-group-none&editing_split_expense=${splitExpenseId}`);
  const dialog = page.getByRole("dialog", { name: title });
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  return dialog;
}

// A saved split opened the way a person opens it on a wide screen: by
// selecting its row in the group's list (the phone and the deep link above
// land on the same card).
function splitRow(page, splitExpenseId) {
  return page.locator(`#split-activity-expense-${splitExpenseId}`);
}

async function openSplitFromRow(page, splitExpenseId, { how = "click" } = {}) {
  await page.goto(`/splits?view=person-tim&month=${MONTH}&split_group=split-group-none`);
  const row = splitRow(page, splitExpenseId);
  await expect(row).toBeVisible({ timeout: 60_000 });
  if (how === "click") {
    await row.click();
  } else {
    await row.focus();
    await page.keyboard.press(how);
  }
  // The card is in the list where the row was (the row's id moves to it),
  // not in a dialog.
  const editor = page.locator(".split-inline-editor-card");
  await expect(editor).toBeVisible();
  await expect(editor).toHaveAttribute("id", `split-activity-expense-${splitExpenseId}`);
  await expect(editor.locator("xpath=ancestor::*[contains(@class,'split-date-items')]")).toHaveCount(1);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  return editor;
}

// The same card by the deep link on a wide screen: in the list, not a dialog.
async function openSplitInline(page, splitExpenseId) {
  await page.goto(`/splits?view=person-tim&month=${MONTH}&split_group=split-group-none&editing_split_expense=${splitExpenseId}`);
  const editor = page.locator(".split-inline-editor-card");
  await expect(editor).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  return editor;
}

async function savedSplit(page, splitExpenseId) {
  const data = await loadSplitsPage(page, { view: "person-tim", month: MONTH });
  return data.splitsPage.activity.find((item) => item.id === splitExpenseId);
}

function box(locator) {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, bottom: rect.bottom, right: rect.right };
  });
}

// Every visible tappable inside `scope`: at least 44 x 44, and at least 8 px
// clear of any other tappable it sits beside (the same measure as
// lead-support-detail-sheets.spec.js).
async function tapTargets(scope) {
  return scope.evaluate((root) => {
    const selector = "button, [role='button'], a[href], select, input:not([type='hidden']), textarea, label.lsd-row";
    const seen = new Set();
    const targets = [];
    for (const element of root.querySelectorAll(selector)) {
      const target = element.closest("label.lsd-row") ?? element;
      if (seen.has(target)) continue;
      seen.add(target);
      const rect = target.getBoundingClientRect();
      const style = getComputedStyle(target);
      if (rect.width === 0 || rect.height === 0 || style.visibility === "hidden" || target.closest("[aria-hidden='true']")) continue;
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      const onTop = Boolean(hit && (target === hit || target.contains(hit)));
      const scroller = target.closest(".split-dialog-scroll");
      const view = scroller?.getBoundingClientRect();
      const clipped = Boolean(view && (rect.top < view.top - 1 || rect.bottom > view.bottom + 1));
      targets.push({
        onTop,
        clipped,
        name: (target.getAttribute("aria-label") || target.textContent || target.className).trim().replace(/\s+/g, " ").slice(0, 40),
        width: Math.round(rect.width * 10) / 10,
        height: Math.round(rect.height * 10) / 10,
        rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
      });
    }
    return targets;
  });
}

function crowdedPairs(allTargets) {
  const targets = allTargets.filter((target) => target.onTop && !target.clipped);
  const pairs = [];
  for (let i = 0; i < targets.length; i += 1) {
    for (let j = i + 1; j < targets.length; j += 1) {
      const a = targets[i].rect;
      const b = targets[j].rect;
      const stacked = Math.abs(a.left - b.left) < 2 && Math.abs(a.right - b.right) < 2;
      if (stacked) continue;
      const gap = Math.max(Math.max(a.left - b.right, b.left - a.right), Math.max(a.top - b.bottom, b.top - a.bottom));
      if (gap < 8) pairs.push(`${targets[i].name} | ${targets[j].name}: ${gap.toFixed(1)}px`);
    }
  }
  return pairs;
}

test.describe("Edit split on a phone", { tag: "@webkit" }, () => {
  test("a 50/50 split saves the same request the form saved, with Save in the bottom bar", async ({ page }) => {
    await setUp(page);
    const description = `Lead edit even ${Date.now()}`;
    const splitExpenseId = await createSplit(page, { description });
    const dialog = await openSplit(page, splitExpenseId);
    const lead = dialog.locator(".lsd-card");

    // Lead: what it was and the total in the group currency, typed in place.
    await expect(lead.getByRole("textbox", { name: "Description" })).toHaveValue(description);
    await expect(lead.getByRole("textbox", { name: "Expense total" })).toHaveValue("86.40");
    await expect(lead.locator(".lsd-chip")).toHaveText(["Sun 10 May", "Paid by Tim", "50 / 50", "Cash"]);
    const shares = dialog.getByRole("group", { name: "Split share amounts" });
    await expect(shares.locator(".lsd-row")).toHaveText(["Tim’s share50% · $43.20", "Joyce’s share50% · $43.20"]);
    await expect(dialog.locator(".lsd-row-more")).toContainText("Date, paid by, paid using, currency, evidence, note");
    // The old form is gone.
    await expect(dialog.locator(".split-dialog-fieldset")).toHaveCount(0);

    // Nothing changed yet: Save is disabled, at the bottom under the thumb,
    // with Delete apart at the start.
    const save = dialog.getByRole("button", { name: "Save expense" });
    await expect(save).toBeDisabled();
    const saveBox = await box(save);
    expect(saveBox.bottom).toBeGreaterThan(PHONE.height - 80);
    expect(saveBox.right).toBeGreaterThan(PHONE.width - 40);
    const deleteButton = dialog.getByRole("button", { name: "Delete", exact: true });
    await expect(deleteButton).toHaveCSS("color", INK.rose);
    const [deleteBox, cancelBox] = await Promise.all([box(deleteButton), box(dialog.getByRole("button", { name: "Cancel", exact: true }))]);
    expect(cancelBox.x - (deleteBox.x + deleteBox.width)).toBeGreaterThanOrEqual(8);

    await lead.getByRole("textbox", { name: "Expense total" }).fill("100");
    await lead.getByRole("textbox", { name: "Description" }).fill(`${description} renamed`);
    await lead.getByRole("textbox", { name: "Description" }).blur();
    await expect(lead.getByRole("textbox", { name: "Expense total" })).toHaveValue("100.00");
    // A saved share keeps its amount when the total changes, as in the form:
    // Tim's $43.20 is now 43.2% of $100.
    await expect(shares.locator(".lsd-row")).toHaveText(["Tim’s share43.2% · $43.20", "Joyce’s share56.8% · $56.80"]);
    await expect(lead.locator(".lsd-chip").nth(2)).toHaveText("43.2 / 56.8");

    await dialog.locator("[data-row='category']").click();
    const categoryPicker = page.getByRole("dialog", { name: "Category" });
    await categoryPicker.getByRole("button", { name: "Home", exact: true }).click();
    await expect(categoryPicker).toHaveCount(0);
    await dialog.getByRole("button", { name: /More details/ }).click();
    await dialog.getByRole("textbox", { name: "Note", exact: true }).fill("After");

    await expect(save).toBeEnabled();
    const update = page.waitForRequest((request) => request.url().includes("/api/splits/expenses/update"));
    await save.click();
    expect((await update).postDataJSON()).toEqual({
      splitExpenseId,
      groupId: null,
      date: `${MONTH}-10`,
      description: `${description} renamed`,
      categoryName: "Home",
      payerPersonName: "Tim",
      amountMinor: 10000,
      note: "After",
      splitBasisPoints: 4320,
      splitAmountMinor: 4320,
      currency: "SGD",
      paymentMethod: "cash",
      paymentStatus: "recorded"
    });
    await expect(dialog).toHaveCount(0);

    await expect.poll(async () => {
      const saved = await savedSplit(page, splitExpenseId);
      return saved && { description: saved.description, totalAmountMinor: saved.totalAmountMinor, categoryName: saved.categoryName, note: saved.note };
    }).toEqual({ description: `${description} renamed`, totalAmountMinor: 10000, categoryName: "Home", note: "After" });
  });

  test("an uneven split changes its shares, payer, date and evidence from the chips and rows as the form did", async ({ page }) => {
    await setUp(page);
    const description = `Lead edit uneven ${Date.now()}`;
    const splitExpenseId = await createSplit(page, { description, amountMinor: 12000, splitBasisPoints: 2500, splitAmountMinor: 3000 });
    const dialog = await openSplit(page, splitExpenseId);
    const lead = dialog.locator(".lsd-card");
    const shares = dialog.getByRole("group", { name: "Split share amounts" });
    await expect(shares.locator(".lsd-row")).toHaveText(["Tim’s share25% · $30.00", "Joyce’s share75% · $90.00"]);

    // The shares chip opens the share editor; percent and amount stay linked.
    await expect(dialog.getByLabel("Tim share %")).toHaveCount(0);
    await lead.getByRole("button", { name: "Change shares, 25 / 75" }).click();
    await dialog.getByLabel("Tim share %").fill("40");
    await dialog.getByLabel("Tim share %").blur();
    await expect(dialog.getByLabel("Tim share amount")).toHaveValue("48.00");
    await expect(shares.locator(".lsd-row")).toHaveText(["Tim’s share40% · $48.00", "Joyce’s share60% · $72.00"]);
    await expect(lead.locator(".lsd-chip").nth(2)).toHaveText("40 / 60");

    // The paid by chip opens the Paid by picker.
    await lead.getByRole("button", { name: "Change paid by, Tim" }).click();
    const payerPicker = page.getByRole("dialog", { name: "Paid by" });
    await payerPicker.getByRole("button", { name: "Joyce", exact: true }).click();
    await expect(payerPicker).toHaveCount(0);
    await expect(lead.locator(".lsd-chip").nth(1)).toHaveText("Paid by Joyce");

    await lead.getByLabel("Change date, Sun 10 May").fill(`${MONTH}-11`);
    await expect(lead.locator(".lsd-chip").first()).toHaveText("Mon 11 May");
    await dialog.locator("[data-row='evidence']").click();
    await page.getByRole("dialog", { name: "Evidence" }).getByRole("button", { name: "Awaiting statement", exact: true }).click();

    const update = page.waitForRequest((request) => request.url().includes("/api/splits/expenses/update"));
    await dialog.getByRole("button", { name: "Save expense" }).click();
    expect((await update).postDataJSON()).toEqual({
      splitExpenseId,
      groupId: null,
      date: `${MONTH}-11`,
      description,
      categoryName: "Groceries",
      payerPersonName: "Joyce",
      amountMinor: 12000,
      note: "Before",
      splitBasisPoints: 4000,
      splitAmountMinor: 4800,
      currency: "SGD",
      paymentMethod: "cash",
      paymentStatus: "awaiting_statement"
    });
    await expect(dialog).toHaveCount(0);
    await expect.poll(async () => {
      const saved = await savedSplit(page, splitExpenseId);
      return saved?.shares?.map((share) => [share.personName, share.amountMinor]).sort();
    }).toEqual([["Joyce", 7200], ["Tim", 4800]]);
  });

  test("Delete asks in the app before deleting, and Cancel keeps the split", async ({ page }) => {
    await setUp(page);
    const splitExpenseId = await createSplit(page);
    const browserDialogs = [];
    page.on("dialog", (dialog) => {
      browserDialogs.push(dialog.type());
      void dialog.dismiss();
    });
    let deletes = 0;
    page.on("request", (request) => {
      if (request.url().includes("/api/splits/expenses/delete")) deletes += 1;
    });

    const dialog = await openSplit(page, splitExpenseId);
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    const confirm = page.getByRole("dialog", { name: "Delete split row" });
    await expect(confirm).toBeVisible();
    await page.waitForTimeout(200);
    expect(deletes).toBe(0);
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toHaveCount(0);
    expect(await savedSplit(page, splitExpenseId)).toBeTruthy();

    const reopened = await openSplit(page, splitExpenseId);
    await reopened.getByRole("button", { name: "Delete", exact: true }).click();
    const deleted = page.waitForResponse((response) => response.url().includes("/api/splits/expenses/delete") && response.ok());
    await confirm.getByRole("button", { name: "Delete split row" }).click();
    await deleted;
    expect(deletes).toBe(1);
    expect(browserDialogs).toEqual([]);
    await expect.poll(async () => Boolean(await savedSplit(page, splitExpenseId))).toBe(false);
  });

  test("a split linked to an entry locks how it was paid, set by the linked entry", async ({ page }) => {
    await setUp(page);
    const { entryId, splitExpenseId } = await createLinkedSplit(page);
    const dialog = await openSplit(page, splitExpenseId);
    const lead = dialog.locator(".lsd-card");

    // The chip shows a lock, opens nothing and says why.
    const paymentChip = lead.locator(".lsd-chip.is-locked");
    await expect(paymentChip).toHaveText("Card, set by the linked entry");
    await expect(lead.getByRole("button", { name: /Change paid using/ })).toHaveCount(0);
    // The other chips stay tappable.
    await expect(lead.getByRole("button", { name: "Change paid by, Tim" })).toBeVisible();

    await dialog.getByRole("button", { name: /More details/ }).click();
    const paymentRow = dialog.locator("[data-row='paymentMethod']");
    await expect(paymentRow).toHaveClass(/is-locked/);
    await expect(paymentRow).toContainText("Paid using (ledger)");
    await expect(paymentRow).toContainText("Card");
    await expect(paymentRow.locator("select, button")).toHaveCount(0);

    // The linked entry is a row, as View split is on the entry.
    const linkedRow = dialog.locator("[data-row='linkedEntry']");
    await expect(linkedRow).toHaveText(/Linked entry\s*View entry/);
    await linkedRow.click();
    await expect(page).toHaveURL(new RegExp(`editing_entry=${entryId}`));
  });

  test("every tap target in Edit split is 44 px or more with room around it", async ({ page }) => {
    await setUp(page);
    const splitExpenseId = await createSplit(page, { amountMinor: 1000, splitBasisPoints: 5000, splitAmountMinor: 500 });
    const dialog = await openSplit(page, splitExpenseId);
    await dialog.locator("[data-share-row='Tim']").click();
    await dialog.getByRole("button", { name: /More details/ }).click();
    const measured = new Set();
    for (const edge of ["top", "bottom"]) {
      await dialog.locator(".split-dialog-scroll").evaluate((scroller, where) => {
        scroller.scrollTop = where === "top" ? 0 : scroller.scrollHeight;
      }, edge);
      const targets = await tapTargets(dialog);
      const small = targets.filter((target) => !target.clipped && (target.width < 44 || target.height < 44)).map((target) => `${target.name} ${target.width}x${target.height}`);
      expect(small).toEqual([]);
      expect(crowdedPairs(targets)).toEqual([]);
      targets.filter((target) => !target.clipped).forEach((target) => measured.add(target.name));
    }
    expect([...measured]).toEqual(expect.arrayContaining([
      "Change date, Sun 10 May", "Change paid by, Tim", "Change shares, 50 / 50", "Change paid using, Cash",
      "Delete", "Cancel", "Save expense"
    ]));
    await expect(dialog.locator(".lsd-card").getByRole("textbox", { name: "Expense total" })).toHaveAttribute("inputmode", "decimal");
    await expect(dialog.getByLabel("Tim share %")).toHaveAttribute("inputmode", "decimal");
  });

  test("hidden money masks the total being edited and the shares", async ({ page }) => {
    await setUp(page, { hidden: true });
    const splitExpenseId = await createSplit(page);
    const dialog = await openSplit(page, splitExpenseId);
    const total = dialog.locator(".lsd-card").getByRole("textbox", { name: "Expense total" });
    await expect(total).toHaveCSS("-webkit-text-security", "disc");
    await expect(dialog.locator(".lsd-card .lsd-amount")).toHaveCSS("color", INK.text);
    await expect(dialog.getByRole("group", { name: "Split share amounts" }).locator(".lsd-row"))
      .toHaveText(["Tim’s share50% · ••••", "Joyce’s share50% · ••••"]);
  });
});

test.describe("Edit split on a wide screen", () => {
  test("the inline card puts the lead across the top and saves an uneven split as the form did", async ({ page }) => {
    await setUp(page, { phone: false });
    const description = `Lead edit desktop ${Date.now()}`;
    const splitExpenseId = await createSplit(page, { description, amountMinor: 12000, splitBasisPoints: 2500, splitAmountMinor: 3000 });
    const dialog = await openSplitInline(page, splitExpenseId);
    const [cardBox, rowsBox] = await Promise.all([box(dialog.locator(".lsd-card")), box(dialog.locator(".lsd-rows"))]);
    // The lead card spans the width and the rows sit under it.
    expect(rowsBox.y).toBeGreaterThan(cardBox.y + cardBox.height - 1);
    expect(cardBox.width).toBeGreaterThan(rowsBox.width - 4);
    // Nothing folds on a wide screen; the share editor opens from the shares chip.
    await expect(dialog.locator(".lsd-row-more")).toHaveCount(0);
    await expect(dialog.getByLabel("Tim share amount")).toHaveCount(0);
    await dialog.locator(".lsd-card").getByRole("button", { name: "Change shares, 25 / 75" }).click();

    await dialog.getByLabel("Tim share amount").fill("60");
    await dialog.getByLabel("Tim share amount").blur();
    await expect(dialog.getByLabel("Tim share %")).toHaveValue("50");
    await dialog.getByLabel("Category").selectOption("Home");
    await dialog.getByRole("textbox", { name: "Note", exact: true }).fill("Desktop note");

    const update = page.waitForRequest((request) => request.url().includes("/api/splits/expenses/update"));
    await dialog.getByRole("button", { name: "Save expense" }).click();
    expect((await update).postDataJSON()).toEqual({
      splitExpenseId,
      groupId: null,
      date: `${MONTH}-10`,
      description,
      categoryName: "Home",
      payerPersonName: "Tim",
      amountMinor: 12000,
      note: "Desktop note",
      splitBasisPoints: 5000,
      splitAmountMinor: 6000,
      currency: "SGD",
      paymentMethod: "cash",
      paymentStatus: "recorded"
    });
    await expect(dialog).toHaveCount(0);
  });

  test("Delete asks in the app, and a linked split's payment row is locked", async ({ page }) => {
    await setUp(page, { phone: false });
    const { splitExpenseId } = await createLinkedSplit(page);
    const dialog = await openSplitInline(page, splitExpenseId);
    // Paid using is the Support chip only (no row repeats it), locked to Card.
    await expect(dialog.locator("[data-row='paymentMethod']")).toHaveCount(0);
    await expect(dialog.locator(".lsd-card select[aria-label^='Change paid using']")).toHaveCount(0);
    await expect(dialog.locator(".lsd-card .lsd-chip.is-locked")).toHaveText("Card, set by the linked entry");

    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    const confirm = page.getByRole("dialog", { name: "Delete split row" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toHaveCount(0);
    expect(await savedSplit(page, splitExpenseId)).toBeTruthy();
  });
});

test.describe("Selecting a split row on a wide screen", () => {
  test("a 50/50 row opens the card and saves the request the inline form sent", async ({ page }) => {
    await setUp(page, { phone: false });
    const description = `Row even ${Date.now()}`;
    const splitExpenseId = await createSplit(page, { description });
    const dialog = await openSplitFromRow(page, splitExpenseId);
    const lead = dialog.locator(".lsd-card");
    await expect(lead.getByRole("textbox", { name: "Description" })).toHaveValue(description);
    await expect(lead.getByRole("textbox", { name: "Expense total" })).toHaveValue("86.40");
    await expect(lead.locator(".lsd-chip")).toHaveText(["Sun 10 May", "Paid by Tim", "50 / 50", "Cash"]);
    await expect(dialog.getByRole("button", { name: "Save expense" })).toBeDisabled();

    await lead.getByRole("textbox", { name: "Expense total" }).fill("100");
    await dialog.getByRole("textbox", { name: "Note", exact: true }).fill("After");
    const update = page.waitForRequest((request) => request.url().includes("/api/splits/expenses/update"));
    await dialog.getByRole("button", { name: "Save expense" }).click();
    expect((await update).postDataJSON()).toEqual({
      splitExpenseId,
      groupId: null,
      date: `${MONTH}-10`,
      description,
      categoryName: "Groceries",
      payerPersonName: "Tim",
      amountMinor: 10000,
      note: "After",
      splitBasisPoints: 4320,
      splitAmountMinor: 4320,
      currency: "SGD",
      paymentMethod: "cash",
      paymentStatus: "recorded"
    });
    await expect(dialog).toHaveCount(0);
    await expect(splitRow(page, splitExpenseId)).toBeFocused();
    await expect.poll(async () => {
      const saved = await savedSplit(page, splitExpenseId);
      return saved && { totalAmountMinor: saved.totalAmountMinor, note: saved.note };
    }).toEqual({ totalAmountMinor: 10000, note: "After" });
  });

  test("an uneven row opens the card and saves the request the inline form sent", async ({ page }) => {
    await setUp(page, { phone: false });
    const description = `Row uneven ${Date.now()}`;
    const splitExpenseId = await createSplit(page, { description, amountMinor: 12000, splitBasisPoints: 2500, splitAmountMinor: 3000 });
    const dialog = await openSplitFromRow(page, splitExpenseId);
    await expect(dialog.getByRole("group", { name: "Split share amounts" }).locator(".lsd-row"))
      .toHaveText(["Tim’s share25% · $30.00", "Joyce’s share75% · $90.00"]);

    // A share row opens the share editor.
    await dialog.locator("[data-share-row='Tim']").click();
    await dialog.getByLabel("Tim share %").fill("40");
    await dialog.getByLabel("Tim share %").blur();
    await expect(dialog.getByLabel("Tim share amount")).toHaveValue("48.00");
    await dialog.getByLabel("Category").selectOption("Home");
    const update = page.waitForRequest((request) => request.url().includes("/api/splits/expenses/update"));
    await dialog.getByRole("button", { name: "Save expense" }).click();
    expect((await update).postDataJSON()).toEqual({
      splitExpenseId,
      groupId: null,
      date: `${MONTH}-10`,
      description,
      categoryName: "Home",
      payerPersonName: "Tim",
      amountMinor: 12000,
      note: "Before",
      splitBasisPoints: 4000,
      splitAmountMinor: 4800,
      currency: "SGD",
      paymentMethod: "cash",
      paymentStatus: "recorded"
    });
    await expect(dialog).toHaveCount(0);
    await expect.poll(async () => {
      const saved = await savedSplit(page, splitExpenseId);
      return saved?.shares?.map((share) => [share.personName, share.amountMinor]).sort();
    }).toEqual([["Joyce", 7200], ["Tim", 4800]]);
  });

  test("Enter and Space open the card, and Escape, Cancel and Save give focus back to the row", async ({ page }) => {
    await setUp(page, { phone: false });
    const splitExpenseId = await createSplit(page, { description: `Row keys ${Date.now()}` });
    let updates = 0;
    page.on("request", (request) => {
      if (request.url().includes("/api/splits/expenses/update")) updates += 1;
    });
    const row = splitRow(page, splitExpenseId);

    const dialog = await openSplitFromRow(page, splitExpenseId, { how: "Enter" });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(row).toBeFocused();

    await row.press("Space");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(row).toBeFocused();

    // A change that is cancelled or escaped is never saved.
    await row.press("Enter");
    await dialog.getByRole("textbox", { name: "Note", exact: true }).fill("Never saved");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(row).toBeFocused();
    expect(updates).toBe(0);
    expect((await savedSplit(page, splitExpenseId))?.note).toBe("Before");

    await row.press("Enter");
    await dialog.getByRole("textbox", { name: "Note", exact: true }).fill("Saved by keyboard");
    await dialog.getByRole("button", { name: "Save expense" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(row).toBeFocused();
    expect(updates).toBe(1);
  });

  test("Delete asks in the app, keeps the split on Cancel, and removes the row when confirmed", async ({ page }) => {
    await setUp(page, { phone: false });
    const description = `Row delete ${Date.now()}`;
    const splitExpenseId = await createSplit(page, { description });
    const browserDialogs = [];
    page.on("dialog", (dialog) => {
      browserDialogs.push(dialog.type());
      void dialog.dismiss();
    });
    let deletes = 0;
    page.on("request", (request) => {
      if (request.url().includes("/api/splits/expenses/delete")) deletes += 1;
    });

    const dialog = await openSplitFromRow(page, splitExpenseId);
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    const confirm = page.getByRole("dialog", { name: "Delete split row" });
    await expect(confirm).toContainText(description);
    await page.waitForTimeout(200);
    expect(deletes).toBe(0);
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toHaveCount(0);
    await expect(dialog).toBeVisible();
    expect(await savedSplit(page, splitExpenseId)).toBeTruthy();

    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    const deleted = page.waitForResponse((response) => response.url().includes("/api/splits/expenses/delete") && response.ok());
    await confirm.getByRole("button", { name: "Delete split row" }).click();
    await deleted;
    expect(deletes).toBe(1);
    expect(browserDialogs).toEqual([]);
    // The card closes with the split gone, not left open on a deleted row.
    await expect(confirm).toHaveCount(0);
    await expect(dialog).toHaveCount(0);
    await expect(splitRow(page, splitExpenseId)).toHaveCount(0);
    await expect.poll(async () => Boolean(await savedSplit(page, splitExpenseId))).toBe(false);
  });
});

// The inline card on a wide screen is compact: the lead across the top, the
// Detail rows in two balanced columns, no row that repeats a chip or a share.
// Stated cap: the card was about 680 px tall at this width before the two-column layout.
const INLINE_CARD_MAX_HEIGHT = 470;

test.describe("The inline split card layout at 1280 px", () => {
  test("is compact, has no duplicate rows, and keeps the lead across the top", async ({ page }) => {
    await setUp(page, { phone: false });
    await page.setViewportSize({ width: 1280, height: 800 });
    const splitExpenseId = await createSplit(page, { description: `Layout ${Date.now()}` });
    const editor = await openSplitFromRow(page, splitExpenseId);

    const cardBox = await box(editor);
    expect(cardBox.height).toBeLessThan(INLINE_CARD_MAX_HEIGHT);
    const [leadBox, rowsBox] = await Promise.all([box(editor.locator(".lsd-card")), box(editor.locator(".lsd-rows"))]);
    expect(leadBox.width).toBeGreaterThan(rowsBox.width - 4);
    expect(rowsBox.y).toBeGreaterThan(leadBox.bottom - 1);

    // Two share rows, then Category, Group, Currency, Evidence, Note: nothing
    // repeats a Support chip (date, paid by, paid using) or a share.
    await expect(editor.locator(".lsd-rows .lsd-row")).toHaveCount(7);
    for (const key of ["date", "payer", "paymentMethod"]) {
      await expect(editor.locator(`[data-row='${key}']`)).toHaveCount(0);
    }
    for (const key of ["category", "group", "currency", "evidence", "note"]) {
      await expect(editor.locator(`[data-row='${key}']`)).toHaveCount(1);
    }
    await expect(editor.getByRole("group", { name: "Split share amounts" }).locator(".lsd-row")).toHaveCount(2);
    await expect(editor.getByLabel("Tim share %")).toHaveCount(0);
    await expect(editor.getByLabel("Tim share amount")).toHaveCount(0);

    // The rows run in two columns.
    const xs = await editor.locator(".lsd-rows .lsd-row").evaluateAll((rows) => [...new Set(rows.map((row) => Math.round(row.getBoundingClientRect().x)))]);
    expect(xs.length).toBe(2);
  });

  test("Date, Paid by and Paid using are still edited from their chips", async ({ page }) => {
    await setUp(page, { phone: false });
    const description = `Chips ${Date.now()}`;
    const splitExpenseId = await createSplit(page, { description });
    const editor = await openSplitFromRow(page, splitExpenseId);
    const lead = editor.locator(".lsd-card");

    await lead.getByLabel("Change date, Sun 10 May").fill(`${MONTH}-12`);
    await lead.getByLabel("Change paid by, Tim").selectOption("Joyce");
    await lead.getByLabel("Change paid using, Cash").selectOption("bank");
    await expect(lead.locator(".lsd-chip")).toHaveText(["Tue 12 May", "Paid by Joyce", "50 / 50", "Bank"]);

    const update = page.waitForRequest((request) => request.url().includes("/api/splits/expenses/update"));
    await editor.getByRole("button", { name: "Save expense" }).click();
    expect((await update).postDataJSON()).toEqual({
      splitExpenseId,
      groupId: null,
      date: `${MONTH}-12`,
      description,
      categoryName: "Groceries",
      payerPersonName: "Joyce",
      amountMinor: 8640,
      note: "Before",
      splitBasisPoints: 5000,
      splitAmountMinor: 4320,
      currency: "SGD",
      paymentMethod: "bank",
      paymentStatus: "recorded"
    });
    await expect(editor).toHaveCount(0);
  });

  test("a linked split's Paid using chip stays locked inline", async ({ page }) => {
    await setUp(page, { phone: false });
    const { splitExpenseId } = await createLinkedSplit(page);
    const editor = await openSplitFromRow(page, splitExpenseId);
    await expect(editor.locator(".lsd-card .lsd-chip.is-locked")).toHaveText("Card, set by the linked entry");
    await expect(editor.locator(".lsd-card select[aria-label^='Change paid using']")).toHaveCount(0);
  });
});
