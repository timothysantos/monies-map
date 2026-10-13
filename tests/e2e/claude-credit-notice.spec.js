import { expect, test } from "@playwright/test";

import { gotoPageAfterApi, reseedDemo } from "./helpers";

// The Claude credit notice on Ask and the Ask and AI section in Settings
// (design.md "Claude credit notice", docs/flows/ask-flow.md "Claude
// credits"). The status route is stubbed per test (low, used up, capped,
// fine, not set up), so these never depend on a real Claude balance. They
// prove the notice shows only for low, used up and capped, with its words,
// tone and actions; the dismiss lasts for the browser session and gives way
// to a worse state; "I've topped up" posts the amount and the notice
// clears; hidden money shows no figures; the status is read only once Ask
// is usable (never on the first screen); and Settings renders the section.
//
// The phone tests are tagged @webkit: `npm run test:e2e:webkit` runs them in
// WebKit on an iPhone 13 profile too.

const PHONE = { width: 390, height: 664 };
const BILLING = "https://platform.claude.com/settings/billing";
const STATUS_PATH = "/api/ai-assist/provider-status";
const TOPPED_UP_PATH = "/api/ai-assist/provider-status/topped-up";
const ASK = "/ask?view=person-tim&month=2026-04";
const SHOT_DIR = process.env.AUTO_BALANCE_SHOT_DIR;

function statusBody(state, overrides = {}) {
  return {
    ok: true,
    visible: true,
    claudeConfigured: state !== "off",
    state: state === "off" ? "unknown" : state,
    estimatedSpendUsd: state === "low" ? 16.4 : state === "ok" ? 3.2 : 20,
    creditUsd: 20,
    warnAtUsd: 15,
    monthSpendUsd: 3.2,
    monthTargetUsd: 8,
    mode: "claude_all",
    lastSuccessAt: "2026-10-11T02:00:00.000Z",
    consoleBillingUrl: BILLING,
    ...overrides
  };
}

// Stubs the status route; `current.state` can change mid-test. Counts the
// status reads and records each top-up body.
async function stubStatus(page, initialState) {
  const current = { state: initialState, reads: 0, toppedUp: [] };
  await page.route(`**${STATUS_PATH}`, (route) => {
    current.reads += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(statusBody(current.state)) });
  });
  await page.route(`**${TOPPED_UP_PATH}`, async (route) => {
    const body = route.request().postDataJSON();
    current.toppedUp.push(body);
    current.state = "ok";
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(statusBody("ok", { estimatedSpendUsd: 0, creditUsd: body.creditUsd }))
    });
  });
  return current;
}

async function setMoneyVisible(page, visible) {
  await page.addInitScript((value) => window.localStorage.setItem("monies-map:money-totals-visible", value), visible ? "true" : "false");
}

async function openAsk(page, path = ASK) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Ask", exact: true })).toBeVisible({ timeout: 30_000 });
}

const notice = (page) => page.getByRole("region", { name: "Claude credits" });

test.describe("the Claude credit notice on a phone @webkit", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(PHONE);
    await reseedDemo(page);
  });

  test("low shows one butter notice at the top of the conversation; dismissed it stays away for the session until the state gets worse", async ({ page }) => {
    await setMoneyVisible(page, true);
    const stub = await stubStatus(page, "low");
    await openAsk(page);

    const box = notice(page);
    await expect(box).toHaveText(/Claude credits are running low: about \$16\.40 of \$20 used\. Ask still works\./);
    await expect(box).toHaveAttribute("data-credit-state", "low");
    await expect(box).toHaveCSS("background-color", "rgb(241, 230, 198)");
    // At the top of the conversation, before anything else in it.
    const firstInThread = await page.locator(".ask-thread > *").first().getAttribute("class");
    expect(firstInThread).toContain("claude-credit-notice");

    const link = box.getByRole("link", { name: "Top up in the Claude Console" });
    await expect(link).toHaveAttribute("href", BILLING);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
    await expect(box.getByRole("button", { name: "I've topped up" })).toBeVisible();
    for (const control of [link, box.getByRole("button", { name: "I've topped up" }), box.getByRole("button", { name: "Hide this notice" })]) {
      const size = await control.boundingBox();
      expect(size.height).toBeGreaterThanOrEqual(44);
      expect(size.width).toBeGreaterThanOrEqual(44);
    }

    await box.getByRole("button", { name: "Hide this notice" }).click();
    await expect(notice(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.sessionStorage.getItem("monies.claudeCreditNotice.v1"))).toBe("low");

    // A reload in the same tab keeps it dismissed while the state is the same.
    await openAsk(page);
    await expect.poll(() => stub.reads).toBeGreaterThanOrEqual(2);
    await expect(page.locator(".ask-thread")).toBeVisible();
    await expect(notice(page)).toHaveCount(0);

    // Worse: used up shows again, in the rose attention tone.
    stub.state = "exhausted";
    await openAsk(page);
    await expect(notice(page)).toHaveText(/Claude credits are used up, so Ask is using the basic model for now\./);
    await expect(notice(page)).toHaveCSS("background-color", "rgb(243, 224, 217)");
  });

  test("I've topped up opens the app's own sheet with the number keypad; a bad amount is refused, a good one is posted and the notice clears", async ({ page }) => {
    await setMoneyVisible(page, true);
    const stub = await stubStatus(page, "low");
    let dialogs = 0;
    page.on("dialog", (dialog) => {
      dialogs += 1;
      void dialog.dismiss();
    });
    await openAsk(page);

    await notice(page).getByRole("button", { name: "I've topped up" }).click();
    const sheet = page.locator(".claude-topup-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText("Enter the Claude credit you bought. Ask counts from this amount again.")).toBeVisible();
    const amount = sheet.getByLabel("Credit bought (US$)");
    await expect(amount).toHaveAttribute("inputmode", "decimal");
    const save = sheet.getByRole("button", { name: "Save" });
    const cancel = sheet.getByRole("button", { name: "Cancel" });
    await expect(save).toBeDisabled();

    // Save and Cancel sit at the bottom of the screen, under the thumb.
    const viewport = page.viewportSize();
    for (const control of [save, cancel]) {
      const size = await control.boundingBox();
      expect(size.y + size.height).toBeGreaterThan(viewport.height * 0.75);
      expect(size.height).toBeGreaterThanOrEqual(44);
    }

    await amount.fill("20000");
    await save.click();
    await expect(sheet.getByRole("alert")).toHaveText("Enter the credit you bought in US dollars, more than 0 and at most 10,000.");
    expect(stub.toppedUp).toEqual([]);

    await amount.fill("25");
    await save.click();
    await expect(sheet).toHaveCount(0);
    expect(stub.toppedUp).toEqual([{ creditUsd: 25 }]);
    await expect(notice(page)).toHaveCount(0);
    expect(dialogs).toBe(0);

    // Cancel closes without posting.
    stub.state = "low";
    await openAsk(page);
    await notice(page).getByRole("button", { name: "I've topped up" }).click();
    await page.locator(".claude-topup-sheet").getByRole("button", { name: "Cancel" }).click();
    await expect(page.locator(".claude-topup-sheet")).toHaveCount(0);
    expect(stub.toppedUp).toHaveLength(1);
    await expect(notice(page)).toBeVisible();
  });

  test("capped says the monthly limit is reached; fine and not set up show no notice", async ({ page }) => {
    await setMoneyVisible(page, true);
    const stub = await stubStatus(page, "capped");
    await openAsk(page);
    await expect(notice(page)).toHaveText(/This month's Claude spending limit is reached, so Ask is using the basic model until it resets\./);
    await expect(notice(page)).toHaveAttribute("data-credit-state", "capped");

    for (const state of ["ok", "off"]) {
      stub.state = state;
      const reads = stub.reads;
      // A new tab session: the kept status is per page load.
      await openAsk(page);
      await expect.poll(() => stub.reads).toBeGreaterThan(reads);
      await expect(page.locator(".ask-thread")).toBeVisible();
      await expect(notice(page)).toHaveCount(0);
    }
  });

  test("hidden money keeps the notice and its actions but shows no dollar figure", async ({ page }) => {
    await setMoneyVisible(page, false);
    await stubStatus(page, "low");
    await openAsk(page);
    await expect(notice(page)).toHaveText(/Claude credits are running low\. Ask still works\./);
    const text = await notice(page).locator("p").innerText();
    expect(text).not.toMatch(/\$|\d/);
    await expect(notice(page).getByRole("link", { name: "Top up in the Claude Console" })).toBeVisible();
  });

  test("the status is never read on the first screen, only once Ask is open and usable", async ({ page }) => {
    await setMoneyVisible(page, true);
    const stub = await stubStatus(page, "low");
    await gotoPageAfterApi(page, "/summary?view=person-tim&month=2026-04", "/api/summary-page", () => page.locator("nav.tab-strip"));
    await page.waitForTimeout(1_500);
    expect(stub.reads).toBe(0);

    await page.locator("nav.tab-strip").getByRole("link", { name: "Ask" }).click();
    await expect(notice(page)).toBeVisible();
    expect(stub.reads).toBe(1);
    const usable = await page.evaluate(() => window.__MONIES_MAP_ROUTE_WORK__?.usable);
    expect(usable).toBe(true);
  });

  test("a failed status read leaves Ask as it was, with no notice and no error", async ({ page }) => {
    await page.route(`**${STATUS_PATH}`, (route) => route.fulfill({ status: 500, body: "boom" }));
    await openAsk(page);
    await expect(page.getByRole("group", { name: "Suggestions" })).toBeVisible();
    await page.waitForTimeout(1_000);
    await expect(notice(page)).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
});

test.describe("the Claude credit notice and Settings on a wide screen", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    await reseedDemo(page);
  });

  test("Ask shows the notice and I've topped up works through a small dialog", async ({ page }) => {
    await setMoneyVisible(page, true);
    const stub = await stubStatus(page, "exhausted");
    await openAsk(page);
    await expect(notice(page)).toHaveText(/Claude credits are used up/);

    await notice(page).getByRole("button", { name: "I've topped up" }).click();
    const dialog = page.getByRole("dialog", { name: "I've topped up" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Credit bought (US$)").fill("0");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Enter the credit you bought in US dollars, more than 0 and at most 10,000.");
    await dialog.getByLabel("Credit bought (US$)").fill("50.5");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);
    expect(stub.toppedUp).toEqual([{ creditUsd: 50.5 }]);
    await expect(notice(page)).toHaveCount(0);
  });

  test("Settings has an Ask and AI section with the status line, both actions and when it was last checked", async ({ page }) => {
    await setMoneyVisible(page, true);
    const stub = await stubStatus(page, "low");
    await gotoPageAfterApi(page, "/settings?view=household", "/api/settings-page", () => page.getByRole("heading", { name: "Settings", exact: true }));

    const toggle = page.getByRole("button", { name: /Ask and AI/ });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    const section = page.locator("#settings-ask-ai");
    await expect(section.locator(".claude-credit-line")).toHaveText("Claude credits are running low: about $16.40 of $20 used. Ask still works.");
    await expect(section.getByRole("link", { name: "Top up in the Claude Console" })).toHaveAttribute("href", BILLING);
    await expect(section.getByText("Last checked", { exact: true })).toBeVisible();

    await section.getByRole("button", { name: "I've topped up" }).click();
    const dialog = page.getByRole("dialog", { name: "I've topped up" });
    await dialog.getByLabel("Credit bought (US$)").fill("30");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);
    expect(stub.toppedUp).toEqual([{ creditUsd: 30 }]);
    await expect(section.locator(".claude-credit-line")).toHaveText("Claude credits are fine: about $0 of $30 used.");
  });

  test("Settings shows this month's Claude spend and who is asked first, in each mode, and hides the dollars with money hidden", async ({ page }) => {
    await setMoneyVisible(page, true);
    const modes = [
      { mode: "claude_all", monthSpendUsd: 3.2, text: "Claude this month: $3.20 of $8 \u00b7 background help is using Claude" },
      { mode: "ask_only", monthSpendUsd: 5.5, text: "Claude this month: $5.50 of $8 \u00b7 background help is using the basic model to save budget" },
      { mode: "basic_first", monthSpendUsd: 7.5, text: "Claude this month: $7.50 of $8 \u00b7 everything is using the basic model to save budget" }
    ];
    for (const { mode, monthSpendUsd, text } of modes) {
      await page.unroute(`**${STATUS_PATH}`);
      await page.route(`**${STATUS_PATH}`, (route) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(statusBody("ok", { mode, monthSpendUsd }))
      }));
      await gotoPageAfterApi(page, "/settings?view=household", "/api/settings-page", () => page.getByRole("heading", { name: "Settings", exact: true }));
      await page.getByRole("button", { name: /Ask and AI/ }).click();
      const section = page.locator("#settings-ask-ai");
      await expect(section.locator(".claude-credit-month")).toHaveText(text);
      await expect(section.locator(".claude-credit-line")).toHaveText("Claude credits are fine: about $3.20 of $20 used.");
      if (SHOT_DIR) {
        await section.screenshot({ path: `${SHOT_DIR}/settings-${mode}.png` });
      }
    }
    await setMoneyVisible(page, false);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Ask and AI/ }).click();
    const hidden = page.locator("#settings-ask-ai .claude-credit-month");
    await expect(hidden).toHaveText("Claude this month \u00b7 everything is using the basic model to save budget");
  });

  test("Settings says Claude hasn't been used yet when it is set up but has not answered", async ({ page }) => {
    await setMoneyVisible(page, true);
    await page.route(`**${STATUS_PATH}`, (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(statusBody("unknown", { estimatedSpendUsd: 0, lastSuccessAt: undefined }))
    }));
    await gotoPageAfterApi(page, "/settings?view=household", "/api/settings-page", () => page.getByRole("heading", { name: "Settings", exact: true }));
    await page.getByRole("button", { name: /Ask and AI/ }).click();
    const section = page.locator("#settings-ask-ai");
    await expect(section.locator(".claude-credit-line")).toHaveText("Claude hasn't been used yet.");
    await expect(section.getByRole("link")).toHaveCount(0);
    await expect(section.getByRole("button", { name: "I've topped up" })).toHaveCount(0);
  });

  test("Settings says calmly when Claude isn't set up, with no actions; a hidden status hides the section", async ({ page }) => {
    await setMoneyVisible(page, true);
    const stub = await stubStatus(page, "off");
    await gotoPageAfterApi(page, "/settings?view=household", "/api/settings-page", () => page.getByRole("heading", { name: "Settings", exact: true }));
    await page.getByRole("button", { name: /Ask and AI/ }).click();
    const section = page.locator("#settings-ask-ai");
    await expect(section.locator(".claude-credit-line")).toHaveText("Claude isn't set up, so Ask uses the basic model.");
    await expect(section.getByRole("link")).toHaveCount(0);
    await expect(section.getByRole("button", { name: "I've topped up" })).toHaveCount(0);
    expect(stub.reads).toBe(1);

    await page.unroute(`**${STATUS_PATH}`);
    await page.route(`**${STATUS_PATH}`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, visible: false }) }));
    await gotoPageAfterApi(page, "/settings?view=household", "/api/settings-page", () => page.getByRole("heading", { name: "Settings", exact: true }));
    await expect(page.getByRole("button", { name: /Apple Pay|Shortcut/ }).first()).toBeVisible();
    await page.waitForTimeout(1_000);
    await expect(page.locator("#settings-ask-ai")).toHaveCount(0);
  });
});
