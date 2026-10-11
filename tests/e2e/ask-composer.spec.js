import { expect, test } from "@playwright/test";
import path from "node:path";

import { gotoPageAfterApi, reseedDemo } from "./helpers";

// The Ask composer on a 375 px phone (design.md "Ask page", "Composer"):
// one rounded field holding a + glyph, the message box and the mic glyph,
// then Send (or Save) outside it as the only filled button. Each glyph is
// small but keeps a 44 × 44 px hit area; the field is at least 44 px tall
// and grows to about three lines, then scrolls. The + opens an in-app menu
// (Take a photo, Choose a photo, Paste), never a system dialog of its own,
// and every placeholder fits on one line without clipping.

const PHONE = { width: 375, height: 812 };
const MONTH = "2026-04";
const RECEIPT_FIXTURE = path.resolve("tests/fixtures/ask/sample-receipt.png");

async function openAskAdd(page) {
  await gotoPageAfterApi(page, `/entries?view=person-tim&month=${MONTH}`, "/api/entries-page", () => page.locator(".entries-fab:not(.splits-fab)"));
  await page.locator(".entries-fab:not(.splits-fab)").click();
  await expect(page).toHaveURL(/\/ask\?.*mode=add/);
  await expect(page.locator('[data-ask-card="draft"]')).toBeVisible();
}

async function placeholderFit(textbox) {
  return textbox.evaluate((element) => {
    const style = getComputedStyle(element);
    const context = document.createElement("canvas").getContext("2d");
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    return {
      placeholder: element.placeholder,
      text: Math.ceil(context.measureText(element.placeholder).width),
      room: Math.floor(element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight))
    };
  });
}

test.describe("the Ask composer on a phone", () => {
  test.use({ viewport: PHONE });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("monies-map:money-totals-visible", "true");
      // A browser with speech recognition, so the mic shows.
      class FakeRecognition { start() {} stop() {} abort() {} }
      window.SpeechRecognition = FakeRecognition;
    });
    await page.goto("/");
    await reseedDemo(page);
  });

  test("glyphs sit inside one field with 44 px hit areas; Send is the only filled button; the field grows to three lines then scrolls", async ({ page }) => {
    await openAskAdd(page);
    const field = page.locator(".ask-field");
    const plus = field.getByRole("button", { name: "Add a photo or paste" });
    const mic = field.getByRole("button", { name: "Start voice input" });
    const message = field.getByRole("textbox", { name: "Message" });

    for (const glyph of [plus, mic]) {
      const box = await glyph.boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      // The icon itself is small, and the button has no border or fill.
      const icon = await glyph.locator("svg").boundingBox();
      expect(icon.width).toBeLessThanOrEqual(22);
      const look = await glyph.evaluate((element) => {
        const style = getComputedStyle(element);
        return { border: style.borderTopWidth, background: style.backgroundColor };
      });
      expect(look).toEqual({ border: "0px", background: "rgba(0, 0, 0, 0)" });
    }
    const fieldBox = await field.boundingBox();
    expect(fieldBox.height).toBeGreaterThanOrEqual(44);
    expect(fieldBox.height).toBeLessThan(50);
    // Glyphs and the box are inside the field's rounded outline.
    for (const item of [plus, mic, message]) {
      const box = await item.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(fieldBox.x - 0.5);
      expect(box.x + box.width).toBeLessThanOrEqual(fieldBox.x + fieldBox.width + 0.5);
    }
    // Save sits outside the field, filled with the accent.
    const save = page.getByRole("button", { name: "Save", exact: true });
    expect((await save.boundingBox()).x).toBeGreaterThanOrEqual(fieldBox.x + fieldBox.width);
    await expect(page.locator(".ask-composer > .ask-icon-button")).toHaveCount(0);

    // Three lines grow the field; a sixth scrolls inside it.
    await message.fill("one\ntwo\nthree");
    const threeLines = (await field.boundingBox()).height;
    expect(threeLines).toBeGreaterThan(70);
    await message.fill("one\ntwo\nthree\nfour\nfive\nsix");
    const sixLines = (await field.boundingBox()).height;
    expect(sixLines).toBeLessThanOrEqual(threeLines + 2);
    expect(await message.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    // Nothing was sent by typing.
    await expect(page.locator(".ask-me")).toHaveCount(0);
  });

  test("every placeholder fits on one line at 375 px", async ({ page }) => {
    await page.goto(`/ask?view=person-tim&month=${MONTH}`);
    await expect(page.getByRole("heading", { name: "Ask", exact: true })).toBeVisible();
    const message = page.getByRole("textbox", { name: "Message" });
    const seen = [];
    const check = async () => {
      const fit = await placeholderFit(message);
      seen.push(fit.placeholder);
      expect(fit.text, `"${fit.placeholder}" needs ${fit.text}px of ${fit.room}px`).toBeLessThanOrEqual(fit.room);
    };
    await expect(message).toHaveAttribute("placeholder", "Ask, or paste a receipt");
    await check();

    await openAskAdd(page);
    await expect(message).toHaveAttribute("placeholder", "Type or say it…");
    await check();
    await page.getByRole("textbox", { name: "Amount" }).fill("4.20");
    await expect(message).toHaveAttribute("placeholder", "Anything to change?");
    await check();
    await page.getByRole("textbox", { name: "What it was" }).fill(`Composer fit ${Date.now()}`);
    await page.getByLabel("Date", { exact: true }).fill("2026-04-20");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator('[data-ask-card="saved"]')).toBeVisible();
    await expect(message).toHaveAttribute("placeholder", "Ask, or add another");
    await check();
    expect(seen).toEqual(["Ask, or paste a receipt", "Type or say it…", "Anything to change?", "Ask, or add another"]);
  });

  test("the + opens an in-app menu whose three options take a photo, choose a photo and paste; Escape closes it", async ({ page }) => {
    const draftRequests = [];
    await page.route("**/api/ai-assist/entry-draft", async (route) => {
      draftRequests.push(route.request().postDataJSON());
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false }) });
    });
    await page.route("**/api/ai-assist/receipt-read", (route) => route.fulfill({
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
    }));
    const dialogs = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await openAskAdd(page);
    const plus = page.getByRole("button", { name: "Add a photo or paste" });
    const menu = page.getByRole("group", { name: "Add a photo or paste" });
    await expect(plus).toHaveAttribute("aria-expanded", "false");

    await plus.click();
    await expect(plus).toHaveAttribute("aria-expanded", "true");
    await expect(menu.getByRole("button")).toHaveText(["Take a photo", "Choose a photo", "Paste"]);
    // The menu opens next to the + (above it, near its left edge).
    const plusBox = await plus.boundingBox();
    const menuBox = await menu.boundingBox();
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(plusBox.y + 1);
    expect(Math.abs(menuBox.x - plusBox.x)).toBeLessThan(40);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(plus).toBeFocused();

    // Take a photo: the camera picker (capture) opens.
    await plus.click();
    const cameraChooser = page.waitForEvent("filechooser");
    await menu.getByRole("button", { name: "Take a photo" }).click();
    const camera = await cameraChooser;
    expect(await camera.element().getAttribute("capture")).toBe("environment");
    await expect(menu).toHaveCount(0);

    // Choose a photo: the plain picker; the photo fills the card.
    await plus.click();
    const libraryChooser = page.waitForEvent("filechooser");
    await menu.getByRole("button", { name: "Choose a photo" }).click();
    const library = await libraryChooser;
    expect(await library.element().getAttribute("capture")).toBeNull();
    await library.setFiles(RECEIPT_FIXTURE);
    await expect(page.locator(".ask-card-tag")).toHaveText("Read from your receipt");
    await expect(page.getByRole("textbox", { name: "What it was" })).toHaveValue("TIONG BAHRU BAKERY");

    // Paste: a copied sentence goes to the reader, as the Paste chip does.
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { read: undefined, readText: async () => "Kopi $2.40" }
      });
    });
    await plus.click();
    await menu.getByRole("button", { name: "Paste" }).click();
    await expect.poll(() => draftRequests.length).toBe(1);
    expect(draftRequests[0].text).toBe("Kopi $2.40");
    await expect(menu).toHaveCount(0);
    expect(dialogs).toEqual([]);
  });
});
