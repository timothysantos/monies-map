import { devices, expect, test } from "@playwright/test";

import { activeElementName, axeViolations, coveredFocusables, settleAnimations } from "./a11y-helpers";
import { loadSplitsPage, postJson, reseedDemo } from "./helpers";

// Accessibility of the Ask page and the desktop Ask dock (docs/audits/
// a11y-pass.md): axe-core finds nothing on each state, nothing focusable sits
// hidden behind the phone page, focus is never dropped onto the page when a
// control it was on goes away, the conversation can be scrolled from the
// keyboard, and the popovers are named. Real Worker; only the Claude credit
// status is stubbed (as claude-credit-notice.spec.js does).

const iPhone = devices["iPhone 12 Pro"].viewport;
const MONTH = "2026-05";
const STATUS_PATH = "/api/ai-assist/provider-status";
const ASK = `/ask?view=household&month=${MONTH}&scope=direct_plus_shared`;

const message = (page) => page.getByRole("textbox", { name: "Message" });
const suggestions = (page) => page.getByRole("group", { name: "Suggestions" });

async function waitUsable(page) {
  await expect.poll(() => page.evaluate(() => window.__MONIES_MAP_ROUTE_WORK__?.usable ?? false), { timeout: 45_000 }).toBe(true);
}

async function stubCredit(page, state) {
  await page.route(`**${STATUS_PATH}`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true, visible: true, claudeConfigured: true, state, estimatedSpendUsd: 16.4, creditUsd: 20, warnAtUsd: 15,
      monthSpendUsd: 3.2, monthTargetUsd: 8, mode: "claude_all", lastSuccessAt: "2026-10-11T02:00:00.000Z",
      consoleBillingUrl: "https://platform.claude.com/settings/billing"
    })
  }));
}

// An open settlement paid by PayNow: a likely settle-up, so the answer comes
// with "Check this first" (the same set-up as ask-money-answers.spec.js).
async function seedSettlePayNow(page) {
  await postJson(page, "/api/accounts/create", { kind: "bank", name: "DBS Multiplier Account", institution: "DBS", ownerPersonId: "person-joyce", currency: "SGD", openingBalanceMinor: 0 });
  await postJson(page, "/api/splits/expenses/create", {
    groupId: null, date: "2026-05-18", description: "Anniversary dinner", categoryName: "Food & Drinks", payerPersonName: "Joyce",
    amountMinor: 30000, splitAmountMinor: 15000, currency: "SGD", paymentMethod: "cash", paymentStatus: "recorded"
  });
  const { checkpointId } = await postJson(page, "/api/splits/checkpoints/create", { viewerPersonId: "person-tim", date: "2026-05-20", currency: "SGD" });
  const splits = await loadSplitsPage(page, { view: "person-tim", month: MONTH });
  const checkpoint = splits.splitsPage.settlementCheckpoints.find((item) => item.id === checkpointId);
  const name = { "person-tim": "Tim", "person-joyce": "Joyce" };
  const bank = { "person-tim": "UOB Savings", "person-joyce": "DBS Multiplier Account" };
  for (const [personId, other, entryType, categoryName] of [
    [checkpoint.fromPersonId, checkpoint.toPersonId, "expense", "Other"],
    [checkpoint.toPersonId, checkpoint.fromPersonId, "income", "Other - Income"]
  ]) {
    await postJson(page, "/api/entries/create", {
      date: "2026-05-22", description: entryType === "expense" ? `PAYNOW TRANSFER TO ${name[other].toUpperCase()}` : `PAYNOW FROM ${name[other].toUpperCase()}`,
      accountName: bank[personId], categoryName, amountMinor: checkpoint.amountMinor, entryType, ownershipType: "direct", ownerName: name[personId]
    });
  }
}

test.describe("the Ask page on a phone, for keyboards and screen readers", () => {
  test.use({ viewport: iPhone });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.goto("/");
    await reseedDemo(page);
  });

  test("axe finds nothing on the empty page, the + menu, a note and an answer", async ({ page }) => {
    await page.goto(ASK);
    await expect(message(page)).toBeVisible();
    expect(await axeViolations(page), "empty Ask").toEqual([]);

    await page.getByRole("button", { name: "Add a photo or paste" }).click();
    await expect(page.getByRole("dialog", { name: "Add a photo or paste" })).toBeVisible();
    expect(await axeViolations(page), "the + menu open").toEqual([]);
    await page.keyboard.press("Escape");

    await message(page).fill("Should I buy a car?");
    await message(page).press("Enter");
    await expect(page.locator(".ask-note").filter({ hasText: "answered yet" })).toBeVisible();
    await message(page).fill("where did the money go");
    await message(page).press("Enter");
    await expect(page.locator(".ask-answer").first()).toBeVisible({ timeout: 30_000 });
    await settleAnimations(page);
    expect(await axeViolations(page), "a note and an answer card").toEqual([]);
  });

  test("axe finds nothing on Check this first, and on the new entry card with the credit notice and back link", async ({ page }) => {
    await seedSettlePayNow(page);
    await page.goto(ASK);
    await message(page).fill("where did the money go");
    await message(page).press("Enter");
    await expect(page.getByRole("region", { name: "Check this first" })).toBeVisible({ timeout: 30_000 });
    await settleAnimations(page);
    expect(await axeViolations(page), "Check this first").toEqual([]);

    await stubCredit(page, "low");
    await page.goto(`/entries?view=person-tim&month=${MONTH}`);
    await waitUsable(page);
    await page.locator(".entries-fab:not(.splits-fab)").click();
    await expect(page.locator('[data-ask-card="draft"]')).toBeVisible();
    await expect(page.getByRole("region", { name: "Claude credits" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to Entries" })).toBeVisible();
    await settleAnimations(page);
    expect(await axeViolations(page), "new entry card, credit notice, back link").toEqual([]);
  });

  test("nothing hidden behind the page can be focused, and the conversation scrolls from the keyboard", async ({ page }) => {
    await page.goto(ASK);
    await expect(message(page)).toBeVisible();
    // The view pills sit under the full-height Ask page: not reachable.
    expect(await coveredFocusables(page)).toEqual([]);
    await expect(page.locator(".context-block")).toHaveAttribute("inert", "");

    // The conversation is a named, focusable scroll box (arrow keys scroll it).
    const log = page.getByRole("log", { name: "Conversation" });
    await expect(log).toHaveAttribute("tabindex", "0");
    await log.focus();
    await expect(log).toBeFocused();

    // Control: on a desktop width the pills are the page's own.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/entries?view=household&month=${MONTH}`);
    await waitUsable(page);
    await expect(page.locator(".context-block")).not.toHaveAttribute("inert", "");
  });

  test("focus stays on the page when a chip, New chat or the credit notice's dismiss goes away", async ({ page }) => {
    await stubCredit(page, "low");
    await page.goto(ASK);
    await expect(message(page)).toBeVisible();
    const notice = page.getByRole("region", { name: "Claude credits" });
    await expect(notice).toBeVisible();

    // Dismiss (the notice goes): focus moves to the conversation.
    await notice.getByRole("button", { name: /dismiss|close|hide/i }).focus();
    await page.keyboard.press("Enter");
    await expect(notice).toHaveCount(0);
    await expect(page.getByRole("log", { name: "Conversation" })).toBeFocused();

    // A chip that opens the card: its row changes, focus must not drop.
    await suggestions(page).getByRole("button", { name: "Add entry" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-ask-card="draft"]')).toBeVisible();
    expect(await activeElementName(page)).not.toBe("BODY");

    // The back chip (the row changes again), then a note and New chat (the
    // chat is empty again, so its button goes).
    await suggestions(page).getByRole("button", { name: "‹ Ask" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-ask-card="draft"]')).toHaveCount(0);
    expect(await activeElementName(page)).not.toBe("BODY");
    await message(page).fill("Should I buy a car?");
    await message(page).press("Enter");
    await expect(page.locator(".ask-note").filter({ hasText: "answered yet" })).toBeVisible();
    await page.getByRole("button", { name: "New chat" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".ask-note").filter({ hasText: "answered yet" })).toHaveCount(0);
    expect(await activeElementName(page)).not.toBe("BODY");
  });

  test("negative: a chip that keeps its place keeps focus on itself", async ({ page }) => {
    await page.goto(ASK);
    await expect(message(page)).toBeVisible();
    // Paste stays in the row: it must not pull focus to the conversation.
    const paste = suggestions(page).getByRole("button", { name: "Paste" });
    await paste.focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(400);
    expect(await activeElementName(page)).not.toBe("BODY");
    await expect(page.getByRole("log", { name: "Conversation" })).not.toBeFocused();
  });
});

test.describe("the Ask dock on a desktop, for keyboards and screen readers", () => {
  test.use({ viewport: { width: 1400, height: 900 } });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.goto("/");
    await reseedDemo(page);
  });

  test("the Ask field sits in a landmark and the panel is a named complementary", async ({ page }) => {
    await page.goto(`/entries?view=person-tim&month=${MONTH}`);
    await waitUsable(page);
    // Entries rows are role=button with a button inside (listed in the audit, not fixed here).
    expect(await axeViolations(page, { exclude: [".entry-row-main"] }), "Entries with the Ask field").toEqual([]);
    await expect(page.getByRole("region", { name: "Ask" }).getByRole("textbox", { name: "Ask", exact: true })).toBeVisible();

    await page.locator("body").click({ position: { x: 5, y: 300 } });
    await page.keyboard.press("/");
    await expect(message(page)).toBeFocused();
    const panel = page.getByRole("complementary", { name: "Ask" });
    await expect(panel).toBeVisible();
    await message(page).fill("how much on bills?");
    await message(page).press("Enter");
    await expect(page.locator(".ask-dock .ask-answer").first()).toBeVisible({ timeout: 30_000 });
    await settleAnimations(page);
    expect(await axeViolations(page, { exclude: [".entry-row-main"] }), "docked panel with an answer").toEqual([]);

    // Close hands focus back to the field.
    await panel.getByRole("button", { name: /^Close/ }).focus();
    await page.keyboard.press("Enter");
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Ask", exact: true })).toBeFocused();
  });
});
