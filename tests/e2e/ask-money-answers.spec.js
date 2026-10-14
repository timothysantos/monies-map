import { devices, expect, test } from "@playwright/test";

import { loadMonthPage, loadSplitsPage, postJson, reseedDemo } from "./helpers";

// Money questions on Ask (docs/flows/ask-flow.md "Money questions"), with
// AI off as on every test stack, so every answer is the computed one: the
// answer card's figures equal the Month page DTO for the same view and
// month, its chips open the screens they name, and a likely settle-up or
// own-account move is asked about first ("Check this first"). Mark as
// settlement goes through the existing routes and the question is
// answered again with it fixed; It's real spending changes nothing and
// answers. Real Worker, real routes; nothing is stubbed.

const iPhone = devices["iPhone 12 Pro"].viewport;
const MONTH = "2026-05";
const money = (amountMinor) => new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" }).format(amountMinor / 100);

async function openAsk(page, view = "household") {
  await page.goto(`/ask?view=${view}&month=${MONTH}&scope=direct_plus_shared`);
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
}

async function send(page, text) {
  await page.getByRole("textbox", { name: "Message" }).fill(text);
  await page.getByRole("textbox", { name: "Message" }).press("Enter");
}

// An answer reads the skew candidates and one or two page DTOs on the
// server: give it longer than a page's own read on a busy test machine.
const ANSWER = { timeout: 30_000 };

const suggestions = (page) => page.getByRole("group", { name: "Suggestions" }).getByRole("button");
const actualSpend = (monthPage) => monthPage.monthPage.metricCards.find((card) => card.label === "Actual spend").amountMinor;
// The plan answer reads as the Month lead: its "Spent" leaves out money filed
// under Investments or Savings (splitMoneyUse), and its plan the savings target.
const leadSpent = (monthPage) => actualSpend(monthPage) - (monthPage.monthPage.categoryShareChart ?? [])
  .filter((datum) => /^(investments|savings)$/i.test(String(datum.label).trim()))
  .reduce((sum, datum) => sum + datum.valueMinor, 0);

// An open settlement between Tim and Joyce, paid by PayNow and filed as
// spending and income: a high-confidence settle-up skew candidate in May.
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
  return { checkpointId, amountMinor: checkpoint.amountMinor };
}

test.describe("money questions on Ask on a phone", () => {
  test.use({ viewport: iPhone });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.goto("/");
    await reseedDemo(page);
  });

  test("where the money went, the plan and a two-month comparison answer with the Month page's figures", async ({ page }) => {
    const may = await loadMonthPage(page, { view: "household", month: MONTH });
    const october = await loadMonthPage(page, { view: "household", month: "2025-10" });
    await openAsk(page);

    await send(page, "where did my money go?");
    const spending = page.locator('[data-ask-money-answer="spending"]');
    await expect(spending).toBeVisible(ANSWER);
    await expect(spending).toHaveAttribute("data-wording-source", "template");
    await expect(spending.locator(".ask-answer-title")).toHaveText("May spending");
    await expect(spending.locator(".ask-answer-amount")).toHaveText(money(actualSpend(may)));
    await expect(spending.locator(".ask-money-wording")).toContainText(`May came to ${money(actualSpend(may))}`);
    await expect(suggestions(page).first()).toHaveText("Open in Entries");
    await expect(suggestions(page).nth(1)).toHaveText("Open Month");
    // Nothing went to the entry reader and no card opened.
    await expect(page.locator(".ask-card")).toHaveCount(0);

    await send(page, "how am I doing against the plan?");
    const plan = page.locator('[data-ask-money-answer="plan"]');
    await expect(plan).toBeVisible(ANSWER);
    await expect(plan.locator(".ask-answer-amount")).toHaveText(money(leadSpent(may)));
    await expect(plan.locator(".lsd-progress")).toBeVisible();
    await expect(suggestions(page).first()).toHaveText("Open Month");

    await send(page, "compare May 2026 with October 2025");
    const compare = page.locator('[data-ask-money-answer="compare"]');
    await expect(compare).toBeVisible(ANSWER);
    await expect(compare.locator(".ask-answer-chip").first()).toHaveText(`October 2025 ${money(actualSpend(october))}`);

    // The answer's first chip opens May's expenses in Entries, from Ask.
    await suggestions(page).getByText("Open in Entries", { exact: true }).click();
    await expect(page).toHaveURL(/\/entries\?.*month=2026-05/);
    const url = new URL(page.url());
    expect(url.searchParams.get("entry_type")).toBe("expense");
    expect(url.searchParams.get("from_ask")).toBe("1");
  });

  test("a likely settle-up is checked first; Mark as settlement links it and the answer has it fixed", async ({ page }) => {
    const settle = await seedSettlePayNow(page);
    const before = actualSpend(await loadMonthPage(page, { view: "household", month: MONTH }));
    await openAsk(page);

    await send(page, "how am I doing against the plan?");
    const check = page.locator('[data-skew-check="open"]');
    await expect(check).toBeVisible(ANSWER);
    await expect(check.locator(".ask-skew-tag")).toHaveText("Check this first");
    await expect(check.locator(".ask-answer-amount")).toHaveText(money(settle.amountMinor));
    await expect(check.locator(".ask-money-wording")).toContainText("looks like a settle-up between you. It's counted as spending and as income.");
    await expect(page.locator('[data-ask-money-answer]')).toHaveCount(0);
    await expect(suggestions(page)).toHaveText(["Mark as settlement", "It's real spending"]);

    await suggestions(page).getByText("Mark as settlement", { exact: true }).click();
    await expect(page.locator(".ask-note").filter({ hasText: "Marked as a settlement." })).toBeVisible(ANSWER);
    const plan = page.locator('[data-ask-money-answer="plan"]');
    await expect(plan).toBeVisible(ANSWER);
    await expect(page.locator('[data-skew-check="resolved"]')).toBeVisible();

    const afterPage = await loadMonthPage(page, { view: "household", month: MONTH });
    const after = actualSpend(afterPage);
    expect(after).toBe(before - settle.amountMinor);
    await expect(plan.locator(".ask-answer-amount")).toHaveText(money(leadSpent(afterPage)));
    const splits = await loadSplitsPage(page, { view: "person-tim", month: MONTH });
    expect(splits.splitsPage.settlementCheckpoints.find((item) => item.id === settle.checkpointId).status).toBe("matched");
  });
});

test.describe("money questions on Ask on a wide screen", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.goto("/");
    await reseedDemo(page);
  });

  test("who owes whom answers from Splits; It's real spending keeps the figures; other questions keep the note", async ({ page }) => {
    // Tim moves $250 to his own card and both sides are filed as spending and income.
    await postJson(page, "/api/entries/create", { date: "2026-05-20", description: "FAST PAYMENT TO OWN CARD", accountName: "UOB Savings", categoryName: "Other", amountMinor: 25000, entryType: "expense", ownershipType: "direct", ownerName: "Tim" });
    await postJson(page, "/api/entries/create", { date: "2026-05-21", description: "PAYMENT RECEIVED", accountName: "UOB One", categoryName: "Other - Income", amountMinor: 25000, entryType: "income", ownershipType: "direct", ownerName: "Tim" });
    const spend = actualSpend(await loadMonthPage(page, { view: "household", month: MONTH }));
    await openAsk(page);

    await send(page, "who owes who?");
    const owed = page.locator('[data-ask-money-answer="owed"]');
    await expect(owed).toBeVisible(ANSWER);
    await expect(owed.locator(".ask-money-wording")).toContainText("on Splits.");
    await expect(suggestions(page).first()).toHaveText("Open Splits");

    await send(page, "where did my money go?");
    const check = page.locator('[data-skew-check="open"]');
    await expect(check).toBeVisible(ANSWER);
    await expect(check.locator(".ask-money-wording")).toContainText("This looks like Tim moving money between their own accounts");
    await expect(suggestions(page)).toHaveText(["Link as transfer", "It's real spending"]);
    await suggestions(page).getByText("It's real spending", { exact: true }).click();
    await expect(page.locator(".ask-note").filter({ hasText: "Kept as spending." })).toBeVisible(ANSWER);
    const spending = page.locator('[data-ask-money-answer="spending"]');
    await expect(spending).toBeVisible(ANSWER);
    await expect(spending.locator(".ask-answer-amount")).toHaveText(money(spend));
    expect(actualSpend(await loadMonthPage(page, { view: "household", month: MONTH }))).toBe(spend);

    await send(page, "should I buy a car?");
    await expect(page.locator(".ask-note:not(.is-source)").last()).toHaveText("I can find entries and add new ones. Other questions aren't answered yet.");
  });

  test("with money hidden the answer shows no amounts and no words", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "false"));
    await openAsk(page);
    await send(page, "how am I doing against the plan?");
    const plan = page.locator('[data-ask-money-answer="plan"]');
    await expect(plan).toBeVisible(ANSWER);
    await expect(plan.locator(".ask-answer-amount")).toHaveText("••••");
    await expect(plan.locator(".ask-money-wording")).toHaveCount(0);
    await expect(plan.locator(".ask-money-lines")).toHaveCount(0);
    await expect(plan.locator(".ask-brief-hidden")).toHaveText("Reveal money totals to read these insights.");
    await expect(plan.locator(".lsd-bar-fill")).toHaveCount(0);
  });
});
