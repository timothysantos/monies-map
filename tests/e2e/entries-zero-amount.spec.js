import { expect, test } from "@playwright/test";

import { loadEntriesPage, postJson, reseedDemo } from "./helpers";

// Saving an entry edit with a cleared or unreadable amount is refused: the
// editor stays open with the person's changes and shows why, and the stored
// entry is untouched. A readable amount then saves as usual.

const month = "2026-05";

async function createGroceries(page, description) {
  const { entryId } = await postJson(page, "/api/entries/create", {
    date: "2026-05-24",
    description,
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 4_250,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });
  return entryId;
}

// Desktop edits the row inline; the phone layout edits it in the Edit entry
// sheet. Both open from a tap on the row and show save errors as an alert.
const layouts = [
  {
    name: "desktop inline editor",
    size: { width: 1280, height: 900 },
    editor: (page) => page.locator(".entry-inline-editor"),
    save: (editor) => editor.getByRole("button", { name: "Done editing entry" })
  },
  {
    name: "mobile edit sheet",
    size: { width: 390, height: 844 },
    editor: (page) => page.getByRole("dialog", { name: "Edit entry" }),
    save: (editor) => editor.getByRole("button", { name: "Save", exact: true })
  }
];

async function openEditor(page, layout, description) {
  await page.goto(`/entries?view=person-tim&month=${month}`);
  const row = page.locator(".entry-row").filter({ hasText: description });
  await expect(row).toHaveCount(1, { timeout: 60_000 });
  await row.locator(".entry-row-main").click();
  const editor = layout.editor(page);
  await expect(editor).toHaveCount(1);
  return editor;
}

async function savedEntry(page, entryId) {
  const payload = await loadEntriesPage(page, { view: "person-tim", month });
  return payload.monthPage.entries.find((entry) => entry.id === entryId);
}

async function saveAndWait(page, layout, editor) {
  const update = page.waitForResponse((response) => response.url().includes("/api/entries/update"));
  await layout.save(editor).click();
  return update;
}

for (const layout of layouts) {
  test(`${layout.name}: a cleared or unreadable amount is refused on save and the draft is kept`, async ({ page }) => {
    await page.setViewportSize(layout.size);
    await page.goto("/");
    await reseedDemo(page);
    const description = `Zero amount guard ${layout.name}`;
    const entryId = await createGroceries(page, description);
    const editor = await openEditor(page, layout, description);

    const descriptionField = editor.getByRole("textbox", { name: "Description" });
    const amount = editor.getByRole("textbox", { name: "Amount" });
    await descriptionField.fill(`${description} renamed`);

    for (const amountText of ["", "abc"]) {
      await amount.fill(amountText);
      expect((await saveAndWait(page, layout, editor)).status()).toBe(400);
      await expect(editor.getByRole("alert")).toHaveText("Amount must be greater than zero");
      // Still open with the person's changes; the amount field reads as 0.
      await expect(editor).toHaveCount(1);
      await expect(amount).toHaveValue("0");
      await expect(descriptionField).toHaveValue(`${description} renamed`);
    }

    const stored = await savedEntry(page, entryId);
    expect({ description: stored.description, amountMinor: stored.amountMinor }).toEqual({ description, amountMinor: 4_250 });

    // A readable amount saves the whole draft and closes the editor.
    await amount.fill("31");
    expect((await saveAndWait(page, layout, editor)).ok()).toBe(true);
    await expect(editor).toHaveCount(0);
    const saved = await savedEntry(page, entryId);
    expect({ description: saved.description, amountMinor: saved.amountMinor }).toEqual({ description: `${description} renamed`, amountMinor: 3_100 });
  });
}
