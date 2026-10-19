import { devices, expect, test } from "@playwright/test";

import { postJson, reseedDemo } from "./helpers";

// Ask's habits (docs/flows/ask-flow.md "Hands-off"), in a real browser on a
// real local Worker. Habits are counted from commands the household runs;
// Ask shows one quiet suggestion row, applies only the safe set by itself
// (when the setting is on and the entry is new), lists everything in Done
// for you with Undo, and Settings shows and edits what Ask remembers. No AI
// is involved.

const iPhone = devices["iPhone 12 Pro"].viewport;
const MONTH = "2026-04";
const TOKEN = "mm_e2e_habits_key";
const SHOTS = process.env.HANDSOFF_SHOT_DIR ?? "";

async function shot(page, name) {
  if (SHOTS) {
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOTS}/${name}.png` });
  }
}

async function enableShortcut(page) {
  const settings = await (await page.request.get("/api/settings-page?view=household")).json();
  const activeIds = settings.settingsPage.accounts.filter((account) => account.isActive).map((account) => account.id);
  await postJson(page, "/api/settings/shortcuts/save", { apiKey: TOKEN, defaultAccountPriorityIds: activeIds });
}

async function applePayEntry(page, description) {
  const response = await page.request.post("/api/shortcuts/entries/create", {
    headers: { "X-Monies-Shortcut-Token": TOKEN },
    data: { amount: "12.30", description, accountName: "UOB One", date: `${MONTH}-23`, requestId: `e2e-habits-${Date.now()}-${Math.round(Math.random() * 1e6)}` }
  });
  const body = await response.json();
  expect(response.ok(), JSON.stringify(body)).toBeTruthy();
  return body.entryId;
}

// The shop's habits through the real commands: `times` new entries in Food &
// Drinks (category confirmations), each added to Splits (split confirmations).
async function teachShop(page, shop, times) {
  for (let index = 0; index < times; index += 1) {
    const created = await postJson(page, "/api/entries/create", {
      date: `${MONTH}-1${index}`, description: `${shop} ${91_000_000 + index}`, accountName: "UOB One", categoryName: "Food & Drinks",
      amountMinor: 1_200, entryType: "expense", ownershipType: "direct", ownerName: "Tim"
    });
    await postJson(page, "/api/splits/expenses/from-entry", { entryId: created.entryId, splitGroupId: null, splitBasisPoints: 5000 });
  }
}

async function openAskOn(page, entryId) {
  await page.goto(`/ask?saved_entry=${entryId}&month=${MONTH}&view=person-tim&from=shortcut`);
  await expect(page.locator('[data-ask-card="saved"]')).toBeVisible({ timeout: 60_000 });
}

async function entryOnSplits(page, entryId) {
  const response = await page.request.get(`/api/entries-page?view=person-tim&month=${MONTH}`);
  const body = await response.json();
  const entry = body.monthPage.entries.find((item) => item.id === entryId);
  return { onSplits: Boolean(entry?.linkedSplitExpenseId), category: entry?.categoryName };
}

for (const [name, viewport] of [["phone", iPhone], ["desktop", { width: 1280, height: 900 }]]) {
  test.describe(`hands-off Ask on a ${name}`, () => {
    test.use({ viewport });

    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
      await page.goto("/");
      await reseedDemo(page);
      await enableShortcut(page);
    });

    test("an Apple Pay entry: one suggestion row, the tick applies it, the next is done for you, Undo puts it back", async ({ page }) => {
      const shop = `Habit Cafe ${Date.now()}`;
      // Two confirmations: Ask suggests, it does not act by itself yet.
      await teachShop(page, shop, 2);
      const first = await applePayEntry(page, shop.toUpperCase());
      expect(await entryOnSplits(page, first)).toEqual({ onSplits: false, category: "Other" });

      await openAskOn(page, first);
      const row = page.locator("[data-ask-habit-suggestion]");
      await expect(row).toBeVisible();
      await expect(row).toContainText("Food & Drinks · Add to splits half each with Joyce, as you usually do");
      await expect(page.locator("[data-ask-done-inline]")).toHaveCount(0);
      await shot(page, `suggestion-row-${name}`);

      // The tick runs the existing commands.
      await row.getByRole("button", { name: "Do this" }).click();
      await expect(row).toHaveCount(0);
      await expect.poll(() => entryOnSplits(page, first)).toEqual({ onSplits: true, category: "Food & Drinks" });

      // That was the third confirmation: the next entry is done for you at once.
      const second = await applePayEntry(page, shop.toUpperCase());
      expect(await entryOnSplits(page, second)).toEqual({ onSplits: true, category: "Food & Drinks" });
      await openAskOn(page, second);
      const inline = page.locator("[data-ask-done-inline]");
      await expect(inline).toBeVisible();
      await expect(inline).toContainText("Category set to Food & Drinks");
      await expect(inline).toContainText("Added to splits half each with Joyce");
      await expect(page.locator("[data-ask-habit-suggestion]")).toHaveCount(0);
      await shot(page, `done-inline-${name}`);

      // The list under the conversation: what, which entry, when, Undo.
      const list = page.locator("[data-ask-done-list]");
      await list.getByRole("button", { name: /Done for you/ }).click();
      await expect(list.locator('[data-done-kind="category"]')).toContainText(shop.toUpperCase());
      await expect(list.locator('[data-done-kind="split"]')).toContainText("Added to splits half each with Joyce");
      await list.scrollIntoViewIfNeeded();
      await shot(page, `done-list-${name}`);

      // Undo the split, then the category.
      await inline.getByRole("button", { name: "Undo" }).first().click();
      await expect.poll(async () => (await entryOnSplits(page, second)).onSplits || (await entryOnSplits(page, second)).category).not.toBe(true);
      await expect.poll(async () => {
        const state = await entryOnSplits(page, second);
        return `${state.onSplits}|${state.category}`;
      }).toMatch(/^(false\|Food & Drinks|true\|Other)$/);
      await expect(list.locator(".ask-done-item.is-undone")).toHaveCount(1);
      await inline.getByRole("button", { name: "Undo" }).click();
      await expect.poll(() => entryOnSplits(page, second)).toEqual({ onSplits: false, category: "Other" });
      await expect(list.locator(".ask-done-item.is-undone")).toHaveCount(2);
      await expect(page.locator("[data-ask-done-inline]")).toHaveCount(0);
      await shot(page, `after-undo-${name}`);

      // Undo counted against the habit: the next entry is not handled.
      const third = await applePayEntry(page, shop.toUpperCase());
      expect(await entryOnSplits(page, third)).toEqual({ onSplits: false, category: "Other" });
    });

    test("with the setting off nothing is done by itself, and the cross declines a suggestion", async ({ page }) => {
      const shop = `Setting Cafe ${Date.now()}`;
      await teachShop(page, shop, 3);
      await postJson(page, "/api/ask/habits/setting", { enabled: false });
      const entryId = await applePayEntry(page, shop.toUpperCase());
      expect(await entryOnSplits(page, entryId)).toEqual({ onSplits: false, category: "Other" });

      await openAskOn(page, entryId);
      const row = page.locator("[data-ask-habit-suggestion]");
      await expect(row).toBeVisible();
      await expect(page.locator("[data-ask-done-list]")).toHaveCount(0);
      await row.getByRole("button", { name: "Not this time" }).click();
      await expect(row).toHaveCount(0);
      // Nothing changed, and the habit starts again from nothing.
      expect(await entryOnSplits(page, entryId)).toEqual({ onSplits: false, category: "Other" });
      const habits = await (await page.request.get("/api/ask/habits")).json();
      expect(habits.habits.filter((habit) => habit.label.toLowerCase().startsWith("setting cafe")).every((habit) => habit.sure === false)).toBe(true);
    });
  });
}

test.describe("Settings: What Ask remembers", () => {
  test.use({ viewport: iPhone });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.goto("/");
    await reseedDemo(page);
  });

  test("the switch, a habit changed and forgotten, and Forget everything with an in-app confirm", async ({ page }) => {
    const shop = "Remember Cafe";
    await teachShop(page, shop, 3);
    const label = shop.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
    await page.goto("/settings");
    const section = page.locator("#settings-ask-remembers");
    await expect(section).toBeVisible({ timeout: 60_000 });
    await section.getByRole("button", { name: /What Ask remembers/ }).click();

    const toggle = section.getByRole("switch", { name: "Let Ask handle safe things" });
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect.poll(async () => (await (await page.request.get("/api/ask/habits")).json()).enabled).toBe(false);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");

    const categoryRow = section.locator(`[data-habit-id="category:${shop.toLowerCase()}"]`);
    await expect(categoryRow).toContainText("Food & Drinks");
    await expect(categoryRow).toContainText("Ask does this by itself");
    await expect(section.locator(`[data-habit-id="split:${shop.toLowerCase()}"]`)).toContainText("Add to splits half each with Joyce");
    await section.scrollIntoViewIfNeeded();
    await shot(page, "settings-section-phone");

    // Change the category: the dialog is the app's own sheet.
    await categoryRow.getByRole("button", { name: `Change what Ask does for ${label}` }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await shot(page, "settings-edit-phone");
    await dialog.getByRole("button", { name: /Category/ }).click();
    await page.getByRole("dialog").last().getByText("Groceries", { exact: true }).click();
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(categoryRow).toContainText("Groceries");

    // Forget one habit: an in-app confirm, never a browser dialog.
    await categoryRow.getByRole("button", { name: `Forget this: ${label}` }).click();
    await page.getByRole("button", { name: "Forget this", exact: true }).click();
    await expect(categoryRow).toHaveCount(0);

    // Forget everything.
    await section.getByRole("button", { name: "Forget everything" }).click();
    await expect(page.getByText("Forget everything Ask remembers?").first()).toBeVisible();
    await shot(page, "settings-forget-phone");
    await page.getByRole("dialog").getByRole("button", { name: "Forget everything" }).click();
    await expect(section.getByText("Nothing yet. Ask learns from the categories and splits you choose.")).toBeVisible();
    const habits = await (await page.request.get("/api/ask/habits")).json();
    expect(habits.habits).toEqual([]);
  });
});

test.describe("Settings: What Ask remembers on a computer", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("the section lists what Ask learned beside the switch", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.goto("/");
    await reseedDemo(page);
    await teachShop(page, "Desktop Cafe", 3);
    await page.goto("/settings");
    const section = page.locator("#settings-ask-remembers");
    await section.getByRole("button", { name: /What Ask remembers/ }).click();
    await expect(section.locator('[data-habit-id="category:desktop cafe"]')).toContainText("Food & Drinks");
    await section.scrollIntoViewIfNeeded();
    await shot(page, "settings-section-desktop");
  });
});
