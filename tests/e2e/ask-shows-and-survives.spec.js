import { expect, test } from "@playwright/test";

import { loadEntriesPage, reseedDemo } from "./helpers";

// What Ask shows and how it survives trouble, on a phone (Ask audit
// 2026-11-17; docs/flows/ask-flow.md "No connection", design.md "Ask
// conversation scroll"). Real Worker, AI off as on every test stack, so
// every message is read by the built-in rules. No connection is the
// browser's own offline switch: nothing is stubbed.
//
// - A1: the card a message made or changed keeps its name and amount in
//   view under the header, with Save in reach.
// - A8 + A9: no connection keeps the words with Try again; a plain card's
//   Save waits in "Waiting to send" and lands exactly once.
// - A10: New chat puts an unsaved card aside with Bring it back.
// - A14: with money hidden an answer offers Show money totals.

const phone = { width: 390, height: 844 };

test.use({ viewport: phone, hasTouch: true });

async function openAsk(page, { visible = true } = {}) {
  await page.addInitScript((shown) => window.localStorage.setItem("monies-map:money-totals-visible", shown ? "true" : "false"), visible);
  await page.goto("/");
  await reseedDemo(page);
  await page.goto("/ask?view=person-tim");
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible({ timeout: 60_000 });
}

async function send(page, text) {
  const box = page.getByRole("textbox", { name: "Message" });
  await box.fill(text);
  await box.press("Enter");
}

const chips = (page) => page.getByRole("group", { name: "Suggestions" }).getByRole("button");

// Where the card's top and its amount sit against the conversation's
// visible area (below the page header, above the chips).
async function cardPlacement(page) {
  return page.evaluate(() => {
    const box = document.querySelector(".ask-thread").getBoundingClientRect();
    const card = document.querySelector(".ask-thread > .ask-card").getBoundingClientRect();
    const amount = document.querySelector(".ask-thread > .ask-card .ask-card-amount").getBoundingClientRect();
    const save = document.querySelector(".ask-bottom").getBoundingClientRect();
    return { boxTop: box.top, boxBottom: box.bottom, cardTop: card.top, amountTop: amount.top, amountBottom: amount.bottom, bottomTop: save.top };
  });
}

async function settled(page) {
  // Let the smooth scroll finish.
  await expect.poll(async () => {
    const first = await page.evaluate(() => document.querySelector(".ask-thread").scrollTop);
    await page.waitForTimeout(150);
    return first === await page.evaluate(() => document.querySelector(".ask-thread").scrollTop);
  }).toBe(true);
}

async function todayMonth(page) {
  return page.evaluate(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore" }).format(new Date()).slice(0, 7));
}

test("A1: a card made or changed by a message shows its name and amount under the header, Save in reach", async ({ page }) => {
  await openAsk(page);
  await send(page, "Koufu lunch $12.50 citi");
  const card = page.locator('[data-ask-card="draft"]');
  await expect(card.locator(".ask-card-amount-input")).toHaveValue(/^12\.50?$/);
  await settled(page);
  let place = await cardPlacement(page);
  expect(place.cardTop).toBeGreaterThanOrEqual(place.boxTop - 1);
  expect(place.amountBottom).toBeLessThanOrEqual(place.boxBottom);
  await expect(page.getByRole("button", { name: "Save" })).toBeInViewport();

  await send(page, "make it 14");
  await expect(card.locator(".ask-card-amount-input")).toHaveValue(/^14(\.00?)?$/);
  await settled(page);
  place = await cardPlacement(page);
  expect(place.cardTop).toBeGreaterThanOrEqual(place.boxTop - 1);
  expect(place.amountTop).toBeGreaterThanOrEqual(place.boxTop);
  expect(place.amountBottom).toBeLessThanOrEqual(place.boxBottom);
});

test("A8 + A9: no connection keeps the words with Try again, and the card's Save waits to send and lands once", async ({ page, context }) => {
  await openAsk(page);
  const message = page.getByRole("textbox", { name: "Message" });

  await context.setOffline(true);
  await send(page, "Koufu dinner $18 citi");
  await expect(page.locator(".ask-note").filter({ hasText: "No connection." })).toHaveText("No connection. Your message is kept.");
  // The words are back in the box, not guessed at: no card, no rules note,
  // no "Reply from" line and no bubble for a message that never left.
  await expect(message).toHaveValue("Koufu dinner $18 citi");
  await expect(page.locator(".ask-card")).toHaveCount(0);
  await expect(page.locator("[data-reply-source]")).toHaveCount(0);
  await expect(page.locator(".ask-me")).toHaveCount(0);
  await expect(page.locator(".ask-note").filter({ hasText: "couldn't read" })).toHaveCount(0);
  await expect(chips(page).first()).toHaveText("Try again");
  await expect(chips(page).first()).toHaveClass(/is-primary/);

  // Back online, Try again reads it.
  await context.setOffline(false);
  await chips(page).first().click();
  const card = page.locator('[data-ask-card="draft"]');
  await expect(card.locator(".ask-card-amount-input")).toHaveValue(/^18(\.00?)?$/);
  await expect(message).toHaveValue("");
  await expect(page.locator(".ask-note").filter({ hasText: "No connection." })).toHaveCount(0);

  // Offline again, Save keeps it waiting on this phone, as the quick pad does.
  const creates = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/entries/create") && request.method() === "POST") creates.push(request.postDataJSON());
  });
  await context.setOffline(true);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".ask-note").filter({ hasText: "Waiting to send" })).toHaveText("Waiting to send: Koufu dinner, $18.00");
  const waiting = page.locator("[data-ask-waiting]");
  await expect(waiting).toContainText("Waiting to send");
  await expect(waiting).toContainText("Kept on this phone. It sends by itself when the connection is back.");
  await expect(waiting.locator("li")).toHaveText(["Koufu dinner, $18.00Remove"]);
  await expect(page.locator(".ask-card")).toHaveCount(0);
  const kept = await page.evaluate(() => JSON.parse(window.localStorage.getItem("monies.cashWaiting.v1")));
  expect(kept).toHaveLength(1);
  expect(kept[0]).toMatchObject({ endpoint: "/api/entries/create", body: { description: "Koufu dinner", amountMinor: 1800, entryType: "expense" } });
  expect(kept[0].requestId).toMatch(/^ask:/);
  expect(kept[0].body.externalReference).toBe(kept[0].requestId);

  // The connection comes back: it sends by itself, once, and leaves the list.
  await context.setOffline(false);
  await expect(waiting).toHaveCount(0, { timeout: 20_000 });
  const month = await todayMonth(page);
  const named = async () => (await loadEntriesPage(page, { month })).monthPage.entries.filter((entry) => entry.description === "Koufu dinner");
  await expect.poll(async () => (await named()).length).toBe(1);
  expect(creates.every((body) => body.externalReference === kept[0].requestId)).toBe(true);

  // Sent again with the same reference (an answer that never arrived), it is
  // still the one entry.
  const again = await page.request.post("/api/entries/create", { data: kept[0].body });
  expect(again.ok()).toBe(true);
  expect((await again.json()).created).toBe(false);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible({ timeout: 60_000 });
  expect(await named()).toHaveLength(1);
});

test("A9: a waiting card can be removed, and then nothing is sent", async ({ page, context }) => {
  await openAsk(page);
  await send(page, "Kopi $2.40 citi");
  await expect(page.locator('[data-ask-card="draft"] .ask-card-amount-input')).toHaveValue(/^2\.40?$/);
  await context.setOffline(true);
  await page.getByRole("button", { name: "Save" }).click();
  const waiting = page.locator("[data-ask-waiting]");
  await expect(waiting.locator("li")).toHaveCount(1);
  await waiting.getByRole("button", { name: "Remove" }).click();
  await expect(waiting).toHaveCount(0);
  expect(await page.evaluate(() => window.localStorage.getItem("monies.cashWaiting.v1"))).toBeNull();
  await context.setOffline(false);
  await page.waitForTimeout(1_500);
  const entries = (await loadEntriesPage(page, { month: await todayMonth(page) })).monthPage.entries;
  expect(entries.filter((entry) => entry.description === "Kopi")).toHaveLength(0);
});

test("A9: a card on Splits cannot wait, so it stays and says why", async ({ page, context }) => {
  await openAsk(page);
  await send(page, "Koufu lunch $12.50 citi");
  await expect(page.locator('[data-ask-card="draft"] .ask-card-amount-input')).toHaveValue(/^12\.50?$/);
  await chips(page).filter({ hasText: /^Split with / }).first().click();
  await expect(chips(page).filter({ hasText: "Not shared" })).toHaveCount(1);
  // With more than one group, the card needs one before it can save.
  const groupRow = page.locator('[data-ask-row="splitGroup"]');
  if (await groupRow.count()) {
    await groupRow.click();
    await page.locator(".mobile-select-dialog .mobile-select-option").filter({ hasNotText: "Choose" }).first().click();
  }
  await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();
  await context.setOffline(true);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".ask-note.is-error")).toHaveText("No connection. Entries on Splits, transfers and income can't wait on this phone, so the card stays here. Save again when the connection is back.");
  await expect(page.locator('[data-ask-card="draft"]')).toBeVisible();
  expect(await page.evaluate(() => window.localStorage.getItem("monies.cashWaiting.v1"))).toBeNull();
  await context.setOffline(false);
});

test("A10: New chat puts an unsaved card aside, and Bring it back returns it, after a reload too", async ({ page }) => {
  await openAsk(page);
  await send(page, "Koufu lunch $12.50 citi");
  await expect(page.locator('[data-ask-card="draft"] .ask-card-amount-input')).toHaveValue(/^12\.50?$/);
  await page.getByRole("button", { name: "New chat" }).click();
  await expect(page.locator(".ask-card")).toHaveCount(0);
  await expect(page.locator(".ask-note").filter({ hasText: "put aside" })).toHaveText("The unsaved entry was put aside.");
  await expect(chips(page).first()).toHaveText("Bring it back");
  await expect(chips(page).first()).toHaveClass(/is-primary/);

  await page.reload();
  await expect(chips(page).first()).toHaveText("Bring it back", { timeout: 60_000 });
  await chips(page).first().click();
  const card = page.locator('[data-ask-card="draft"]');
  await expect(card.locator(".ask-card-merchant")).toHaveText("Koufu lunch");
  await expect(card.locator(".ask-card-amount-input")).toHaveValue(/^12\.50?$/);
  await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();
  await expect(chips(page).filter({ hasText: "Bring it back" })).toHaveCount(0);
});

test("A14: with money hidden an answer offers Show money totals, which shows them", async ({ page }) => {
  await openAsk(page, { visible: false });
  await send(page, "how am I doing against the plan?");
  const plan = page.locator('[data-ask-money-answer="plan"]');
  await expect(plan).toBeVisible({ timeout: 30_000 });
  await expect(plan.locator(".ask-answer-amount")).toHaveText("••••");
  const show = plan.getByRole("button", { name: "Show money totals" });
  await expect(show).toBeVisible();
  await show.click();
  await expect(plan.locator(".ask-answer-amount")).not.toHaveText("••••");
  await expect(show).toHaveCount(0);
});
