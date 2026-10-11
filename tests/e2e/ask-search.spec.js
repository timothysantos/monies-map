import { devices, expect, test } from "@playwright/test";
import path from "node:path";

import { reseedDemo } from "./helpers";

// Search and filter from Ask, and the conversation kept across tabs
// (docs/flows/ask-flow.md "Search and filter", "Continuity"): a filter
// question answers with the same total and rows the Entries page shows for
// it; "Open in Entries" opens exactly that list with a From Ask chip that
// goes back to the conversation or clears the filters; leaving Ask, or
// reloading the tab, keeps the thread, a half-filled card and the typed
// words; the Ask tab shows a dot meanwhile. The entry and receipt readers
// are stubbed (their routes are built on other branches).

const iPhone = devices["iPhone 12 Pro"].viewport;
const RECEIPT_FIXTURE = path.resolve("tests/fixtures/ask/sample-receipt.png");

async function trackedMonth(page) {
  const response = await page.request.get("/api/app-shell");
  const shell = await response.json();
  return shell.trackedMonths.at(-1);
}

async function openAsk(page, month, view = "person-tim") {
  await page.goto(`/ask?view=${view}&month=${month}&scope=direct_plus_shared`);
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
}

async function send(page, text) {
  await page.getByRole("textbox", { name: "Message" }).fill(text);
  await page.getByRole("textbox", { name: "Message" }).press("Enter");
}

async function stubEntryDraft(page, month) {
  await page.route("**/api/ai-assist/entry-draft", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      draft: {
        fields: {
          date: { value: `${month}-12`, source: "sentence" },
          description: { value: "Koufu lunch", source: "sentence" },
          amountMinor: { value: 1250, source: "sentence" },
          entryType: { value: "expense", source: "rule" },
          categoryName: { value: "Food & Drinks", source: "rule" }
        },
        questions: [],
        missing: []
      },
      ai: { requested: false, available: false }
    })
  }));
}

const suggestions = (page) => page.getByRole("group", { name: "Suggestions" });
const answerCard = (page) => page.locator(".ask-answer").last();

test.describe("search and filter from Ask on a phone", { tag: "@webkit" }, () => {
  test.use({ viewport: iPhone });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.goto("/");
    await reseedDemo(page);
  });

  test("a filter question matches Entries, and the From Ask chip goes back to the conversation as it was", async ({ page }) => {
    const month = await trackedMonth(page);
    await stubEntryDraft(page, month);
    await openAsk(page, month);

    // A half-filled card first: a sentence the entry reader fills.
    await send(page, "Koufu lunch $12.50");
    await expect(page.locator('[data-ask-card="draft"]')).toBeVisible();
    await expect(page.getByRole("textbox", { name: "What it was" })).toHaveValue("Koufu lunch");

    // Then a question: an answer card under the card, never read as a change to it.
    await send(page, "how much on bills?");
    const answer = answerCard(page);
    await expect(answer).toHaveAttribute("data-ask-answer", /^\d+$/);
    await expect(answer.locator(".ask-answer-title")).toHaveText("Bills");
    await expect(answer.locator(".ask-answer-chip")).toHaveText([formatMonth(month), "Tim", "Bills"]);
    const count = Number(await answer.getAttribute("data-ask-answer"));
    expect(count).toBeGreaterThan(0);
    await expect(answer.locator(".ask-answer-detail")).toHaveText(`Spent · ${count === 1 ? "1 entry" : `${count} entries`}`);
    const amount = (await answer.locator(".ask-answer-amount").innerText()).trim();
    await expect(page.getByRole("textbox", { name: "What it was" })).toHaveValue("Koufu lunch");
    // Words typed and not sent are kept too.
    await page.getByRole("textbox", { name: "Message" }).fill("and a kopi");

    await expect(suggestions(page).getByRole("button").first()).toHaveText("Open in Entries");
    await suggestions(page).getByRole("button", { name: "Open in Entries" }).click();

    // Entries opens on exactly that list: same rows, same total.
    await expect(page).toHaveURL(/\/entries\?/);
    const url = new URL(page.url());
    expect(Object.fromEntries(url.searchParams)).toEqual({
      view: "person-tim", month, scope: "direct_plus_shared", entries_scope: "direct_plus_shared", entry_category: "Bills", from_ask: "1"
    });
    await expect(page.locator(".entry-row")).toHaveCount(count);
    await expect(page.locator(".entries-totals-item").first().locator("strong")).toHaveText(amount);

    // The From Ask chip: above the View and scope bar, 44 px targets.
    const chip = page.getByRole("group", { name: "From Ask" });
    await expect(chip).toBeVisible();
    await expect(chip).toContainText("From Ask · Bills");
    const back = chip.getByRole("button", { name: /Back to Ask/ });
    const clear = chip.getByRole("button", { name: "Clear the filters from Ask" });
    for (const target of [back, clear]) {
      const box = await target.boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    const chipBox = await chip.boundingBox();
    const barBox = await page.locator(".mobile-context-sticky-wrap").boundingBox();
    expect(chipBox.y + chipBox.height).toBeLessThanOrEqual(barBox.y);

    // The Ask tab says a conversation is in progress.
    await expect(page.getByRole("link", { name: "Ask, conversation in progress" })).toBeVisible();
    await expect(page.locator(".tab-dot")).toBeVisible();

    // Back to Ask: the thread, the card, its fields and the typed words.
    await back.click();
    await expect(page).toHaveURL(/\/ask\?/);
    await expectConversationIntact(page, amount);
    await expect(page.locator(".tab-dot")).toHaveCount(0);

    // A reload in the same tab keeps it too.
    await page.reload();
    await expectConversationIntact(page, amount);

    // Leaving by the tab bar and coming back by the Ask tab: the same.
    await page.locator("nav.tab-strip").getByRole("link", { name: "Summary" }).click();
    await expect(page).toHaveURL(/\/summary\?/);
    await expect(page.locator(".tab-dot")).toBeVisible();
    await page.locator("nav.tab-strip").getByRole("link", { name: "Ask, conversation in progress" }).click();
    await expectConversationIntact(page, amount);

    // New chat starts over and the dot goes.
    await page.getByRole("button", { name: "New chat" }).click();
    await expect(page.locator(".ask-me")).toHaveCount(0);
    await expect(page.locator(".ask-answer")).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Message" })).toHaveValue("");
    expect(await page.evaluate(() => window.sessionStorage.getItem("monies.askConversation.v1.presence"))).toBeNull();
    await page.locator("nav.tab-strip").getByRole("link", { name: "Entries" }).click();
    await expect(page.locator("nav.tab-strip").getByRole("link", { name: "Ask", exact: true })).toBeVisible();
    await expect(page.locator(".tab-dot")).toHaveCount(0);
  });

  test("an answer below an unsaved card owns the chips and the send button; Back to the unsaved entry brings the card's back", async ({ page }) => {
    const month = await trackedMonth(page);
    await stubEntryDraft(page, month);
    await openAsk(page, month);
    const save = page.getByRole("button", { name: "Save", exact: true });

    await send(page, "Koufu lunch $12.50");
    await expect(page.locator('[data-ask-card="draft"]')).toBeVisible();
    await expect(suggestions(page).getByRole("button")).toHaveText(["Split with Joyce", "Add a note", "Different card"]);
    await expect(save).toBeEnabled();

    // A search question: its answer is now the newest item. Its chips only,
    // and Send (not Save) in the composer; the card stays as it was.
    await send(page, "how much on bills?");
    await expect(answerCard(page)).toHaveAttribute("data-ask-answer", /^\d+$/);
    await expect(suggestions(page).getByRole("button")).toHaveText(["Open in Entries", "Back to the unsaved entry"]);
    await expect(save).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "What it was" })).toHaveValue("Koufu lunch");
    // Enter on an empty message box saves nothing while the answer is active.
    let creates = 0;
    page.on("request", (request) => {
      if (request.url().includes("/api/entries/create")) creates += 1;
    });
    await page.getByRole("textbox", { name: "Message" }).press("Enter");
    await expect(page.locator('[data-ask-card="draft"]')).toBeVisible();

    // The way back stays within thumb reach in the chip row above the composer.
    const backChip = suggestions(page).getByRole("button", { name: "Back to the unsaved entry" });
    const chipBox = await backChip.boundingBox();
    const composerBox = await page.locator(".ask-composer").boundingBox();
    expect(chipBox.y).toBeLessThan(composerBox.y);
    expect(chipBox.y).toBeGreaterThan(iPhone.height / 2);

    // Back: the card moves below the answer, its chips and Save return.
    await backChip.click();
    await expect(suggestions(page).getByRole("button")).toHaveText(["Split with Joyce", "Add a note", "Different card"]);
    await expect(save).toBeEnabled();
    const order = await page.locator(".ask-thread").evaluate((thread) => {
      const answer = thread.querySelector(".ask-answer");
      const card = thread.querySelector("[data-ask-card]");
      return Boolean(answer.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(order).toBe(true);
    await expect(page.locator("[data-ask-card]")).toBeInViewport();

    // A reload keeps the card where it now is, still active.
    await page.reload();
    await expect(suggestions(page).getByRole("button")).toHaveText(["Split with Joyce", "Add a note", "Different card"]);
    await expect(save).toBeEnabled();
    expect(creates).toBe(0);
  });

  test("✕ on the From Ask chip clears the filters and keeps the view, month and scope", async ({ page }) => {
    const month = await trackedMonth(page);
    await openAsk(page, month);
    await send(page, "citi spending");
    await expect(answerCard(page)).toHaveAttribute("data-ask-answer", /^\d+$/);
    await expect(answerCard(page).locator(".ask-answer-chip")).toHaveText([formatMonth(month), "Tim", "Citi Rewards", "Spending"]);
    await suggestions(page).getByRole("button", { name: "Open in Entries" }).click();
    await expect(page).toHaveURL(/entry_wallet=acct-citi-rewards/);
    await expect(page).toHaveURL(/entry_type=expense/);
    const filteredRows = await page.locator(".entry-row").count();

    await page.getByRole("group", { name: "From Ask" }).getByRole("button", { name: "Clear the filters from Ask" }).click();
    await expect(page.getByRole("group", { name: "From Ask" })).toHaveCount(0);
    const url = new URL(page.url());
    expect(Object.fromEntries(url.searchParams)).toEqual({ view: "person-tim", month, scope: "direct_plus_shared", entries_scope: "direct_plus_shared" });
    await expect.poll(() => page.locator(".entry-row").count()).toBeGreaterThan(filteredRows);
  });

  test("a wallet word that fits several asks which, and only a tap changes the view", async ({ page }) => {
    const month = await trackedMonth(page);
    await openAsk(page, month);

    await send(page, "show uob");
    await expect(page.locator(".ask-question")).toHaveText("Which card or account?");
    await expect(suggestions(page).getByRole("button")).toHaveText(["UOB Lady's", "UOB One", "UOB Savings", "All of them"]);
    await expect(page.locator(".ask-answer")).toHaveCount(0);
    await suggestions(page).getByRole("button", { name: "UOB One" }).click();
    await expect(answerCard(page).locator(".ask-answer-title")).toHaveText("UOB One");
    await expect(page.locator(".ask-question")).toHaveCount(0);

    await send(page, "switch to Joyce");
    await expect(page.locator(".ask-question")).toHaveText("Change the view?");
    // Nothing changes until the chip is tapped.
    expect(new URL(page.url()).searchParams.get("view")).toBe("person-tim");
    await expect(page.locator(".ask-context")).toContainText("Tim");
    await suggestions(page).getByRole("button", { name: "Switch to Joyce" }).click();
    await expect(page).toHaveURL(/view=person-joyce/);
    await expect(page.locator(".ask-context")).toHaveText(`Joyce · Direct + Shared · ${formatMonth(month)}`);
    await expect(page.locator(".ask-note").last()).toHaveText("Now showing Joyce.");
    // The earlier answer keeps its own filter (Tim's UOB One).
    await expect(page.locator(".ask-answer").first().locator(".ask-answer-chip").nth(1)).toHaveText("Tim");

    // A question it cannot read still gets the plain note.
    await send(page, "Am I on track?");
    await expect(page.locator(".ask-note").last()).toContainText("aren't answered yet");
  });

  test("a receipt photo never reaches sessionStorage", async ({ page }) => {
    const month = await trackedMonth(page);
    await page.route("**/api/ai-assist/receipt-read", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, receipt: { merchant: { value: "FairPrice", confidence: "high" }, date: { value: `${month}-10`, confidence: "high" }, total: { amountMinor: 4560, currency: "SGD", confidence: "high" } }, ai: { available: true } })
    }));
    await openAsk(page, month);
    await page.locator('input.ask-file-input[capture]').setInputFiles(RECEIPT_FIXTURE);
    await expect(page.getByRole("textbox", { name: "What it was" })).toHaveValue("FairPrice");
    await expect(page.locator(".ask-receipt-thumb img")).toBeVisible();
    const stored = await page.evaluate(() => window.sessionStorage.getItem("monies.askConversation.v1"));
    expect(stored).toContain("FairPrice");
    expect(stored).not.toMatch(/blob:|data:image|"kind":"photo"/);

    // Back from another tab: the card is there, the photo is not kept.
    await page.locator("nav.tab-strip").getByRole("link", { name: "Entries" }).click();
    await expect(page).toHaveURL(/\/entries\?/);
    await page.locator("nav.tab-strip").getByRole("link", { name: "Ask, conversation in progress" }).click();
    await expect(page.getByRole("textbox", { name: "What it was" })).toHaveValue("FairPrice");
    await expect(page.locator(".ask-me")).toHaveText(["Sent a receipt photo"]);
    await expect(page.locator(".ask-receipt-thumb")).toHaveCount(0);
  });
});

test.describe("search and filter from Ask on a wide screen", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.goto("/");
    await reseedDemo(page);
  });

  test("the answer equals Entries, and the From Ask chip sits at the top of the list", async ({ page }) => {
    const month = await trackedMonth(page);
    await openAsk(page, month, "household");
    await send(page, "bills");
    const answer = answerCard(page);
    await expect(answer).toHaveAttribute("data-ask-answer", /^\d+$/);
    await expect(answer.locator(".ask-answer-chip")).toHaveText([formatMonth(month), "Household", "Bills"]);
    const count = Number(await answer.getAttribute("data-ask-answer"));
    const amount = (await answer.locator(".ask-answer-amount").innerText()).trim();
    await suggestions(page).getByRole("button", { name: "Open in Entries" }).click();

    await expect(page.locator(".entry-row")).toHaveCount(count);
    await expect(page.locator(".entries-totals-item").first().locator("strong")).toHaveText(amount);
    const chip = page.getByRole("group", { name: "From Ask" });
    await expect(chip).toBeVisible();
    // Inline at the top of the list, above the totals.
    const chipBox = await chip.boundingBox();
    const totalsBox = await page.locator(".entries-totals-strip").boundingBox();
    expect(chipBox.y).toBeLessThan(totalsBox.y);
    await expect(chip).not.toHaveCSS("position", "fixed");

    await chip.getByRole("button", { name: /Back to Ask/ }).click();
    await expect(page).toHaveURL(/\/ask\?/);
    await expect(page.locator(".ask-me")).toHaveText(["bills"]);
    await expect(answerCard(page).locator(".ask-answer-amount")).toHaveText(amount);
  });
});

async function expectConversationIntact(page, amount) {
  await expect(page.locator(".ask-me")).toHaveText(["Koufu lunch $12.50", "how much on bills?"]);
  await expect(page.locator('[data-ask-card="draft"]')).toBeVisible();
  await expect(page.getByRole("textbox", { name: "What it was" })).toHaveValue("Koufu lunch");
  await expect(page.getByRole("textbox", { name: "Amount" })).toHaveValue("12.50");
  await expect(answerCard(page).locator(".ask-answer-amount")).toHaveText(amount);
  await expect(page.getByRole("textbox", { name: "Message" })).toHaveValue("and a kopi");
  await expect(suggestions(page).getByRole("button").first()).toHaveText("Open in Entries");
  // Near the bottom: the answer is in view.
  await expect(answerCard(page)).toBeInViewport();
}

function formatMonth(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month - 1]} ${year}`;
}
