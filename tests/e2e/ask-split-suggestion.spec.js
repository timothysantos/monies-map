import { devices, expect, test } from "@playwright/test";

import { gotoPageAfterApi, loadEntriesPage, loadSplitsPage, reseedDemo } from "./helpers";

// The Ask card's split question (docs/flows/ask-flow.md "Split suggestion"):
// "You usually split this with {name}. Add it to {group}?". The rule has its
// own tests (split-suggestion*.test.mjs); here the server's answer is
// stubbed so the card's behaviour is proved in a real browser: the question
// appears, choosing it turns the Splits switch on with that group and writes
// nothing until Save, Save makes the entry and its split once, and
// "Not this time" hides it.

const iPhone = devices["iPhone 12 Pro"].viewport;
const MONTH = "2025-10";
const GROUP_ID = "split-group-baby-river";

async function stubSuggestion(page, partner, { suggestion = null } = {}) {
  const requests = [];
  await page.route("**/api/splits/suggestion", async (route) => {
    requests.push(route.request().postDataJSON());
    const body = suggestion ?? {
      groupId: GROUP_ID,
      groupName: "Baby River",
      basisPoints: 5000,
      otherPersonId: "person-partner",
      otherPersonName: partner,
      evidenceCount: 3,
      matchedCount: 4,
      matchedBy: "description"
    };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, suggestion: body === "none" ? null : body }) });
  });
  return requests;
}

async function openCard(page, description) {
  await gotoPageAfterApi(page, `/entries?view=person-tim&month=${MONTH}`, "/api/entries-page", () => page.locator(".entries-fab:not(.splits-fab)"));
  await page.locator(".entries-fab:not(.splits-fab)").click();
  await expect(page.locator('[data-ask-card="draft"]')).toBeVisible();
  await page.getByRole("textbox", { name: "Amount" }).fill("31.40");
  await page.getByRole("textbox", { name: "What it was" }).fill(description);
  await page.getByLabel("Date", { exact: true }).fill("2025-10-16");
}

test.describe("the Ask card's split question on a phone", () => {
  test.use({ viewport: iPhone });
  // The stubbed answer names its own person; the card shows it as given.
  const partner = "Joyce";

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.goto("/");
    await reseedDemo(page);
  });

  test("the question appears, choosing it sets the Splits switch and group, and Save makes the entry and its split once", async ({ page }) => {
    const description = `Ask usual split ${Date.now()}`;
    const requests = await stubSuggestion(page, partner);
    await openCard(page, description);

    const chips = page.getByRole("group", { name: "Suggestions" });
    await expect(page.locator(".ask-question")).toHaveText(`You usually split this with ${partner}. Add it to Baby River?`);
    await expect(chips.getByRole("button")).toHaveText(["Split 50/50 in Baby River", "Not this time", "Edit in form"]);
    expect(requests.at(-1)).toMatchObject({ entryType: "expense", description, ownerName: expect.any(String), date: "2025-10-16" });
    if (process.env.SPLIT_SUGGEST_SHOT_DIR) {
      await page.screenshot({ path: `${process.env.SPLIT_SUGGEST_SHOT_DIR}/question-phone.png` });
      await page.locator(".ask-question").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${process.env.SPLIT_SUGGEST_SHOT_DIR}/question-phone-scrolled.png` });
    }
    // Nothing is on Splits yet.
    await expect(page.getByRole("switch")).toHaveAttribute("aria-checked", "false");

    await chips.getByRole("button", { name: "Split 50/50 in Baby River" }).click();
    await expect(page.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    await expect(page.locator(".ask-share small")).toHaveText("Baby River");
    if (process.env.SPLIT_SUGGEST_SHOT_DIR) {
      await page.screenshot({ path: `${process.env.SPLIT_SUGGEST_SHOT_DIR}/chosen-phone.png` });
    }
    await expect(page.locator(".ask-question")).toHaveCount(0);
    // Choosing writes nothing: the split does not exist before Save.
    expect((await loadSplitsPage(page, { view: "person-tim", month: MONTH })).splitsPage.activity.some((item) => item.description === description)).toBe(false);

    const creates = [];
    page.on("request", (request) => { if (request.url().includes("/api/entries/create") && request.method() === "POST") creates.push(request); });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator('[data-ask-card="saved"]')).toBeVisible();
    await expect(page.locator(".ask-card-saved-line")).toHaveText("Also on Splits: Baby River");
    expect(creates).toHaveLength(1);

    const entries = (await loadEntriesPage(page, { view: "person-tim", month: MONTH })).monthPage.entries.filter((entry) => entry.description === description);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ linkedSplitGroupName: "Baby River" });
    const splits = (await loadSplitsPage(page, { view: "person-tim", month: MONTH })).splitsPage.activity.filter((item) => item.description === description);
    expect(splits).toHaveLength(1);
    expect(splits[0]).toMatchObject({ groupId: GROUP_ID, linkedTransactionId: entries[0].id });
  });

  test("Not this time hides the question for the card and saves without Splits", async ({ page }) => {
    const description = `Ask not split ${Date.now()}`;
    await stubSuggestion(page, partner);
    await openCard(page, description);
    const chips = page.getByRole("group", { name: "Suggestions" });
    await expect(chips.getByRole("button", { name: "Not this time" })).toBeVisible();

    await chips.getByRole("button", { name: "Not this time" }).click();
    await expect(page.locator(".ask-question")).toHaveCount(0);
    await expect(chips.getByRole("button", { name: /Split 50\/50/ })).toHaveCount(0);
    await expect(page.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    // Editing the card does not bring it back.
    await page.getByRole("textbox", { name: "What it was" }).fill(`${description} again`);
    await page.waitForTimeout(900);
    await expect(page.locator(".ask-question")).toHaveCount(0);

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator('[data-ask-card="saved"]')).toBeVisible();
    await expect(page.locator(".ask-card-saved-line")).toHaveCount(0);
    const splits = (await loadSplitsPage(page, { view: "person-tim", month: MONTH })).splitsPage.activity;
    expect(splits.some((item) => item.description.startsWith(description))).toBe(false);
  });

  test("no suggestion, or one that is not an even share, asks nothing", async ({ page }) => {
    await stubSuggestion(page, partner, { suggestion: "none" });
    await openCard(page, `Ask nothing ${Date.now()}`);
    await page.waitForTimeout(1000);
    await expect(page.locator(".ask-question")).toHaveCount(0);

    await page.unrouteAll({ behavior: "ignoreErrors" });
    await stubSuggestion(page, partner, { suggestion: { groupId: GROUP_ID, groupName: "Baby River", basisPoints: 7000, otherPersonId: "p", otherPersonName: partner, evidenceCount: 3, matchedCount: 3, matchedBy: "description" } });
    await page.getByRole("textbox", { name: "What it was" }).fill(`Ask lopsided ${Date.now()}`);
    await page.waitForTimeout(1000);
    await expect(page.locator(".ask-question")).toHaveCount(0);
    await expect(page.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });
});
