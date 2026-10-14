import { devices, expect, test } from "@playwright/test";

import { loadSplitsPage, postJson, reseedDemo } from "./helpers";

// Ask, AI first (docs/flows/ask-flow.md "AI first"). The model is stubbed:
// each test forwards the page's real /api/ask/turn request to the real
// Worker with the model's answer in the X-Ask-Turn-Test-Reply header (read
// only when APP_ENVIRONMENT is "test"), so the server still loads the
// context, checks the action against the demo household and builds the
// reply. Without the header the test Worker has AI off, and Ask reads the
// message with its rules, with a one-line note.

const iPhone = devices["iPhone 12 Pro"].viewport;
const MONTH = "2026-04";

async function stubModel(page, replies) {
  const seen = [];
  await page.route("**/api/ask/turn", async (route) => {
    const body = route.request().postDataJSON();
    seen.push(body);
    const { _repair: repair, ...reply } = replies.shift() ?? {};
    const headers = { ...route.request().headers() };
    if (Object.keys(reply).length) headers["x-ask-turn-test-reply"] = JSON.stringify(reply);
    // The model's answer to the repair turn, when the first answer is refused.
    if (repair) headers["x-ask-turn-test-repair-reply"] = JSON.stringify(repair);
    const response = await route.fetch({ headers });
    await route.fulfill({ response });
  });
  return seen;
}

async function send(page, text) {
  const message = page.getByRole("textbox", { name: "Message" });
  await message.fill(text);
  await message.press("Enter");
}

test.describe("Ask, AI first", () => {
  test.use({ viewport: iPhone });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.goto("/");
    await reseedDemo(page);
  });

  test("a refused answer is repaired before the person is asked: \"all hers\" names nobody, the repair names Joyce, and the draft shows", async ({ page }) => {
    const description = `STARBUCKS ${Date.now()}`;
    const created = await postJson(page, "/api/entries/create", {
      date: "2026-04-23", description, accountName: "Citi Rewards", categoryName: "Food & Drinks", amountMinor: 4_250, entryType: "expense", ownershipType: "direct", ownerName: "Tim"
    });
    await stubModel(page, [
      { action: "add_entry_to_splits", split: { shares: [{ person: "wife", all: true }] }, _repair: { action: "add_entry_to_splits", split: { shares: [{ person: "Joyce", all: true }] } } }
    ]);
    await page.goto(`/ask?saved_entry=${created.entryId}&month=${MONTH}&view=person-tim&from=shortcut`);
    await expect(page.locator('[data-ask-card="saved"]')).toBeVisible({ timeout: 60_000 });
    await send(page, "split this with my wife, all hers");
    const proposal = page.locator('[data-split-proposal="draft"]');
    await expect(proposal).toBeVisible();
    await expect(proposal.locator('[data-split-share="Joyce"]')).toContainText("100%");
    // No question was asked.
    await expect(page.locator(".ask-chips").getByRole("button", { name: "Tim" })).toHaveCount(0);
  });

  test("a draft says what it assumed, with the other reading one tap away: an unknown wallet is left off, and a chip puts it on a real one", async ({ page }) => {
    const seen = await stubModel(page, [
      { action: "draft_entry", entry: { type: "expense", description: "stuff", amount: "30", wallet: "posb" } },
      { action: "edit_draft", entry: { wallet: "UOB One" } }
    ]);
    await page.goto(`/ask?month=${MONTH}&view=person-tim`);
    await send(page, "bought stuff 30 on posb");
    await expect(page.locator(".ask-question")).toContainText('I couldn\'t find a wallet called "posb", so I left the wallet out.');
    const chip = page.locator(".ask-chips").getByRole("button", { name: /^On / }).first();
    await expect(chip).toBeVisible();
    await page.screenshot({ path: "test-results/ask-ai-turn-assumption.png", fullPage: false });
    const label = (await chip.textContent()) ?? "";
    await chip.click();
    await expect.poll(() => seen.length).toBe(2);
    expect(seen[1].text).toBe(label.trim());
    await expect(page.locator("[data-reply-source]")).toHaveCount(2);
  });

  test("\"coffee 4.50\" is Food & Drinks even when the model says Other, and each reply says where it came from: Claude, the basic model, or the built-in rules", async ({ page }) => {
    await stubModel(page, [
      { action: "draft_entry", entry: { type: "expense", description: "coffee", amount: "4.50", category: "Other" } },
      { action: "draft_entry", entry: { type: "expense", description: "zorblax", amount: "7", category: "Other" } },
      {}
    ]);
    await page.goto(`/ask?month=${MONTH}&view=person-tim`);
    await send(page, "coffee 4.50");
    await expect(page.locator('[data-reply-source="claude"]')).toHaveText("Reply from Claude");
    await page.screenshot({ path: "test-results/ask-reply-source-after.png", fullPage: false });
    await expect(page.locator("[data-ask-card]").last()).toContainText("Food & Drinks");
    await expect(page.locator("[data-ask-card]").last()).not.toContainText("Other");

    // Nothing fits: Other, said plainly.
    await send(page, "zorblax 7");
    await expect(page.locator(".ask-note, .ask-question").filter({ hasText: "I couldn't tell the category, so I used Other." }).first()).toBeVisible();

    // No model answer (AI off in the test Worker): the built-in rules, said once more.
    await send(page, "tea 3");
    await expect(page.locator('[data-reply-source="rules"]')).toHaveText("Reply from the built-in rules");
  });

  test("Apple Pay entry, \"Add to splits, all Joyce\": a draft with Tim paying and Joyce's 100% share; Add to Splits saves it, and Splits shows Joyce owes the whole amount", async ({ page }) => {
    const description = `STARBUCKS ${Date.now()}`;
    const created = await postJson(page, "/api/entries/create", {
      date: "2026-04-23", description, accountName: "Citi Rewards", categoryName: "Food & Drinks", amountMinor: 4_250, entryType: "expense", ownershipType: "direct", ownerName: "Tim"
    });
    const seen = await stubModel(page, [
      { action: "add_entry_to_splits", split: { payer: null, group: null, shares: [{ person: "Joyce", percent: null, amount: null, all: true }] } }
    ]);

    await page.goto(`/ask?saved_entry=${created.entryId}&month=${MONTH}&view=person-tim&from=shortcut`);
    await expect(page.locator('[data-ask-card="saved"]')).toBeVisible({ timeout: 60_000 });
    await send(page, "Add to splits, all Joyce");

    // The page sent the saved entry as the focus, by id only.
    await expect.poll(() => seen.length).toBe(1);
    expect(seen[0].focus).toEqual({ kind: "saved_entry", entryId: created.entryId });
    expect(seen[0].text).toBe("Add to splits, all Joyce");

    const proposal = page.locator('[data-split-proposal="draft"]');
    await expect(proposal).toBeVisible();
    await expect(proposal).toContainText(description);
    await expect(proposal).toContainText("Tim paid");
    await expect(proposal.locator('[data-split-share="Joyce"]')).toContainText("$42.50");
    await expect(proposal.locator('[data-split-share="Joyce"]')).toContainText("100%");
    await expect(proposal.locator('[data-split-share="Tim"]')).toContainText("0%");
    // Nothing is on Splits until Add to Splits.
    let splits = await loadSplitsPage(page, { view: "person-joyce", month: MONTH });
    expect(splits.splitsPage.activity.some((item) => item.description === description)).toBe(false);

    await page.screenshot({ path: "test-results/ask-ai-turn-split-draft.png", fullPage: false });
    await proposal.getByRole("button", { name: "Add to Splits" }).click();
    await expect(page.locator('[data-split-proposal="saved"]')).toBeVisible();
    await expect(page.locator(".ask-note").filter({ hasText: "Added to Splits." })).toBeVisible();

    splits = await loadSplitsPage(page, { view: "person-joyce", month: MONTH });
    const item = splits.splitsPage.activity.find((activity) => activity.description === description);
    expect(item.paidByPersonName).toBe("Tim");
    expect(item.shares.map((share) => [share.personName, share.amountMinor])).toEqual([["Tim", 0], ["Joyce", 4_250]]);
    expect(item.viewerAmountMinor).toBe(4_250);
    await page.screenshot({ path: "test-results/ask-ai-turn-split-proposal.png", fullPage: false });
  });

  test("\"Add to splits, Joyce's share 1.6\" on a $7.90 entry: one stated share is enough, both shares shown, nothing saved, and \"Is that a percentage instead?\" re-reads it as 1.6%", async ({ page }) => {
    const description = `TORI-Q ${Date.now()}`;
    const created = await postJson(page, "/api/entries/create", {
      date: "2026-04-23", description, accountName: "Citi Rewards", categoryName: "Food & Drinks", amountMinor: 790, entryType: "expense", ownershipType: "direct", ownerName: "Tim"
    });
    const seen = await stubModel(page, [
      // The shape that failed in production: Tim listed with nothing in him.
      { action: "add_entry_to_splits", split: { payer: null, group: null, shares: [{ person: "Joyce", percent: null, amount: "1.6", all: null }, { person: "Tim", percent: null, amount: null, all: null }] } },
      { action: "add_entry_to_splits", split: { payer: null, group: null, shares: [{ person: "Joyce", percent: 1.6, amount: null, all: null }] } }
    ]);
    await page.goto(`/ask?saved_entry=${created.entryId}&month=${MONTH}&view=person-tim&from=shortcut`);
    await expect(page.locator('[data-ask-card="saved"]')).toBeVisible({ timeout: 60_000 });
    await send(page, "Add to splits, Joyce's share 1.6");

    const proposal = page.locator('[data-split-proposal="draft"]');
    await expect(proposal).toBeVisible();
    await expect(page.locator(".ask-question, .ask-note").filter({ hasText: "need to add up" })).toHaveCount(0);
    await expect(proposal.locator('[data-split-share="Joyce"]')).toContainText("$1.60");
    await expect(proposal.locator('[data-split-share="Joyce"]')).toContainText("20%");
    await expect(proposal.locator('[data-split-share="Tim"]')).toContainText("$6.30");
    await expect(proposal.locator('[data-split-share="Tim"]')).toContainText("80%");
    let splits = await loadSplitsPage(page, { view: "person-joyce", month: MONTH });
    expect(splits.splitsPage.activity.some((item) => item.description === description)).toBe(false);
    await page.screenshot({ path: "test-results/ask-ai-turn-split-share-guess.png", fullPage: false });

    await proposal.locator("[data-split-percent-instead]").click();
    await expect.poll(() => seen.length).toBe(2);
    expect(seen[1].text).toBe("Add to splits, Joyce's share is 1.6%");
    const reread = page.locator('[data-split-proposal="draft"]');
    await expect(reread).toHaveCount(1);
    await expect(reread.locator('[data-split-share="Joyce"]')).toContainText("$0.13");
    await expect(reread.locator('[data-split-share="Joyce"]')).toContainText("2%");
    await expect(reread.locator("[data-split-percent-instead]")).toHaveCount(0);
    splits = await loadSplitsPage(page, { view: "person-joyce", month: MONTH });
    expect(splits.splitsPage.activity.some((item) => item.description === description)).toBe(false);

    // Save: Joyce owes the $0.13 share the person chose.
    await reread.getByRole("button", { name: "Add to Splits" }).click();
    await expect(page.locator('[data-split-proposal="saved"]')).toBeVisible();
  });

  test("with AI off, \"Joyce's share 1.6\" on the saved entry still drafts the split (the rules read the share)", async ({ page }) => {
    const description = `TORI-Q OFF ${Date.now()}`;
    const created = await postJson(page, "/api/entries/create", {
      date: "2026-04-23", description, accountName: "Citi Rewards", categoryName: "Food & Drinks", amountMinor: 790, entryType: "expense", ownershipType: "direct", ownerName: "Tim"
    });
    await page.goto(`/ask?saved_entry=${created.entryId}&month=${MONTH}&view=person-tim&from=shortcut`);
    await expect(page.locator('[data-ask-card="saved"]')).toBeVisible({ timeout: 60_000 });
    await send(page, "Add to splits, Joyce's share 1.6");
    await expect(page.locator(".ask-note").filter({ hasText: "AI isn't available right now" })).toHaveCount(1);
    const proposal = page.locator('[data-split-proposal="draft"]');
    await expect(proposal.locator('[data-split-share="Joyce"]')).toContainText("$1.60");
    await expect(proposal.locator('[data-split-share="Tim"]')).toContainText("$6.30");
  });

  test("an unclear message is asked back with chips; a chip is sent as the next message", async ({ page }) => {
    const seen = await stubModel(page, [
      { action: "ask_clarification", clarify: { question: "Which lunch do you mean?", options: ["Today's lunch", "Yesterday's lunch"] } },
      { action: "cannot_help", note: "Pick the entry in Entries, then ask again." }
    ]);
    await page.goto(`/ask?view=person-tim&month=${MONTH}`);
    await send(page, "split the lunch");
    await expect(page.locator(".ask-question")).toHaveText("Which lunch do you mean?");
    const chips = page.getByRole("group", { name: "Suggestions" }).getByRole("button");
    await expect(chips).toHaveText(["Today's lunch", "Yesterday's lunch"]);
    await page.screenshot({ path: "test-results/ask-ai-turn-clarify.png", fullPage: false });
    await chips.first().click();
    await expect.poll(() => seen.length).toBe(2);
    expect(seen[1].text).toBe("Today's lunch");
    expect(seen[1].history.map((line) => line.text)).toContain("split the lunch");
    await expect(page.locator(".ask-me").last()).toHaveText("Today's lunch");
    await expect(page.locator(".ask-note:not(.is-source)").last()).toHaveText("Pick the entry in Entries, then ask again.");
  });

  test("a model that names someone outside the household is asked back, never drafted", async ({ page }) => {
    const description = `UNKNOWN ${Date.now()}`;
    const created = await postJson(page, "/api/entries/create", {
      date: "2026-04-23", description, accountName: "Citi Rewards", categoryName: "Food & Drinks", amountMinor: 1_000, entryType: "expense", ownershipType: "direct", ownerName: "Tim"
    });
    await stubModel(page, [{ action: "add_entry_to_splits", split: { shares: [{ person: "Serene", all: true }] } }]);
    await page.goto(`/ask?saved_entry=${created.entryId}&month=${MONTH}&view=person-tim&from=shortcut`);
    await expect(page.locator('[data-ask-card="saved"]')).toBeVisible({ timeout: 60_000 });
    await send(page, "all Serene");
    await expect(page.locator(".ask-question")).toHaveText("Whose share do you mean? This household has Tim and Joyce.");
    await expect(page.locator("[data-split-proposal]")).toHaveCount(0);
  });

  test("with AI off, Ask reads the message with its rules and says so once", async ({ page }) => {
    await page.goto(`/ask?view=person-tim&month=${MONTH}`);
    await send(page, "groceries in april 2026");
    await expect(page.locator(".ask-note").filter({ hasText: "AI isn't available right now" })).toHaveCount(1);
    await expect(page.locator(".ask-answer").first()).toBeVisible();
    await send(page, "transport in april 2026");
    await expect(page.locator(".ask-answer")).toHaveCount(2);
    await expect(page.locator(".ask-note").filter({ hasText: "AI isn't available right now" })).toHaveCount(1);
  });
});
