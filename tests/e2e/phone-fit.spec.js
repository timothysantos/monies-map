import { devices, expect, test } from "@playwright/test";

import { expectFits, fakeKeyboard, setKeyboard } from "./fit-check.js";
import { STRESS, addWaitingTaps, seedStressHousehold } from "./fit-stress-fixture.js";

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

// Older controls the fit check reports that this work did not change, each
// listed in the fit audit as left for the owner (34-36 px, in first-screen
// CSS); the Entries row's category label is a second target on a row that
// is itself the target.
const OLDER_SMALL_TARGETS = [".totals-visibility-toggle--form", ".icon-action.subtle-cancel", ".entry-row-category-button", ".entry-chip-trip", ".entries-date-refresh-button"];

const message = (page) => page.getByRole("textbox", { name: "Message" });

async function stubModel(page, replies) {
  await page.route("**/api/ask/turn", async (route) => {
    const reply = replies.shift();
    const response = await route.fetch({ headers: { ...route.request().headers(), ...(reply ? { "x-ask-turn-test-reply": JSON.stringify(reply) } : {}) } });
    await route.fulfill({ response });
  });
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
});
