import { devices, expect, test } from "@playwright/test";

import { loadEntriesPage, postJson, reseedDemo } from "./helpers";

// Trips and events in Ask (docs/flows/ask-flow.md "Trips and events"). The
// model is stubbed with the X-Ask-Turn-Test-Reply header, so the real Worker
// checks the action against the demo household. A change card lists each
// entry's trip before and after and saves only with its button; "How much
// was the trip?" is answered from the Entries trip view's own figures, and
// Open in Entries goes to that view.

const iPhone = devices["iPhone 12 Pro"].viewport;
const MONTH = "2026-04";

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

async function createEntry(page, fields) {
  const created = await postJson(page, "/api/entries/create", {
    date: "2026-04-23", accountName: "Citi Rewards", categoryName: "Travel", amountMinor: 1_000, entryType: "expense", ownershipType: "direct", ownerName: "Tim", ...fields
  });
  return created.entryId;
}

async function tripOf(page, id) {
  const data = await loadEntriesPage(page, { view: "person-tim", month: MONTH });
  return data.monthPage.entries.find((entry) => entry.id === id)?.tripEventId ?? null;
}

const tripAction = (tripEvent) => ({ action: "set_trip_event", trip_event: { name: null, off: null, make: null, words: null, currency: null, when: null, from: null, to: null, ...tripEvent } });

test.describe("Ask, trips and events", () => {
  test.use({ viewport: iPhone });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.goto("/");
    await reseedDemo(page);
  });

  test("\"put it on the trip\" is a card with the trip before and after; Save puts it on, Undo takes it off", async ({ page }) => {
    const name = `Kyoto test ${Date.now()}`;
    const saved = await postJson(page, "/api/trip-events/save", { name });
    const entryId = await createEntry(page, { description: `KYOTO RYOKAN ${Date.now()}`, amountMinor: 32_000 });
    const seen = await stubModel(page, [tripAction({ name })]);
    await page.goto(`/ask?saved_entry=${entryId}&month=${MONTH}&view=person-tim&from=shortcut`);
    await expect(page.locator('[data-ask-card="saved"]')).toBeVisible({ timeout: 60_000 });
    await send(page, `put it on ${name}`);
    await expect.poll(() => seen.length).toBe(1);

    const card = page.locator('[data-change-draft="draft"][data-change-type="trip_event"]');
    await expect(card).toBeVisible();
    await expect(card.locator('[data-change-field="trip"]')).toContainText("No trip or event");
    await expect(card.locator('[data-change-field="trip"]')).toContainText(name);
    await expect(card.locator(`[data-change-entry="${entryId}"]`)).toContainText(`No trip or event → ${name}`);
    expect(await tripOf(page, entryId)).toBeNull();
    await page.screenshot({ path: "test-results/ask-trip-card.png" });

    await card.getByRole("button", { name: "Save" }).click();
    await expect(page.locator('[data-change-draft="saved"]')).toBeVisible();
    await expect.poll(() => tripOf(page, entryId)).toBe(saved.tripEvent.id);
    await page.locator("[data-change-undo]").click();
    await expect(page.locator('[data-change-draft="undone"]')).toBeVisible();
    await expect.poll(() => tripOf(page, entryId)).toBeNull();
  });

  test("\"how much was the trip?\" answers with the trip view's Spent, and Open in Entries shows the trip", async ({ page }) => {
    const name = `Osaka test ${Date.now()}`;
    const saved = await postJson(page, "/api/trip-events/save", { name });
    const ids = [
      await createEntry(page, { description: `OSAKA HOTEL ${Date.now()}`, amountMinor: 45_000 }),
      await createEntry(page, { description: `OSAKA RAMEN ${Date.now()}`, categoryName: "Food & Drinks", amountMinor: 2_350 })
    ];
    await postJson(page, "/api/trip-events/entries/set", { entryIds: ids, tripEventId: saved.tripEvent.id });
    await stubModel(page, [{ action: "answer_question", question: { topic: "trip", trip: name } }]);
    await page.goto(`/ask?month=${MONTH}&view=person-tim`);
    await send(page, `How much did we spend on ${name}?`);

    const answer = page.locator('[data-ask-money-answer="trip"]');
    await expect(answer).toBeVisible({ timeout: 30_000 });
    await expect(answer).toContainText(name);
    await expect(answer.locator(".ask-answer-amount")).toContainText("473.50");
    await page.screenshot({ path: "test-results/ask-trip-answer.png" });

    await page.getByRole("button", { name: "Open in Entries" }).click();
    await expect(page).toHaveURL(new RegExp(`/entries\\?.*entry_trip=${saved.tripEvent.id}`));
  });
});
