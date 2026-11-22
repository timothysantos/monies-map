import { expect, test } from "@playwright/test";
import sharp from "sharp";

import { postJson, reseedDemo } from "./helpers";
import { expectFits, fakeKeyboard, setKeyboard } from "./fit-check.js";
import { seedStressHousehold, STRESS } from "./fit-stress-fixture.js";

// Many receipts at once on the Ask page (docs/flows/ask-flow.md "Many
// receipts at once"): several photos in one go are read one after another
// with visible progress, then reviewed one at a time on the usual card; a
// receipt already in the ledger becomes a change card that saves through
// the existing command; a photo that cannot be read says so with Try again
// and Type it instead; the same photo twice is left out; leaving the page
// keeps the queue. The receipt reader is stubbed (its own route is tested
// elsewhere); every receipt here is invented.

const TODAY = new Date().toISOString().slice(0, 10);
const MONTH = TODAY.slice(0, 7);
const suggestions = (page) => page.getByRole("group", { name: "Suggestions" }).getByRole("button");

// Distinct small photos, so each has its own fingerprint.
async function photo(name, colour) {
  const buffer = await sharp({ create: { width: 60, height: 90, channels: 3, background: colour } }).png().toBuffer();
  return { name: `${name}.png`, mimeType: "image/png", buffer };
}

function receipt(merchant, amountMinor, currency = "SGD", lineItems = []) {
  return {
    source: "ai",
    merchant: { value: merchant, confidence: "high" },
    date: { value: TODAY, confidence: "high" },
    total: { amountMinor, currency, confidence: "high" },
    cardLast4: null,
    lineItems,
    questions: []
  };
}

// The reader answers in the order the photos are read (one at a time).
async function stubReader(page, answers) {
  const seen = { count: 0, concurrent: 0, maxConcurrent: 0 };
  await page.route("**/api/ai-assist/receipt-read", async (route) => {
    const answer = answers[seen.count] ?? { status: 503 };
    seen.count += 1;
    seen.concurrent += 1;
    seen.maxConcurrent = Math.max(seen.maxConcurrent, seen.concurrent);
    await new Promise((resolve) => setTimeout(resolve, 150));
    seen.concurrent -= 1;
    if (answer.status) {
      await route.fulfill({ status: answer.status, contentType: "application/json", body: JSON.stringify({ ok: false }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, available: true, receipt: answer }) });
  });
  // No on-device reader in these tests: it fails at once.
  await page.route("**/vendor/tesseract/tesseract.esm.min.js", (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: "export default {};" }));
  return seen;
}

async function openAsk(page) {
  await page.goto(`/ask?view=person-tim&month=${MONTH}&scope=direct_plus_shared`);
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
}

async function entryById(page, entryId) {
  const data = await (await page.request.get(`/api/entries-page?view=household&month=${MONTH}`)).json();
  return data.monthPage.entries.find((entry) => entry.id === entryId) ?? null;
}

async function entryByName(page, description) {
  const data = await (await page.request.get(`/api/entries-page?view=household&month=${MONTH}`)).json();
  return data.monthPage.entries.filter((entry) => entry.description === description);
}

test.describe("many receipts at once on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.goto("/");
    await reseedDemo(page);
    // 1 SGD = 14,025 IDR, saved as if fetched now (the test Worker is offline).
    const reseeded = await page.request.post("/api/demo/reseed?fx_rate=IDR:14025");
    expect(reseeded.ok()).toBeTruthy();
  });

  test("three photos: read one at a time, a new one saved, one already there updated through its command, one unreadable", async ({ page }) => {
    // A bank row for the warung, in SGD: IDR 150,000 is about SGD 10.70.
    const { entryId: warungId } = await postJson(page, "/api/entries/create", {
      date: TODAY, description: "ZQX WARUNG SARI", accountName: "UOB One", categoryName: "Food & Drinks", amountMinor: 1_090, entryType: "expense", ownershipType: "direct", ownerName: "Tim"
    });
    const seen = await stubReader(page, [receipt("ZQX NOODLE BAR", 1_240), receipt("Zqx Warung Sari", 15_000_000, "IDR"), { status: 503 }]);
    await openAsk(page);
    await page.locator(".ask-file-input").nth(1).setInputFiles([await photo("a", "#f2e3c9"), await photo("b", "#c9e3f2"), await photo("c", "#e3f2c9")]);

    await expect(page.locator(".ask-me").last()).toHaveText("Sent 3 receipt photos");
    await expect(page.locator(".ask-receipt-thumbs img")).toHaveCount(3);
    // Visible progress while the rest are read, and the first is ready to review.
    await expect(page.locator(".ask-receipts-head")).toContainText(/Reading [23] of 3…|Receipt 1 of 3/);
    await expect(page.getByRole("textbox", { name: "What it was" })).toHaveValue("ZQX NOODLE BAR");
    await expect(page.locator(".ask-card-tag")).toHaveText("Read from your receipt");
    // Not now, not Discard, on one of several receipts.
    await expect(page.locator(".ask-card-discard .lsd-quiet")).toHaveText("Not now");

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator('[data-ask-card="saved"]')).toBeVisible();
    expect((await entryByName(page, "ZQX NOODLE BAR"))[0]).toMatchObject({ amountMinor: 1_240, date: TODAY });

    // The saved card stays until Next receipt.
    await expect(suggestions(page).first()).toHaveText("Next receipt");
    await suggestions(page).first().click();
    const change = page.locator('[data-change-type="receipt_match"]');
    await expect(change).toBeVisible();
    await expect(change).toContainText("This receipt is already in Entries");
    await expect(change.locator('[data-change-field="note"]')).toContainText("Receipt: paid IDR 150,000.");
    await change.getByRole("button", { name: "Update this entry" }).click();
    await expect(page.locator(".ask-note").filter({ hasText: "Updated from the receipt." })).toBeVisible();
    const updated = await entryById(page, warungId);
    expect(updated).toMatchObject({ amountMinor: 1_090, description: "ZQX WARUNG SARI", note: "Receipt: paid IDR 150,000." });
    expect((await entryByName(page, "Zqx Warung Sari")).length, "no second entry for the same purchase").toBe(0);

    // The third could not be read: it says so, with Try again and Type it instead.
    await expect(page.locator(".ask-note").filter({ hasText: "The receipt reader isn't available just now" })).toHaveCount(1);
    const failed = page.locator('[data-receipt-status="failed"]');
    await expect(failed).toContainText("Couldn't read this one");
    await expect(failed.locator("[data-receipt-retry]")).toHaveText("Try again");
    await failed.locator("[data-receipt-type]").click();
    await expect(page.locator('[data-ask-card="draft"]')).toBeVisible();
    expect(seen.maxConcurrent, "the photos were read one after another").toBe(1);
    expect(seen.count).toBe(3);
  });

  test("the same photo twice is left out; two entries that both fit are asked about with chips", async ({ page }) => {
    for (const card of ["UOB One", "Citi Rewards"]) {
      await postJson(page, "/api/entries/create", { date: TODAY, description: "ZQX TOAST CORNER", accountName: card, categoryName: "Food & Drinks", amountMinor: 760, entryType: "expense", ownershipType: "direct", ownerName: "Tim" });
    }
    await stubReader(page, [receipt("ZQX Toast Corner", 760)]);
    await openAsk(page);
    const same = await photo("same", "#ddeeff");
    await page.locator(".ask-file-input").nth(1).setInputFiles([same, { ...same, name: "same-again.png" }]);
    await expect(page.locator(".ask-note").filter({ hasText: "This is the same photo as receipt 1, so it's left out." })).toBeVisible();
    await expect(page.locator(".ask-question")).toHaveText("This receipt looks like one of these entries. Which is it?");
    const labels = await suggestions(page).allInnerTexts();
    expect(labels.slice(0, 2).every((label) => /^ZQX TOAST CORNER, Today, \$7\.60$/.test(label))).toBe(true);
    expect(labels.slice(2)).toEqual(["It's a new one", "Not now"]);
    await suggestions(page).nth(2).click();
    await expect(page.getByRole("textbox", { name: "What it was" })).toHaveValue("ZQX Toast Corner");
  });

  test("leaving Ask and coming back keeps the unsaved queue, with no photo kept", async ({ page }) => {
    await stubReader(page, [receipt("ZQX PAPER STORE", 2_150), receipt("ZQX FRUIT STALL", 480)]);
    await openAsk(page);
    await page.locator(".ask-file-input").nth(1).setInputFiles([await photo("p", "#ffeedd"), await photo("q", "#eeddff")]);
    await expect(page.getByRole("textbox", { name: "What it was" })).toHaveValue("ZQX PAPER STORE");
    await expect(page.locator(".ask-receipts-head")).toHaveText("Receipt 1 of 2");

    await page.locator("nav.tab-strip").getByRole("link", { name: "Entries" }).click();
    await expect(page).toHaveURL(/\/entries/);
    const stored = await page.evaluate(() => window.sessionStorage.getItem("monies.askConversation.v1") ?? "");
    expect(stored).toContain("ZQX FRUIT STALL");
    expect(stored).not.toMatch(/blob:|data:image/);

    await page.reload();
    await page.locator("nav.tab-strip").getByRole("link", { name: "Ask" }).click();
    await expect(page.getByRole("textbox", { name: "What it was" })).toHaveValue("ZQX PAPER STORE");
    await page.locator(".ask-card-discard .lsd-quiet").click();
    await expect(page.getByRole("textbox", { name: "What it was" })).toHaveValue("ZQX FRUIT STALL");
    await expect(page.locator(".ask-receipts-head")).toHaveText("Receipt 2 of 2");
  });

  test("more than ten photos: only the first ten are read, and the page says so", async ({ page }) => {
    await stubReader(page, []);
    await openAsk(page);
    const photos = [];
    for (let index = 0; index < 11; index += 1) photos.push(await photo(`n${index}`, { r: 20 * index, g: 120, b: 200 }));
    await page.locator(".ask-file-input").nth(1).setInputFiles(photos);
    await expect(page.locator(".ask-note").filter({ hasText: "That's 11 photos. I'll read the first 10. Send the rest after these." })).toBeVisible();
    await expect(page.locator(".ask-receipt-thumbs img")).toHaveCount(10);
  });
});

test.describe("the receipt queue fits a phone", () => {
  for (const viewport of [{ width: 320, height: 568 }, { width: 375, height: 557 }, { width: 390, height: 844 }]) {
    test(`queue, card and a failed receipt at ${viewport.width}x${viewport.height}, keyboard down and up`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await fakeKeyboard(page);
      await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
      await page.goto("/");
      await seedStressHousehold(page);
      // Amounts no seeded entry has, so each is a new entry card.
      await stubReader(page, [receipt(STRESS.longShop, 12_345_679), receipt(STRESS.noSpaceShop, 4_312), { status: 503 }]);
      await page.goto(`/ask?view=household&month=${STRESS.month}&scope=direct_plus_shared`);
      await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
      await page.locator(".ask-file-input").nth(1).setInputFiles([await photo("x", "#aabbcc"), await photo("y", "#bbccaa"), await photo("z", "#ccaabb")]);
      await expect(page.locator('[data-receipt-status="failed"]')).toBeVisible({ timeout: 20_000 });
      const shop = page.getByRole("textbox", { name: "What it was" });
      await expect(shop).toHaveValue(STRESS.longShop);
      await expect(page.locator(".ask-receipts-head")).toHaveText("Receipt 1 of 3");
      await page.locator(".ask-card").first().evaluate((element) => element.scrollIntoView({ block: "start" }));
      await page.screenshot({ path: `test-results/receipt-card-${viewport.width}x${viewport.height}.png` });
      await expectFits(page);
      // The card's text field with the keyboard up.
      await shop.focus();
      await setKeyboard(page, Math.round(viewport.height * 0.42));
      await expectFits(page, { mustSee: [":focus"] });
      await setKeyboard(page, 0);
      await page.locator("[data-receipts-toggle]").click();
      await expectFits(page);
      await page.locator('[data-receipt-status="failed"] [data-receipt-type]').evaluate((element) => element.scrollIntoView({ block: "center" }));
      await expectFits(page, { mustSee: ['[data-receipt-status="failed"] [data-receipt-type]'] });
      await page.screenshot({ path: `test-results/receipt-queue-${viewport.width}x${viewport.height}.png` });
      await page.getByRole("textbox", { name: "Message" }).focus();
      await setKeyboard(page, Math.round(viewport.height * 0.42));
      await expectFits(page, { mustSee: [":focus"] });
      await setKeyboard(page, 0);
    });
  }
});
