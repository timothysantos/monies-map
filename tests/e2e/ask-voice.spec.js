import { devices, expect, test } from "@playwright/test";

import { gotoPageAfterApi, reseedDemo } from "./helpers";

// The Ask composer's mic on a phone (docs/flows/ask-flow.md, "Voice input").
// The browser's speech recognition is replaced in the page by a stand-in the
// test drives, so the spoken words are known: they must land in the message
// box, interim words first, and nothing may be sent until the person taps
// Send. Hold to talk and tap-to-start/tap-to-stop both work; permission
// denied is a calm note, never a system alert. Without speech recognition,
// the test Worker's voice fallback is off (AI is disabled there), so the mic
// hides after one calm note without asking for the microphone.

const iPhone = devices["iPhone 12 Pro"].viewport;
const MONTH = "2026-04";

// A SpeechRecognition stand-in: records what the page called, and lets the
// test emit the browser's events on the newest instance.
function installFakeRecognition() {
  const instances = [];
  class FakeRecognition {
    constructor() {
      this.calls = [];
      instances.push(this);
    }
    start() { this.calls.push("start"); }
    stop() { this.calls.push("stop"); }
    abort() { this.calls.push("abort"); }
  }
  window.SpeechRecognition = FakeRecognition;
  window.webkitSpeechRecognition = FakeRecognition;
  const last = () => instances[instances.length - 1];
  window.__voice = {
    count: () => instances.length,
    calls: () => last()?.calls ?? [],
    settings: () => ({ lang: last()?.lang, interimResults: last()?.interimResults, continuous: last()?.continuous }),
    start: () => last().onstart?.({}),
    results: (list) => last().onresult?.({
      resultIndex: 0,
      results: list.map(([transcript, isFinal]) => Object.assign([{ transcript }], { isFinal }))
    }),
    error: (error) => last().onerror?.({ error }),
    end: () => last().onend?.({})
  };
}

function removeSpeechRecognition() {
  for (const name of ["SpeechRecognition", "webkitSpeechRecognition"]) {
    Object.defineProperty(window, name, { value: undefined, configurable: true, writable: true });
  }
  window.__micRequests = 0;
  if (navigator.mediaDevices) {
    navigator.mediaDevices.getUserMedia = async () => {
      window.__micRequests += 1;
      throw new DOMException("blocked in test", "NotAllowedError");
    };
  }
}

async function openAskAdd(page) {
  await gotoPageAfterApi(page, `/entries?view=person-tim&month=${MONTH}`, "/api/entries-page", () => page.locator(".entries-fab:not(.splits-fab)"));
  await page.locator(".entries-fab:not(.splits-fab)").click();
  await expect(page).toHaveURL(/\/ask\?.*mode=add/);
  await expect(page.locator('[data-ask-card="draft"]')).toBeVisible();
}

function trackAiRequests(page) {
  const seen = { draft: [], transcribe: 0 };
  page.on("request", (request) => {
    if (request.url().includes("/api/ai-assist/transcribe")) seen.transcribe += 1;
  });
  return seen;
}

test.describe("voice input on the Ask page", () => {
  test.use({ viewport: iPhone });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.goto("/");
    await reseedDemo(page);
  });

  test("hold the mic: the words fill the message box as they come and are sent only when Send is tapped", async ({ page }) => {
    await page.addInitScript(installFakeRecognition);
    const seen = trackAiRequests(page);
    await page.route("**/api/ai-assist/entry-draft", async (route) => {
      seen.draft.push(route.request().postDataJSON());
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false }) });
    });
    const dialogs = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });

    await openAskAdd(page);
    const message = page.getByRole("textbox", { name: "Message" });
    const mic = page.getByRole("button", { name: "Start voice input" });
    await expect(mic).toBeVisible();
    // Inside the one rounded field: the + glyph, the message box, the mic.
    // Send (or Save) sits outside it.
    const order = await page.locator(".ask-field > button, .ask-field > textarea").evaluateAll((items) => items.map((item) => item.getAttribute("aria-label")));
    expect(order).toEqual(["Add a photo or paste", "Message", "Start voice input"]);
    await expect(page.locator(".ask-field").getByRole("button", { name: "Save", exact: true })).toHaveCount(0);

    const box = await mic.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect.poll(() => page.evaluate(() => window.__voice.calls())).toEqual(["start"]);
    expect(await page.evaluate(() => window.__voice.settings())).toEqual({ lang: "en-SG", interimResults: true, continuous: true });
    await page.evaluate(() => window.__voice.start());
    const stop = page.getByRole("button", { name: "Stop voice input" });
    await expect(stop).toHaveClass(/is-listening/);
    await expect(message).toHaveAttribute("placeholder", "Listening…");
    await expect(page.getByRole("status").filter({ hasText: "Listening…" })).toHaveCount(1);

    await page.evaluate(() => window.__voice.results([["Koufu lunch", false]]));
    await expect(message).toHaveValue("Koufu lunch");
    await page.evaluate(() => window.__voice.results([["Koufu lunch", true], [" twelve fifty", false]]));
    await expect(message).toHaveValue("Koufu lunch twelve fifty");

    // Let go after holding: listening stops, the final words stay.
    await page.waitForTimeout(450);
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.__voice.calls())).toEqual(["start", "stop"]);
    await page.evaluate(() => {
      window.__voice.results([["Koufu lunch", true], [" $12.50 Citi", true]]);
      window.__voice.end();
    });
    await expect(message).toHaveValue("Koufu lunch $12.50 Citi");
    await expect(page.getByRole("button", { name: "Start voice input" })).not.toHaveClass(/is-listening/);
    await expect(page.locator(".ask-composer [role=status]")).toHaveText("Check the message, then send.");

    // Nothing was sent: no message in the conversation, no reader request.
    await page.waitForTimeout(300);
    expect(seen.draft).toEqual([]);
    await expect(page.locator(".ask-me")).toHaveCount(0);
    expect(seen.transcribe).toBe(0);

    // The person checks it, edits it, and sends.
    await message.fill("Koufu lunch $12.50, Citi");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.locator(".ask-me")).toHaveText("Koufu lunch $12.50, Citi");
    await expect.poll(() => seen.draft.length).toBe(1);
    expect(seen.draft[0].text).toBe("Koufu lunch $12.50, Citi");
    expect(seen.transcribe).toBe(0);
    expect(dialogs).toEqual([]);
  });

  test("tap to start and tap to stop, and Enter on the focused mic, add the words after what was typed", async ({ page }) => {
    await page.addInitScript(installFakeRecognition);
    await openAskAdd(page);
    const message = page.getByRole("textbox", { name: "Message" });
    await message.fill("Citi");

    // A quick tap keeps listening after the finger lifts.
    await page.getByRole("button", { name: "Start voice input" }).click();
    await page.evaluate(() => window.__voice.start());
    await expect(page.getByRole("button", { name: "Stop voice input" })).toHaveClass(/is-listening/);
    await page.evaluate(() => window.__voice.results([["kopi two forty", false]]));
    await expect(message).toHaveValue("Citi kopi two forty");
    expect(await page.evaluate(() => window.__voice.calls())).toEqual(["start"]);
    await page.getByRole("button", { name: "Stop voice input" }).click();
    expect(await page.evaluate(() => window.__voice.calls())).toEqual(["start", "stop"]);
    await page.evaluate(() => {
      window.__voice.results([["kopi $2.40", true]]);
      window.__voice.end();
    });
    await expect(message).toHaveValue("Citi kopi $2.40");

    // The keyboard: Enter starts, Enter stops.
    await message.fill("");
    await page.getByRole("button", { name: "Start voice input" }).focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => page.evaluate(() => window.__voice.count())).toBe(2);
    await page.evaluate(() => {
      window.__voice.start();
      window.__voice.results([["Grab to work", true]]);
    });
    await expect(page.getByRole("button", { name: "Stop voice input" })).toBeFocused();
    await page.keyboard.press("Enter");
    expect(await page.evaluate(() => window.__voice.calls())).toEqual(["start", "stop"]);
    await page.evaluate(() => window.__voice.end());
    await expect(message).toHaveValue("Grab to work");
    await expect(page.locator(".ask-me")).toHaveCount(0);
  });

  test("a microphone that is not allowed gives a calm note, never a system alert", async ({ page }) => {
    await page.addInitScript(installFakeRecognition);
    const dialogs = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await openAskAdd(page);
    await page.getByRole("button", { name: "Start voice input" }).click();
    await page.evaluate(() => {
      window.__voice.error("not-allowed");
      window.__voice.end();
    });
    await expect(page.locator(".ask-note.is-calm").filter({ hasText: "The microphone isn't allowed here." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start voice input" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Message" })).toHaveValue("");
    expect(dialogs).toEqual([]);
  });

  test("with no speech recognition and the voice fallback off, the mic hides after one calm note", async ({ page }) => {
    await page.addInitScript(removeSpeechRecognition);
    const probes = [];
    page.on("response", (response) => {
      if (response.url().includes("/api/ai-assist/transcribe")) probes.push({ method: response.request().method(), status: response.status() });
    });
    await openAskAdd(page);
    // Opening Ask asks nothing.
    expect(probes).toEqual([]);
    await page.getByRole("button", { name: "Start voice input" }).click();
    await expect(page.locator(".ask-note.is-calm").filter({ hasText: "Voice input isn't available in this browser." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start voice input" })).toHaveCount(0);
    // The Worker's own route answered; the microphone was never asked for.
    expect(probes).toEqual([{ method: "GET", status: 200 }]);
    expect(await page.evaluate(() => window.__micRequests)).toBe(0);
    // Typing still works as before.
    await expect(page.getByRole("textbox", { name: "Message" })).toBeEditable();
  });
});
