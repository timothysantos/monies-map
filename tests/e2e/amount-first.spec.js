import { expect, test } from "@playwright/test";
import path from "node:path";

import { gotoPageAfterApi, loadEntriesPage, postJson } from "./helpers";

// Amount first (docs/flows/cash-entry-flow.md "Amount first"; design.md
// "Cash pad"; src/client/new-entry-pad.js, switches in
// src/domain/quick-pad-config.ts NEW_ENTRY_PAD). On a phone the Entries +
// opens the new entry with Just paid already open: amount, Save, words
// later. The pad's way out, "Type it instead", reaches the typed new entry,
// which sits low above the chips with Just paid first and filled; its $0.00
// opens the pad while the entry is empty. Other ways into a new entry, the
// desktop, and each switch off keep the earlier screen. Phone 390 and
// desktop 1280; the test Worker has no AI (the rules read a sentence) and
// never fetches rates (the reseed saves one IDR rate).

const TIM = "person-tim";
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const DESKTOP = { viewport: { width: 1280, height: 900 } };
// Set to a folder to also save screenshots of each state.
const SHOT_DIR = process.env.AMOUNT_FIRST_SHOT_DIR ?? "";
const RECEIPT_FIXTURE = path.resolve("tests/fixtures/ask/sample-receipt.png");

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function shiftDay(day, days) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function shot(page, name) {
  if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

// A Bali trip on today in rupiah and Tim's cash wallet.
async function seed(page) {
  const reseed = await page.request.post("/api/demo/reseed?fx_rate=IDR:13500");
  expect(reseed.ok(), await reseed.text()).toBeTruthy();
  const wallet = await postJson(page, "/api/accounts/create", { name: "Tim's cash", institution: "Cash", kind: "cash", currency: "SGD", ownerPersonId: TIM });
  await postJson(page, "/api/settings/payment-ways/save", { personId: TIM, bankTransferAccountId: "", cashAccountId: wallet.accountId });
  await postJson(page, "/api/trip-events/save", { name: "Bali trip", startDate: shiftDay(today(), -2), endDate: shiftDay(today(), 5), currency: "IDR" });
  return wallet.accountId;
}

const entriesPath = () => `/entries?view=${TIM}&month=${today().slice(0, 7)}`;

async function openEntries(page) {
  await gotoPageAfterApi(page, entriesPath(), "/api/entries-page", () => page.locator(".entries-fab:not(.splits-fab)"));
}

const plus = (page) => page.locator(".entries-fab:not(.splits-fab)");
const padOf = (page) => page.getByRole("dialog", { name: "Just paid" });
const chipsOf = (page) => page.getByRole("group", { name: "Suggestions" }).getByRole("button");

async function press(pad, keys) {
  for (const key of keys) {
    await pad.getByRole("button", { name: key === "000" ? "Three zeros" : key, exact: true }).click();
  }
}

// Every listed element on screen is what a tap at its centre reaches:
// nothing overlaps. (Chips scrolled off the row's side are not on screen.)
async function nothingCovers(page, selector) {
  const hits = await page.evaluate((query) => [...document.querySelectorAll(query)].filter((element) => {
    const box = element.getBoundingClientRect();
    const x = box.left + box.width / 2;
    return x > 0 && x < window.innerWidth;
  }).map((element) => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return { name: element.textContent?.trim() || element.getAttribute("aria-label"), reached: Boolean(hit && (hit === element || element.contains(hit))) };
  }), selector);
  expect(hits.length).toBeGreaterThan(0);
  expect(hits.filter((item) => !item.reached)).toEqual([]);
}

async function entriesNamed(page, description) {
  const data = await loadEntriesPage(page, { view: "household", month: today().slice(0, 7) });
  return data.monthPage.entries.filter((entry) => entry.description === description);
}

test.describe("amount first on a phone", () => {
  test.use(PHONE);

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    // No page load before the reseed: a first load on a fresh database would
    // keep its placeholder person on the device.
  });

  test("+ opens Just paid at once: a cash payment in rupiah is 5 taps, +, 3, 5, 000, Save", async ({ page }) => {
    const walletId = await seed(page);
    await openEntries(page);
    let taps = 0;
    await plus(page).click(); taps += 1;
    await expect(page).toHaveURL(/\/ask\?.*mode=add.*from=entries/);
    const pad = padOf(page);
    await expect(pad).toBeVisible();
    await expect(pad.locator(".cash-pad-line")).toHaveText(/Tim's cash.*IDR.*Today.*Tim/, { timeout: 30_000 });
    await shot(page, "phone-1-plus-opens-pad");
    // Nothing covers a key, Save or the way out.
    await nothingCovers(page, ".cash-pad-key, .cash-pad-save, .cash-pad-type-instead, .cash-pad-close");
    await press(pad, ["3", "5", "000"]); taps += 3;
    const saved = page.waitForResponse((response) => response.url().includes("/api/cash-entries/create") && response.ok());
    await pad.getByRole("button", { name: "Save", exact: true }).click(); taps += 1;
    const { entry } = await (await saved).json();
    expect(taps).toBe(5);
    expect(entry).toMatchObject({ accountId: walletId, paidAmountMinor: 3_500_000, paidCurrency: "IDR" });
    await expect(pad.locator(".cash-pad-saved-line")).toHaveText("Saved: Cash, Rp 35,000");
    // After Save the words box is as before, and no way out shows.
    await expect(pad.getByRole("textbox", { name: "What was it?" })).toBeVisible();
    await expect(pad.getByRole("button", { name: "Type it instead" })).toHaveCount(0);

    // Done shows the new entry page, empty; a reload of it does not open the pad again.
    await pad.getByRole("button", { name: "Done", exact: true }).click();
    await expect(pad).toBeHidden();
    await page.reload();
    await expect(page.locator('[data-ask-card="draft"]')).toBeVisible();
    await expect(chipsOf(page).first()).toHaveText("Just paid");
    await expect(padOf(page)).toHaveCount(0);
  });

  test("Type it instead reaches the typed entry: low, Just paid first and filled, and a typed sentence still saves", async ({ page }) => {
    await seed(page);
    await openEntries(page);
    await plus(page).click();
    const pad = padOf(page);
    await expect(pad).toBeVisible();
    await pad.getByRole("button", { name: "Type it instead" }).click();
    await expect(pad).toBeHidden();
    // The message box has the focus, so a phone's keyboard comes up.
    const message = page.getByRole("textbox", { name: "Message" });
    await expect(message).toBeFocused();
    await shot(page, "phone-2-way-out-empty-entry");

    // Just paid leads the chips, filled, ahead of the way back.
    await expect(chipsOf(page)).toHaveText(["Just paid", "‹ Entries", "Scan receipt", "Paste", "Transfer", "Income", "Edit in form"]);
    await expect(chipsOf(page).first()).toHaveClass(/is-primary/);
    await expect(chipsOf(page).nth(1)).not.toHaveClass(/is-primary/);
    // The empty card sits just above the chips, its detail rows folded away.
    const card = page.locator('[data-ask-card="draft"]');
    const cardBox = await card.boundingBox();
    const chipsBox = await page.locator(".ask-chips").boundingBox();
    expect(chipsBox.y - (cardBox.y + cardBox.height)).toBeLessThan(40);
    expect(cardBox.y).toBeGreaterThan(300);
    await expect(page.locator("[data-ask-row]")).toHaveCount(0);
    await nothingCovers(page, ".ask-card-amount-tap, .ask-chip, .ask-save");

    // The keyboard open: the space above shrinks, the card and Save stay clear.
    await page.setViewportSize({ width: 390, height: 520 });
    await expect(message).toBeFocused();
    await shot(page, "phone-3-keyboard-open");
    await nothingCovers(page, ".ask-card-amount-tap, .ask-save, .ask-chip:first-child");
    await page.setViewportSize({ width: 390, height: 844 });

    // A typed sentence fills the card (the rules, no AI), which goes back to
    // the top with its rows, and saves.
    const name = `Kopi ${Date.now() % 100000}`;
    await message.fill(`${name} 4.50`);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.locator(".ask-card-tag")).toHaveText("Filled in from your message");
    await expect(page.getByRole("textbox", { name: "Amount" })).toHaveValue("4.50");
    await expect(page.locator("[data-ask-row]").first()).toBeVisible();
    expect((await card.boundingBox()).y).toBeLessThan(200);
    await expect(chipsOf(page).filter({ hasText: "Just paid" })).toHaveCount(0);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator('[data-ask-card="saved"]')).toBeVisible();
    expect(await entriesNamed(page, name)).toEqual([expect.objectContaining({ amountMinor: 450, entryType: "expense" })]);
  });

  test("$0.00 opens Just paid on an empty entry, and is typed in place once the entry has words", async ({ page }) => {
    await seed(page);
    await openEntries(page);
    await plus(page).click();
    await padOf(page).getByRole("button", { name: "Close" }).click();
    await expect(padOf(page)).toBeHidden();
    await shot(page, "phone-4-closed-pad-empty-entry");

    const amount = page.getByRole("button", { name: "Amount, opens Just paid" });
    await expect(amount).toHaveText("$0.00");
    await expect(page.getByRole("textbox", { name: "Amount" })).toHaveCount(0);
    await amount.click();
    await expect(padOf(page)).toBeVisible();
    await expect(padOf(page).locator(".cash-pad-line")).toContainText("IDR", { timeout: 30_000 });
    await shot(page, "phone-5-amount-tap-opens-pad");
    await padOf(page).getByRole("button", { name: "Close" }).click();

    // With words on it, the $0.00 is the amount field again: no pad.
    await page.getByRole("textbox", { name: "What it was" }).fill("Taxi");
    await expect(amount).toHaveCount(0);
    const field = page.getByRole("textbox", { name: "Amount" });
    await field.click();
    await expect(field).toBeFocused();
    await expect(padOf(page)).toHaveCount(0);
    await field.fill("12");
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  });

  test("an entry being changed keeps its amount: the saved card's Undo gives back a filled card, typed in place", async ({ page }) => {
    await seed(page);
    await openEntries(page);
    await plus(page).click();
    await padOf(page).getByRole("button", { name: "Type it instead" }).click();
    const name = `Edit me ${Date.now() % 100000}`;
    await page.getByRole("textbox", { name: "Message" }).fill(`${name} 7.20`);
    await page.getByRole("button", { name: "Send" }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator('[data-ask-card="saved"]')).toBeVisible();
    // A saved card's amount is no control at all.
    await expect(page.getByRole("button", { name: "Amount, opens Just paid" })).toHaveCount(0);
    await chipsOf(page).filter({ hasText: "Undo" }).click();
    await expect(page.locator('[data-ask-card="draft"]')).toBeVisible();
    const field = page.getByRole("textbox", { name: "Amount" });
    await expect(field).toHaveValue("7.20");
    await field.click();
    await expect(padOf(page)).toHaveCount(0);
  });

  test("other ways into a new entry never open the pad by themselves", async ({ page }) => {
    await seed(page);
    // A link straight to a new entry, with no + tap (a bookmark, a reload).
    await page.goto(`/ask?view=${TIM}&mode=add&from=entries`);
    await expect(page.locator('[data-ask-card="draft"]')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(500);
    await expect(padOf(page)).toHaveCount(0);
    // A quick-entry link opens the Entries form with its amount, as before.
    await gotoPageAfterApi(page, `${entriesPath()}&action=add-expense&amount=4.50&merchant=Kopi`, "/api/entries-page", () => page.locator(".entry-mobile-sheet, .entry-composer").first());
    await expect(padOf(page)).toHaveCount(0);
    // Ask's own Add entry.
    await page.goto(`/ask?view=${TIM}`);
    await chipsOf(page).filter({ hasText: "Add entry" }).click({ timeout: 30_000 });
    await expect(page.locator('[data-ask-card="draft"]')).toBeVisible();
    await page.waitForTimeout(500);
    await expect(padOf(page)).toHaveCount(0);
    // A receipt photo given to Ask fills a card: nothing opens, and its
    // amount is typed in place.
    await page.route("**/api/ai-assist/receipt-read", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        receipt: { source: "ai", merchant: { value: "TIONG BAHRU BAKERY", confidence: "high" }, date: { value: today(), confidence: "high" }, total: { amountMinor: 3860, currency: "SGD", confidence: "high" }, cardLast4: null, lineItems: [], questions: [] },
        ai: { available: true }
      })
    }));
    await page.goto(`/ask?view=${TIM}`);
    await expect(chipsOf(page).filter({ hasText: "Scan receipt" })).toBeVisible({ timeout: 30_000 });
    await page.locator(".ask-file-input").nth(1).setInputFiles(RECEIPT_FIXTURE);
    await expect(page.locator(".ask-card-tag")).toHaveText("Read from your receipt");
    await expect(page.getByRole("textbox", { name: "Amount" })).toHaveValue("38.60");
    await page.getByRole("textbox", { name: "Amount" }).click();
    await expect(padOf(page)).toHaveCount(0);
    // The Splits receipt button's expense keeps its Splits switch and typed amount.
    await gotoPageAfterApi(page, "/splits?view=person-tim&month=2025-10&split_group=split-group-baby-river", "/api/splits-page", () => page.locator(".splits-fab"));
    await page.locator(".splits-fab").click();
    await expect(page).toHaveURL(/\/ask\?.*mode=expense/);
    await expect(page.locator('[data-ask-card="draft"]')).toBeVisible();
    await page.waitForTimeout(500);
    await expect(padOf(page)).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Amount" })).toBeVisible();
    await expect(chipsOf(page).first()).toHaveText("‹ Splits");
  });

  test("with every switch off the + opens the entry as before: no pad, ‹ Entries first, rows shown, $0.00 typed in place", async ({ page }) => {
    await page.addInitScript(() => {
      // @ts-ignore: the test override (new-entry-pad.js)
      window.__MONIES_MAP_NEW_ENTRY_PAD__ = { openPadOnNewEntry: false, amountOpensPad: false, justPaidFirst: false, emptyEntryLow: false };
    });
    await seed(page);
    await openEntries(page);
    await plus(page).click();
    await expect(page.locator('[data-ask-card="draft"]')).toBeVisible();
    await page.waitForTimeout(500);
    await expect(padOf(page)).toHaveCount(0);
    await expect(chipsOf(page).first()).toHaveText("‹ Entries");
    await expect(chipsOf(page).nth(1)).toHaveText("Just paid");
    await expect(chipsOf(page).nth(1)).not.toHaveClass(/is-primary/);
    await expect(page.locator("[data-ask-row]").first()).toBeVisible();
    expect((await page.locator('[data-ask-card="draft"]').boundingBox()).y).toBeLessThan(200);
    await page.getByRole("textbox", { name: "Amount" }).click();
    await expect(padOf(page)).toHaveCount(0);
    // Just paid from the chip still opens the pad, and has its way out.
    await chipsOf(page).nth(1).click();
    await expect(padOf(page)).toBeVisible();
    await expect(padOf(page).getByRole("button", { name: "Type it instead" })).toBeVisible();
  });

  test("only the + auto-open is off: the rest still leads to the pad", async ({ page }) => {
    await page.addInitScript(() => {
      // @ts-ignore: the test override (new-entry-pad.js)
      window.__MONIES_MAP_NEW_ENTRY_PAD__ = { openPadOnNewEntry: false };
    });
    await seed(page);
    await openEntries(page);
    await plus(page).click();
    await expect(page.locator('[data-ask-card="draft"]')).toBeVisible();
    await page.waitForTimeout(500);
    await expect(padOf(page)).toHaveCount(0);
    await expect(chipsOf(page).first()).toHaveText("Just paid");
    await page.getByRole("button", { name: "Amount, opens Just paid" }).click();
    await expect(padOf(page)).toBeVisible();
  });
});

test.describe("amount first on a desktop", () => {
  test.use(DESKTOP);

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    // No page load before the reseed: a first load on a fresh database would
    // keep its placeholder person on the device.
  });

  test("+ opens the Ask panel with no pad; the $0.00 is typed in place; Just paid leads the chips and opens the pad", async ({ page }) => {
    await seed(page);
    await openEntries(page);
    await plus(page).click();
    const card = page.locator('[data-ask-card="draft"]');
    await expect(card).toBeVisible();
    await page.waitForTimeout(500);
    await expect(padOf(page)).toHaveCount(0);
    await shot(page, "desktop-1-plus");
    // The rows stay and the amount is a field.
    await expect(page.locator("[data-ask-row]").first()).toBeVisible();
    const field = page.getByRole("textbox", { name: "Amount" });
    await field.click();
    await expect(field).toBeFocused();
    await expect(padOf(page)).toHaveCount(0);
    await expect(chipsOf(page).first()).toHaveText("Just paid");
    await expect(chipsOf(page).first()).toHaveClass(/is-primary/);
    await chipsOf(page).first().click();
    const pad = padOf(page);
    await expect(pad).toBeVisible();
    await nothingCovers(page, ".cash-pad-key, .cash-pad-save, .cash-pad-type-instead");
    // The way out returns to the panel's message box.
    await pad.getByRole("button", { name: "Type it instead" }).click();
    await expect(pad).toBeHidden();
    await expect(page.getByRole("textbox", { name: "Message" })).toBeFocused();
  });
});
