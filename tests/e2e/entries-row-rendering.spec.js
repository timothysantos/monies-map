import { expect, test } from "@playwright/test";

import { installReactCommitCounter } from "../support/react-commit-counter.js";
import { gotoPageAfterApi, reseedDemo } from "./helpers";

// Entries rows are memoized: a draft, an editor opening or a filter change
// re-renders only the rows it changes, so a 2,000-row month stays usable.
// Row renders are counted through the React DevTools hook
// (tests/support/react-commit-counter.js), keyed by each row's element id.

const ENTRIES_URL = "/entries?view=household&month=2026-05";

async function openEntries(page) {
  await page.addInitScript(installReactCommitCounter);
  await reseedDemo(page);
  await gotoPageAfterApi(page, ENTRIES_URL, "/api/entries-page", () => page.locator(".entry-row").nth(4));
  await page.evaluate(() => window.__reactCommitCounter.trackRows(["entry-row", "entry-row-amount"]));
}

async function countRowRenders(page, action) {
  await page.evaluate(() => {
    window.__reactCommitCounter.reset();
    window.__reactCommitCounter.enabled = true;
  });
  await action();
  // Let effects and any follow-up commits land before reading.
  await page.waitForTimeout(250);
  return page.evaluate(() => {
    window.__reactCommitCounter.enabled = false;
    const { commits, rowIds, rowRenders } = window.__reactCommitCounter.read();
    return { commits, rowIds: rowIds["entry-row"] ?? [], amountRenders: rowRenders["entry-row-amount"] ?? 0 };
  });
}

const rowIds = (page) => page.locator(".entry-row").evaluateAll((rows) => rows.map((row) => row.id));

test("opening one entry and typing a draft re-renders only that row", async ({ page }) => {
  await openEntries(page);
  const ids = await rowIds(page);
  expect(ids.length).toBeGreaterThan(5);
  const targetId = ids[2];
  const target = page.locator(`[id="${targetId}"]`);

  const opened = await countRowRenders(page, async () => {
    await target.locator(".entry-row-main").click();
    await expect(target.locator(".entry-inline-editor")).toBeVisible();
  });
  expect(opened.commits).toBeGreaterThan(0);
  expect(opened.rowIds.length).toBeGreaterThan(0);
  expect([...new Set(opened.rowIds)]).toEqual([targetId]);

  const note = target.locator(".entry-inline-editor textarea").nth(1);
  await note.click();
  await note.press("End");
  const before = await note.inputValue();
  const typed = await countRowRenders(page, async () => {
    await page.keyboard.type("x");
    await expect(note).toHaveValue(`${before}x`);
  });
  expect(typed.rowIds.length).toBeGreaterThan(0);
  expect([...new Set(typed.rowIds)]).toEqual([targetId]);

  // Negative: cancelling restores the saved row without touching the others.
  const cancelled = await countRowRenders(page, async () => {
    await page.getByRole("button", { name: "Cancel editing entry" }).click();
    await expect(target.locator(".entry-inline-editor")).toHaveCount(0);
  });
  expect([...new Set(cancelled.rowIds)]).toEqual([targetId]);
  await expect(page.locator(".entry-row")).toHaveCount(ids.length);
});

test("a filter change keeps the open draft, its focus and caret, and re-renders only rows it adds", async ({ page }) => {
  await openEntries(page);
  const allIds = await rowIds(page);
  // Push a type filter onto history so Back and Forward change it while the
  // editor stays open (history navigation is not an outside click).
  await page.locator(".entries-filter-bar select").first().selectOption("expense");
  await expect.poll(() => page.url()).toContain("entry_type=expense");
  await expect.poll(async () => (await rowIds(page)).length).toBeLessThan(allIds.length);
  const expenseIds = await rowIds(page);
  const targetId = expenseIds[1];
  const target = page.locator(`[id="${targetId}"]`);

  await target.locator(".entry-row-main").click();
  const note = target.locator(".entry-inline-editor textarea").nth(1);
  await note.click();
  await note.press("End");
  await page.keyboard.type(" draft kept");
  const draft = await note.inputValue();
  expect(draft.endsWith(" draft kept")).toBe(true);

  const widened = await countRowRenders(page, async () => {
    await page.goBack();
    await expect.poll(() => page.url()).not.toContain("entry_type=expense");
    await expect(page.locator(".entry-row")).toHaveCount(allIds.length);
  });
  // Rows already on screen do not re-render; only newly shown rows mount.
  const rerenderedExisting = widened.rowIds.filter((id) => expenseIds.includes(id) && id !== targetId);
  expect(rerenderedExisting).toEqual([]);
  expect(widened.rowIds.some((id) => !expenseIds.includes(id))).toBe(true);

  await expect(note).toBeFocused();
  await expect(note).toHaveValue(draft);
  expect(await note.evaluate((element) => [element.selectionStart, element.selectionEnd])).toEqual([draft.length, draft.length]);

  // Narrowing again keeps the pinned editing row and its draft.
  await page.goForward();
  await expect.poll(() => page.url()).toContain("entry_type=expense");
  await expect(page.locator(".entry-row")).toHaveCount(expenseIds.length);
  await expect(note).toBeFocused();
  await page.keyboard.type("!");
  await expect(note).toHaveValue(`${draft}!`);
});

test("the privacy toggle redraws every row amount without re-rendering the rows", async ({ page }) => {
  await openEntries(page);
  const amounts = page.locator(".entry-row .entry-row-amount strong");
  const count = await amounts.count();
  await expect(amounts.first()).toHaveText("••••");
  expect(await amounts.evaluateAll((items) => items.every((item) => item.textContent === "••••"))).toBe(true);

  const shown = await countRowRenders(page, async () => {
    await page.getByRole("button", { name: "Show money totals" }).first().click();
    await expect.poll(() => amounts.evaluateAll((items) => items.filter((item) => item.textContent.includes("$")).length)).toBe(count);
  });
  expect(shown.rowIds).toEqual([]);
  expect(shown.amountRenders).toBe(count);

  await page.getByRole("button", { name: "Hide money totals" }).first().click();
  await expect.poll(() => amounts.evaluateAll((items) => items.filter((item) => item.textContent === "••••").length)).toBe(count);
});

test("a row's category dialog opens only on demand and closes without opening the row", async ({ page }) => {
  await openEntries(page);
  const row = page.locator(".entry-row").nth(1);
  const trigger = row.locator(".category-icon-button");
  const categoryName = (await trigger.getAttribute("aria-label")).replace(/^Edit /, "");
  await expect(page.locator(".settings-category-dialog")).toHaveCount(0);

  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("input").first()).toHaveValue(categoryName);
  // The icon opens the category dialog, not the row editor.
  await expect(row.locator(".entry-inline-editor")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(page.locator(".settings-category-dialog")).toHaveCount(0);
  await expect(row.locator(".entry-inline-editor")).toHaveCount(0);
});
