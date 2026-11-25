import { devices, expect, test } from "@playwright/test";
import path from "node:path";

import { expectFits, fakeKeyboard, setKeyboard } from "./fit-check.js";
import { STRESS, addBareTaps, addWaitingTaps, seedStressHousehold } from "./fit-stress-fixture.js";
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
// The smallest (F11): an iPhone SE under an in-app browser toolbar, and a
// 375 x 557 phone at 130% text (its CSS pixels divided by 1.3), each with
// its keyboard. Checked with the keyboard up.
const SMALL_PHONES = [
  { width: 320, height: 458, keyboard: 260 },
  { width: 288, height: 429, keyboard: 224 }
];
const { defaultBrowserType: _browser, viewport: _viewport, ...iPhone13 } = devices["iPhone 13"];

// The sheet close X, the money eye in forms and a row's trip chip reach
// 44 px (fit audit F10). One older target is still skipped: the Entries
// row's category label sits on a row that is itself the target, between the
// row's clipped top edge and the shop name; a taller reach would take taps
// from the shop name, which opens the entry (left for the owner).
const OLDER_SMALL_TARGETS = [".entry-row-category-button"];

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

  test("Entries: a payment with no details (shop and amount fields) fits, keyboard up on each field, beside a waiting tap with a shop", async ({ page }) => {
    await addBareTaps(page, 1);
    await addWaitingTaps(page, 1);
    await page.goto(`/entries?view=household&month=${STRESS.month}`);
    const bare = page.locator("form.waiting-tap-card").filter({ has: page.locator(".waiting-tap-shop") });
    await expect(bare).toBeVisible({ timeout: 60_000 });
    await expect(bare.locator(".waiting-tap-line")).toContainText("No details came through.");
    await expectFitsOnPhones(page, { typing: () => bare.locator(".waiting-tap-shop input") });
    await expectFitsOnPhones(page, { typing: () => bare.locator(".waiting-tap-amount input") });
    await shot(page, "entries-bare-tap");
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

  // F11: the smallest phones with the keyboard up: an iPhone SE under an
  // in-app browser toolbar, and 375 x 557 at 130% text (288 x 429 at 100%).
  // The sheet's whole body scrolls under its fixed bar, so what is typed,
  // the bar and enough of a list stay in sight.
  test("smallest phones, keyboard up: Ask, Record settlement and the category list keep what is typed and the bar in sight", async ({ page }) => {
    const check = async (typing, options = {}) => {
      for (const phone of SMALL_PHONES) {
        await page.setViewportSize({ width: phone.width, height: phone.height });
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        // In Ask, the person is looking at the latest reply.
        await page.locator(".ask-thread").evaluateAll((threads) => threads.forEach((thread) => { thread.scrollTop = thread.scrollHeight; }));
        await typing().focus();
        await setKeyboard(page, phone.keyboard);
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        if (options.shot) await shot(page, `${options.shot}-${phone.width}x${phone.height}`, { phone: { width: phone.width, height: phone.height } });
        await expectFits(page, { ignore: OLDER_SMALL_TARGETS, mustSee: [":focus", ...(options.mustSee ?? [])], notChoosers: options.notChoosers ?? [] });
        await setKeyboard(page, 0);
        await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
      }
    };

    await stubModel(page, [{
      action: "ask_clarification",
      clarify: { question: "Which of these did you mean?", options: ["The family dinner at the roastery and bakery", "The lunch with the grandparents", "Something else", "None of these"] }
    }]);
    await page.goto(`/ask?view=person-tim&month=${STRESS.month}`);
    await expect(message(page)).toBeVisible({ timeout: 60_000 });
    await send(page, "the family dinner");
    await expect(page.locator(".ask-question")).toBeVisible({ timeout: 30_000 });
    await check(() => message(page), { mustSee: [".ask-send", ".ask-question"], shot: "F11-ask" });

    await page.goto("/splits?view=person-tim&month=2025-10&split_group=split-group-none");
    await page.locator(".splits-lead").getByRole("button", { name: "Settle group" }).click({ timeout: 60_000 });
    const sheet = page.getByRole("dialog");
    await expect(sheet).toContainText("Record payment for this group only");
    await check(() => sheet.locator("input.lsd-amount-input"), { notChoosers: [".split-dialog-scroll"], shot: "F11-settlement" });
    await page.keyboard.press("Escape");

    await page.goto(`/entries?view=household&month=${STRESS.month}`);
    await page.locator(".entry-row-category-button").first().click({ timeout: 60_000 });
    const search = page.getByRole("combobox", { name: "Search categories" });
    await expect(search).toBeVisible();
    await check(() => search, { shot: "F11-category-list" });
  });

  // F13: on a phone the time beside a long wallet name stays on one line,
  // and the day header is not cut at 130% text.
  test("Entries: a row's time stays whole beside a long wallet name, and the day header fits at 130% text", async ({ page }) => {
    await page.goto(`/entries?view=household&month=${STRESS.month}`);
    const row = page.locator(".entry-row").filter({ hasText: STRESS.longShop }).first();
    await expect(row).toBeVisible({ timeout: 60_000 });
    if (process.env.FIT_SHOTS) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.mouse.move(195, 400);
      await page.mouse.wheel(0, 760);
      await page.waitForTimeout(400);
      await shot(page, "F13-row-long-wallet");
      await page.mouse.wheel(0, 900);
      await page.waitForTimeout(400);
      await shot(page, "F13-row-normal");
    }
    for (const phone of [...PHONES, ...SMALL_PHONES]) {
      await page.setViewportSize({ width: phone.width, height: phone.height });
      await row.locator(".entry-row-main").evaluate((element) => element.scrollIntoView({ block: "start" }));
      const time = row.locator(".entry-row-time-inline");
      const box = await time.boundingBox();
      expect(box, `time shown at ${phone.width}`).not.toBeNull();
      expect(box.height, `time on one line at ${phone.width}x${phone.height}`).toBeLessThan(22);
      const head = page.locator(".entries-date-head strong").first();
      expect(await head.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), `day header whole at ${phone.width}`).toBe(true);
      // This row's chip line can sit beside the floating bars; the trip
      // chip's reach is checked in full view by the F10 test above.
      await expectFits(page, { root: ".entries-date-group", ignore: [...OLDER_SMALL_TARGETS, ".entry-chip-trip"] });
    }
    await shot(page, "F13-date-head-130", { phone: { width: 288, height: 429 } });
  });

  // Ask audit B28: Joyce's entry on Tim's own wallet goes on Splits with Tim
  // as the payer; the card says so, with one chip for Joyce, and fits.
  test("Ask: Add to Splits on someone else's wallet says who paid, with one chip, and fits", async ({ page }) => {
    const entryId = (await postJson(page, "/api/entries/create", {
      date: STRESS.today, description: STRESS.longShop, accountName: STRESS.wallets[0], categoryName: "Food & Drinks", amountMinor: 12_345_678, entryType: "expense", ownershipType: "direct", ownerName: STRESS.joyce
    })).entryId;
    await stubModel(page, [{ action: "add_entry_to_splits", split: { payer: null, group: null, shares: [] } }]);
    await page.goto(`/ask?saved_entry=${entryId}&month=${STRESS.month}&view=person-tim&from=shortcut`);
    await expect(page.locator('[data-ask-card="saved"]')).toBeVisible({ timeout: 60_000 });
    await send(page, "add to splits");
    const card = page.locator("[data-split-proposal]").last();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.evaluate((element) => element.scrollIntoView({ block: "center" }));
    await shot(page, "B28-paid-from-wallet");
    await expect(page.getByText(`It was paid from ${STRESS.wallets[0]}, which is ${STRESS.tim}'s`)).toBeVisible();
    await expect(page.getByRole("button", { name: "Add to Splits, Joyce paid" })).toBeVisible();
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
    await expect(page.getByText("Which plan line, how much, and for which month?")).toBeVisible({ timeout: 30_000 });
    await shot(page, "B22-plan-question");
    await expect(page.locator(".ask-question")).toHaveText("Which plan line, how much, and for which month?");
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
        // Not the seeded entry's figure: that same purchase would now be
        // matched to the entry already there instead of filling the card.
        total: { amountMinor: 12_345_679, currency: "SGD", confidence: "high" }, cardLast4: null, lineItems: [], questions: []
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
