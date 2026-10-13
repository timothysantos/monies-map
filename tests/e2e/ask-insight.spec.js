import { devices, expect, test } from "@playwright/test";

import { gotoPageAfterApi, reseedDemo } from "./helpers";

// "Ask about this" on a Money insights line (docs/flows/ask-flow.md
// "Insight questions"). The line opens Ask with "Explain: <the line>" and a
// card built from the insight's own facts: what it's based on, the entries
// behind it and the line's think line, with its links as chips. AI is off on
// every test stack, so the card is the facts alone; the AI explanation is
// stubbed at the route once, to see its tag. Hidden money shows no figure
// and no Ask about this. Real Worker for everything else.

const iPhone = devices["iPhone 12 Pro"].viewport;
const MONTH_PATH = "/month?view=person-tim&month=2026-05&scope=direct_plus_shared";
const SUMMARY_PATH = "/summary?view=household&month=2026-05&scope=direct_plus_shared&summary_start=2026-05&summary_end=2026-05";

const suggestions = (page) => page.getByRole("group", { name: "Suggestions" }).getByRole("button");
const card = (page) => page.locator("[data-ask-insight]");
const question = (fact) => `Explain: ${fact.replace(/[.!]+$/, "")}`;

async function openMonth(page) {
  await gotoPageAfterApi(page, MONTH_PATH, "/api/month-page", () => page.locator(".financial-insight").first());
}

test.describe("Ask about this on a phone", () => {
  test.use({ viewport: iPhone });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.goto("/");
    await reseedDemo(page);
  });

  test("the teaser's Ask about this opens Ask with the question and the insight's facts, once, with AI off", async ({ page }) => {
    await openMonth(page);
    const fold = page.locator(".financial-insight-fold");
    await expect(fold).toHaveAttribute("aria-expanded", "false");
    const fact = (await fold.locator("strong").textContent()).trim();
    const think = (await fold.locator(".financial-insight-think").textContent()).trim();
    const ask = page.locator(".checkin-ask.is-teaser");
    await expect(ask).toBeVisible();
    // A separate target from the fold: its box is above the card, not on it.
    const [askBox, foldBox] = [await ask.boundingBox(), await fold.boundingBox()];
    expect(askBox.y + askBox.height).toBeLessThanOrEqual(foldBox.y + 1);
    expect(askBox.height).toBeGreaterThanOrEqual(44);

    await ask.click();
    await expect(page).toHaveURL(/\/ask\?view=person-tim&month=2026-05&scope=direct_plus_shared$/);
    await expect(page.locator(".ask-me").last()).toHaveText(question(fact));
    await expect(card(page)).toBeVisible();
    await expect(card(page).locator(".ask-answer-title")).toHaveText(fact);
    await expect(card(page).locator(".ask-insight-think")).toHaveText(think);
    await expect(card(page)).toHaveAttribute("data-wording-source", "facts");
    await expect(card(page).getByText("Worded by AI")).toHaveCount(0);
    await expect(card(page).getByText("What it's based on")).toBeVisible();
    expect(await card(page).locator(".ask-insight-basis li").count()).toBeGreaterThan(0);
    // The status line clears once the explanation route says AI is off.
    await expect(page.locator(".ask-note.is-status")).toHaveCount(0);
    await expect(suggestions(page).first()).toBeEnabled();

    // Back and forward, and a reload, keep the one question: it was asked once.
    await page.goBack();
    await expect(page).toHaveURL(/\/month\?/);
    await page.goForward();
    await expect(card(page)).toBeVisible();
    await page.reload();
    await expect(card(page)).toBeVisible();
    await expect(page.locator(".ask-me", { hasText: question(fact) })).toHaveCount(1);
    await expect(card(page)).toHaveCount(1);
  });

  test("Open in Entries shows the insight's entries with the From Ask chip; with money hidden nothing shows a figure", async ({ page }) => {
    await openMonth(page);
    // Every insight with entries behind it: try the headline, then Also lines.
    await page.locator(".financial-insight-fold").click();
    await page.getByRole("button", { name: "See all insights" }).click();
    const asks = page.locator(".financial-insight-content .checkin-ask");
    const count = await asks.count();
    expect(count).toBeGreaterThan(0);
    let withEntries = false;
    for (let index = 0; index < count && !withEntries; index += 1) {
      if (index > 0) {
        await openMonth(page);
        await page.getByRole("button", { name: "See all insights" }).click();
      }
      await page.locator(".financial-insight-content .checkin-ask").nth(index).click();
      await expect(card(page).last()).toBeVisible();
      withEntries = await card(page).last().getByText("The entries").isVisible();
    }
    test.skip(!withEntries, "No insight in this month's demo data has entries behind it.");
    await expect(card(page).last().locator(".ask-insight-entries li").first()).toBeVisible({ timeout: 30_000 });
    await expect(suggestions(page).first()).toHaveText("Open in Entries");
    const rows = await card(page).last().locator(".ask-insight-entries li").count();
    await suggestions(page).first().click();
    await expect(page).toHaveURL(/\/entries\?.*from_ask=1/);
    await expect(page.getByRole("group", { name: "From Ask" })).toBeVisible();
    expect(await page.locator("[data-entry-id], .entry-row").count()).toBeGreaterThanOrEqual(Math.min(rows, 1));

    // Hidden money: Ask keeps the conversation but shows no figure or line.
    await page.evaluate(() => window.localStorage.setItem("monies-map:money-totals-visible", "false"));
    await page.goto("/ask?view=person-tim&month=2026-05&scope=direct_plus_shared");
    await expect(card(page).last()).toBeVisible();
    await expect(page.locator(".ask-me").last()).toHaveText("Explain this money insight");
    await expect(card(page).last().locator(".ask-answer-title")).toHaveText("A money insight");
    await expect(card(page).last().locator(".ask-brief-hidden")).toHaveText("Reveal money totals to read these insights.");
    await expect(card(page).last()).not.toContainText("$");
    await expect(card(page).last().locator(".ask-insight-basis")).toHaveCount(0);

    // And the insights themselves offer no Ask about this.
    await openMonth(page);
    await expect(page.locator(".checkin-ask")).toHaveCount(0);
  });
});

test.describe("Ask about this on a wide screen", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("monies-map:money-totals-visible", "true");
      window.sessionStorage.clear();
    });
    await page.goto("/");
    await reseedDemo(page);
  });

  test("the headline opens the Ask panel beside Summary; a checked AI explanation carries Worded by AI", async ({ page }) => {
    let sent = null;
    await page.route("**/api/ai-assist/insight-explain", async (route) => {
      sent = route.request().postDataJSON();
      await route.fulfill({ json: { ok: true, explanation: { text: "This is what the line above says, in short.", source: "ai" }, ai: { requested: true, available: true } } });
    });
    await gotoPageAfterApi(page, SUMMARY_PATH, "/api/summary-page", () => page.locator(".financial-insight").first());
    const headline = page.locator(".financial-insight-content .checkin-fact");
    await expect(headline).toBeVisible();
    const fact = (await headline.textContent()).trim();
    await page.locator(".financial-insight-content > .checkin-ask").click();

    const dock = page.locator(".ask-dock");
    await expect(dock).toBeVisible();
    await expect(page).toHaveURL(/\/summary\?/);
    await expect(dock.locator(".ask-me").last()).toHaveText(question(fact));
    await expect(dock.locator("[data-ask-insight] .ask-answer-title")).toHaveText(fact);
    await expect(dock.locator("[data-ask-insight]")).toHaveAttribute("data-wording-source", "ai");
    await expect(dock.locator("[data-ask-insight]").getByText("Worded by AI")).toBeVisible();
    await expect(dock.locator(".ask-insight-explanation")).toHaveText("This is what the line above says, in short.");
    // Only the line, its think line and its basis were sent.
    expect(Object.keys(sent).sort()).toEqual(["fact", "kind", "lines", "think"]);
    expect(sent.fact).toBe(fact);
    expect(sent.lines.length).toBeGreaterThan(0);

    // A second insight, asked while the panel is open, joins the same chat.
    const more = page.getByRole("button", { name: "See all insights" });
    await more.click();
    const alsoAsk = page.locator(".checkin-also .checkin-ask");
    if (await alsoAsk.count()) {
      const alsoFact = (await page.locator(".checkin-also li").first().locator("span").nth(1).textContent()).trim();
      await alsoAsk.first().click();
      await expect(dock.locator(".ask-me").last()).toHaveText(question(alsoFact));
      await expect(dock.locator("[data-ask-insight]")).toHaveCount(2);
    }
  });
});
