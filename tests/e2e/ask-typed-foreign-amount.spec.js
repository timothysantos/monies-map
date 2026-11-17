import { devices, expect, test } from "@playwright/test";

import { gotoPageAfterApi, loadEntriesPage, postJson, tapAddEntry } from "./helpers";

// A typed "coffee 35000 IDR cash" in Ask's new entry card on a phone, AI off
// (the rules reader). The rupiah is never taken as dollars: with a saved rate
// the card shows an estimate in the cash wallet's currency and keeps the
// rupiah and the rate note; with no rate the card asks for the amount and
// offers no chip. docs/flows/cash-entry-flow.md.

const iPhone = devices["iPhone 12 Pro"].viewport;
const TIM = "person-tim";

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

// The test Worker never fetches rates: a reseed can save one (IDR here).
// KRW is never given one, so it is the "no rate" currency.
async function reseed(page, idrRate) {
  const response = await page.request.post(`/api/demo/reseed?fx_rate=IDR:${idrRate}`);
  expect(response.ok()).toBe(true);
}

async function addCashWallet(page) {
  const wallet = await postJson(page, "/api/accounts/create", { name: "Tim's cash", institution: "Cash", kind: "cash", currency: "SGD", ownerPersonId: TIM });
  await postJson(page, "/api/settings/payment-ways/save", { personId: TIM, bankTransferAccountId: "", cashAccountId: wallet.accountId });
  return wallet.accountId;
}

async function typeIntoAsk(page, text) {
  await gotoPageAfterApi(page, `/entries?view=${TIM}&month=${today().slice(0, 7)}`, "/api/entries-page", () => page.locator(".entries-fab:not(.splits-fab)"));
  await tapAddEntry(page);
  await expect(page.locator('[data-ask-card="draft"]')).toBeVisible();
  await page.getByRole("textbox", { name: "Message" }).fill(text);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator(".ask-card-tag")).toHaveText("Filled in from your message");
}

test.describe("a typed amount in another currency on a phone", () => {
  test.use({ viewport: iPhone });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.goto("/");
  });

  test("coffee 35000 IDR cash shows an estimate in dollars, never $35,000, and saves the rupiah with it", async ({ page }) => {
    await reseed(page, 12500);
    const walletId = await addCashWallet(page);
    await typeIntoAsk(page, "coffee 35000 IDR cash");

    // Not the old chip, and not the rupiah as dollars.
    await expect(page.getByRole("button", { name: /IDR 35,000/ })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Amount" })).toHaveValue("2.80");
    await expect(page.locator(".ask-card")).not.toContainText("35,000.00");
    await expect(page.locator("body")).toContainText("Paid IDR 35,000 cash. Saved as about SGD 2.80 at 1 SGD = 12,500 IDR");

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator('[data-ask-card="saved"]')).toBeVisible();
    const data = await loadEntriesPage(page, { view: "household", month: today().slice(0, 7) });
    const entry = data.monthPage.entries.find((row) => row.description === "coffee" && row.accountId === walletId);
    // The page's rows carry the note; the kept rupiah amount is proved in
    // tests/typed-foreign-amount-route.test.mjs.
    expect(entry).toMatchObject({ amountMinor: 280, entryType: "expense", note: expect.stringContaining("Paid IDR 35,000 cash. Saved as about SGD 2.80 at 1 SGD = 12,500 IDR") });
  });

  test("with no rate the card asks for the amount and offers no chip with the rupiah", async ({ page }) => {
    await reseed(page, 12500);
    await addCashWallet(page);
    await typeIntoAsk(page, "coffee 35000 KRW cash");
    await expect(page.getByRole("button", { name: /KRW 35,000/ })).toHaveCount(0);
    await expect(page.locator("body")).toContainText("That was KRW 35,000. What did it cost in your card's currency?");
    await expect(page.getByRole("textbox", { name: "Amount" })).toHaveValue("");
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  });
});
