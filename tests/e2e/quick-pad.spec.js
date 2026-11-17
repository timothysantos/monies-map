import { expect, test } from "@playwright/test";
import path from "node:path";

import { gotoPageAfterApi, openJustPaid, postJson } from "./helpers";

// The quick pad abroad (design.md "Cash pad"; docs/flows/cash-entry-flow.md;
// DOMAIN.md "Quick Entry"): at the till only the amount, by cash or by one of
// the person's cards; an Apple Pay tap that missed its amount finished from
// the pad; later, in a calm moment, a few words ("dinner ramen split with
// joyce") that Ask's rules (the test Worker has no AI) read into one change
// card, saved in place; and Ask's reminder that gathers the payments still
// waiting for words. Phone 390 and desktop 1280. The test Worker never
// fetches rates: the reseed saves one IDR rate.

const TIM = "person-tim";
const TOKEN = "mm_e2e_quick_pad";
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
// Set to a folder to also save screenshots of each new state.
const SHOT_DIR = process.env.QUICK_PAD_SHOT_DIR ?? "";

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

// A Bali trip on today in rupiah, Tim's cash wallet, and Tim's Shortcut key.
async function seed(page) {
  const reseed = await page.request.post("/api/demo/reseed?fx_rate=IDR:13500");
  expect(reseed.ok(), await reseed.text()).toBeTruthy();
  const wallet = await postJson(page, "/api/accounts/create", { name: "Tim's cash", institution: "Cash", kind: "cash", currency: "SGD", ownerPersonId: TIM });
  await postJson(page, "/api/settings/payment-ways/save", { personId: TIM, bankTransferAccountId: "", cashAccountId: wallet.accountId });
  await postJson(page, "/api/trip-events/save", { name: "Bali trip", startDate: shiftDay(today(), -2), endDate: shiftDay(today(), 5), currency: "IDR" });
  const settings = await (await page.request.get("/api/settings-page?view=household")).json();
  const uobOne = settings.settingsPage.accounts.find((account) => account.name === "UOB One");
  await postJson(page, "/api/settings/shortcuts/save", { apiKey: TOKEN, defaultAccountPriorityIds: [uobOne.id] });
  return { uobOneId: uobOne.id };
}

// An Apple Pay tap that reached the app without its amount (Shortcut v8).
async function holdTap(page, description) {
  const held = await page.request.post("/api/shortcuts/entries/create", {
    headers: { "X-Monies-Shortcut-Token": TOKEN },
    data: { amount: "", description, name: "UOB One", date: today(), requestId: `apple-pay-e2e-${description.replace(/\W/g, "")}-${Date.now()}`, clientVersion: "apple-pay-api-2026-11-17-v8" }
  });
  expect(held.status(), await held.text()).toBe(202);
}

async function openPad(page) {
  await gotoPageAfterApi(page, `/entries?view=${TIM}&month=${today().slice(0, 7)}`, "/api/entries-page", () => page.locator(".entries-fab:not(.splits-fab)"));
  const pad = await openJustPaid(page);
  await expect(pad.locator(".cash-pad-line")).toContainText("IDR", { timeout: 30_000 });
  return pad;
}

async function press(pad, keys) {
  for (const key of keys) {
    await pad.getByRole("button", { name: key === "000" ? "Three zeros" : key, exact: true }).click();
  }
}

async function payByCard(pad, cardName) {
  await pad.locator(".cash-pad-line").click();
  const way = pad.locator(".cash-pad-choice-row").filter({ hasText: "Paid with" });
  await expect(way.getByRole("button")).toHaveText(["Cash", cardName]);
  await way.getByRole("button", { name: cardName }).click();
  await pad.getByRole("button", { name: "Done", exact: true }).click();
}

async function entries(page) {
  const data = await (await page.request.get(`/api/entries-page?view=household&month=${today().slice(0, 7)}`)).json();
  return data.monthPage.entries;
}

async function splitFor(page, entryId) {
  const splits = await (await page.request.get(`/api/splits-page?view=household&month=${today().slice(0, 7)}`)).json();
  return JSON.stringify(splits).includes(entryId);
}

for (const [layout, use] of [["phone", PHONE], ["desktop", { viewport: { width: 1280, height: 900 } }]]) {
  test.describe(`quick pad on ${layout}`, () => {
    test.use(use);

    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
      await page.goto("/");
    });

    test("a card payment in the trip's currency is an estimate on the card; a few words later name it, file it and split it", async ({ page }) => {
      await seed(page);
      const pad = await openPad(page);
      await shot(page, `${layout}-1-pad-opens`);
      await payByCard(pad, "UOB One");
      await expect(pad.locator(".cash-pad-line")).toHaveText(/UOB One.*IDR.*Today.*Tim/);
      await press(pad, ["8", "5", "000"]);
      await shot(page, `${layout}-2-card-typed`);
      const saved = page.waitForResponse((response) => response.url().includes("/api/cash-entries/create") && response.ok());
      await pad.getByRole("button", { name: "Save", exact: true }).click();
      const { entry } = await (await saved).json();
      expect(entry).toMatchObject({ description: "Card payment", accountName: "UOB One", paidAmountMinor: 8_500_000, paidCurrency: "IDR", amountMinor: 630 });
      await expect(pad.locator(".cash-pad-saved-line")).toHaveText("Saved: Card payment, Rp 85,000");
      await shot(page, `${layout}-3-card-saved-words-box`);

      // Later: a few words in the one box.
      await pad.getByRole("textbox", { name: "What was it?" }).fill("dinner ramen split with joyce");
      await pad.getByRole("button", { name: "Add", exact: true }).click();
      const card = pad.locator('[data-change-draft="draft"]');
      await expect(card).toBeVisible();
      await expect(card.locator("[data-change-field]")).toHaveText([/Card payment.*Dinner ramen/, /Other.*Food & Drinks/, /Not on Splits.*Half each with Joyce/]);
      await shot(page, `${layout}-4-words-card`);
      await card.getByRole("button", { name: "Save", exact: true }).click();
      await expect(pad.locator('[data-change-draft="saved"]')).toBeVisible();
      await expect(pad.locator(".cash-pad-saved-line")).toHaveText("Saved: Dinner ramen, Rp 85,000");
      await shot(page, `${layout}-5-words-saved`);
      await expect.poll(async () => (await entries(page)).find((item) => item.id === entry.entryId)?.description).toBe("Dinner ramen");
      const after = (await entries(page)).find((item) => item.id === entry.entryId);
      expect(after.categoryName).toBe("Food & Drinks");
      expect(await splitFor(page, entry.entryId)).toBe(true);

      // Paid with is kept for the day on this device.
      await pad.getByRole("button", { name: "Add another" }).click();
      await expect(pad.locator(".cash-pad-line")).toHaveText(/UOB One.*IDR/);
    });

    test("an Apple Pay tap that missed its amount is finished from the pad once; a card payment while one waits offers it first", async ({ page }) => {
      await seed(page);
      await holdTap(page, "Periplus Bali");
      const pad = await openPad(page);
      const taps = pad.getByRole("group", { name: "Apple Pay missed the amount" });
      await expect(taps.getByRole("button")).toHaveText([/^Periplus Bali, \d{2}:\d{2}$/]);
      await taps.getByRole("button").click();
      await expect(pad.locator(".cash-pad-again-chosen")).toHaveText("Periplus Bali · UOB One");
      await expect(pad.locator(".cash-pad-line")).toHaveText(/UOB One.*IDR/);
      await press(pad, ["4", "5", "0", "000"]);
      await shot(page, `${layout}-6-tap-chosen`);
      // Nothing overlaps the pad: each key and Save is what a thumb touches.
      const hits = await page.evaluate(() => [...document.querySelectorAll(".cash-pad-key, .cash-pad-save, .cash-pad-again .cash-pad-chip")].map((element) => {
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return Boolean(hit && (hit === element || element.contains(hit)));
      }));
      expect(hits.every(Boolean)).toBe(true);
      await pad.getByRole("button", { name: "Save", exact: true }).click();
      await expect(pad.locator(".cash-pad-saved-line")).toHaveText("Saved: Periplus Bali, Rp 450,000");
      await expect.poll(async () => (await entries(page)).filter((item) => item.description === "Periplus Bali").length).toBe(1);

      // A second tap on the same card, then a card payment typed by hand.
      await holdTap(page, "Bintang Supermarket");
      await pad.getByRole("button", { name: "Close" }).click();
      const again = await openPad(page);
      await payByCard(again, "UOB One");
      await press(again, ["1", "2", "0", "000"]);
      await again.getByRole("button", { name: "Save", exact: true }).click();
      const offer = again.locator(".cash-pad-offer");
      await expect(offer).toContainText(/^Is this the Bintang Supermarket payment from \d{2}:\d{2}\? Apple Pay didn't send its amount\./);
      await shot(page, `${layout}-7-tap-offer`);
      await offer.getByRole("button", { name: "Yes, that one" }).click();
      await expect(again.locator(".cash-pad-saved-line")).toHaveText("Saved: Bintang Supermarket, Rp 120,000");
      const all = await entries(page);
      expect(all.filter((item) => item.description === "Bintang Supermarket")).toHaveLength(1);
      expect(all.filter((item) => item.description === "Card payment")).toHaveLength(0);
    });

    test("Ask's reminder gathers today's payments that need a few words and each gets its words in the list", async ({ page }) => {
      const { uobOneId } = await seed(page);
      for (const amountMinor of [8_500_000, 3_000_000]) {
        await postJson(page, "/api/cash-entries/create", { requestId: crypto.randomUUID(), personId: TIM, way: "card", accountId: uobOneId, amountMinor, currency: "IDR" });
      }
      await gotoPageAfterApi(page, `/ask?view=${TIM}`, "/api/reminders", () => page.locator('[data-reminder-kind="quick_words"]'));
      const reminder = page.locator('[data-reminder-kind="quick_words"]');
      await expect(reminder.locator(".reminder-title")).toHaveText("2 payments from today need a few words");
      await shot(page, `${layout}-8-reminder`);
      await reminder.getByRole("button", { name: "Add words" }).click();
      const pad = page.getByRole("dialog", { name: "Just paid" });
      const list = pad.locator(".cash-pad-words-list");
      await expect(list.locator(".cash-pad-eyebrow")).toHaveText("2 payments need a few words", { timeout: 30_000 });
      await expect(list.locator(".cash-pad-words-row")).toHaveCount(2);
      // Both typed this minute: newest first, either order within it.
      const rows = (await list.locator(".cash-pad-words-row").allTextContents()).sort();
      expect(rows[0]).toMatch(/^Rp 30,000 · \d{2}:\d{2} · UOB OneAdd words$/);
      expect(rows[1]).toMatch(/^Rp 85,000 · \d{2}:\d{2} · UOB OneAdd words$/);
      await shot(page, `${layout}-9-words-list`);
      await list.locator(".cash-pad-words-row").first().click();
      await list.getByRole("textbox", { name: "What was it?" }).fill("taxi to the villa");
      await list.getByRole("button", { name: "Add", exact: true }).click();
      await list.locator('[data-change-draft="draft"]').getByRole("button", { name: "Save", exact: true }).click();
      await expect(list.locator(".cash-pad-words-row").first()).toContainText("Has its words");
      await expect(list.locator(".cash-pad-eyebrow")).toHaveText("1 payment needs a few words");
      await shot(page, `${layout}-10-words-list-done`);
      await expect.poll(async () => (await entries(page)).filter((item) => item.description === "Taxi to the villa").length).toBe(1);
    });
  });
}

test.describe("quick pad with money hidden", () => {
  test.use(PHONE);

  test("the waiting taps and the words list show names and times, never a figure", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "false"));
    await page.goto("/");
    const { uobOneId } = await seed(page);
    await postJson(page, "/api/cash-entries/create", { requestId: crypto.randomUUID(), personId: TIM, way: "card", accountId: uobOneId, amountMinor: 8_500_000, currency: "IDR" });
    await holdTap(page, "Periplus Bali");
    await gotoPageAfterApi(page, `/ask?view=${TIM}`, "/api/reminders", () => page.locator('[data-reminder-kind="quick_words"]'));
    await page.locator('[data-reminder-kind="quick_words"]').getByRole("button", { name: "Add words" }).click();
    const pad = page.getByRole("dialog", { name: "Just paid" });
    await expect(pad.locator(".cash-pad-words-row")).toHaveText([/^\d{2}:\d{2} · UOB One/]);
    await expect(pad).not.toContainText(/85,000|Rp|6\.30/);
    await pad.getByRole("button", { name: "Type a payment" }).click();
    await expect(pad.getByRole("group", { name: "Apple Pay missed the amount" }).getByRole("button")).toHaveText([/^Periplus Bali, \d{2}:\d{2}$/]);
  });
});
