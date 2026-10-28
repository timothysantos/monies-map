import { expect, test } from "@playwright/test";

import { reseedDemo } from "./helpers";

// Reminders in Ask (docs/flows/reminders-flow.md; docs/audits/reminders.md).
// The reminders route is stubbed per test with the facts the fixed rules would
// raise, so these never depend on today's date or the demo household; the
// rules themselves are proved on a real Worker and D1 in
// tests/reminders-rules.test.mjs and tests/reminders-api.test.mjs. They prove
// what a person sees and does: cards on top of the Ask chat (2 on a phone, 3
// in the docked panel, "N more"), their words and money, Later (a sheet on a
// phone, a menu on a wide screen) and what it remembers on this device, the
// card's action opening the right page, hidden money, nothing when there is
// nothing (and no shift), none in add mode, and the Ask tab's dot.
//
// Phone tests are tagged @webkit as the Ask specs are.

const PHONE = { width: 390, height: 664 };
const ASK = "/ask?view=person-tim&month=2026-04";
const STORAGE_KEY = "monies.reminders.v1";

const cardBill = { key: "card_bill:acct-uob:2026-09", kind: "card_bill", accountId: "acct-uob", accountName: "UOB PRVI Miles", statementMonth: "2026-09", dueDate: "2026-10-18", daysUntilDue: 6, leftMinor: 52773, paidMinor: 0, currency: "SGD" };
const statement = { key: "statement:acct-ocbc:2026-09", kind: "statement_missing", accountId: "acct-ocbc", accountName: "OCBC 365 Card", statementMonth: "2026-09", expectedOn: "2026-09-30", daysSinceExpected: 12 };
const settleUp = { key: "splits:settle_up:cp-1", kind: "splits_waiting", variant: "settle_up", fromName: "Serene", toName: "Ethan", direction: "you_owe", amountMinor: 104724, currency: "SGD", sinceDate: "2026-09-06", weeks: 5 };
const price = { key: "price:monthly|SPOTIFY:2026-10-07", kind: "price_change", payeeName: "Spotify", period: "monthly", fromMinor: 1598, toMinor: 1798, firstNewChargeDate: "2026-10-07", priorChargeCount: 11, currency: "SGD" };
const monthClose = {
  key: "month_close:2026-09", kind: "month_close", month: "2026-09", allDone: false,
  checks: [
    { id: "statements", done: true, count: 6 },
    { id: "other", done: true, count: 0 },
    { id: "splits", done: false, count: 1, amountMinor: 104724, currency: "SGD", withName: "Ethan" },
    { id: "note", done: true, count: 1 }
  ]
};

function singaporeToday(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore" }).format(date);
}

// Stubs the route; `current.reminders` can change mid-test, `current.status` too.
async function stubReminders(page, reminders, { status = 200 } = {}) {
  const current = { reminders, status, reads: 0 };
  await page.route("**/api/reminders**", (route) => {
    current.reads += 1;
    if (current.status !== 200) {
      return route.fulfill({ status: current.status, contentType: "application/json", body: JSON.stringify({ ok: false, error: "Reminders failed" }) });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ viewId: "person-tim", today: singaporeToday(), reminders: current.reminders })
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

const region = (page) => page.getByRole("region", { name: "Reminders", exact: true });
const card = (page, title) => region(page).locator("article", { hasText: title });
// To Summary, once Ask has gone from the screen (a page keeps showing until the next one is ready).
async function leaveAsk(page) {
  await page.locator("nav.tab-strip a", { hasText: "Summary" }).first().click();
  await expect(page.locator(".ask-thread")).toHaveCount(0);
}
const storedState = (page) => page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null"), STORAGE_KEY);

test.describe("reminders in Ask on a phone @webkit", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(PHONE);
    await reseedDemo(page);
    await setMoneyVisible(page, true);
  });

  test("two cards and '1 more reminder' sit above Since you last looked, and the third opens in place", async ({ page }) => {
    await stubReminders(page, [cardBill, statement, settleUp]);
    await openAsk(page);
    await expect(region(page)).toBeVisible();
    await expect(region(page).locator("article")).toHaveCount(2);
    await expect(card(page, "UOB PRVI Miles bill due in 6 days")).toContainText("Due Sun 18 Oct. Nothing paid to it since the statement.");
    await expect(card(page, "UOB PRVI Miles bill due in 6 days")).toContainText("$527.73");
    await expect(card(page, "OCBC 365 Card's September statement should be out")).toBeVisible();
    await expect(region(page).getByText("3", { exact: true })).toBeVisible();

    // Reminders come before the brief in the thread.
    const order = await page.evaluate(() => {
      const thread = document.querySelector(".ask-thread");
      const reminders = thread.querySelector(".reminders");
      const brief = [...thread.querySelectorAll(".ask-k")].find((node) => /since you last looked/i.test(node.textContent));
      return { before: Boolean(brief) && Boolean(reminders.compareDocumentPosition(brief) & Node.DOCUMENT_POSITION_FOLLOWING), hasBrief: Boolean(brief) };
    });
    expect(order.before || !order.hasBrief).toBe(true);

    const more = page.getByRole("button", { name: "1 more reminder" });
    await expect(more).toBeVisible();
    const box = await more.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
    await more.click();
    await expect(region(page).locator("article")).toHaveCount(3);
    await expect(card(page, "Settle-up with Ethan waiting 5 weeks")).toContainText("On 6 Sep you agreed to pay Ethan this to even out your shared costs.");
    await expect(more).toHaveCount(0);
  });

  test("Later opens a sheet with the three days and the skip choices, folds the card, and is remembered on this device", async ({ page }) => {
    await stubReminders(page, [cardBill, statement]);
    await openAsk(page);
    const bill = card(page, "UOB PRVI Miles bill due in 6 days");
    await bill.getByRole("button", { name: "Later" }).click();
    const sheet = page.getByRole("dialog", { name: "Remind me later" });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText("UOB PRVI Miles bill");
    for (const label of ["Tomorrow", "In 3 days", "Next week", "Not for this bill", "Paid from another account"]) {
      await expect(sheet.getByRole("button", { name: new RegExp(`^${label}`) })).toBeVisible();
    }
    await expect(sheet.getByRole("button", { name: /^Tomorrow/ })).toContainText(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} [A-Z][a-z]{2}/);
    await expect(sheet).toContainText("This only hides it on this device.");
    await sheet.getByRole("button", { name: /^Tomorrow/ }).click();

    // The card folds into one line with Undo, for this visit.
    await expect(region(page).getByText(/^Back on /)).toBeVisible();
    await expect(card(page, "UOB PRVI Miles bill due in 6 days")).toHaveCount(0);
    const state = await storedState(page);
    expect(state.v).toBe(1);
    expect(state.items[cardBill.key]).toMatchObject({ until: singaporeToday(1), seen: false });

    // Undo brings it back and forgets the choice.
    await region(page).getByRole("button", { name: "Undo" }).click();
    await expect(card(page, "UOB PRVI Miles bill due in 6 days")).toBeVisible();
    expect((await storedState(page)).items[cardBill.key].until).toBeUndefined();

    // Later again, then reopen Ask: it stays away until its day.
    await card(page, "UOB PRVI Miles bill due in 6 days").getByRole("button", { name: "Later" }).click();
    await page.getByRole("dialog", { name: "Remind me later" }).getByRole("button", { name: /^In 3 days/ }).click();
    await openAsk(page);
    await expect(region(page).locator("article")).toHaveCount(1);
    await expect(card(page, "UOB PRVI Miles bill due in 6 days")).toHaveCount(0);
    expect((await storedState(page)).items[cardBill.key].until).toBe(singaporeToday(3));
  });

  test("'Paid from another account' and 'Not for this statement' hide that one for good", async ({ page }) => {
    await stubReminders(page, [cardBill, statement]);
    await openAsk(page);
    await card(page, "UOB PRVI Miles bill due in 6 days").getByRole("button", { name: "Later" }).click();
    await page.getByRole("dialog", { name: "Remind me later" }).getByRole("button", { name: /^Paid from another account/ }).click();
    await card(page, "OCBC 365 Card").getByRole("button", { name: "Later" }).click();
    const sheet = page.getByRole("dialog", { name: "Remind me later" });
    await expect(sheet.getByRole("button", { name: /^Not for this statement/ })).toContainText("back for October's");
    await sheet.getByRole("button", { name: /^Not for this statement/ }).click();
    const state = await storedState(page);
    expect(state.items[cardBill.key].skip).toBe(true);
    expect(state.items[statement.key].skip).toBe(true);
    await openAsk(page);
    await expect(region(page)).toHaveCount(0);
  });

  test("each card's main action opens the page that settles it", async ({ page }) => {
    await stubReminders(page, [statement, cardBill]);
    await openAsk(page);
    await card(page, "OCBC 365 Card").getByRole("button", { name: "Import statement" }).click();
    await expect(page).toHaveURL(/\/imports/);

    await openAsk(page);
    await card(page, "UOB PRVI Miles bill").getByRole("button", { name: "Open card" }).click();
    await expect(page).toHaveURL(/\/entries\?.*entry_wallet=acct-uob/);
  });

  test("a price change has Got it instead of Later, and a month's checklist shows its four checks and opens each page", async ({ page }) => {
    await stubReminders(page, [monthClose, price]);
    await openAsk(page);
    const close = card(page, "September is ready to close");
    await expect(close).toContainText("Every statement is in. 3 of 4 checks done.");
    await expect(close.getByRole("img", { name: "3 of 4 checks done" })).toBeVisible();
    for (const label of ["Statements imported", "Left in Other (no category)", "Splits to settle", "Month note"]) {
      await expect(close).toContainText(label);
    }
    await expect(close).toContainText("$1,047.24");
    await expect(close).toContainText("with Ethan");
    expect(await close.locator("button.reminder-row").count()).toBe(1);

    const spotify = card(page, "Spotify now costs $17.98 a month");
    await expect(spotify).toContainText("Up from $15.98, its price for the 11 months before. First new charge on 7 Oct.");
    await expect(spotify).toContainText("+$2.00");
    await expect(spotify.getByRole("button", { name: "Later" })).toHaveCount(0);
    await spotify.getByRole("button", { name: "Got it" }).click();
    await expect(region(page).getByText("Got it", { exact: true })).toBeVisible();
    expect((await storedState(page)).items[price.key].skip).toBe(true);

    await close.getByRole("button", { name: /Splits to settle/ }).click();
    await expect(page).toHaveURL(/\/splits/);
    await openAsk(page);
    await card(page, "September is ready to close").getByRole("button", { name: "Open September" }).click();
    await expect(page).toHaveURL(/\/month\?.*month=2026-09/);
  });

  test("a finished checklist shows one 'all in' line, once, only after it was shown open", async ({ page }) => {
    const done = { ...monthClose, allDone: true, checks: monthClose.checks.map((check) => ({ ...check, done: true })) };
    const current = await stubReminders(page, [monthClose]);
    await openAsk(page);
    await expect(card(page, "September is ready to close")).toBeVisible();
    expect((await storedState(page)).items[monthClose.key].open).toBe(true);

    current.reminders = [done];
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(region(page).getByText("September is all in")).toBeVisible();
    await expect(region(page).locator("article")).toHaveCount(0);
    await expect.poll(async () => (await storedState(page)).items[monthClose.key].doneShown).toBe(true);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Ask", exact: true })).toBeVisible();
    await page.waitForTimeout(600);
    await expect(region(page)).toHaveCount(0);
  });

  test("with money hidden the amounts are masked and no sentence says who owes whom", async ({ page }) => {
    await stubReminders(page, [cardBill, settleUp, price]);
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "false"));
    await openAsk(page);
    await page.getByRole("button", { name: "1 more reminder" }).click();
    const text = await region(page).innerText();
    expect(text).toContain("••••");
    expect(text).not.toMatch(/\$\d/);
    expect(text).not.toMatch(/527|1,047|17\.98|15\.98/);
    expect(text).toContain("Agreed on 6 Sep to even out your shared costs.");
    expect(text).not.toMatch(/you agreed|pay Ethan|owe/i);
    expect(text).toContain("Spotify's price changed");
  });

  test("nothing shows, and nothing moves, when there is nothing to remind", async ({ page }) => {
    const current = await stubReminders(page, []);
    await openAsk(page);
    await expect.poll(() => current.reads).toBeGreaterThan(0);
    await expect(region(page)).toHaveCount(0);
    const before = await page.locator(".ask-thread").evaluate((node) => node.firstElementChild?.getBoundingClientRect().top);
    await page.waitForTimeout(500);
    const after = await page.locator(".ask-thread").evaluate((node) => node.firstElementChild?.getBoundingClientRect().top);
    expect(after).toBe(before);
  });

  test("a failed read shows nothing and Ask still works", async ({ page }) => {
    await stubReminders(page, [cardBill], { status: 500 });
    await openAsk(page);
    await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
    await page.waitForTimeout(500);
    await expect(region(page)).toHaveCount(0);
  });

  test("add mode shows no reminders and never asks for them; neither does the first screen", async ({ page }) => {
    const current = await stubReminders(page, [cardBill]);
    await page.goto("/summary?view=person-tim", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__MONIES_MAP_ROUTE_WORK__?.usable === true, null, { timeout: 60_000 });
    await page.waitForTimeout(3_000);
    expect(current.reads).toBe(0);
    await page.goto("/ask?view=person-tim&month=2026-04&mode=add&from=entries", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".ask-thread")).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(800);
    await expect(region(page)).toHaveCount(0);
    expect(current.reads).toBe(0);
  });

  test("the Ask tab shows a dot only for a reminder this device has not seen, and its label says why", async ({ page }) => {
    await stubReminders(page, [cardBill, statement]);
    await page.goto("/summary?view=person-tim", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__MONIES_MAP_ROUTE_WORK__?.usable === true, null, { timeout: 60_000 });
    const askTab = page.locator("nav.tab-strip a.tab-phone-only").first();
    // The app made no reminders request of its own, so there is no dot yet.
    await expect(askTab.locator(".tab-dot")).toHaveCount(0);

    // Opening Ask with the cards on show marks them seen.
    await askTab.click();
    await expect(region(page).locator("article")).toHaveCount(2);
    await expect.poll(async () => (await storedState(page))?.items?.[cardBill.key]?.seen).toBe(true);
    await leaveAsk(page);
    await expect(page.locator("nav.tab-strip a.tab-phone-only .tab-dot")).toHaveCount(0);

    // Later to tomorrow in Ask; then a day goes by on this device.
    await askTab.click();
    await card(page, "OCBC 365 Card").getByRole("button", { name: "Later" }).click();
    await page.getByRole("dialog", { name: "Remind me later" }).getByRole("button", { name: /^Tomorrow/ }).click();
    await leaveAsk(page);
    await expect(page.locator("nav.tab-strip a.tab-phone-only .tab-dot")).toHaveCount(0);
    await page.evaluate(({ key, yesterday }) => {
      const state = JSON.parse(window.localStorage.getItem(key));
      for (const item of Object.values(state.items)) if (item.until) item.until = yesterday;
      window.localStorage.setItem(key, JSON.stringify(state));
      window.dispatchEvent(new StorageEvent("storage", { key }));
    }, { key: STORAGE_KEY, yesterday: singaporeToday(-1) });
    const dot = page.locator("nav.tab-strip a.tab-phone-only .tab-dot");
    await expect(dot).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Ask, 1 reminder" })).toBeVisible();

    // Opening Ask shows it again and the dot clears.
    await page.getByRole("link", { name: "Ask, 1 reminder" }).click();
    await expect(card(page, "OCBC 365 Card")).toBeVisible();
    await leaveAsk(page);
    await expect(page.locator("nav.tab-strip a.tab-phone-only .tab-dot")).toHaveCount(0);
  });

  test("with storage blocked every reminder shows and choosing Later does not break the page", async ({ page }) => {
    await page.addInitScript(() => {
      const blocked = () => { throw new DOMException("blocked", "SecurityError"); };
      const original = Storage.prototype.getItem;
      Storage.prototype.getItem = function getItem(key) {
        return key === "monies.reminders.v1" ? blocked() : original.call(this, key);
      };
      const originalSet = Storage.prototype.setItem;
      Storage.prototype.setItem = function setItem(key, value) {
        return key === "monies.reminders.v1" ? blocked() : originalSet.call(this, key, value);
      };
    });
    await stubReminders(page, [cardBill, statement]);
    await openAsk(page);
    await expect(region(page).locator("article")).toHaveCount(2);
    await card(page, "OCBC 365 Card").getByRole("button", { name: "Later" }).click();
    await page.getByRole("dialog", { name: "Remind me later" }).getByRole("button", { name: /^Tomorrow/ }).click();
    await expect(region(page).getByText(/^Back on /)).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
  });
});

test.describe("reminders in the docked Ask panel (1440 wide)", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await reseedDemo(page);
    await setMoneyVisible(page, true);
  });

  async function openDock(page) {
    await page.goto("/summary?view=person-tim", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__MONIES_MAP_ROUTE_WORK__?.usable === true, null, { timeout: 60_000 });
    await page.getByRole("textbox", { name: "Ask", exact: true }).click();
    await expect(page.locator(".ask-dock .ask-thread")).toBeVisible({ timeout: 30_000 });
  }

  test("three cards and '1 more reminder' in the panel; Later is a small menu under the button", async ({ page }) => {
    await stubReminders(page, [cardBill, statement, settleUp, price]);
    await openDock(page);
    const inDock = page.locator(".ask-dock").getByRole("region", { name: "Reminders", exact: true });
    await expect(inDock.locator("article")).toHaveCount(3);
    await expect(inDock.getByRole("button", { name: "1 more reminder" })).toBeVisible();

    await inDock.locator("article", { hasText: "OCBC 365 Card" }).getByRole("button", { name: "Later" }).click();
    const menu = page.locator(".reminder-later-popover");
    await expect(menu).toBeVisible();
    await expect(menu).toContainText("Remind me later");
    for (const label of ["Tomorrow", "In 3 days", "Next week", "Not for this statement"]) {
      await expect(menu.getByRole("button", { name: new RegExp(`^${label}`) })).toBeVisible();
    }
    await expect(page.locator(".note-dialog-overlay")).toHaveCount(0);
    await menu.getByRole("button", { name: /^Next week/ }).click();
    await expect(inDock.getByText(/^Back on Mon /)).toBeVisible();
    const state = await storedState(page);
    expect(new Date(`${state.items[statement.key].until}T00:00:00Z`).getUTCDay()).toBe(1);
  });

  test("a card's action opens the page beside the panel, and the Ask field's dot appears for a returning reminder and clears when it is seen", async ({ page }) => {
    await stubReminders(page, [cardBill, statement]);
    await openDock(page);
    const inDock = page.locator(".ask-dock").getByRole("region", { name: "Reminders", exact: true });
    await inDock.locator("article", { hasText: "OCBC 365 Card" }).getByRole("button", { name: "Later" }).click();
    await page.locator(".reminder-later-popover").getByRole("button", { name: /^Tomorrow/ }).click();
    await inDock.locator("article", { hasText: "UOB PRVI Miles" }).getByRole("button", { name: "Open card" }).click();
    await expect(page).toHaveURL(/\/entries\?.*entry_wallet=acct-uob/);
    await expect(page.locator(".ask-dock")).toBeVisible();

    // Close the panel; no dot while everything is seen or waiting.
    await page.getByRole("button", { name: "Close Ask" }).click();
    const field = page.locator(".ask-dock-field");
    await expect(field).toBeVisible();
    await expect(field.locator(".tab-dot")).toHaveCount(0);

    // A day goes by on this device: the dot is on the sparkle and the field's label says why.
    await page.evaluate(({ key, yesterday }) => {
      const state = JSON.parse(window.localStorage.getItem(key));
      for (const item of Object.values(state.items)) if (item.until) item.until = yesterday;
      window.localStorage.setItem(key, JSON.stringify(state));
      window.dispatchEvent(new StorageEvent("storage", { key }));
    }, { key: STORAGE_KEY, yesterday: singaporeToday(-1) });
    await expect(field.locator(".ask-dock-field-dot")).toHaveCount(1);
    await expect(page.getByRole("textbox", { name: "Ask, 1 reminder" })).toBeVisible();

    // Opening Ask with it on show clears the dot.
    await page.getByRole("textbox", { name: "Ask, 1 reminder" }).click();
    await expect(page.locator(".ask-dock").getByRole("region", { name: "Reminders", exact: true }).locator("article", { hasText: "OCBC 365 Card" })).toBeVisible();
    await page.getByRole("button", { name: "Close Ask" }).click();
    await expect(page.locator(".ask-dock-field")).toBeVisible();
    await expect(page.locator(".ask-dock-field .tab-dot")).toHaveCount(0);
  });

  test("the cards stay inside the panel and nothing reaches under it", async ({ page }) => {
    await stubReminders(page, [cardBill, statement, settleUp]);
    await openDock(page);
    const box = await page.locator(".ask-dock").boundingBox();
    const cards = page.locator(".ask-dock article.reminder-card");
    for (let index = 0; index < (await cards.count()); index += 1) {
      const rect = await cards.nth(index).boundingBox();
      expect(rect.x).toBeGreaterThanOrEqual(box.x);
      expect(rect.x + rect.width).toBeLessThanOrEqual(box.x + box.width + 1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  });
});

test("the real route answers the demo household with a list the screen can read", async ({ page }) => {
  await reseedDemo(page);
  const response = await page.request.get("/api/reminders?view=household");
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(Array.isArray(body.reminders)).toBe(true);
  expect(body.reminders.length).toBeLessThanOrEqual(20);
  expect(body.viewId).toBe("household");
  expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect((await page.request.post("/api/reminders", { data: {} })).status()).toBe(405);
});
