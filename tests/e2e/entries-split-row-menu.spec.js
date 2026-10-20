import { expect, test } from "@playwright/test";

import { loadEntriesPage, postJson, reseedDemo } from "./helpers";

// The Edit entry actions of an entry on Splits (owner request, 2026-10-20):
// the bottom bar has one destructive action, Delete entry, on one row with
// Close (or Cancel) and Save. Taking the entry off Splits moved to its
// Splits row: "View split ›" opens a small menu with View split and Remove
// from Splits, which asks first (the same dialog and command as the old
// Delete split button) and keeps the entry. The confirmation says what the
// menu said (owner, 2026-10-20): "Remove from Splits?", the entry stays, and
// its button is "Remove" (the full words wrap at 320 px), with no "Delete
// split" left. An entry not on Splits keeps its plain "Add to splits" row,
// with no menu.

const MONTH = "2026-05";
const PHONE = { width: 390, height: 664 };
const DESKTOP = { width: 1280, height: 860 };

async function createEntry(page, description, { linked }) {
  const { entryId } = await postJson(page, "/api/entries/create", {
    date: `${MONTH}-22`,
    description,
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 6000,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });
  if (!linked) return { entryId, splitExpenseId: null };
  const { splitExpenseId } = await postJson(page, "/api/splits/expenses/from-entry", { entryId, splitGroupId: null });
  return { entryId, splitExpenseId };
}

async function setUp(page, viewport) {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await page.setViewportSize(viewport);
  await page.goto("/");
  await reseedDemo(page);
}

// The open editor: the phone's Edit entry sheet, or the wide inline card.
async function openEditor(page, entryId, { phone }) {
  await page.goto(`/entries?view=person-tim&month=${MONTH}&entries_scope=direct_plus_shared&editing_entry=${entryId}`);
  const editor = phone
    ? page.locator('.entry-mobile-sheet[aria-label="Edit entry"]')
    : page.locator(".entry-inline-editor").first();
  await expect(editor).toBeVisible({ timeout: 60_000 });
  return editor;
}

const REMOVE_TITLE = "Remove from Splits?";
const REMOVE_BUTTON = "Remove";
const REMOVE_NOTE = "The entry stays in Entries. Only its split on Splits is removed.";

const actionBar = (editor, phone) => editor.locator(phone ? ".entry-edit-sheet-actions" : ".entry-edit-inline-actions");

async function expectOneRowFooter(editor, phone) {
  const bar = actionBar(editor, phone);
  // Exactly one destructive action, and it is Delete entry.
  await expect(bar.locator(".is-danger")).toHaveCount(1);
  await expect(bar.locator(".is-danger")).toHaveText("Delete entry");
  await expect(editor.getByRole("button", { name: "Delete split" })).toHaveCount(0);
  // Delete entry, then Close or Cancel, then Save: one row, each at least
  // 44px. Read in one pass, so a scroll in between cannot skew the rows.
  const boxes = await bar.evaluate((element) => [...element.querySelectorAll("button")]
    .filter((button) => button.getClientRects().length > 0)
    .map((button) => {
      const rect = button.getBoundingClientRect();
      return { name: button.textContent.trim(), box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
    }));
  expect(boxes[0].name).toBe("Delete entry");
  expect(boxes.at(-1).name).toBe("Save");
  for (const { name, box } of boxes) {
    expect(box.height, `${name} is a 44px target`).toBeGreaterThanOrEqual(44);
    expect(Math.abs((box.y + box.height / 2) - (boxes[0].box.y + boxes[0].box.height / 2)), `${name} sits on the one row`).toBeLessThanOrEqual(2);
  }
  expect(boxes[0].box.x).toBeLessThan(boxes.at(-1).box.x);
}

for (const device of [{ name: "phone", viewport: PHONE, phone: true }, { name: "desktop", viewport: DESKTOP, phone: false }]) {
  test.describe(`Edit entry actions on a ${device.name}`, () => {
    test("an entry on Splits: one destructive action, and Remove from Splits on the Splits row keeps the entry", async ({ page }) => {
      await setUp(page, device.viewport);
      const description = `Split row menu ${device.name} ${Date.now()}`;
      const { entryId } = await createEntry(page, description, { linked: true });
      const editor = await openEditor(page, entryId, device);

      await expectOneRowFooter(editor, device.phone);

      // The Splits row opens a menu; its name says what it holds.
      const splitsRow = editor.locator("[data-row='splits']");
      await expect(splitsRow).toContainText("View split");
      await expect(splitsRow).toHaveAttribute("aria-haspopup", "menu");
      await expect(splitsRow).toHaveAccessibleName("Splits: View split or Remove from Splits");
      await splitsRow.click();
      const menu = page.getByRole("menu", { name: "Splits" });
      await expect(menu).toBeVisible();
      await expect(menu.getByRole("menuitem")).toHaveText(["View split", "Remove from Splits"]);
      const menuBox = await menu.boundingBox();
      expect(menuBox.y).toBeGreaterThanOrEqual(0);
      expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(device.viewport.height);
      for (const item of await menu.getByRole("menuitem").all()) {
        expect((await item.boundingBox()).height).toBeGreaterThanOrEqual(44);
      }

      // Remove from Splits asks first, with the existing dialog, in the
      // menu's words: the entry stays, only its split goes.
      await menu.getByRole("menuitem", { name: "Remove from Splits" }).click();
      await expect(menu).toBeHidden();
      const dialog = page.locator(".entry-delete-dialog");
      await expect(dialog).toBeVisible();
      await expect(page.getByRole("dialog", { name: REMOVE_TITLE })).toBeVisible();
      await expect(dialog).toContainText(REMOVE_NOTE);
      await expect(dialog).toContainText(description);
      await expect(dialog).toContainText("$60.00");
      await expect(dialog).not.toContainText(/delete split|ledger/i);
      await expect(dialog.getByRole("button", { name: "Delete split" })).toHaveCount(0);
      const deleted = page.waitForResponse((response) => response.url().includes("/api/splits/expenses/delete") && response.ok());
      await dialog.getByRole("button", { name: REMOVE_BUTTON, exact: true }).click();
      await deleted;
      await expect(dialog).toBeHidden();

      // The entry stays, now off Splits: the plain Add to splits row is back.
      await expect(editor.locator("[data-row='splits']")).toContainText("Add to splits", { timeout: 30_000 });
      await expect(editor.locator("[data-row='splits']")).not.toHaveAttribute("aria-haspopup", "menu");
      const entriesData = await loadEntriesPage(page, { view: "person-tim", month: MONTH });
      const entry = entriesData.monthPage.entries.find((item) => item.id === entryId);
      expect(entry, "the entry is kept").toBeTruthy();
      expect(entry.linkedSplitExpenseId ?? null).toBeNull();
    });

    test("View split in the Splits row's menu opens the split on Splits", async ({ page }) => {
      await setUp(page, device.viewport);
      const description = `Split row view ${device.name} ${Date.now()}`;
      const { entryId } = await createEntry(page, description, { linked: true });
      const editor = await openEditor(page, entryId, device);
      await editor.locator("[data-row='splits']").click();
      await page.getByRole("menu", { name: "Splits" }).getByRole("menuitem", { name: "View split" }).click();
      await expect(page).toHaveURL(/\/splits\?/, { timeout: 30_000 });
    });

    test("a refused Remove from Splits shows the error and keeps the split", async ({ page }) => {
      await setUp(page, device.viewport);
      const description = `Split row refusal ${device.name} ${Date.now()}`;
      const { entryId } = await createEntry(page, description, { linked: true });
      const editor = await openEditor(page, entryId, device);
      await page.route("**/api/splits/expenses/delete", (route) => route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "That split cannot change right now." })
      }));
      await editor.locator("[data-row='splits']").click();
      await page.getByRole("menu", { name: "Splits" }).getByRole("menuitem", { name: "Remove from Splits" }).click();
      const dialog = page.locator(".entry-delete-dialog");
      await dialog.getByRole("button", { name: REMOVE_BUTTON, exact: true }).click();
      await expect(dialog.getByText("That split cannot change right now.")).toBeVisible();
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toBeHidden();
      await expect(editor.locator("[data-row='splits']")).toContainText("View split");
      const entriesData = await loadEntriesPage(page, { view: "person-tim", month: MONTH });
      expect(entriesData.monthPage.entries.find((item) => item.id === entryId)?.linkedSplitExpenseId).toBeTruthy();
    });

    test("an entry not on Splits keeps its plain Add to splits row and the one-row bar", async ({ page }) => {
      await setUp(page, device.viewport);
      const description = `Split row unlinked ${device.name} ${Date.now()}`;
      const { entryId } = await createEntry(page, description, { linked: false });
      const editor = await openEditor(page, entryId, device);
      await expectOneRowFooter(editor, device.phone);
      const splitsRow = editor.locator("[data-row='splits']");
      await expect(splitsRow).toContainText("Add to splits");
      await expect(editor.locator("[aria-haspopup='menu'][data-row='splits'], [data-row='splits'] [aria-haspopup='menu']")).toHaveCount(0);
      await expect(page.getByRole("menu", { name: "Splits" })).toHaveCount(0);
    });
  });
}

// Owner condition: "as long as it is not too cramped". The title and the
// button label each sit on one line, uncut, at every phone width and on a
// wide screen.
async function lineCount(locator) {
  return locator.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return new Set([...range.getClientRects()].filter((rect) => rect.width > 0).map((rect) => Math.round(rect.top))).size;
  });
}

for (const width of [320, 375, 390, 1280]) {
  test(`the Remove from Splits confirmation fits on one line each at ${width}px`, async ({ page }) => {
    const phone = width < 768;
    const viewport = phone ? { width, height: 664 } : DESKTOP;
    await setUp(page, viewport);
    const { entryId } = await createEntry(page, `Split remove fit ${width} ${Date.now()}`, { linked: true });
    const editor = await openEditor(page, entryId, { phone });
    await editor.locator("[data-row='splits']").click();
    await page.getByRole("menu", { name: "Splits" }).getByRole("menuitem", { name: "Remove from Splits" }).click();
    const dialog = page.getByRole("dialog", { name: REMOVE_TITLE });
    await expect(dialog).toBeVisible();
    const title = dialog.getByText(REMOVE_TITLE, { exact: true });
    const button = dialog.getByRole("button", { name: REMOVE_BUTTON, exact: true });
    const cancel = dialog.getByRole("button", { name: "Cancel", exact: true });
    for (const [name, locator] of [["title", title], ["button", button], ["Cancel", cancel]]) {
      expect(await lineCount(locator), `${name} sits on one line`).toBe(1);
      expect(await locator.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), `${name} is not cut`).toBe(true);
    }
    const [buttonBox, cancelBox] = [await button.boundingBox(), await cancel.boundingBox()];
    expect(buttonBox.height).toBeGreaterThanOrEqual(44);
    expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(viewport.width);
    expect(Math.max(buttonBox.x - (cancelBox.x + cancelBox.width), cancelBox.x - (buttonBox.x + buttonBox.width))).toBeGreaterThanOrEqual(8);
  });
}
