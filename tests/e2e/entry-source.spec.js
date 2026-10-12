import { devices, expect, test } from "@playwright/test";

import { loadEntriesPage, postJson, reseedDemo } from "./helpers";

// Added by (DOMAIN.md): an entry the Apple Pay Shortcut or Ask saved says so.
// - The Entries page DTO carries `addedBy` ("apple_pay_shortcut" | "ask")
//   derived on the server, never the Shortcut request id or Ask card id.
// - The Edit entry and Ask saved cards name the tool in the bank state chip
//   while provisional ("Apple Pay · provisional", "Ask · provisional"), and
//   "Statement certified" once a statement certifies it.
// - More details adds a read-only "Added by" row, only when known.
// - An Entries row shows a small muted glyph beside its amount ("Added with
//   Apple Pay", "Added in Ask") without changing the row's height, also
//   with money hidden.
//
// Tagged @webkit: `npm run test:e2e:webkit` runs the phone cases in WebKit.

const MONTH = "2026-05";
const SHORTCUT_TOKEN = "mm_e2e_key";
const { defaultBrowserType: _browser, ...iPhone13 } = devices["iPhone 13"];

async function enableShortcut(page) {
  const settings = await (await page.request.get("/api/settings-page?view=household")).json();
  const activeIds = settings.settingsPage.accounts.filter((account) => account.isActive).map((account) => account.id);
  await postJson(page, "/api/settings/shortcuts/save", { apiKey: SHORTCUT_TOKEN, defaultAccountPriorityIds: activeIds });
}

async function createShortcutEntry(page, { accountName = "UOB One", description, date = `${MONTH}-23`, amount = "12.30" }) {
  const response = await page.request.post("/api/shortcuts/entries/create", {
    headers: { "X-Monies-Shortcut-Token": SHORTCUT_TOKEN },
    data: { amount, description, accountName, date, requestId: `e2e-shortcut-${Date.now()}-${Math.round(Math.random() * 1e6)}` }
  });
  const body = await response.json();
  expect(response.ok(), JSON.stringify(body)).toBeTruthy();
  return body.entryId;
}

async function createEntry(page, patch) {
  const { entryId } = await postJson(page, "/api/entries/create", {
    date: `${MONTH}-23`,
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 1_890,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim",
    ...patch
  });
  return entryId;
}

async function seedSources(page) {
  const stamp = Date.now();
  await enableShortcut(page);
  const shortcutId = await createShortcutEntry(page, { description: `Source shortcut ${stamp}` });
  const askReference = `ask:e2esource${stamp}`;
  const askId = await createEntry(page, { description: `Source ask ${stamp}`, externalReference: askReference });
  const manualId = await createEntry(page, { description: `Source manual ${stamp}` });
  return { shortcutId, askId, manualId, askReference };
}

async function openEditSheet(page, entryId) {
  await page.goto(`/entries?view=person-tim&month=${MONTH}&editing_entry=${entryId}`);
  const sheet = page.locator('.entry-mobile-sheet[aria-label="Edit entry"]');
  await expect(sheet).toBeVisible({ timeout: 60_000 });
  return sheet;
}

test.describe("entry source", { tag: "@webkit" }, () => {
  test.use(iPhone13);

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await reseedDemo(page);
  });

  test("the Entries page sends only the derived source, never the reference", async ({ page }) => {
    const { shortcutId, askId, manualId, askReference } = await seedSources(page);
    const response = await page.request.get(`/api/entries-page?view=person-tim&month=${MONTH}`);
    const text = await response.text();
    expect(text).not.toContain("shortcut:");
    expect(text).not.toContain(askReference);
    expect(text).not.toContain("externalReference");
    const entries = JSON.parse(text).monthPage.entries;
    const byId = Object.fromEntries(entries.map((entry) => [entry.id, entry]));
    expect(byId[shortcutId].addedBy).toBe("apple_pay_shortcut");
    expect(byId[askId].addedBy).toBe("ask");
    expect("addedBy" in byId[manualId]).toBe(false);
  });

  test("the edit sheet names the tool in the state chip and in an Added by row", async ({ page }) => {
    const { shortcutId, askId, manualId } = await seedSources(page);
    const cases = [
      { id: shortcutId, chip: "Apple Pay · provisional", addedBy: "Apple Pay shortcut", hint: "Date, wallet, posted date, type, added by" },
      { id: askId, chip: "Ask · provisional", addedBy: "Ask", hint: "Date, wallet, posted date, type, added by" },
      { id: manualId, chip: "Manual provisional", addedBy: null, hint: "Date, wallet, posted date, type" }
    ];
    for (const { id, chip, addedBy, hint } of cases) {
      const sheet = await openEditSheet(page, id);
      await expect(sheet.locator('.lsd-card [data-chip="state"]')).toHaveText(chip);
      // The folded row names what it holds, Added by included when known.
      await expect(sheet.locator(".lsd-row-more .lsd-row-hint")).toHaveText(hint);
      await sheet.getByRole("button", { name: /More details/ }).tap();
      const row = sheet.locator('[data-row="addedBy"]');
      if (addedBy) {
        await expect(row.locator(".lsd-row-label")).toHaveText("Added by");
        await expect(row.locator(".lsd-row-value")).toHaveText(addedBy);
        // Read-only: not a button, no chevron or lock, a tap opens nothing.
        expect(await row.evaluate((element) => element.tagName)).toBe("DIV");
        await expect(row.locator("svg")).toHaveCount(0);
        await row.tap();
        await expect(page.locator(".mobile-select-dialog")).toHaveCount(0);
      } else {
        await expect(row).toHaveCount(0);
      }
      await sheet.getByRole("button", { name: "Close", exact: true }).tap();
      await expect(sheet).toHaveCount(0);
    }
  });

  test("a certified Shortcut entry says Statement certified but keeps its Added by row", async ({ page }) => {
    await enableShortcut(page);
    const accountName = `Source Savings ${Date.now()}`;
    const { accountId } = await postJson(page, "/api/accounts/create", {
      name: accountName, institution: "Synthetic Test Bank", kind: "bank", openingBalanceMinor: 0, currency: "SGD", ownerPersonId: "", isJoint: false
    });
    const entryId = await createShortcutEntry(page, { accountName, description: "NTUC FAIRPRICE", date: `${MONTH}-21`, amount: "12.50" });
    const statementCheckpoints = [{
      accountId, accountName, detectedAccountName: accountName, checkpointMonth: MONTH,
      statementStartDate: `${MONTH}-01`, statementEndDate: `${MONTH}-31`, statementBalanceMinor: -1_250, note: "Source checkpoint"
    }];
    const preview = await postJson(page, "/api/imports/preview", {
      sourceLabel: "Source statement", sourceType: "pdf",
      rows: [{ date: `${MONTH}-21`, description: "NTUC FAIRPRICE", expense: "12.50", accountId, account: accountName, category: "Groceries" }],
      defaultAccountName: accountName, ownershipType: "direct", ownerName: "Tim", statementCheckpoints
    });
    const previewRows = preview.preview.previewRows;
    expect(previewRows.map((row) => row.reconciliationTargetTransactionId)).toEqual([entryId]);
    await postJson(page, "/api/imports/commit", {
      sourceLabel: "Source statement", sourceType: "pdf", parserKey: "uob_savings_pdf",
      rows: previewRows.filter((row) => row.commitStatus === "included"),
      statementCheckpoints, statementControlRows: previewRows, statementReconciliations: preview.preview.statementReconciliations
    });
    const household = await loadEntriesPage(page, { view: "household", month: MONTH });
    expect(household.monthPage.entries.find((entry) => entry.id === entryId)).toMatchObject({
      bankCertificationStatus: "statement_certified", addedBy: "apple_pay_shortcut"
    });

    const sheet = await openEditSheet(page, entryId);
    await expect(sheet.locator('.lsd-card [data-chip="state"]')).toHaveText("Statement certified");
    await expect(sheet.locator(".lsd-row-more .lsd-row-hint")).toHaveText("Posted date, type, added by");
    await sheet.getByRole("button", { name: /More details/ }).tap();
    await expect(sheet.locator('[data-row="addedBy"] .lsd-row-value')).toHaveText("Apple Pay shortcut");
  });

  test("Entries rows carry a small glyph beside the amount, the same height, with money shown or hidden", async ({ page }) => {
    const { shortcutId, askId, manualId } = await seedSources(page);
    for (const hidden of [false, true]) {
      // Init scripts run in order, so this one decides.
      await page.addInitScript((value) => window.localStorage.setItem("monies-map:money-totals-visible", value), hidden ? "false" : "true");
      await page.goto(`/entries?view=person-tim&month=${MONTH}`);
      const row = (id) => page.locator(`[id="${id}"] .entry-row-main`);
      await expect(row(manualId)).toBeVisible({ timeout: 60_000 });
      const applePay = row(shortcutId).getByRole("img", { name: "Added with Apple Pay" });
      const ask = row(askId).getByRole("img", { name: "Added in Ask" });
      await expect(applePay).toBeVisible();
      await expect(ask).toBeVisible();
      await expect(row(manualId).locator(".entry-row-source")).toHaveCount(0);
      // Beside the amount, inside its line, in muted ink.
      expect(await applePay.evaluate((glyph) => Boolean(glyph.closest(".entry-row-amount")))).toBe(true);
      const muted = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--muted").trim());
      expect(muted).not.toBe("");
      const [glyphColour, mutedColour] = await applePay.evaluate((glyph) => {
        const probe = document.createElement("span");
        probe.style.color = "var(--muted)";
        document.body.append(probe);
        const colours = [getComputedStyle(glyph).color, getComputedStyle(probe).color];
        probe.remove();
        return colours;
      });
      expect(glyphColour).toBe(mutedColour);
      const heights = await Promise.all([shortcutId, askId, manualId].map(async (id) => (await row(id).boundingBox()).height));
      expect(Math.abs(heights[0] - heights[2])).toBeLessThan(0.5);
      expect(Math.abs(heights[1] - heights[2])).toBeLessThan(0.5);
      const amountText = await row(shortcutId).locator(".entry-row-amount strong").innerText();
      if (hidden) {
        expect(amountText).not.toMatch(/\d/);
      } else {
        expect(amountText).toContain("12.30");
      }
    }
  });

  test("Ask's saved cards name the tool: Ask · provisional, Apple Pay · provisional", async ({ page }) => {
    await page.goto(`/entries?view=person-tim&month=${MONTH}`);
    await page.locator(".entries-fab:not(.splits-fab)").tap();
    const draft = page.locator('[data-ask-card="draft"]');
    await expect(draft).toBeVisible({ timeout: 60_000 });
    await expect(draft.locator('[data-chip="state"]')).toHaveCount(0);
    await page.getByRole("textbox", { name: "Amount" }).fill("4.20");
    await page.getByRole("textbox", { name: "What it was" }).fill(`Source saved ${Date.now()}`);
    await page.getByRole("button", { name: "Save", exact: true }).tap();
    const saved = page.locator('[data-ask-card="saved"]');
    await expect(saved).toBeVisible();
    await expect(saved.locator('[data-chip="state"]')).toHaveText("Ask · provisional");
    // A saved card is not edited from its chips.
    await expect(saved.locator(".lsd-chip-hit")).toHaveCount(0);

    await enableShortcut(page);
    const shortcutId = await createShortcutEntry(page, { description: `Source opened ${Date.now()}` });
    await page.goto(`/ask?view=person-tim&month=${MONTH}&saved_entry=${shortcutId}&from=shortcut`);
    const shortcutCard = page.locator('[data-ask-card="saved"]');
    await expect(shortcutCard).toBeVisible({ timeout: 60_000 });
    await expect(shortcutCard.locator('[data-chip="state"]')).toHaveText("Apple Pay · provisional");
  });
});
