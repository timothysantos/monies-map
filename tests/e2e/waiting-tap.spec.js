import { devices, expect, test } from "@playwright/test";
import path from "node:path";

import { gotoPageAfterApi, postJson } from "./helpers";

// A waiting tap (DOMAIN.md "Waiting Tap"): an Apple Pay payment that reached
// the app without its amount waits as one line at the top of Entries. Save
// in the card's currency, Save in the trip's currency (the trip page then
// shows it as an Estimate, as for any Wallet amount in another currency),
// Not a payment, and money hidden (no amount hint). Phone (iPhone 13, 390)
// and desktop (1280). The Shortcut posts the blank tap as v8 does.

const MONTH = "2026-05";
const TOKEN = "mm_e2e_waiting_tap";
const { defaultBrowserType: _browser, ...iPhone13 } = devices["iPhone 13"];
// Set to a folder to also save screenshots of the card in each state.
const SHOT_DIR = process.env.WAITING_TAP_SHOT_DIR ?? "";

const card = (page) => page.locator("form.waiting-tap-card");

async function seed(page) {
  // The test Worker never fetches rates: one saved IDR rate.
  const reseed = await page.request.post("/api/demo/reseed?fx_rate=IDR:14025");
  expect(reseed.ok(), await reseed.text()).toBeTruthy();
  const settings = await (await page.request.get("/api/settings-page?view=household")).json();
  const activeIds = settings.settingsPage.accounts.filter((account) => account.isActive).map((account) => account.id);
  await postJson(page, "/api/settings/shortcuts/save", { apiKey: TOKEN, defaultAccountPriorityIds: activeIds });
  const { tripEvent } = await postJson(page, "/api/trip-events/save", { name: "Bali trip", startDate: `${MONTH}-20`, endDate: `${MONTH}-26`, currency: "IDR" });
  const held = await page.request.post("/api/shortcuts/entries/create", {
    headers: { "X-Monies-Shortcut-Token": TOKEN },
    data: { amount: "", description: "Periplus Bali", name: "UOB One", date: `${MONTH}-23`, requestId: `apple-pay-e2e-${Date.now()}`, clientVersion: "apple-pay-api-2026-11-17-v8" }
  });
  expect(held.status(), await held.text()).toBe(202);
  return { tripEvent, held: await held.json() };
}

async function openEntries(page, extra = "") {
  await gotoPageAfterApi(page, `/entries?view=household&month=${MONTH}${extra}`, "/api/entries-page", () => card(page));
  await expect(card(page)).toBeVisible();
}

async function shot(page, name) {
  if (SHOT_DIR) {
    await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
  }
}

async function savedEntry(page, description = "Periplus Bali") {
  const entriesPage = await (await page.request.get(`/api/entries-page?view=household&month=${MONTH}`)).json();
  return { entry: entriesPage.monthPage.entries.find((item) => item.description === description), waitingTaps: entriesPage.waitingTaps };
}

for (const [layout, use] of [["phone", iPhone13], ["desktop", { viewport: { width: 1280, height: 900 } }]]) {
  test.describe(`waiting tap on ${layout}`, () => {
    test.use(use);

    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    });

    test("one line to finish: the card says what came through, Save in the card's currency saves the entry", async ({ page }) => {
      await seed(page);
      await openEntries(page);
      await expect(card(page).locator(".waiting-tap-line")).toHaveText(/^Periplus Bali, Sat 23 May \d{2}:\d{2}, UOB One\. The amount didn't come through\.$/);
      const amount = card(page).getByRole("textbox", { name: "Amount for Periplus Bali" });
      await expect(amount).toHaveAttribute("inputmode", "decimal");
      await expect(amount).toHaveAttribute("placeholder", "0.00");
      const currencies = card(page).getByRole("group", { name: "Paid in" }).getByRole("button");
      await expect(currencies).toHaveText(["SGD", "IDR"]);
      await expect(currencies.first()).toHaveAttribute("aria-pressed", "true");
      // The card sits above the list and nothing floats over it.
      const box = await card(page).boundingBox();
      expect(box.width).toBeLessThanOrEqual(page.viewportSize().width);
      await shot(page, `${layout}-waiting`);

      // An empty amount is refused in plain words, without a browser alert.
      await card(page).getByRole("button", { name: "Save" }).click();
      await expect(card(page).getByRole("alert")).toHaveText("Type the amount, like 12.50.");

      await amount.fill("22.94");
      await shot(page, `${layout}-typed`);
      await card(page).getByRole("button", { name: "Save" }).click();
      await expect(page.locator(".waiting-tap-done")).toHaveText("Saved Periplus Bali.");
      await expect(card(page)).toHaveCount(0);
      await expect(page.locator(".entry-row-description").filter({ hasText: "Periplus Bali" }).first()).toBeVisible();
      await shot(page, `${layout}-saved`);
      const { entry, waitingTaps } = await savedEntry(page);
      expect([entry.amountMinor, entry.accountName, entry.addedBy, waitingTaps]).toEqual([2294, "UOB One", "apple_pay_shortcut", undefined]);
    });

    test("Save in the trip's currency: the entry is an estimate in SGD with the Rupiah kept", async ({ page }) => {
      const { tripEvent } = await seed(page);
      await openEntries(page);
      await card(page).getByRole("button", { name: "IDR" }).click();
      await expect(card(page).getByRole("button", { name: "IDR" })).toHaveAttribute("aria-pressed", "true");
      await card(page).getByRole("textbox", { name: "Amount for Periplus Bali" }).fill("150000");
      await shot(page, `${layout}-other-currency`);
      await card(page).getByRole("button", { name: "Save" }).click();
      await expect(page.locator(".waiting-tap-done")).toHaveText("Saved Periplus Bali.");
      const { entry } = await savedEntry(page);
      expect(entry.amountMinor).toBe(1070);
      expect(entry.note).toMatch(/^Paid IDR 150,000\. Saved as about SGD 10\.70/);
      // On the trip, it shows as an estimate like any Wallet amount abroad.
      await postJson(page, "/api/trip-events/entries/set", { entryIds: [entry.id], tripEventId: tripEvent.id });
      await gotoPageAfterApi(page, `/trips/${tripEvent.id}?view=household&month=${MONTH}`, "/api/trip-page", () => page.locator("[data-trip-page]"));
      await expect(page.locator("[data-trip-page] .trip-estimate").first()).toHaveText("Estimate");
    });

    test("Not a payment removes it and saves nothing; opened from Ask's link the amount field is ready", async ({ page }) => {
      const { held } = await seed(page);
      const tapId = new URL(held.openUrl).searchParams.get("waiting_tap");
      await openEntries(page, `&waiting_tap=${tapId}`);
      if (layout === "desktop") {
        await expect(card(page).getByRole("textbox", { name: "Amount for Periplus Bali" })).toBeFocused();
      }
      await card(page).getByRole("button", { name: "Not a payment" }).click();
      await expect(page.locator(".waiting-tap-done")).toHaveText("Removed Periplus Bali. Nothing was saved.");
      await shot(page, `${layout}-removed`);
      const { entry, waitingTaps } = await savedEntry(page);
      expect([entry, waitingTaps]).toEqual([undefined, undefined]);
    });
  });

  // A bare tap (DOMAIN.md "Bare Tap"): Wallet ran the automation before it
  // had the details, so only the card came through.
  test.describe(`payment with no details on ${layout}`, () => {
    test.use(use);

    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    });

    async function seedBare(page) {
      await seed(page);
      const bare = await page.request.post("/api/shortcuts/entries/create", {
        headers: { "X-Monies-Shortcut-Token": TOKEN },
        data: { amount: "", description: "", name: "UOB One", date: `${MONTH}-24`, requestId: `apple-pay-e2e-bare-${Date.now()}`, clientVersion: "apple-pay-api-2026-11-17-v8" }
      });
      expect(bare.status(), await bare.text()).toBe(202);
      expect((await bare.json()).notice).toBe("Payment on UOB One noted. Waiting for its details.");
      // Only the bare one on the card for this test.
      const entriesPage = await (await page.request.get(`/api/entries-page?view=household&month=${MONTH}`)).json();
      const named = entriesPage.waitingTaps.find((item) => item.merchant === "Periplus Bali");
      await postJson(page, "/api/waiting-taps/remove", { tapId: named.id });
    }

    test("the card asks for the shop and the amount, refuses a missing shop in plain words, and Save saves the entry", async ({ page }) => {
      await seedBare(page);
      await openEntries(page);
      await expect(card(page)).toHaveCount(1);
      await expect(card(page).locator(".waiting-tap-line")).toHaveText(/^Payment on UOB One, Sun 24 May \d{1,2}:\d{2} [ap]m\. No details came through\.$/);
      const shop = card(page).getByRole("textbox", { name: "Shop for the payment on UOB One" });
      const amount = card(page).getByRole("textbox", { name: "Amount for the payment on UOB One" });
      await expect(shop).toHaveAttribute("placeholder", "Shop");
      await shot(page, `${layout}-bare-waiting`);

      await amount.fill("12.40");
      await card(page).getByRole("button", { name: "Save" }).click();
      await expect(card(page).getByRole("alert")).toHaveText("Type the shop's name.");
      await expect(shop).toHaveAttribute("aria-invalid", "true");

      await shop.fill("Lawson Ginza");
      await shot(page, `${layout}-bare-typed`);
      await card(page).getByRole("button", { name: "Save" }).click();
      await expect(page.locator(".waiting-tap-done")).toHaveText("Saved Lawson Ginza.");
      await expect(card(page)).toHaveCount(0);
      await expect(page.locator(".entry-row-description").filter({ hasText: "Lawson Ginza" }).first()).toBeVisible();
      await shot(page, `${layout}-bare-saved`);
      const { entry, waitingTaps } = await savedEntry(page, "Lawson Ginza");
      expect([entry.amountMinor, entry.accountName, entry.date, waitingTaps]).toEqual([1240, "UOB One", `${MONTH}-24`, undefined]);
    });

    test("Not a payment removes it and saves nothing", async ({ page }) => {
      await seedBare(page);
      await openEntries(page);
      await card(page).getByRole("button", { name: "Not a payment" }).click();
      await expect(page.locator(".waiting-tap-done")).toHaveText("Removed the payment on UOB One. Nothing was saved.");
      expect((await savedEntry(page)).waitingTaps).toEqual(undefined);
    });
  });

  test.describe(`waiting tap on ${layout}, money hidden`, () => {
    test.use(use);

    test("money hidden: the card shows no amount hint and still saves", async ({ page }) => {
      await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "false"));
      await seed(page);
      await openEntries(page);
      const amount = card(page).getByRole("textbox", { name: "Amount for Periplus Bali" });
      await expect(amount).toHaveAttribute("placeholder", "");
      await expect(card(page)).not.toContainText(/\d+\.\d{2}/);
      await shot(page, `${layout}-hidden`);
      await amount.fill("8.40");
      await card(page).getByRole("button", { name: "Save" }).click();
      await expect(page.locator(".waiting-tap-done")).toHaveText("Saved Periplus Bali.");
      expect((await savedEntry(page)).entry.amountMinor).toBe(840);
    });
  });
}
