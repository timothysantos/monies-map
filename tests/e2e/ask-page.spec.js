import { devices, expect, test } from "@playwright/test";
import path from "node:path";

import { gotoPageAfterApi, loadEntriesPage, loadReferenceData, loadSplitsPage, postJson, reseedDemo } from "./helpers";

// The Ask page on a phone (docs/flows/ask-flow.md): the Entries + and the
// Splits receipt buttons open its new entry card; a card filled by hand, by
// a typed sentence or by a receipt saves through the existing create route
// and shows up in Entries; the readers failing leaves the card manual; the
// chips after a save go where they say; the Apple Pay Shortcut's link opens
// the saved entry's card. The two readers (entry-draft, receipt-read) are
// stubbed: their routes are built on other branches.

const iPhone = devices["iPhone 12 Pro"].viewport;
const RECEIPT_FIXTURE = path.resolve("tests/fixtures/ask/sample-receipt.png");
const MONTH = "2026-04";

async function openAskAdd(page, { view = "person-tim", month = MONTH } = {}) {
  await gotoPageAfterApi(page, `/entries?view=${view}&month=${month}`, "/api/entries-page", () => page.locator(".entries-fab:not(.splits-fab)"));
  await page.locator(".entries-fab:not(.splits-fab)").click();
  await expect(page).toHaveURL(/\/ask\?.*mode=add/);
  await expect(page.locator('[data-ask-card="draft"]')).toBeVisible();
}

async function findEntry(page, description, { view = "person-tim", month = MONTH } = {}) {
  const data = await loadEntriesPage(page, { view, month });
  return data.monthPage.entries.find((entry) => entry.description === description) ?? null;
}

test.describe("the Ask page on a phone", () => {
  test.use({ viewport: iPhone });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.goto("/");
    await reseedDemo(page);
  });

  test("the tab bar reads Summary, Entries, Splits, Ask, and Month is no page under More pages", async ({ page }) => {
    await gotoPageAfterApi(page, `/summary?view=person-tim&month=${MONTH}`, "/api/summary-page", () => page.locator("nav.tab-strip"));
    const visibleTabs = await page.locator("nav.tab-strip > a.tab:visible").allInnerTexts();
    expect(visibleTabs.map((text) => text.trim())).toEqual(["Summary", "Entries", "Splits", "Ask"]);
    await page.getByRole("button", { name: "More pages" }).click();
    const overflow = page.locator(".tab-overflow-popover");
    await expect(overflow.getByRole("link")).toHaveText(["Imports", "Settings", "FAQ"]);
    await expect(overflow.getByRole("link", { name: "Month" })).toHaveCount(0);

    await page.keyboard.press("Escape");
    await page.locator("nav.tab-strip").getByRole("link", { name: "Ask" }).click();
    await expect(page).toHaveURL(/\/ask\?/);
    await expect(page.getByRole("heading", { name: "Ask", exact: true })).toBeVisible();
    // The context line names the person, scope and the month in view.
    const month = new URL(page.url()).searchParams.get("month");
    const monthLabel = new Date(`${month}-01T00:00:00Z`).toLocaleString("en-SG", { month: "short", year: "numeric", timeZone: "UTC" });
    await expect(page.locator(".ask-context")).toHaveText(`Tim · Direct + Shared · ${monthLabel}`);
    const chips = page.getByRole("group", { name: "Suggestions" }).getByRole("button");
    await expect(chips).toHaveText(["Scan receipt", "Paste", "Add entry", "Add expense"]);
    // The tab bar stays; Ask is a page, not a sheet.
    await expect(page.locator("nav.tab-strip")).toBeVisible();

    // A question that is not a search or a filter is not something to add
    // either: no card appears, and nothing is sent to the entry reader.
    // (Search and filter questions: ask-search.spec.js.)
    let draftRequests = 0;
    await page.route("**/api/ai-assist/entry-draft", (route) => {
      draftRequests += 1;
      return route.fulfill({ status: 404, body: "{}" });
    });
    await page.getByRole("textbox", { name: "Message" }).fill("Am I on track?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.locator(".ask-note").filter({ hasText: "answered yet" })).toHaveText("I can find entries and add new ones. Other questions aren't answered yet.");
    await expect(page.locator(".ask-card")).toHaveCount(0);
    expect(draftRequests).toBe(0);
  });

  test("+ opens the new entry card; filled by hand it saves the entry, which shows in Entries", async ({ page }) => {
    const description = `Ask by hand ${Date.now()}`;
    await openAskAdd(page);
    await expect(page.getByRole("heading", { name: "New entry" })).toBeVisible();
    const save = page.getByRole("button", { name: "Save", exact: true });
    await expect(save).toBeDisabled();
    await expect(page.getByRole("group", { name: "Suggestions" }).getByRole("button").first()).toHaveText("‹ Entries");

    await page.getByRole("textbox", { name: "Amount" }).fill("12.5");
    await expect(save).toBeDisabled();
    await page.getByRole("textbox", { name: "What it was" }).fill(description);
    await page.getByLabel("Date", { exact: true }).fill("2026-04-20");
    await expect(save).toBeEnabled();
    // An expense reads as money out (rose), before and after the save.
    await expect(page.locator(".ask-card-amount")).toHaveClass(/money-out/);

    const created = page.waitForResponse((response) => response.url().includes("/api/entries/create") && response.request().method() === "POST");
    await save.click();
    expect((await created).ok()).toBe(true);
    await expect(page.locator('[data-ask-card="saved"]')).toBeVisible();
    await expect(page.locator(".ask-card-tag")).toHaveText("Saved");
    await expect(page.locator(".ask-card-amount")).toContainText("−$12.50");

    const entry = await findEntry(page, description);
    expect(entry).toMatchObject({ date: "2026-04-20", amountMinor: 1250, entryType: "expense", categoryName: "Other", ownershipType: "direct", ownerName: "Tim" });

    const chips = page.getByRole("group", { name: "Suggestions" }).getByRole("button");
    await expect(chips).toHaveText(["Back to Entries", "Open this entry", "Undo"]);
    await expect(chips.first()).toHaveClass(/is-primary/);
    await chips.first().click();
    await expect(page).toHaveURL(/\/entries\?.*month=2026-04/);
    await expect(page.locator(".entry-row").filter({ hasText: description })).toBeVisible();
  });

  test("a reload while Save is on its way brings the card back, and saving again shows the one entry already made", async ({ page }) => {
    const description = `Ask reload ${Date.now()}`;
    await openAskAdd(page);
    await page.getByRole("textbox", { name: "Amount" }).fill("7.80");
    await page.getByRole("textbox", { name: "What it was" }).fill(description);
    await page.getByLabel("Date", { exact: true }).fill("2026-04-21");
    const save = page.getByRole("button", { name: "Save", exact: true });
    await expect(save).toBeEnabled();

    // The create request reaches the server, but its answer never gets back:
    // the page reloads first.
    let landed;
    const firstCreate = new Promise((resolve) => { landed = resolve; });
    await page.route("**/api/entries/create", async (route) => {
      const response = await route.fetch();
      landed({ body: await response.json(), sent: route.request().postDataJSON() });
    });
    await save.click();
    const first = await firstCreate;
    expect(first.body.created).toBe(true);
    expect(first.sent.externalReference).toMatch(/^ask:[A-Za-z0-9-]{8,64}$/);
    await page.reload();
    await page.unrouteAll({ behavior: "ignoreErrors" });

    // The card is back as a draft with what was typed.
    await expect(page.locator('[data-ask-card="draft"]')).toBeVisible();
    await expect(page.getByRole("textbox", { name: "What it was" })).toHaveValue(description);
    const again = page.waitForResponse((response) => response.url().includes("/api/entries/create") && response.request().method() === "POST");
    await save.click();
    const repeat = await again;
    expect(repeat.request().postDataJSON().externalReference).toBe(first.sent.externalReference);
    expect(await repeat.json()).toMatchObject({ ok: true, created: false, entryId: first.body.entryId });
    await expect(page.locator('[data-ask-card="saved"]')).toBeVisible();
    await expect(page.locator(".ask-card-tag")).toHaveText("Saved");

    // One entry, not two; Undo removes it.
    const data = await loadEntriesPage(page, { view: "person-tim", month: MONTH });
    expect(data.monthPage.entries.filter((entry) => entry.description === description).map((entry) => entry.id)).toEqual([first.body.entryId]);
    await page.getByRole("group", { name: "Suggestions" }).getByRole("button", { name: "Undo" }).click();
    await expect(page.locator('[data-ask-card="draft"]')).toBeVisible();
    expect(await findEntry(page, description)).toBeNull();
  });

  test("a typed sentence fills the card from the entry reader and the card saves what it shows", async ({ page }) => {
    const { accounts } = await loadReferenceData(page);
    const citi = accounts.find((account) => account.name === "Citi Rewards");
    const description = `KOUFU FOOD COURT ${Date.now()}`;
    let sentBody = null;
    await page.route("**/api/ai-assist/entry-draft", async (route) => {
      sentBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          draft: {
            fields: {
              date: { value: "2026-04-18", source: "sentence" },
              description: { value: description, source: "sentence" },
              accountId: { value: citi.id, source: "sentence" },
              accountName: { value: citi.name, source: "sentence" },
              categoryName: { value: "Food & Drinks", source: "rule" },
              amountMinor: { value: 1250, source: "sentence" },
              entryType: { value: "expense", source: "default" },
              ownershipType: { value: "direct", source: "default" },
              ownerName: { value: "Tim", source: "default" }
            },
            missing: [],
            questions: []
          },
          ai: { requested: false, available: false }
        })
      });
    });

    await openAskAdd(page);
    await page.getByRole("textbox", { name: "Message" }).fill("Koufu lunch $12.50 on Apr 18, Citi");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.locator(".ask-card-tag")).toHaveText("Filled in from your message");
    expect(sentBody).toEqual({ text: "Koufu lunch $12.50 on Apr 18, Citi", viewId: "person-tim" });
    await expect(page.locator(".ask-me")).toHaveText("Koufu lunch $12.50 on Apr 18, Citi");
    await expect(page.getByRole("textbox", { name: "What it was" })).toHaveValue(description);
    await expect(page.locator(".ask-card-category")).toHaveText("Food & Drinks");
    // Filled rows carry a dot; Type was a default, so it has none.
    await expect(page.locator('[data-ask-row="category"] .ask-row-dot')).toHaveCount(1);
    await expect(page.locator('[data-ask-row="wallet"] .ask-row-dot')).toHaveCount(1);
    await expect(page.locator('[data-ask-row="type"] .ask-row-dot')).toHaveCount(0);

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator('[data-ask-card="saved"]')).toBeVisible();
    const entry = await findEntry(page, description);
    expect(entry).toMatchObject({ date: "2026-04-18", amountMinor: 1250, categoryName: "Food & Drinks", accountId: citi.id });
  });

  test("a receipt photo is sent small and without its file details, and fills the card", async ({ page }) => {
    let upload = null;
    await page.route("**/api/ai-assist/receipt-read", async (route) => {
      const request = route.request();
      upload = { contentType: request.headers()["content-type"] ?? "", body: request.postDataBuffer() };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          receipt: {
            source: "ai",
            merchant: { value: "TIONG BAHRU BAKERY", confidence: "high" },
            date: { value: "2026-04-21", confidence: "high" },
            total: { amountMinor: 3860, currency: "SGD", confidence: "high" },
            cardLast4: null,
            lineItems: [],
            questions: []
          },
          ai: { available: true }
        })
      });
    });

    await openAskAdd(page);
    await page.locator(".ask-file-input").nth(1).setInputFiles(RECEIPT_FIXTURE);
    await expect(page.locator(".ask-card-tag")).toHaveText("Read from your receipt");
    await expect(page.locator(".ask-receipt-thumb img")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "What it was" })).toHaveValue("TIONG BAHRU BAKERY");
    expect(upload.contentType).toMatch(/^multipart\/form-data/);
    // One re-encoded JPEG part: the original PNG (and any EXIF) never leaves.
    const body = upload.body.toString("latin1");
    expect(body).toContain('name="image"');
    expect(body).toContain("Content-Type: image/jpeg");
    expect(body).not.toContain("PNG");

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator('[data-ask-card="saved"]')).toBeVisible();
    const entry = await findEntry(page, "TIONG BAHRU BAKERY");
    expect(entry).toMatchObject({ date: "2026-04-21", amountMinor: 3860, entryType: "expense" });
  });

  test("with the entry reader unavailable the card says so calmly and still saves by hand", async ({ page }) => {
    await page.route("**/api/ai-assist/entry-draft", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false }) }));
    const dialogs = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    const description = `Ask offline ${Date.now()}`;

    await openAskAdd(page);
    await page.getByRole("textbox", { name: "Message" }).fill("Kopi $2.40");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.locator(".ask-note").filter({ hasText: "I couldn't read that" })).toBeVisible();
    await expect(page.locator(".ask-card-tag")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();

    await page.getByRole("textbox", { name: "What it was" }).fill(description);
    await page.getByRole("textbox", { name: "Amount" }).fill("2.40");
    await page.getByLabel("Date", { exact: true }).fill("2026-04-22");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator('[data-ask-card="saved"]')).toBeVisible();
    expect(await findEntry(page, description)).toMatchObject({ amountMinor: 240 });
    expect(dialogs).toEqual([]);
  });

  test("Open this entry opens it in Entries, and Undo removes it and gives the card back", async ({ page }) => {
    const description = `Ask undo ${Date.now()}`;
    await openAskAdd(page);
    await page.getByRole("textbox", { name: "What it was" }).fill(description);
    await page.getByRole("textbox", { name: "Amount" }).fill("7");
    await page.getByLabel("Date", { exact: true }).fill("2026-04-19");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator('[data-ask-card="saved"]')).toBeVisible();
    const entry = await findEntry(page, description);
    expect(entry).toBeTruthy();

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator('[data-ask-card="draft"]')).toBeVisible();
    await expect(page.locator(".ask-note").filter({ hasText: "Removed." })).toBeVisible();
    await expect.poll(() => findEntry(page, description)).toBeNull();
    await expect(page.getByRole("textbox", { name: "What it was" })).toHaveValue(description);

    // Saved again, then opened in Entries' editor.
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator('[data-ask-card="saved"]')).toBeVisible();
    const saved = await findEntry(page, description);
    await page.getByRole("button", { name: "Open this entry" }).click();
    await expect(page).toHaveURL(new RegExp(`/entries\\?.*month=2026-04`));
    const sheet = page.locator(".entry-mobile-sheet");
    await expect(sheet).toBeVisible();
    // The edit sheet folds the date under More details.
    await sheet.getByRole("button", { name: /More details/ }).click();
    await expect(sheet.locator('[data-row="date"] input[type="date"]')).toHaveValue("2026-04-19");
    expect(saved.id).toBeTruthy();
  });

  test("Edit in form carries the card to the Entries composer, so the old form is never lost", async ({ page }) => {
    await openAskAdd(page);
    await page.getByRole("textbox", { name: "What it was" }).fill("Hawker dinner");
    await page.getByRole("textbox", { name: "Amount" }).fill("9.80");
    await page.getByLabel("Date", { exact: true }).fill("2026-04-17");
    await page.getByRole("button", { name: "Edit in form" }).click();
    await expect(page).toHaveURL(/\/entries\?/);
    const sheet = page.locator('.entry-mobile-sheet[aria-label="Add entry"]');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByLabel("Description")).toHaveValue("Hawker dinner");
  });

  test("the Splits receipt button opens the card with Splits on; saved, it opens on Splits", async ({ page }) => {
    const description = `Ask split ${Date.now()}`;
    await gotoPageAfterApi(page, "/splits?view=person-tim&month=2025-10&split_group=split-group-baby-river", "/api/splits-page", () => page.locator(".splits-fab"));
    await page.locator(".splits-fab").click();
    await expect(page).toHaveURL(/\/ask\?.*mode=expense.*from=splits.*split_group=split-group-baby-river/);
    await expect(page.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    await expect(page.locator(".ask-share small")).toHaveText("Baby River");
    await expect(page.getByRole("group", { name: "Suggestions" }).getByRole("button").first()).toHaveText("‹ Splits");

    await page.getByRole("textbox", { name: "What it was" }).fill(description);
    await page.getByRole("textbox", { name: "Amount" }).fill("40");
    await page.getByLabel("Date", { exact: true }).fill("2025-10-15");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator('[data-ask-card="saved"]')).toBeVisible();
    await expect(page.locator(".ask-card-saved-line")).toHaveText("Also on Splits: Baby River");

    const entry = await findEntry(page, description, { month: "2025-10" });
    expect(entry?.linkedSplitExpenseId).toBeTruthy();
    const splits = await loadSplitsPage(page, { view: "person-tim", month: "2025-10" });
    const split = splits.splitsPage.activity.find((item) => item.description === description);
    expect(split).toMatchObject({ groupId: "split-group-baby-river", linkedTransactionId: entry.id });

    const chips = page.getByRole("group", { name: "Suggestions" }).getByRole("button");
    await expect(chips).toHaveText(["Back to Splits", "Open this entry", "Open on Splits", "Undo"]);
    await page.getByRole("button", { name: "Open on Splits" }).click();
    await expect(page).toHaveURL(/\/splits\?/);
    await expect(page.getByRole("dialog").getByLabel("Description")).toHaveValue(description);
  });

  test("with no group in the URL, the receipt button carries the group Splits opened on", async ({ page }) => {
    await gotoPageAfterApi(page, "/splits?view=person-tim&month=2025-10", "/api/splits-page", () => page.locator(".splits-fab"));
    const chosen = await page.locator("[data-splits-fab-trigger='true']").getAttribute("data-split-group");
    expect(chosen).toBeTruthy();
    await page.locator(".splits-fab").click();
    await expect(page).toHaveURL(new RegExp(`/ask\\?.*mode=expense.*split_group=${chosen}`));
    await expect(page.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });

  test("the Apple Pay Shortcut's link opens the saved entry's card and asks about Other", async ({ page }) => {
    const description = `STARBUCKS ${Date.now()}`;
    const created = await postJson(page, "/api/entries/create", {
      date: "2026-04-23",
      description,
      accountName: "Citi Rewards",
      categoryName: "Other",
      amountMinor: 690,
      entryType: "expense",
      ownershipType: "direct",
      ownerName: "Tim"
    });

    await page.goto(`/ask?saved_entry=${created.entryId}&month=2026-04&view=person-tim&from=shortcut`);
    await expect(page.locator('[data-ask-card="saved"]')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator(".ask-card-merchant")).toHaveText(description);
    await expect(page.locator(".ask-card-amount")).toContainText("−$6.90");
    await expect(page.locator(".ask-question")).toHaveText("It landed in Other. Which category fits?");
    const chips = page.getByRole("group", { name: "Suggestions" }).getByRole("button");
    await expect(chips.first()).toHaveText("Open this entry");
    await expect(chips.first()).toHaveClass(/is-primary/);

    const suggestion = (await chips.nth(1).innerText()).trim();
    expect(suggestion).not.toBe("Other");
    await chips.nth(1).click();
    await expect(page.locator(".ask-note").filter({ hasText: `Moved to ${suggestion}.` })).toBeVisible();
    await expect.poll(async () => (await findEntry(page, description))?.categoryName).toBe(suggestion);

    // A link to an entry that is gone says so instead of failing.
    await page.goto("/ask?saved_entry=txn-missing&month=2026-04&view=person-tim&from=shortcut");
    await expect(page.locator(".ask-note").filter({ hasText: "couldn't be found" })).toBeVisible({ timeout: 60_000 });
    await expect(page.locator(".ask-card")).toHaveCount(0);
  });

  test("hidden money shows no amount and no tone on a saved card", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "false"));
    const description = `Ask hidden ${Date.now()}`;
    await openAskAdd(page);
    await page.getByRole("textbox", { name: "What it was" }).fill(description);
    await page.getByRole("textbox", { name: "Amount" }).fill("5");
    await page.getByLabel("Date", { exact: true }).fill("2026-04-16");
    // The typed amount is masked while it is typed.
    expect(await page.getByRole("textbox", { name: "Amount" }).evaluate((element) => getComputedStyle(element).webkitTextSecurity)).toBe("disc");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator('[data-ask-card="saved"]')).toBeVisible();
    await expect(page.locator(".ask-card-amount")).toHaveText("••••");
    const colour = await page.locator(".ask-card-amount strong").evaluate((element) => getComputedStyle(element).color);
    const textColour = await page.locator(".ask-card-merchant").evaluate((element) => getComputedStyle(element).color);
    expect(colour).toBe(textColour);
  });
});
