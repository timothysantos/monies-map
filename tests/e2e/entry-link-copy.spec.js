import { expect, test } from "@playwright/test";

import { postJson, reseedDemo } from "./helpers";

// The entry editor's Copy link with a stand-in clipboard: one that takes the
// link and one the browser refuses. A refusal used to do nothing at all.
async function openEditor(page, { refuse }) {
  await page.addInitScript((shouldRefuse) => {
    const written = [];
    Object.defineProperty(window, "__copiedLinks", { value: written });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          if (shouldRefuse) throw new DOMException("Write permission denied.", "NotAllowedError");
          written.push(text);
        }
      }
    });
  }, refuse);
  await page.goto("/");
  await reseedDemo(page);
  const entry = await postJson(page, "/api/entries/create", {
    date: "2026-05-24",
    description: `Playwright copy link ${Date.now()}`,
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 2550,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });
  await page.goto(`/entries?view=person-tim&month=2026-05&editing_entry=${entry.entryId}`);
  const editor = page.locator(".entry-inline-editor").first();
  await expect(editor).toBeVisible();
  return { editor, entryId: entry.entryId };
}

test("Copy link says Link copied when the clipboard takes the link", async ({ page }) => {
  const { editor, entryId } = await openEditor(page, { refuse: false });
  await editor.getByRole("button", { name: "Copy link" }).click();
  await expect(editor.getByRole("button", { name: "Link copied" })).toBeVisible();
  const copied = await page.evaluate(() => window.__copiedLinks);
  expect(copied).toHaveLength(1);
  expect(copied[0]).toContain(entryId);
  await expect(editor.getByText("Couldn't copy.", { exact: false })).toHaveCount(0);
  await expect(editor.getByRole("button", { name: "Copy link" })).toBeVisible({ timeout: 5_000 });
});

test("Copy link says it couldn't copy and shows the link to copy by hand when the clipboard is refused", async ({ page }) => {
  const dialogs = [];
  page.on("dialog", (dialog) => { dialogs.push(dialog.message()); void dialog.dismiss(); });
  const { editor, entryId } = await openEditor(page, { refuse: true });
  await editor.getByRole("button", { name: "Copy link" }).click();
  await expect(editor.getByRole("status").filter({ hasText: "Couldn't copy. Select the link and copy it instead." })).toBeVisible();
  const field = editor.getByRole("textbox", { name: "Link to this entry" });
  await expect(field).toBeVisible();
  await expect(field).toHaveValue(new RegExp(entryId));
  await expect(field).toHaveJSProperty("readOnly", true);
  // The link is selected, ready for the person's own copy.
  const selected = await field.evaluate((node) => node.selectionEnd - node.selectionStart === node.value.length && document.activeElement === node);
  expect(selected).toBe(true);
  await expect(editor.getByRole("button", { name: "Link copied" })).toHaveCount(0);
  expect(dialogs).toEqual([]);
});
