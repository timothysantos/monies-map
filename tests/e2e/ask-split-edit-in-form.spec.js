import { expect, test } from "@playwright/test";

import { loadReferenceData, loadSplitsPage, reseedDemo } from "./helpers";

// Ask's "Edit in form" from the Splits receipt button (docs/flows/ask-flow.md
// "Edit in form", docs/flows/splits-flow.md): New split expense opens for the
// group, filled in with what the card drafted, unsaved; Save creates the
// split with those values, Cancel saves nothing, and a card with no amount
// opens the form with the amount empty and focused. On a desktop (dialog)
// and a phone (sheet). The values travel in history state, never the URL.

const SCREENS = [
  { name: "desktop 1280x800", phone: false, viewport: { width: 1280, height: 800 } },
  { name: "phone 390x844", phone: true, viewport: { width: 390, height: 844 } }
];
const GROUP_ID = "split-group-baby-river";
const ASK_URL = `/ask?view=person-tim&month=2025-10&mode=expense&from=splits&split_group=${GROUP_ID}`;

// The typed sentence is read by the rules (the turn route says AI is off)
// and the entry reader, mocked here: a shared $86.40 dinner on Joyce's Citi
// card, Tim's share 30%.
async function mockReaders(page, { description, accountId }) {
  await page.route("**/api/ask/turn", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, mode: "rules", reason: "ai_off" }) }));
  await page.route("**/api/ai-assist/entry-draft", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      draft: {
        fields: {
          date: { value: "2025-10-14", source: "sentence" },
          description: { value: description, source: "sentence" },
          accountId: { value: accountId, source: "sentence" },
          categoryName: { value: "Food & Drinks", source: "rule" },
          amountMinor: { value: 8640, source: "sentence" },
          entryType: { value: "expense", source: "default" },
          ownershipType: { value: "shared", source: "sentence" },
          splitBasisPoints: { value: 3000, source: "sentence" }
        },
        missing: [],
        questions: []
      },
      ai: { requested: false, available: false }
    })
  }));
}

async function draftOnAsk(page, { description, accountId }) {
  await mockReaders(page, { description, accountId });
  await page.goto(ASK_URL);
  await expect(page.locator('[data-ask-card="draft"]')).toBeVisible({ timeout: 60_000 });
  await page.getByRole("textbox", { name: "Message" }).fill("Dinner 86.40 on Citi, I pay 30%");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("textbox", { name: "What it was" })).toHaveValue(description);
  await page.getByRole("button", { name: "Add a note" }).click();
  await page.getByRole("textbox", { name: "Note", exact: true }).fill("Birthday dinner");
  await expect(page.getByRole("button", { name: "Change owner, Shared" })).toBeVisible();
}

async function openMoreDetails(dialog, phone) {
  if (phone) {
    await dialog.getByRole("button", { name: /More details/ }).click();
  }
}

for (const screen of SCREENS) {
  test.describe(`Ask Edit in form for a split, ${screen.name}`, () => {
    test.use({ viewport: screen.viewport, hasTouch: screen.phone });

    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
      await page.goto("/");
      await reseedDemo(page);
    });

    test("New split expense shows the card's values, unsaved, and Save creates the split with them", async ({ page }) => {
      const { accounts } = await loadReferenceData(page);
      const citi = accounts.find((account) => account.name === "Citi Rewards");
      const description = `Ask form dinner ${Date.now()}`;
      await draftOnAsk(page, { description, accountId: citi.id });

      await page.getByRole("button", { name: "Edit in form" }).click();
      const dialog = page.getByRole("dialog", { name: "New split expense" });
      await expect(dialog).toBeVisible({ timeout: 60_000 });
      await expect(page).toHaveURL(/\/splits\?/);
      await expect(page).not.toHaveURL(/split_action/);
      // Nothing personal rides in the link.
      expect(page.url()).not.toContain("86");
      expect(page.url()).not.toContain("Ask%20form");

      await expect(dialog.locator(".split-expense-card-head")).toContainText("Baby River");
      await expect(dialog.getByRole("textbox", { name: "Description" })).toHaveValue(description);
      await expect(dialog.getByRole("textbox", { name: "Expense total" })).toHaveValue(/^86\.40$/);
      await expect(dialog.getByRole("button", { name: "Change paid by, Joyce" })).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Change paid using, Card" })).toBeVisible();
      await expect(dialog.getByRole("button", { name: /Change shares, 30 \/ 70/ })).toBeVisible();
      await expect(dialog.getByRole("group", { name: "Split share amounts" }).locator(".lsd-row")).toHaveText(["Tim’s share30% · $25.92", "Joyce’s share70% · $60.48"]);
      await expect(dialog.locator("[data-row='category']")).toContainText("Food & Drinks");
      await openMoreDetails(dialog, screen.phone);
      await expect(dialog.getByLabel("Currency")).toHaveValue("SGD");
      await expect(dialog.getByRole("textbox", { name: "Note", exact: true })).toHaveValue("Birthday dinner");

      // Unsaved: no split exists until Save.
      const before = await loadSplitsPage(page, { view: "person-tim", month: "2025-10" });
      expect(before.splitsPage.activity.some((item) => item.description === description)).toBe(false);

      const create = page.waitForRequest((request) => request.url().includes("/api/splits/expenses/create"));
      await dialog.getByRole("button", { name: "Save expense" }).click();
      expect((await create).postDataJSON()).toEqual({
        groupId: GROUP_ID,
        date: "2025-10-14",
        description,
        categoryName: "Food & Drinks",
        payerPersonName: "Joyce",
        amountMinor: 8640,
        note: "Birthday dinner",
        splitBasisPoints: 3000,
        splitAmountMinor: 2592,
        currency: "SGD",
        paymentMethod: "card",
        paymentStatus: "recorded"
      });
      await expect(dialog).toHaveCount(0);
      await expect.poll(async () => {
        const after = await loadSplitsPage(page, { view: "person-tim", month: "2025-10" });
        const saved = after.splitsPage.activity.find((item) => item.kind === "expense" && item.description === description);
        return saved && { groupId: saved.groupId, totalAmountMinor: saved.totalAmountMinor, paidByPersonName: saved.paidByPersonName, categoryName: saved.categoryName, note: saved.note };
      }).toEqual({ groupId: GROUP_ID, totalAmountMinor: 8640, paidByPersonName: "Joyce", categoryName: "Food & Drinks", note: "Birthday dinner" });
    });

    test("negative: Cancel saves nothing and the form does not open again", async ({ page }) => {
      const { accounts } = await loadReferenceData(page);
      const citi = accounts.find((account) => account.name === "Citi Rewards");
      const description = `Ask form cancel ${Date.now()}`;
      await draftOnAsk(page, { description, accountId: citi.id });
      let created = false;
      page.on("request", (request) => {
        if (request.url().includes("/api/splits/expenses/create") || request.url().includes("/api/entries/create")) created = true;
      });

      await page.getByRole("button", { name: "Edit in form" }).click();
      const dialog = page.getByRole("dialog", { name: "New split expense" });
      await expect(dialog.getByRole("textbox", { name: "Description" })).toHaveValue(description, { timeout: 60_000 });
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toHaveCount(0);
      await page.reload();
      await expect(page.locator("article.panel-splits")).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(300);
      await expect(dialog).toHaveCount(0);
      expect(created).toBe(false);
      const after = await loadSplitsPage(page, { view: "person-tim", month: "2025-10" });
      expect(after.splitsPage.activity.some((item) => item.description === description)).toBe(false);
    });

    test("a card with no amount opens the form with the amount empty and focused", async ({ page }) => {
      await page.route("**/api/ask/turn", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, mode: "rules", reason: "ai_off" }) }));
      const description = `Ask form no amount ${Date.now()}`;
      await page.goto(ASK_URL);
      await expect(page.locator('[data-ask-card="draft"]')).toBeVisible({ timeout: 60_000 });
      await page.getByRole("textbox", { name: "What it was" }).fill(description);
      await page.getByRole("button", { name: "Edit in form" }).click();

      const dialog = page.getByRole("dialog", { name: "New split expense" });
      await expect(dialog.getByRole("textbox", { name: "Description" })).toHaveValue(description, { timeout: 60_000 });
      const total = dialog.getByRole("textbox", { name: "Expense total" });
      await expect(total).toBeFocused();
      await expect(dialog.locator(".lsd-amount-field")).toHaveClass(/is-empty/);
      // Save checks it exactly as a form filled by hand does.
      await dialog.getByRole("button", { name: "Save expense" }).click();
      await expect(dialog.getByText("Expense amount must be greater than zero.")).toBeVisible();
    });
  });
}
