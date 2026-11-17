import { expect, test } from "@playwright/test";

import { loadEntriesPage, postJson, reseedDemo } from "./helpers";

// Ask audit 2 on a phone (390 wide, light, demo data). The model is stubbed
// as in ask-ai-turn-phase2.spec.js: the page's real /api/ask/turn request
// reaches the real Worker with the model's answer in X-Ask-Turn-Test-Reply,
// so the server still checks it against the household and reads the rows.
// - B14: a bulk change whose category the model left out is the change card;
//   with no category said, "Which category?" offers categories to tap, and
//   a tap makes the card.
// - B15: "make that one Groceries" after an answer that showed one entry
//   changes that entry.
// - B19: "add a new account" opens Settings with the accounts reason.
// - B21: a payment that waited to send says "Sent" once it has gone.

const phone = { width: 390, height: 844 };
const SHOTS = process.env.ASK_FIX2_SHOTS ?? "test-results/ask-fix2";

test.use({ viewport: phone, hasTouch: true });

async function stubModel(page, replies) {
  const seen = [];
  await page.route("**/api/ask/turn", async (route) => {
    seen.push(route.request().postDataJSON());
    const reply = replies.shift();
    const response = await route.fetch({ headers: { ...route.request().headers(), ...(reply ? { "x-ask-turn-test-reply": JSON.stringify(reply) } : {}) } });
    await route.fulfill({ response });
  });
  return seen;
}

async function send(page, text) {
  const message = page.getByRole("textbox", { name: "Message" });
  await message.fill(text);
  await message.press("Enter");
}

async function todayMonth(page) {
  return page.evaluate(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore" }).format(new Date()).slice(0, 7));
}

async function today(page) {
  return page.evaluate(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore" }).format(new Date()));
}

async function createEntry(page, fields) {
  const created = await postJson(page, "/api/entries/create", {
    date: await today(page), accountName: "Citi Rewards", categoryName: "Food & Drinks", amountMinor: 1_000, entryType: "expense", ownershipType: "direct", ownerName: "Tim", ...fields
  });
  return created.entryId;
}

async function entryById(page, id) {
  const data = await loadEntriesPage(page, { view: "person-tim", month: await todayMonth(page) });
  return data.monthPage.entries.find((entry) => entry.id === id) ?? null;
}

async function shot(page, name) {
  await page.screenshot({ path: `${SHOTS}/${name}` });
}

async function openAsk(page) {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await page.goto("/");
  await reseedDemo(page);
}

test("B14: the model leaves the category out: the bulk card; with none said, categories to tap, and a tap makes the card", async ({ page }) => {
  await openAsk(page);
  const ids = [];
  for (const amountMinor of [1_850, 2_240]) {
    ids.push(await createEntry(page, { description: "ZQGRAB* RIDE", amountMinor }));
  }
  const seen = await stubModel(page, [
    { action: "recategorise", recategorise: { category: null, words: "zqgrab" } },
    { action: "recategorise", recategorise: { category: null, words: "zqgrab" } }
  ]);
  await page.goto(`/ask?view=person-tim&month=${await todayMonth(page)}`);
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible({ timeout: 60_000 });

  await send(page, "make all zqgrab rides");
  const question = page.locator(".ask-note, .ask-question").filter({ hasText: "Which category should it go in?" });
  await expect(question.first()).toBeVisible();
  const chip = page.getByRole("button", { name: "Move all zqgrab to Taxi" });
  await expect(chip).toBeVisible();
  await shot(page, "B14-after-2-category-chips.png");

  await chip.click();
  await expect.poll(() => seen.length).toBe(2);
  expect(seen[1].text).toBe("Move all zqgrab to Taxi");
  const card = page.locator('[data-change-draft="draft"][data-change-type="recategorise_bulk"]');
  await expect(card).toBeVisible();
  await expect(card).toContainText("2 entries change category");
  await expect(card.locator('[data-change-field="category"]')).toContainText("Taxi");
  await card.evaluate((element) => element.scrollIntoView({ block: "center" }));
  await shot(page, "B14-after-1-bulk-card.png");
  expect((await entryById(page, ids[0])).categoryName).toBe("Food & Drinks");

  await card.getByRole("button", { name: "Change 2 entries" }).click();
  await expect(page.locator('[data-change-draft="saved"]')).toBeVisible();
  for (const id of ids) {
    await expect.poll(async () => (await entryById(page, id)).categoryName).toBe("Taxi");
  }
});

test("B15: after an answer that showed one entry, \"make that one Groceries\" is a card for that entry; Save moves it", async ({ page }) => {
  await openAsk(page);
  const entryId = await createEntry(page, { description: "ZQKOUFU PTE LTD", amountMinor: 700 });
  const month = await todayMonth(page);
  const seen = await stubModel(page, [
    { action: "search_entries", search: { words: "zqkoufu", month: "this month" } },
    { action: "recategorise", recategorise: { category: "Groceries" } }
  ]);
  await page.goto(`/ask?view=person-tim&month=${month}`);
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible({ timeout: 60_000 });

  await send(page, "what did I pay at zqkoufu this month");
  await expect(page.locator("[data-ask-answer='1']")).toBeVisible();
  await send(page, "make that one groceries");
  await expect.poll(() => seen.length).toBe(2);
  expect(seen[1].focus).toMatchObject({ kind: "entry_list", list: { entryId } });

  const card = page.locator('[data-change-draft="draft"][data-change-type="recategorise"]');
  await expect(card).toBeVisible();
  await expect(card).toContainText("ZQKOUFU PTE LTD");
  await expect(card.locator('[data-change-field="category"]')).toContainText("Groceries");
  // An expense's amount carries its sign, as on the entry card (B29).
  await expect(card.locator(".lsd-amount")).toHaveText("−$7.00");
  await card.evaluate((element) => element.scrollIntoView({ block: "center" }));
  await shot(page, "B15-after-1-that-one-card.png");

  await card.getByRole("button", { name: "Save" }).click();
  await expect(page.locator('[data-change-draft="saved"]')).toBeVisible();
  await expect.poll(async () => (await entryById(page, entryId)).categoryName).toBe("Groceries");
});

test("B19: \"add a new account for my CPF\" says accounts are changed in Settings and opens Settings, whatever the model named", async ({ page }) => {
  await openAsk(page);
  await stubModel(page, [{ action: "cannot_help", blocked: "delete_entry", note: null }]);
  await page.goto("/ask?view=person-tim");
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible({ timeout: 60_000 });
  await send(page, "add a new account for my CPF");
  await expect(page).toHaveURL(/\/settings/);
  await shot(page, "B19-after-1-settings.png");
  await page.goBack();
  await expect(page.locator(".ask-note").filter({ hasText: "Accounts are added and changed in Settings, not from Ask." })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".ask-note").filter({ hasText: "Ask doesn't delete entries" })).toHaveCount(0);
  await shot(page, "B19-after-2-thread.png");
});

test("B17: \"how much did we spend on food this month?\" read by the model as all spending shows the Food & Drinks entries and their total", async ({ page }) => {
  await openAsk(page);
  await stubModel(page, [{ action: "answer_question", question: { topic: "spending_where", month: "this month" } }]);
  await page.goto(`/ask?view=person-tim&month=${await todayMonth(page)}`);
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible({ timeout: 60_000 });
  await send(page, "how much did we spend on food this month?");
  const answer = page.locator(".ask-answer");
  await expect(answer).toBeVisible();
  await expect(answer.locator(".ask-answer-title")).toHaveText("Food & Drinks");
  await shot(page, "B17-after-1-food-answer.png");
});

test("B20: \"settle up with Joyce\" read by the model as a payment with no amount asks which group, with each group to tap", async ({ page }) => {
  await openAsk(page);
  await stubModel(page, [{ action: "draft_settlement", settlement: { from: "Joyce", to: null, amount: null } }]);
  await page.goto("/ask?view=person-tim");
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible({ timeout: 60_000 });
  await send(page, "settle up with joyce");
  const chips = page.getByRole("group", { name: "Suggestions" }).getByRole("button").filter({ hasText: /^Settle up / });
  await expect(chips.first()).toBeVisible();
  expect(await chips.count()).toBeGreaterThanOrEqual(2);
  await expect(page.getByText("How much was paid back?")).toHaveCount(0);
  await shot(page, "B20-after-1-settle-groups.png");
});

test("B30: with money hidden, the draft's amount shows no minus sign", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "false"));
  await page.goto("/");
  await reseedDemo(page);
  await page.goto("/ask?view=person-tim");
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible({ timeout: 60_000 });
  await send(page, "lunch 9.90 citi");
  const card = page.locator('[data-ask-card="draft"]');
  await expect(card.locator(".ask-card-amount-input")).toHaveValue(/^9\.90?$/);
  await expect(card.locator(".ask-card-amount-sign")).toBeHidden();
  expect(await card.locator(".ask-card-amount-prefix").evaluate((element) => element.innerText.trim())).toBe("$");
  await shot(page, "B30-after-1-hidden-draft.png");
});

test("B21: a Save that waited for the connection says Sent once it has gone, and lands once", async ({ page, context }) => {
  await openAsk(page);
  await page.goto("/ask?view=person-tim");
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible({ timeout: 60_000 });
  await send(page, "Teh tarik $1.80 citi");
  await expect(page.locator('[data-ask-card="draft"] .ask-card-amount-input')).toHaveValue(/^1\.80?$/);

  await context.setOffline(true);
  await page.getByRole("button", { name: "Save" }).click();
  const line = page.locator(".ask-note").filter({ hasText: /Teh tarik, \$1\.80/ });
  await expect(line).toHaveText("Waiting to send: Teh tarik, $1.80");

  await context.setOffline(false);
  await expect(page.locator("[data-ask-waiting]")).toHaveCount(0, { timeout: 20_000 });
  await expect(line).toHaveText("Sent: Teh tarik, $1.80");
  await expect(page.locator(".ask-note").filter({ hasText: "Waiting to send" })).toHaveCount(0);
  await shot(page, "B21-after-1-sent.png");
  const month = await todayMonth(page);
  await expect.poll(async () => (await loadEntriesPage(page, { month })).monthPage.entries.filter((entry) => entry.description === "Teh tarik").length).toBe(1);
});
