import { expect, test } from "@playwright/test";

import { loadEntriesPage, loadSplitsPage, postJson, reseedDemo } from "./helpers";

test("editing an existing split expense keeps the row in place and persists the change", async ({ page }) => {
  const updatedNote = `Updated split note ${Date.now()}`;

  await page.goto("/");
  await reseedDemo(page);
  await page.goto("/splits?view=person-tim&month=2025-10&split_group=split-group-baby-river");

  await page.locator(".split-activity-card").filter({ hasText: "Family support" }).first().click();
  // On a wide screen a saved split expense opens as the card in the list, not a dialog.
  const editDialog = page.locator(".split-inline-editor-card");
  await expect(editDialog).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await editDialog.getByRole("textbox", { name: "Note", exact: true }).fill(updatedNote);
  await editDialog.getByRole("button", { name: "Save expense" }).click();
  const syncDialog = page.getByRole("dialog", { name: "Update connected note?" });
  if (await syncDialog.isVisible().catch(() => false)) {
    await syncDialog.getByRole("button", { name: "Save only this" }).click();
  }

  await expect(page.locator(".split-activity-card").filter({ hasText: "Family support" }).filter({ hasText: updatedNote })).toBeVisible();
  await expect.poll(async () => {
    const data = await loadSplitsPage(page, { view: "person-tim", month: "2025-10" });
    return data.splitsPage.activity.find((item) => item.description === "Family support")?.note ?? "";
  }).toBe(updatedNote);
});

test("editing a linked split note can update the connected entry note", async ({ page }) => {
  const month = "2026-04";
  const description = `Playwright split linked note ${Date.now()}`;
  const entryNote = "entry current note";
  const syncedNote = "split note copied to entry";

  await page.goto("/");
  await reseedDemo(page);

  const entry = await postJson(page, "/api/entries/create", {
    date: `${month}-24`,
    description,
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 2550,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim",
    note: entryNote
  });
  const splitData = await postJson(page, "/api/splits/expenses/from-entry", {
    entryId: entry.entryId,
    splitGroupId: null
  });

  await page.goto(`/splits?view=person-tim&month=${month}&editing_split_expense=${splitData.splitExpenseId}`);
  const editDialog = page.locator(".split-inline-editor-card");
  await expect(editDialog).toBeVisible();
  await editDialog.getByRole("textbox", { name: "Note", exact: true }).fill(syncedNote);
  await editDialog.getByRole("button", { name: "Save expense" }).click();

  const syncDialog = page.getByRole("dialog", { name: "Update connected note?" });
  await expect(syncDialog).toBeVisible();
  await expect(syncDialog).toContainText(syncedNote);
  await expect(syncDialog).toContainText(entryNote);
  await syncDialog.getByRole("button", { name: "Update both" }).click();
  await expect(syncDialog).toBeHidden({ timeout: 60_000 });

  const splitsData = await loadSplitsPage(page, { view: "person-tim", month });
  const updatedSplit = splitsData.splitsPage.activity.find((item) => item.id === splitData.splitExpenseId);
  expect(updatedSplit?.note).toBe(syncedNote);

  const entriesData = await loadEntriesPage(page, { view: "person-tim", month });
  const updatedEntry = entriesData.monthPage.entries.find((item) => item.id === entry.entryId);
  expect(updatedEntry?.note).toBe(syncedNote);
});

test("linked split payment method is derived from the ledger account and locked", async ({ page }) => {
  const month = "2026-04";

  await page.goto("/");
  await reseedDemo(page);
  const entry = await postJson(page, "/api/entries/create", {
    date: `${month}-24`,
    description: `Linked payment method ${Date.now()}`,
    accountName: "UOB One",
    categoryName: "Food & Drinks",
    amountMinor: 2550,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });
  const splitData = await postJson(page, "/api/splits/expenses/from-entry", {
    entryId: entry.entryId,
    splitGroupId: null
  });

  await page.goto(`/splits?view=person-tim&month=${month}&editing_split_expense=${splitData.splitExpenseId}`);
  const editDialog = page.locator(".split-inline-editor-card");
  // The split expense card: Paid using is the Support chip alone (no row repeats
  // it), locked to Card with no picker (design.md, "Tappable chips").
  await expect(editDialog.locator("[data-row='paymentMethod']")).toHaveCount(0);
  await expect(editDialog.locator(".lsd-card select[aria-label^='Change paid using']")).toHaveCount(0);
  await expect(editDialog.locator(".lsd-card .lsd-chip.is-locked")).toHaveText("Card, set by the linked entry");
});

test("mobile split sheet keeps its bottom bar in view and scrolls the card above it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await reseedDemo(page);
  await page.goto("/splits?view=person-tim&month=2025-10&editing_split_expense=split-expense-baby-river-family");

  const dialog = page.getByRole("dialog", { name: "Edit split" });
  await expect(dialog).toBeVisible();
  // The split expense card scrolls; the old "More fields below" cue is gone.
  await expect(dialog.locator(".split-dialog-scroll-cue")).toHaveCount(0);
  await expect(dialog.locator(".split-dialog-scroll")).toHaveCSS("overflow-y", "auto");
  const actions = dialog.locator(".split-expense-card-actions");
  const actionBox = await actions.boundingBox();
  expect(actionBox).toMatchObject({ x: 0, width: 390 });
  const buttons = await actions.getByRole("button").all();
  expect(buttons).toHaveLength(3);
  for (const button of buttons) {
    const buttonBox = await button.boundingBox();
    expect(buttonBox).not.toBeNull();
    expect(buttonBox.x).toBeGreaterThanOrEqual(0);
    expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(390);
    expect(buttonBox.height).toBeGreaterThanOrEqual(44);
    expect(actionBox.y + actionBox.height - (buttonBox.y + buttonBox.height)).toBeGreaterThanOrEqual(18);
  }
  await expect(actions.getByRole("button")).toHaveText(["Delete", "Cancel", "Save expense"]);
  await expect(dialog.getByRole("button", { name: "Save expense" })).toBeInViewport();
});

test("editing a linked split category can update the connected entry category", async ({ page }) => {
  const month = "2026-04";
  const description = `Playwright split linked category ${Date.now()}`;

  await page.goto("/");
  await reseedDemo(page);

  const entry = await postJson(page, "/api/entries/create", {
    date: `${month}-24`,
    description,
    accountName: "UOB One",
    categoryName: "Food & Drinks",
    amountMinor: 2550,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });
  const splitData = await postJson(page, "/api/splits/expenses/from-entry", {
    entryId: entry.entryId,
    splitGroupId: null
  });

  await page.goto(`/splits?view=person-tim&month=${month}&editing_split_expense=${splitData.splitExpenseId}`);
  const editDialog = page.locator(".split-inline-editor-card");
  await expect(editDialog).toBeVisible();
  await editDialog.getByLabel("Category").selectOption("Groceries");
  await editDialog.getByRole("button", { name: "Save expense" }).click();

  const syncDialog = page.getByRole("dialog", { name: "Update connected entry category?" });
  await expect(syncDialog).toBeVisible();
  await expect(syncDialog).toContainText("Food & Drinks");
  await expect(syncDialog).toContainText("Groceries");
  await syncDialog.getByRole("button", { name: "Update both" }).click();
  await expect(syncDialog).toBeHidden({ timeout: 60_000 });

  const splitsData = await loadSplitsPage(page, { view: "person-tim", month });
  const updatedSplit = splitsData.splitsPage.activity.find((item) => item.id === splitData.splitExpenseId);
  expect(updatedSplit?.categoryName).toBe("Groceries");

  const entriesData = await loadEntriesPage(page, { view: "person-tim", month });
  const updatedEntry = entriesData.monthPage.entries.find((item) => item.id === entry.entryId);
  expect(updatedEntry?.categoryName).toBe("Groceries");
});

// Holds short timers (the editors' deferred amount focus) until released, the
// way a busy tab delays them while the person is already typing elsewhere.
// The hold starts at document start on pages whose URL matches `urlPattern`.
async function installShortTimerHold(page, urlPattern) {
  await page.addInitScript((pattern) => {
    const nativeSetTimeout = window.setTimeout.bind(window);
    const nativeClearTimeout = window.clearTimeout.bind(window);
    const held = new Map();
    let nextHeldId = -1;
    window.__holdShortTimers = new RegExp(pattern).test(window.location.href);
    window.setTimeout = (callback, delay, ...args) => {
      if (!window.__holdShortTimers || typeof callback !== "function" || !(delay >= 50 && delay <= 200)) {
        return nativeSetTimeout(callback, delay, ...args);
      }
      const id = nextHeldId;
      nextHeldId -= 1;
      held.set(id, () => callback(...args));
      return id;
    };
    window.clearTimeout = (id) => {
      if (held.delete(id)) {
        return;
      }
      nativeClearTimeout(id);
    };
    window.__releaseShortTimers = () => {
      window.__holdShortTimers = false;
      const released = [...held.values()];
      held.clear();
      released.forEach((callback) => callback());
      return released.length;
    };
  }, urlPattern);
}

async function createLinkedSplit(page, { month, note }) {
  const entry = await postJson(page, "/api/entries/create", {
    date: `${month}-24`,
    description: `Playwright split deferred focus ${Date.now()}`,
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 2550,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim",
    note
  });
  return postJson(page, "/api/splits/expenses/from-entry", {
    entryId: entry.entryId,
    splitGroupId: null
  });
}

test("a late amount autofocus never moves a note being typed in the split dialog", async ({ page }) => {
  const month = "2026-04";
  await installShortTimerHold(page, "editing_split_expense=");
  await page.goto("/");
  await reseedDemo(page);
  const splitData = await createLinkedSplit(page, { month, note: "entry current note" });

  await page.goto(`/splits?view=person-tim&month=${month}&editing_split_expense=${splitData.splitExpenseId}`);
  const editDialog = page.locator(".split-inline-editor-card");
  await expect(editDialog).toBeVisible();
  const amount = editDialog.getByRole("textbox", { name: /Expense total/ });
  const note = editDialog.getByRole("textbox", { name: "Note", exact: true });
  const amountBefore = await amount.inputValue();

  await note.fill("split note");
  const releasedTimers = await page.evaluate(() => window.__releaseShortTimers());
  expect(releasedTimers).toBeGreaterThan(0);
  // Keep typing through the keyboard: a locator action would refocus Note and
  // hide a stolen focus.
  await page.keyboard.type(" copied to entry");

  await expect(note).toBeFocused();
  await expect(note).toHaveValue("split note copied to entry");
  await expect(amount).toHaveValue(amountBefore);
  await editDialog.getByRole("button", { name: "Save expense" }).click();
  const syncDialog = page.getByRole("dialog", { name: "Update connected note?" });
  await expect(syncDialog).toContainText("split note copied to entry");
  await syncDialog.getByRole("button", { name: "Save only this" }).click();
  await expect(syncDialog).toBeHidden({ timeout: 60_000 });
  const splitsData = await loadSplitsPage(page, { view: "person-tim", month });
  const updatedSplit = splitsData.splitsPage.activity.find((item) => item.id === splitData.splitExpenseId);
  expect(updatedSplit).toMatchObject({ note: "split note copied to entry", totalAmountMinor: 2550 });
});

test("the split dialog still focuses the amount when nothing else was focused", async ({ page }) => {
  const month = "2026-04";
  await installShortTimerHold(page, "editing_split_expense=");
  await page.goto("/");
  await reseedDemo(page);
  const splitData = await createLinkedSplit(page, { month, note: "entry current note" });

  await page.goto(`/splits?view=person-tim&month=${month}&editing_split_expense=${splitData.splitExpenseId}`);
  const editDialog = page.locator(".split-inline-editor-card");
  await expect(editDialog).toBeVisible();
  const amount = editDialog.getByRole("textbox", { name: /Expense total/ });
  await expect(amount).not.toBeFocused();
  const releasedTimers = await page.evaluate(() => window.__releaseShortTimers());
  expect(releasedTimers).toBeGreaterThan(0);
  await expect(amount).toBeFocused();
});

test("a late amount autofocus never moves a note being typed in the split card opened from its row", async ({ page }) => {
  const typedNote = `Inline note ${Date.now()}`;
  await installShortTimerHold(page, "split_group=split-group-baby-river");
  await page.goto("/");
  await reseedDemo(page);
  await page.goto("/splits?view=person-tim&month=2025-10&split_group=split-group-baby-river");

  const card = page.locator(".split-activity-card").filter({ hasText: "Family support" }).first();
  await expect(card).toBeVisible();
  await card.click();
  const cardDialog = page.locator(".split-inline-editor-card");
  await expect(cardDialog).toBeVisible();
  const note = cardDialog.getByRole("textbox", { name: "Note", exact: true });
  const amount = cardDialog.getByRole("textbox", { name: /Expense total/ });
  const amountBefore = await amount.inputValue();

  await note.fill(typedNote.slice(0, 6));
  const releasedTimers = await page.evaluate(() => window.__releaseShortTimers());
  expect(releasedTimers).toBeGreaterThan(0);
  await page.keyboard.type(typedNote.slice(6));

  await expect(note).toBeFocused();
  await expect(note).toHaveValue(typedNote);
  await expect(amount).toHaveValue(amountBefore);
});
