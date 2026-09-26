import { expect, test } from "@playwright/test";

import { postJson, reseedDemo } from "./helpers";

const month = "2026-05";

async function createEntry(page, description) {
  const entry = await postJson(page, "/api/entries/create", {
    date: `${month}-22`,
    description,
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 6000,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });
  return entry.entryId;
}

// Holds Entries page responses once armed, so a test can decide when the
// refresh after a save lands.
function holdEntriesPageResponses(page) {
  let armed = false;
  let release;
  const released = new Promise((resolve) => {
    release = resolve;
  });
  let heldRequest;
  const requestHeld = new Promise((resolve) => {
    heldRequest = resolve;
  });
  const ready = page.route("**/api/entries-page?**", async (route) => {
    if (!armed) {
      await route.continue();
      return;
    }
    heldRequest();
    await released;
    await route.continue();
  });
  return {
    ready,
    arm: () => {
      armed = true;
    },
    requestHeld,
    release: () => release()
  };
}

test("saving an entry opened from a deep link closes the editor and does not reopen it after the refresh", async ({ page }) => {
  const description = `Deep link save ${Date.now()}`;

  await page.goto("/");
  await reseedDemo(page);
  const entryId = await createEntry(page, description);
  const hold = holdEntriesPageResponses(page);
  await hold.ready;

  await page.goto(`/entries?view=household&month=${month}&entries_scope=direct_plus_shared&editing_entry=${entryId}`);
  const editor = page.locator(".entry-inline-editor");
  await expect(editor).toHaveCount(1, { timeout: 60_000 });
  await editor.getByRole("textbox", { name: "Description" }).fill(`${description} saved`);

  hold.arm();
  const entryUpdate = page.waitForResponse((response) => response.url().includes("/api/entries/update") && response.ok());
  await editor.getByRole("button", { name: "Done editing entry" }).click();
  await entryUpdate;
  await hold.requestHeld;

  // The editor closes on save while the refresh is still out.
  await expect(editor).toHaveCount(0);
  const refreshed = page.waitForResponse((response) => response.url().includes("/api/entries-page?"));
  hold.release();
  await refreshed;

  // The refreshed row shows the saved text and the link no longer asks for
  // the editor, so nothing reopens it.
  const savedRow = page.locator(".entry-row").filter({ hasText: `${description} saved` }).first();
  await expect(savedRow).not.toContainText("Updating");
  await expect(page).not.toHaveURL(/editing_entry=/);
  await expect(editor).toHaveCount(0);
  // A later render must not bring it back either.
  await page.waitForTimeout(500);
  await expect(editor).toHaveCount(0);
});

test("saving after Add to splits wrote the entry into the link closes the editor and does not reopen it", async ({ page }) => {
  const description = `Link after add to splits ${Date.now()}`;

  await page.goto("/");
  await reseedDemo(page);
  await createEntry(page, description);
  const hold = holdEntriesPageResponses(page);
  await hold.ready;

  await page.goto(`/entries?view=household&month=${month}&entries_scope=direct_plus_shared`);
  const row = page.locator(".entry-row").filter({ hasText: description }).first();
  await expect(row).toBeVisible({ timeout: 60_000 });
  await expect(page).not.toHaveURL(/editing_entry=/);
  await row.click();
  const editor = page.locator(".entry-inline-editor");
  await expect(editor).toHaveCount(1);

  // Adding to splits keeps the editor open and writes its entry into the URL.
  const splitResponse = page.waitForResponse((response) => response.url().includes("/api/splits/expenses/from-entry") && response.ok());
  await editor.getByRole("button", { name: "Add to splits" }).click();
  const groupPicker = page.getByRole("dialog", { name: "Add to splits" });
  try {
    await expect(groupPicker).toBeVisible({ timeout: 1000 });
    await groupPicker.locator("select").selectOption({ label: "Non-group expenses" });
  } catch {
    // Single-group split workspaces post immediately without opening the picker.
  }
  await splitResponse;
  await expect(editor.getByRole("button", { name: "View split" })).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/editing_entry=/);
  await expect(editor).toHaveCount(1);

  await editor.getByRole("textbox", { name: "Description" }).fill(`${description} saved`);
  hold.arm();
  const entryUpdate = page.waitForResponse((response) => response.url().includes("/api/entries/update") && response.ok());
  await editor.getByRole("button", { name: "Done editing entry" }).click();
  await entryUpdate;
  await hold.requestHeld;

  await expect(editor).toHaveCount(0);
  const refreshed = page.waitForResponse((response) => response.url().includes("/api/entries-page?"));
  hold.release();
  await refreshed;

  const savedRow = page.locator(".entry-row").filter({ hasText: `${description} saved` }).first();
  await expect(savedRow).not.toContainText("Updating");
  await expect(page).not.toHaveURL(/editing_entry=/);
  await expect(editor).toHaveCount(0);
  await page.waitForTimeout(500);
  await expect(editor).toHaveCount(0);
});
