import { expect, test } from "@playwright/test";
import sharp from "sharp";

import { reseedDemo } from "./helpers";
import { expectFits, fakeKeyboard, setKeyboard } from "./fit-check.js";
import { seedStressHousehold, STRESS } from "./fit-stress-fixture.js";

// Items on a receipt, and whose each one is (docs/flows/ask-flow.md "Items
// and whose they are"): the card lists the receipt's items when they add up
// to its total; on a card shared on Splits each item takes one tap (Mine,
// Joyce's, Shared) and the card's share rows follow the items to the cent;
// Save puts the shares on Splits and the items in the entry's note. Items
// that do not add up show the total only, with a line that says so. The
// receipt reader is stubbed with invented receipts.

const TODAY = new Date().toISOString().slice(0, 10);
const MONTH = TODAY.slice(0, 7);

async function photo(colour) {
  return { name: "receipt.png", mimeType: "image/png", buffer: await sharp({ create: { width: 60, height: 90, channels: 3, background: colour } }).png().toBuffer() };
}

function bill(lineItems, totalMinor, merchant = "ZQX WARUNG HIJAU") {
  return {
    source: "ai",
    merchant: { value: merchant, confidence: "high" },
    date: { value: TODAY, confidence: "high" },
    total: { amountMinor: totalMinor, currency: "SGD", confidence: "high" },
    cardLast4: null,
    lineItems,
    questions: []
  };
}

const DINNER = [
  { description: "Nasi Lemak Set", amountMinor: 890, quantity: 1 },
  { description: "Mee Goreng", amountMinor: 750, quantity: 1 },
  { description: "Teh Tarik", amountMinor: 560, quantity: 2 },
  { description: "Satay 10 sticks", amountMinor: 1_200, quantity: 1 },
  { description: "Chendol", amountMinor: 420, quantity: 1 },
  { description: "Svc Chg 10%", amountMinor: 382, quantity: null },
  { description: "GST 9%", amountMinor: 378, quantity: null }
];

async function stubReader(page, receipts) {
  let index = 0;
  await page.route("**/api/ai-assist/receipt-read", async (route) => {
    const receipt = receipts[Math.min(index, receipts.length - 1)];
    index += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, available: true, receipt }) });
  });
}

async function sendPhoto(page, colour = "#f0e0d0") {
  await page.locator(".ask-file-input").nth(1).setInputFiles([await photo(colour)]);
}

test.describe("items on a receipt on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.goto("/");
    await reseedDemo(page);
  });

  test("a dinner for two: one tap per item makes the shares to the cent, and Save puts them on Splits with the items in the note", async ({ page }) => {
    await stubReader(page, [bill(DINNER, 4_580)]);
    await page.goto(`/ask?view=person-tim&month=${MONTH}&scope=direct_plus_shared`);
    await sendPhoto(page);
    await expect(page.getByRole("textbox", { name: "What it was" })).toHaveValue("ZQX WARUNG HIJAU");
    const items = page.locator("[data-receipt-items='ok']");
    // Folded until the card is shared.
    await expect(items.locator("[data-receipt-items-toggle]")).toHaveText(/See the 5 items/);
    await page.getByRole("switch").click();
    await expect(items.locator("[data-receipt-item]")).toHaveCount(7);
    await expect(items.locator("[data-receipt-item='5']")).toContainText("Svc Chg 10%");
    // Untouched: half each.
    const shares = page.locator(".ask-rows-shares");
    await expect(shares.locator("[data-card-share='Tim']")).toContainText("$22.90");
    await items.getByRole("group", { name: "Whose is Nasi Lemak Set?" }).getByRole("button", { name: "Mine" }).click();
    await items.getByRole("group", { name: "Whose is Mee Goreng?" }).getByRole("button", { name: "Joyce's" }).click();
    await items.getByRole("group", { name: "Whose is Chendol?" }).getByRole("button", { name: "Joyce's" }).click();
    await expect(items.getByRole("group", { name: "Whose is Chendol?" }).getByRole("button", { name: "Joyce's" })).toHaveAttribute("aria-pressed", "true");
    await expect(shares.locator("[data-card-share='Tim']")).toContainText("$21.22");
    await expect(shares.locator("[data-card-share='Joyce']")).toContainText("$24.58");
    if (process.env.RECEIPT_SHOTS_DIR) {
      await items.locator("[data-receipt-item='0']").evaluate((element) => element.scrollIntoView({ block: "start" }));
      await page.screenshot({ path: `${process.env.RECEIPT_SHOTS_DIR}/06-items-whose-each-is.png` });
      await shares.evaluate((element) => element.scrollIntoView({ block: "end" }));
      await page.screenshot({ path: `${process.env.RECEIPT_SHOTS_DIR}/07-shares-from-items.png` });
    }

    // The demo household has several split groups: choose one, as for any shared card.
    await page.locator('[data-ask-row="splitGroup"]').click();
    await page.locator(".mobile-select-dialog .mobile-select-option").nth(1).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator('[data-ask-card="saved"]')).toBeVisible();
    const data = await (await page.request.get(`/api/entries-page?view=household&month=${MONTH}`)).json();
    const entry = data.monthPage.entries.find((row) => row.description === "ZQX WARUNG HIJAU");
    expect(entry.amountMinor).toBe(4_580);
    expect(entry.note).toContain("Receipt items:\n- Nasi Lemak Set SGD 8.90 · Tim\n- Mee Goreng SGD 7.50 · Joyce");
    const splits = await (await page.request.get(`/api/splits-page?view=household&month=${MONTH}`)).json();
    const split = splits.splitsPage.activity.find((item) => item.description === "ZQX WARUNG HIJAU");
    expect(split.totalAmountMinor).toBe(4_580);
    expect(Object.fromEntries(split.shares.map((share) => [share.personName ?? share.personId, share.amountMinor]))).toMatchObject({ Tim: 2_122, Joyce: 2_458 });
  });

  test("items that do not add up show the total only, with one line saying so", async ({ page }) => {
    await stubReader(page, [bill(DINNER.slice(1), 4_580)]);
    await page.goto(`/ask?view=person-tim&month=${MONTH}&scope=direct_plus_shared`);
    await sendPhoto(page);
    await expect(page.locator("[data-receipt-items='unreliable']")).toHaveText("The items couldn't be read reliably, so only the total is shown.");
    await expect(page.locator(".ask-card-amount-input")).toHaveValue(/^45\.80?$/);
    if (process.env.RECEIPT_SHOTS_DIR) await page.screenshot({ path: `${process.env.RECEIPT_SHOTS_DIR}/08-items-not-reliable.png` });
  });
});

test.describe("a 15-item receipt fits a phone", () => {
  const fifteen = Array.from({ length: 15 }, (_, index) => ({ description: index === 3 ? STRESS.longShop.slice(0, 70) : `ZQX ITEM WITH A LONGER NAME ${index + 1}`, amountMinor: 1_000 + index * 100, quantity: index % 4 === 0 ? 2 : 1 }));
  const total = fifteen.reduce((sum, item) => sum + item.amountMinor, 0);
  for (const viewport of [{ width: 320, height: 568 }, { width: 375, height: 557 }, { width: 390, height: 844 }]) {
    test(`items and their taps at ${viewport.width}x${viewport.height}, keyboard down and up`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await fakeKeyboard(page);
      await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
      await page.goto("/");
      await seedStressHousehold(page);
      await stubReader(page, [bill(fifteen, total, STRESS.noSpaceShop)]);
      await page.goto(`/ask?view=person-tim&month=${STRESS.month}&scope=direct_plus_shared`);
      await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
      await sendPhoto(page);
      await expect(page.getByRole("textbox", { name: "What it was" })).toHaveValue(STRESS.noSpaceShop);
      await page.getByRole("switch").click();
      const items = page.locator("[data-receipt-items='ok']");
      await expect(items.locator("[data-receipt-item]")).toHaveCount(15);
      await items.locator("[data-receipt-item='3'] .ask-receipt-item-choice").first().click();
      for (const index of [0, 7, 14]) {
        await items.locator(`[data-receipt-item='${index}']`).evaluate((element) => element.scrollIntoView({ block: "center" }));
        await expectFits(page);
      }
      await page.locator(".ask-rows-shares").evaluate((element) => element.scrollIntoView({ block: "center" }));
      await expectFits(page);
      await page.screenshot({ path: `test-results/receipt-items-${viewport.width}x${viewport.height}.png` });
      const shop = page.getByRole("textbox", { name: "What it was" });
      await shop.focus();
      await setKeyboard(page, Math.round(viewport.height * 0.42));
      await expectFits(page, { mustSee: [":focus"] });
      await setKeyboard(page, 0);
    });
  }
});
