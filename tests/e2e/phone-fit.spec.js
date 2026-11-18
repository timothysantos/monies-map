import { devices, expect, test } from "@playwright/test";
import path from "node:path";

import { expectFits, fakeKeyboard, setKeyboard } from "./fit-check.js";
import { STRESS, addWaitingTaps, seedStressHousehold } from "./fit-stress-fixture.js";
import { postJson } from "./helpers.js";
import { LADYS_CARD, writeStatementPdf } from "./uob-wrong-card-statement.js";

const RECEIPT_FIXTURE = path.resolve("tests/fixtures/ask/sample-receipt.png");

// Phone fit (docs/code-spec.md "Phone fit check"): Ask and Entries states
// with the heavy household (fit-stress-fixture.js) at small phone sizes, with
// the keyboard down and up, checked for fit by fit-check.js rather than for
// presence. The Just paid pad and its choosers are another spec's.
//
// Sizes: an iPhone SE, an iPhone 8 under an in-app browser toolbar (667 -
// 110) and an iPhone 13, each with its keyboard height. 320 x 458 (SE under
// a toolbar, keyboard up) leaves about 80 px for the conversation and is
// not held to the 2.5-row rule.
const PHONES = [
  { width: 320, height: 568, keyboard: 260 },
  { width: 375, height: 557, keyboard: 291 },
  { width: 390, height: 844, keyboard: 336 }
];
const { defaultBrowserType: _browser, viewport: _viewport, ...iPhone13 } = devices["iPhone 13"];

// Nothing is skipped as an older small target any more: the sheet close X
// and the money eye in forms reach 44 px (fit audit F10, styles.css), and the
// Entries row's category label and trip chip already did.
const OLDER_SMALL_TARGETS = [];

const message = (page) => page.getByRole("textbox", { name: "Message" });

async function stubModel(page, replies) {
  await page.route("**/api/ask/turn", async (route) => {
    const reply = replies.shift();
    const response = await route.fetch({ headers: { ...route.request().headers(), ...(reply ? { "x-ask-turn-test-reply": JSON.stringify(reply) } : {}) } });
    await route.fulfill({ response });
  });
}

// A 390 x 844 screenshot for the owner's review, only when FIT_SHOTS names a
// folder (the follow-up's before/after shots).
async function shot(page, name, { phone = { width: 390, height: 844 } } = {}) {
  if (!process.env.FIT_SHOTS) return;
  const before = page.viewportSize();
  await page.setViewportSize(phone);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: `${process.env.FIT_SHOTS}/${name}.png` });
  if (before) await page.setViewportSize(before);
}

async function send(page, text) {
  await message(page).fill(text);
  await message(page).press("Enter");
}

// Every phone size, keyboard down; then (with `typing`) the keyboard up with
// the given field focused and kept in sight.
async function expectFitsOnPhones(page, { typing = null, mustSee = [], ignore = [], notChoosers = [] } = {}) {
  for (const phone of PHONES) {
    await page.setViewportSize({ width: phone.width, height: phone.height });
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(phone.width);
    // Two frames for resize observers (growing text boxes) to follow.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expectFits(page, { ignore: [...OLDER_SMALL_TARGETS, ...ignore], notChoosers });
    if (typing) {
      await typing().focus();
      await setKeyboard(page, phone.keyboard);
      await expectFits(page, { ignore: [...OLDER_SMALL_TARGETS, ...ignore], notChoosers, mustSee: [":focus", ...mustSee] });
      await setKeyboard(page, 0);
      await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    }
  }
}

test.describe("phone fit", () => {
  test.use({ ...iPhone13, viewport: { width: 375, height: 557 } });

  test.beforeEach(async ({ page }) => {
    test.setTimeout(240_000);
    await fakeKeyboard(page);
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    // Seeded before the first page load, so no screen holds the old names.
    await seedStressHousehold(page);
  });

  test("Ask with the keyboard up keeps the message box, Send and the latest reply above the keyboard", async ({ page }) => {
    await stubModel(page, [{
      action: "ask_clarification",
      clarify: { question: "Which of these did you mean when you said the family dinner at the long named place?", options: ["The family dinner at the roastery and bakery on Saturday night", "The lunch with the grandparents and the cousins on Sunday", "Something else earlier this month", "None of these, I will type it again"] }
    }]);
    await page.goto(`/ask?view=person-tim&month=${STRESS.month}`);
    await expect(message(page)).toBeVisible({ timeout: 60_000 });
    await expectFitsOnPhones(page, { typing: () => message(page), mustSee: [".ask-send"] });

    await send(page, "the family dinner");
    await expect(page.locator(".ask-question")).toBeVisible({ timeout: 30_000 });
    // F12: all four options are chips; the long ones shortened at a word
    // (they used to be dropped, leaving one chip).
    await shot(page, "F12-question-chips");
    await expect(page.locator(".ask-chips .ask-chip")).toHaveText([
      "The family dinner at the roastery…",
      "The lunch with the grandparents…",
      "Something else earlier this month",
      "None of these, I will type it again"
    ]);
    // On each phone, with the question in sight at the end of the conversation:
    // the keyboard comes up and a long message grows the box, and the
    // question, the box and Send all stay in sight above the keyboard.
    for (const phone of PHONES) {
      await page.setViewportSize({ width: phone.width, height: phone.height });
      await message(page).fill("");
      await page.locator(".ask-thread").evaluate((thread) => { thread.scrollTop = thread.scrollHeight; });
      await message(page).focus();
      await setKeyboard(page, phone.keyboard);
      await message(page).fill("I paid for the whole family dinner at the very long named restaurant yesterday evening, split it with Joyce sixty forty and put it on the Bali trip please");
      await expectFits(page, { ignore: OLDER_SMALL_TARGETS, mustSee: [":focus", ".ask-send", ".ask-question"] });
      await setKeyboard(page, 0);
    }
  });

  test("Ask's cards fit a small phone: a long no-space shop with a six-figure amount, a 25-row bulk change, an answer list", async ({ page }) => {
    await stubModel(page, [
      { action: "search_entries", search: { words: STRESS.bulkWord } },
      { action: "recategorise", recategorise: { category: "Kids' enrichment classes and weekend tuition", words: STRESS.bulkWord } }
    ]);
    await page.goto(`/ask?view=person-tim&month=${STRESS.month}`);
    await send(page, `show ${STRESS.bulkWord}`);
    const answer = page.locator(".ask-answer-title").first();
    await expect(answer).toBeVisible({ timeout: 30_000 });
    await expectFitsOnPhones(page);

    await send(page, `make all ${STRESS.bulkWord} rides kids classes`);
    await expect(page.locator('[data-change-type="recategorise_bulk"]')).toBeVisible({ timeout: 30_000 });
    await expectFitsOnPhones(page);

    // With AI off the rules read the message into a draft entry card.
    await page.unroute("**/api/ask/turn");
    await page.route("**/api/ask/turn", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, mode: "rules", reason: "ai_off" }) }));
    await send(page, `${STRESS.noSpaceShop} 123456.78`);
    const merchant = page.locator(".ask-card-merchant").last();
    await expect(merchant).toBeVisible({ timeout: 30_000 });
    await merchant.evaluate((element) => element.scrollIntoView({ block: "center" }));
    await expectFitsOnPhones(page);
    // The title keeps a readable width: the amount moved under it instead.
    for (const phone of PHONES) {
      await page.setViewportSize({ width: phone.width, height: phone.height });
      expect((await merchant.boundingBox()).width, `title width at ${phone.width}`).toBeGreaterThan(100);
    }
  });

  test("Entries: the waiting tap card with 1 and 5 waiting, the list end and the + new entry form fit, keyboard up and down", async ({ page }) => {
    await addWaitingTaps(page, 1);
    await page.goto(`/entries?view=household&month=${STRESS.month}`);
    const card = page.locator("form.waiting-tap-card");
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expectFitsOnPhones(page, { typing: () => card.locator("input").first() });

    await addWaitingTaps(page, 4);
    await page.reload();
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expectFitsOnPhones(page);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expectFitsOnPhones(page);

    await page.goto(`/entries?view=household&month=${STRESS.month}&action=add-expense&amount=123456.78&merchant=${encodeURIComponent(STRESS.noSpaceShop)}`);
    const sheet = page.locator(".entry-mobile-sheet").first();
    await expect(sheet).toBeVisible({ timeout: 60_000 });
    // With the keyboard up, Cancel and Save share one row so the form keeps
    // room above the keyboard (stacked, a 375 x 557 phone kept 2 rows).
    await expectFitsOnPhones(page, { typing: () => sheet.locator("input:visible, textarea:visible").first() });
  });

  // F10: a row's category label and trip chip reach 44 px for a thumb.
  test("Entries: a row with its category label and trip chip fits and both are full-size targets", async ({ page }) => {
    await page.goto(`/entries?view=household&month=${STRESS.month}`);
    const chip = page.locator(".entry-chip-trip").first();
    await expect(chip).toBeVisible({ timeout: 60_000 });
    await chip.evaluate((element) => element.scrollIntoView({ block: "center" }));
    await shot(page, "F10-entries-row-targets");
    await expectFitsOnPhones(page);
  });

  test("Entries: the edit sheet of a rupiah card payment fits, keyboard up and down", async ({ page }) => {
    await page.goto(`/entries?view=household&month=${STRESS.month}`);
    const row = page.locator(".entry-row").filter({ hasText: "IDR" }).first();
    await expect(row).toBeVisible({ timeout: 60_000 });
    await row.locator(".entry-row-main").click();
    const sheet = page.locator('.entry-mobile-sheet[aria-label="Edit entry"]');
    await expect(sheet).toBeVisible();
    await expectFitsOnPhones(page, { typing: () => sheet.locator("input:visible, textarea:visible").first() });
  });

  test("Splits: Record settlement keeps the amount being typed in sight above the keyboard", async ({ page }) => {
    await page.goto("/splits?view=person-tim&month=2025-10&split_group=split-group-none");
    await page.locator(".splits-lead").getByRole("button", { name: "Settle group" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toContainText("Record payment for this group only");
    // The sheet's body is a form, not a list to pick from.
    await expectFitsOnPhones(page, { typing: () => sheet.locator("input.lsd-amount-input"), notChoosers: [".split-dialog-scroll"] });
  });

  test("Settings: the section list keeps to the screen with two long names, and Ask's switch is a full-size target", async ({ page }) => {
    await page.goto("/settings");
    const people = page.locator(".settings-section-toggle").filter({ hasText: "People" });
    await expect(people).toContainText(STRESS.joyce, { timeout: 60_000 });
    await expectFitsOnPhones(page);
    await page.locator(".settings-section-toggle").filter({ hasText: "What Ask remembers" }).click();
    await expect(page.getByRole("switch", { name: "Let Ask handle safe things" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("switch", { name: "Let Ask handle safe things" }).scrollIntoViewIfNeeded();
    await expectFitsOnPhones(page);
  });

  // Ask audit B22: a plan change neither the model nor the rules could read
  // asks with the household's plan lines as chips, each a whole message.
  test("Ask: an unread plan change asks with plan-line chips that fit", async ({ page }) => {
    await stubModel(page, [
      { action: "plan_change", plan: { month: null, copy_from: null, ops: [] } },
      { action: "plan_change", plan: { month: null, copy_from: null, ops: [] } }
    ]);
    for (const [label, categoryName] of [["Shopping", "Shopping"], ["Groceries", "Groceries"]]) {
      await postJson(page, "/api/month-plan/save", {
        rowId: `fit-plan-${label.toLowerCase()}`, month: STRESS.month, sectionKey: "budget_buckets", categoryName, label,
        plannedMinor: 30_000, planDate: null, accountName: "", note: "", ownershipType: "direct", ownerName: STRESS.tim
      });
    }
    await page.goto(`/ask?view=person-tim&month=${STRESS.month}`);
    await expect(message(page)).toBeVisible({ timeout: 60_000 });
    await send(page, "take 50 off shoping and give it to groceries this month");
    await expect(page.locator(".ask-question")).toHaveText("Which plan line, how much, and for which month?", { timeout: 30_000 });
    await shot(page, "B22-plan-question");
    const chips = page.locator(".ask-chips .ask-chip");
    await expect(chips.first()).toHaveText(/^Move \$50 from .+ this month$/);
    await expectFitsOnPhones(page, { typing: () => message(page), mustSee: [".ask-send"] });
  });

  test("Splits: the new split expense sheet fits with the keyboard up", async ({ page }) => {
    await page.goto("/splits?view=person-tim&month=2025-10&split_group=split-group-none");
    // On a phone, Splits' + Add expense opens Ask's new entry card with
    // Splits on (the desktop has its own dialog, dialog-fit.spec.js).
    await page.getByRole("button", { name: "+ Add expense" }).click({ timeout: 60_000 });
    const card = page.locator('[data-ask-card="draft"]');
    await expect(card).toBeVisible({ timeout: 30_000 });
    const what = card.getByRole("textbox", { name: "What it was" });
    await what.fill(STRESS.longShop);
    await card.getByRole("textbox", { name: "Amount" }).fill("123456.78");
    await shot(page, "S7a-splits-add-expense");
    await expectFitsOnPhones(page, { typing: () => what });
    await expectFitsOnPhones(page, { typing: () => card.getByRole("textbox", { name: "Amount" }) });
  });

  test("Imports: the sticky bar with its blockers fits over a statement in review", async ({ page }, testInfo) => {
    const ladys = (await postJson(page, "/api/accounts/create", { name: LADYS_CARD, institution: "UOB", kind: "credit_card", currency: "SGD", openingBalanceMinor: -1250, ownerPersonId: "person-tim", isJoint: false })).accountId;
    for (const [date, description, amountMinor] of [["2026-04-20", "OpenAI", 2949], ["2026-05-05", "Buyandship", 1313]]) {
      await postJson(page, "/api/entries/create", { accountId: ladys, date, description, amountMinor, categoryName: "Shopping", entryType: "expense", ownershipType: "direct", ownerName: STRESS.tim });
    }
    const pdf = testInfo.outputPath("eStatement_UOB_Cards_12May2026.pdf");
    await writeStatementPdf(page, pdf);
    await page.goto("/imports");
    await page.locator("input[type=file]").setInputFiles([pdf]);
    const bar = page.getByRole("navigation", { name: "Import progress" });
    await bar.locator(".import-file-chip").first().click({ timeout: 60_000 });
    await expect(page.locator(".statement-review")).toBeVisible({ timeout: 30_000 });
    await expect(bar.locator(".import-blockers")).toContainText("Before you can commit:");
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight / 2, behavior: "instant" }));
    await shot(page, "S7b-imports-sticky-blockers");
    await expectFitsOnPhones(page);
  });

  test("Entries: the Trips & events sheet fits with a long trip name", async ({ page }) => {
    await page.goto(`/entries?view=household&month=${STRESS.month}`);
    await expect(page.locator(".entry-row").first()).toBeVisible({ timeout: 60_000 });
    await page.locator(".entries-totals .lsd-rows").getByRole("button", { name: /^Filters/ }).click();
    const context = page.getByRole("dialog", { name: "View and scope" });
    await context.locator("[data-trip-filter]").click();
    const sheet = page.getByRole("dialog", { name: "Trips & events" });
    await expect(sheet).toContainText(STRESS.trip);
    await shot(page, "S7c-trips-sheet");
    await expectFitsOnPhones(page);
  });

  test("Ask: a receipt photo's preview on the card fits", async ({ page }) => {
    await page.route("**/api/ai-assist/receipt-read", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, ai: { available: true }, receipt: {
        source: "ai", merchant: { value: STRESS.longShop, confidence: "high" }, date: { value: STRESS.today, confidence: "high" },
        total: { amountMinor: 12_345_678, currency: "SGD", confidence: "high" }, cardLast4: null, lineItems: [], questions: []
      } })
    }));
    await page.goto(`/ask?view=person-tim&month=${STRESS.month}&mode=add`);
    await expect(page.locator('[data-ask-card="draft"]')).toBeVisible({ timeout: 60_000 });
    await page.locator(".ask-file-input").nth(1).setInputFiles(RECEIPT_FIXTURE);
    await expect(page.locator(".ask-receipt-thumb img")).toBeVisible({ timeout: 30_000 });
    await page.locator(".ask-receipt-thumb").evaluate((element) => element.scrollIntoView({ block: "center" }));
    await shot(page, "S7d-ask-receipt-preview");
    await expectFitsOnPhones(page, { typing: () => page.getByRole("textbox", { name: "What it was" }) });
  });

  test("Ask: the Done for you log with an automatic change fits", async ({ page }) => {
    const entryId = (await postJson(page, "/api/entries/create", {
      date: STRESS.today, description: STRESS.longShop, accountName: "UOB One", categoryName: "Food & Drinks", amountMinor: 12_345_678, entryType: "expense", ownershipType: "direct", ownerName: STRESS.tim
    })).entryId;
    await stubModel(page, [{ action: "edit_note", note_edit: { target: "entry", text: "birthday dinner with the grandparents and all the cousins" } }]);
    await page.goto(`/ask?saved_entry=${entryId}&month=${STRESS.month}&view=person-tim&from=shortcut`);
    await expect(page.locator('[data-ask-card="saved"]')).toBeVisible({ timeout: 60_000 });
    await send(page, "note: birthday dinner with the grandparents and all the cousins");
    const list = page.locator("[data-ask-done-list]");
    await list.getByRole("button", { name: /Done for you/ }).click({ timeout: 30_000 });
    await expect(list.locator('[data-done-kind="note"]')).toBeVisible();
    await list.evaluate((element) => element.scrollIntoView({ block: "center" }));
    await shot(page, "S7e-done-for-you");
    await expectFitsOnPhones(page);
  });
});
