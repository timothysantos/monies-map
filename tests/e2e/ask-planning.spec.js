import { mkdir } from "node:fs/promises";

import { devices, expect, test } from "@playwright/test";

import { loadMonthPage, reseedDemo } from "./helpers";

// Planning by chat and intent against outcome on Ask (docs/flows/ask-flow.md
// "Planning by chat" and "Money questions"), with AI off as on every test
// stack, so every draft is read by rules: a typed change to a month's plan
// shows a Draft card with each line and the view's totals before → after;
// Save plan changes the plan the Month page shows (and Undo puts it back);
// Discard writes nothing; a name that fits two lines and a request with no
// month ask with chips; "how did May go?" answers with the Month lead's own
// figures and its savings bar. Real Worker, real routes; nothing is stubbed.
// SHOTS=<dir> also saves the PR's phone and desktop screenshots there.

const iPhone = devices["iPhone 12 Pro"].viewport;
const MONTH = "2026-05";
const money = (amountMinor) => new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" }).format(amountMinor / 100);
const message = (page) => page.getByRole("textbox", { name: "Message" });
const suggestions = (page) => page.getByRole("group", { name: "Suggestions" }).getByRole("button");
const draftCard = (page) => page.locator("[data-plan-draft]").last();
const card = (monthPage, label) => monthPage.monthPage.metricCards.find((item) => item.label === label).amountMinor;
// The Month lead's "of $X plan" is the spend job's plan: the planned spend
// less the savings target (the demo plans no investments), not the card's total.
const leadPlan = (monthPage) => card(monthPage, "Planned spend") - card(monthPage, "Savings target");
// Its "Spent" leaves out money filed under Investments or Savings (moved, not
// spent). The plan answer reads both through the same splitMoneyUse.
const movedMinor = (monthPage) => (monthPage.monthPage.categoryShareChart ?? [])
  .filter((datum) => /^(investments|savings)$/i.test(String(datum.label).trim()))
  .reduce((sum, datum) => sum + datum.valueMinor, 0);
const leadSpent = (monthPage) => card(monthPage, "Actual spend") - movedMinor(monthPage);
const planRow = (monthPage, id) => monthPage.monthPage.planSections.flatMap((section) => section.rows).find((row) => row.id === id);
// A draft or an answer reads the month's plan rows on the server.
const READ = { timeout: 30_000 };

async function shot(page, name) {
  if (!process.env.SHOTS) return;
  await mkdir(process.env.SHOTS, { recursive: true });
  // After the card's arrival motion.
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${process.env.SHOTS}/${name}.png` });
}

async function openAsk(page, view = "person-tim") {
  await page.goto(`/ask?view=${view}&month=${MONTH}&scope=direct_plus_shared`);
  await expect(message(page)).toBeVisible();
}

async function send(page, text) {
  await message(page).fill(text);
  await message(page).press("Enter");
}

async function planRows(page, view = "person-tim") {
  const month = await loadMonthPage(page, { view, month: MONTH });
  return month.monthPage.planSections.flatMap((section) => section.rows).map((row) => [row.id, row.plannedMinor]);
}

test.describe("planning by chat on a phone", () => {
  test.use({ viewport: iPhone });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.goto("/");
    await reseedDemo(page);
  });

  test("a set request drafts before → after; Save plan changes the plan Month shows, and Undo puts it back", async ({ page }) => {
    const before = await loadMonthPage(page, { view: "person-tim", month: MONTH });
    const plannedBefore = card(before, "Planned spend");
    expect(planRow(before, "plan-oct-groceries").plannedMinor).toBe(14_000);
    await openAsk(page);

    await send(page, "set groceries plan to $200 for May 2026");
    const draft = draftCard(page);
    await expect(draft).toHaveAttribute("data-plan-draft", "draft", READ);
    await expect(page.getByText("Here is the change. Nothing is saved until you tap Save.")).toBeVisible();
    await expect(draft.locator(".ask-card-tag")).toHaveText(["Draft"]);
    await expect(draft.locator(".ask-plan-title")).toHaveText("Groceries plan");
    await expect(draft.locator(".lsd-amount")).toHaveText("$200.00");
    await expect(draft.getByText("was $140.00")).toBeVisible();
    await expect(draft.locator('[data-plan-line="plan-oct-groceries"]')).toContainText("$140.00→to$200.00");
    // The view's totals as the Month cards add them, before → after.
    await expect(draft.locator('[data-plan-total="plannedSpend"]')).toContainText(`${money(plannedBefore)}→to${money(plannedBefore + 6_000)}`);
    await expect(draft.locator('[data-plan-total="plannedIncome"]')).toContainText(money(before.monthPage.incomeRows.reduce((sum, row) => sum + row.plannedMinor, 0)));
    await shot(page, "plan-set-phone-draft");
    // Nothing is written before Save.
    expect(planRow(await loadMonthPage(page, { view: "person-tim", month: MONTH }), "plan-oct-groceries").plannedMinor).toBe(14_000);

    await draft.getByRole("button", { name: "Save plan" }).click();
    await expect(draft).toHaveAttribute("data-plan-draft", "saved");
    await expect(draft.locator(".ask-card-tag")).toHaveText(["Saved"]);
    await expect(page.getByText("Saved to the May 2026 plan.")).toBeVisible();
    await shot(page, "plan-set-phone-saved");
    const after = await loadMonthPage(page, { view: "person-tim", month: MONTH });
    expect(planRow(after, "plan-oct-groceries").plannedMinor).toBe(20_000);
    expect(card(after, "Planned spend")).toBe(plannedBefore + 6_000);

    // See it on Month: the Month page shows the new plan.
    await draft.getByRole("button", { name: "See it on Month" }).click();
    await expect(page).toHaveURL(/\/month\?.*view=person-tim.*month=2026-05/);
    await expect(page.locator(".summary-lead-plan").first()).toContainText(money(leadPlan(after)), READ);

    await page.goBack();
    await draftCard(page).getByRole("button", { name: "Undo this change" }).click();
    await expect(draftCard(page)).toHaveAttribute("data-plan-draft", "draft");
    await expect(page.getByText("Undone. The plan is back as it was.")).toBeVisible();
    expect(planRow(await loadMonthPage(page, { view: "person-tim", month: MONTH }), "plan-oct-groceries").plannedMinor).toBe(14_000);
  });

  test("a move keeps planned spend; Discard writes nothing", async ({ page }) => {
    const rowsBefore = await planRows(page);
    await openAsk(page);
    await send(page, "move $20 from Food to Groceries in May 2026");
    const draft = draftCard(page);
    await expect(draft).toHaveAttribute("data-plan-draft", "draft", READ);
    await expect(draft.locator(".ask-plan-title")).toHaveText("Move $20.00");
    await expect(draft.getByText("Food to Groceries")).toBeVisible();
    await expect(draft.locator('[data-chip="same-spend"]')).toHaveText("Planned spend stays the same");
    await expect(draft.locator('[data-plan-line="plan-oct-food"]')).toContainText("$650.00→to$630.00");
    await expect(draft.locator('[data-plan-line="plan-oct-groceries"]')).toContainText("$140.00→to$160.00");
    await shot(page, "plan-move-phone-draft");

    await draft.getByRole("button", { name: "Discard" }).click();
    await expect(page.getByText("Discarded. The plan is unchanged.")).toBeVisible();
    await expect(page.locator("[data-plan-draft]")).toHaveCount(0);
    expect(await planRows(page)).toEqual(rowsBefore);
  });

  test("a name that fits two lines asks which, and a request with no month asks which month", async ({ page }) => {
    await openAsk(page);
    await send(page, "set sports to 150 for may 2026");
    await expect(page.getByText("Which line do you mean by “sports”?")).toBeVisible(READ);
    await expect(suggestions(page)).toHaveText(["Sports & Hobbies", "Tennis lesson"]);
    await expect(page.locator("[data-plan-draft]")).toHaveCount(0);
    await suggestions(page).filter({ hasText: "Sports & Hobbies" }).click();
    await expect(draftCard(page).locator('[data-plan-line="plan-oct-sports"]')).toContainText("$104.50→to$150.00", READ);

    await send(page, "groceries budget 200");
    await expect(page.getByText("Which month's plan?")).toBeVisible(READ);
    await expect(suggestions(page).filter({ hasText: "May 2026" })).toHaveCount(1);
    await suggestions(page).filter({ hasText: "May 2026" }).click();
    await expect(draftCard(page).locator('[data-plan-line="plan-oct-groceries"]')).toContainText("$140.00→to$200.00", READ);
  });

  test("with AI off, drafts come from the rules alone and a request they cannot read is read as before", async ({ page }) => {
    const rowsBefore = await planRows(page);
    await openAsk(page);
    await send(page, "set taxi to 120 for may 2026");
    await expect(draftCard(page)).toHaveAttribute("data-plan-draft", "draft", READ);
    await expect(draftCard(page).getByText("Read by AI")).toHaveCount(0);

    await send(page, "bump up the grocery money for may 2026 to $200");
    // Not a plan draft: the page's other readers take it, and nothing is written.
    await expect(page.locator(".ask-me").last()).toHaveText("bump up the grocery money for may 2026 to $200");
    await expect(page.locator(".ask-note.is-status")).toHaveCount(0, READ);
    await expect(page.locator("[data-plan-draft]")).toHaveCount(1);
    expect(await planRows(page)).toEqual(rowsBefore);
  });

  test("how did May go: the plan answer with the Month lead's figures and savings bar, and Open Month", async ({ page }) => {
    const may = await loadMonthPage(page, { view: "person-tim", month: MONTH });
    await openAsk(page);
    await send(page, "how did May 2026 go?");
    const answer = page.locator('[data-ask-money-answer="plan"]');
    await expect(answer).toBeVisible(READ);
    await expect(answer.locator(".ask-answer-title")).toHaveText("May against plan");
    // The Month lead's own figures: its "Spent" and its "of $X plan".
    await expect(answer.locator(".ask-answer-amount")).toHaveText(money(leadSpent(may)));
    await expect(answer.locator(".money-plan").first()).toHaveText(`of ${money(leadPlan(may))} plan`);
    await expect(answer.locator("[data-savings-bar]")).toBeVisible();
    await expect(answer).toHaveAttribute("data-wording-source", "template");
    await expect(suggestions(page).first()).toHaveText("Open Month");
    await expect(suggestions(page).nth(1)).toHaveText("Open in Entries");
    await shot(page, "intent-phone-answer");

    await suggestions(page).first().click();
    await expect(page).toHaveURL(/\/month\?.*month=2026-05/);
    await expect(page.locator(".summary-lead-plan").first()).toContainText(money(leadPlan(may)), READ);
  });

  test("with money hidden the draft shows no amounts and no warning", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "false"));
    await openAsk(page);
    await send(page, "set groceries plan to $200 for May 2026");
    const draft = draftCard(page);
    await expect(draft).toHaveAttribute("data-plan-draft", "draft", READ);
    await expect(draft.locator('[data-plan-line="plan-oct-groceries"]')).toContainText("••••→to••••");
    await expect(draft).not.toContainText("$");
    await shot(page, "plan-set-phone-hidden");
  });
});

test.describe("planning by chat in the desktop Ask panel", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.goto("/");
    await reseedDemo(page);
  });

  test("a draft saved in the docked panel changes the Month page beside it", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const before = await loadMonthPage(page, { view: "household", month: MONTH });
    const planned = card(before, "Planned spend");
    await page.goto(`/month?view=household&month=${MONTH}&scope=direct_plus_shared`);
    await expect(page.locator(".summary-lead-plan").first()).toContainText(money(leadPlan(before)), READ);
    await page.getByRole("textbox", { name: "Ask", exact: true }).click();
    await expect(message(page)).toBeVisible();
    await send(page, "set taxi to 120 for May 2026");
    const draft = page.locator(".ask-dock [data-plan-draft]").last();
    await expect(draft).toHaveAttribute("data-plan-draft", "draft", READ);
    await expect(draft.locator(".ask-plan-subtitle")).toHaveText("May 2026");
    await expect(draft.locator('[data-plan-total="plannedSpend"]')).toContainText(`${money(planned)}→to${money(planned + 4_000)}`);
    await shot(page, "plan-desktop-draft");
    await draft.getByRole("button", { name: "Save plan" }).click();
    await expect(draft).toHaveAttribute("data-plan-draft", "saved");
    const saved = await loadMonthPage(page, { view: "household", month: MONTH });
    expect(card(saved, "Planned spend")).toBe(planned + 4_000);
    await expect(page.locator(".summary-lead-plan").first()).toContainText(money(leadPlan(saved)), READ);

    await send(page, "how did May 2026 go?");
    await expect(page.locator('.ask-dock [data-ask-money-answer="plan"]')).toBeVisible(READ);
    await shot(page, "intent-desktop-answer");
  });
});
