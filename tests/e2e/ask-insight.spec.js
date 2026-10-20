import { devices, expect, test } from "@playwright/test";

import { gotoPageAfterApi, reseedDemo } from "./helpers";

// "Ask about this" on a Money insights line (docs/flows/ask-flow.md
// "Insight questions"). Each insight line (the headline, each Also line, the
// Fun fact and the Big picture line) is itself one quiet button that opens
// the figure menu, whose one item is Ask about this; there is no visible Ask
// link. Choosing it opens Ask with "Explain: <the line>" and a
// card built from the insight's own facts: what it's based on, the entries
// behind it and the line's think line, with its links as chips. AI is off on
// every test stack, so the card is the facts alone; the AI explanation is
// stubbed at the route once, to see its tag. Hidden money shows no figure
// and no line button. Real Worker for everything else.

const iPhone = devices["iPhone 12 Pro"].viewport;
const MONTH_PATH = "/month?view=person-tim&month=2026-05&scope=direct_plus_shared";

const suggestions = (page) => page.getByRole("group", { name: "Suggestions" }).getByRole("button");
const card = (page) => page.locator("[data-ask-insight]");
const question = (fact) => `Explain: ${fact.replace(/[.!]+$/, "")}`;
const lineMenu = (page) => page.locator('.figure-menu[data-figure-menu="insight"]');

// Taps a line, then chooses Ask about this in the one-item menu it opens.
async function askVia(page, line) {
  await line.click();
  await expect(lineMenu(page)).toBeVisible();
  await expect(lineMenu(page).getByRole("button")).toHaveText(["Ask about this"]);
  await lineMenu(page).getByRole("button", { name: "Ask about this" }).click();
}

async function openMonth(page) {
  await gotoPageAfterApi(page, MONTH_PATH, "/api/month-page", () => page.locator(".financial-insight").first());
}

test.describe("Ask about this on a phone", () => {
  test.use({ viewport: iPhone });

  test.beforeEach(async ({ page }) => {
    // Shown at first; a test may hide them, and a reload keeps its choice.
    await page.addInitScript(() => {
      if (window.localStorage.getItem("monies-map:money-totals-visible") === null) {
        window.localStorage.setItem("monies-map:money-totals-visible", "true");
      }
    });
    await page.goto("/");
    await reseedDemo(page);
  });

  test("tapping the headline opens a one-item menu; Ask about this opens Ask with the question and the insight's facts, once, with AI off", async ({ page }) => {
    await openMonth(page);
    const fold = page.locator(".financial-insight-fold");
    await expect(fold).toHaveAttribute("aria-expanded", "false");
    const fact = (await fold.locator("strong").textContent()).trim();
    const think = (await fold.locator(".financial-insight-think").textContent()).trim();
    // The folded teaser has no Ask link of its own; the fold is just the fold.
    await expect(page.locator(".checkin-ask")).toHaveCount(0);
    await expect(page.locator(".financial-insight").getByText("Ask about this", { exact: true })).toHaveCount(0);
    await fold.click();
    const line = page.locator(".financial-insight-content .checkin-line-btn").first();
    await expect(line).toBeVisible();
    await expect(line).toContainText(fact);
    // A real button, 44px tall on a phone by padding, with text still selectable.
    await expect(line).toHaveAttribute("aria-haspopup", "true");
    expect((await line.boundingBox()).height).toBeGreaterThanOrEqual(44);
    expect(await line.evaluate((node) => getComputedStyle(node).userSelect)).toBe("text");
    // No visible Ask about this link anywhere on the card.
    await expect(page.locator(".financial-insight .checkin-ask")).toHaveCount(0);
    await expect(page.locator(".financial-insight").getByRole("button", { name: /^Ask about this/ })).toHaveCount(0);

    // A press alone (the start of holding to select text) opens nothing; the click does.
    const box = await line.boundingBox();
    await page.mouse.move(box.x + 20, box.y + box.height / 2);
    await page.mouse.down();
    await expect(lineMenu(page)).toHaveCount(0);
    await page.mouse.up();
    await expect(lineMenu(page)).toBeVisible();
    await expect(line).toHaveAttribute("aria-expanded", "true");
    await expect(lineMenu(page).getByRole("button")).toHaveText(["Ask about this"]);
    expect((await lineMenu(page).getByRole("button").boundingBox()).height).toBeGreaterThanOrEqual(44);

    // Escape closes it and the line has the focus back; so does a tap outside.
    await page.keyboard.press("Escape");
    await expect(lineMenu(page)).toHaveCount(0);
    await expect(line).toBeFocused();
    await expect(line).toHaveAttribute("aria-expanded", "false");
    await line.click();
    await expect(lineMenu(page)).toBeVisible();
    await page.mouse.click(4, 4);
    await expect(lineMenu(page)).toHaveCount(0);

    // Ask opens for the view, month and scope the page was showing.
    const shown = new URL(page.url()).searchParams;
    await askVia(page, line);
    await expect(page).toHaveURL(new RegExp(`/ask\\?view=${shown.get("view")}&month=${shown.get("month")}&scope=${shown.get("scope")}$`));
    await expect(page.locator(".ask-me").last()).toHaveText(question(fact));
    await expect(card(page)).toBeVisible();
    await expect(card(page).locator(".ask-insight-fact")).toHaveText(fact);
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

  // The Fun fact and the Big picture line are each one tappable line
  // (owner, 2026-10-15); its menu's Ask about this opens Ask with that
  // line's own text, once.
  for (const [label, selector] of [["Fun fact", ".checkin-fun"], ["Big picture", ".checkin-long-view"]]) {
    test(`the ${label} line is one button whose menu opens Ask with that line, with no filler after it`, async ({ page }) => {
      await gotoPageAfterApi(page, "/month?view=household&month=2025-09&scope=direct_plus_shared", "/api/month-page", () => page.locator(".financial-insight").first());
      await page.locator(".financial-insight-fold").click();
      const container = page.locator(`.financial-insight-content ${selector}`);
      await expect(container).toBeVisible();
      const line = container.locator(".checkin-line-btn");
      await expect(line).toHaveCount(1);
      expect((await line.boundingBox()).height).toBeGreaterThanOrEqual(44);
      await expect(container.getByRole("button", { name: /^Ask about this/ })).toHaveCount(0);
      const whole = (await line.evaluate((node) => [...node.childNodes].filter((child) => child.nodeType === 3).map((child) => child.textContent).join(""))).trim();
      expect(whole.length).toBeGreaterThan(20);
      expect(whole).not.toMatch(/useful part|depends on your life|your call|yours to decide/);
      await askVia(page, line);
      await expect(page).toHaveURL(/\/ask\?/);
      await expect(card(page)).toBeVisible();
      // Ask gets the line's fact (a Big picture line's think line stays with the page).
      const text = (await card(page).locator(".ask-insight-fact").textContent()).trim();
      expect(whole.startsWith(text)).toBe(true);
      await expect(page.locator(".ask-me").last()).toHaveText(question(text));
      await expect(card(page).locator(".checkin-chip")).toHaveText(label);
      // Asked once: a reload keeps the one question.
      await page.reload();
      await expect(page.locator(".ask-me", { hasText: question(text) })).toHaveCount(1);
    });
  }

  test("Open in Entries shows the insight's entries with the From Ask chip; with money hidden nothing shows a figure", async ({ page }) => {
    await openMonth(page);
    // Every insight with entries behind it: try the headline, then Also lines.
    await page.locator(".financial-insight-fold").click();
    await page.getByRole("button", { name: "See all insights" }).click();
    const lines = page.locator(".financial-insight-content .checkin-line-btn");
    const count = await lines.count();
    expect(count).toBeGreaterThan(0);
    let withEntries = false;
    for (let index = 0; index < count && !withEntries; index += 1) {
      if (index > 0) {
        await openMonth(page);
        await page.getByRole("button", { name: "See all insights" }).click();
      }
      await askVia(page, page.locator(".financial-insight-content .checkin-line-btn").nth(index));
      await expect(card(page).last()).toBeVisible();
      // The heading only: while the rows load, the status line under it reads
      // "Loading the entries…", which a substring match would also find.
      withEntries = await card(page).last().getByText("The entries", { exact: true }).isVisible();
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
    await expect(card(page).last().locator(".ask-insight-fact")).toHaveCount(0);
    await expect(card(page).last()).not.toContainText("$");
    await expect(card(page).last().locator(".ask-insight-basis")).toHaveCount(0);

    // And the insights themselves have no tappable line and no Ask about this.
    await openMonth(page);
    await expect(page.locator(".checkin-ask")).toHaveCount(0);
    await expect(page.locator(".checkin-line-btn")).toHaveCount(0);
    await expect(page.locator('.financial-insight [data-fig="insight"]')).toHaveCount(0);
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

  test("the headline's menu opens the Ask panel beside Month; Escape closes the menu and the line keeps focus; a checked AI explanation carries Worded by AI", async ({ page }) => {
    let sent = null;
    await page.route("**/api/ai-assist/insight-explain", async (route) => {
      sent = route.request().postDataJSON();
      await route.fulfill({ json: { ok: true, explanation: { text: "This is what the line above says, in short.", source: "ai" }, ai: { requested: true, available: true } } });
    });
    await openMonth(page);
    const headline = page.locator(".financial-insight-content .checkin-fact");
    await expect(headline).toBeVisible();
    const fact = (await headline.textContent()).trim();
    const line = page.locator(".financial-insight-content .checkin-line-btn").first();
    await expect(page.locator(".checkin-ask")).toHaveCount(0);
    await expect(page.locator(".financial-insight").getByRole("button", { name: /^Ask about this/ })).toHaveCount(0);

    // Click opens the same menu; Escape closes it and the line has the focus.
    await line.click();
    await expect(lineMenu(page)).toBeVisible();
    await expect(lineMenu(page).getByRole("button")).toHaveText(["Ask about this"]);
    await page.keyboard.press("Escape");
    await expect(lineMenu(page)).toHaveCount(0);
    await expect(line).toBeFocused();
    // The keyboard works too: Enter on the focused line opens it again.
    await page.keyboard.press("Enter");
    await expect(lineMenu(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(lineMenu(page)).toHaveCount(0);

    await askVia(page, line);

    const dock = page.locator(".ask-dock");
    await expect(dock).toBeVisible();
    await expect(page).toHaveURL(/\/month\?/);
    await expect(dock.locator(".ask-me").last()).toHaveText(question(fact));
    await expect(dock.locator("[data-ask-insight] .ask-insight-fact")).toHaveText(fact);
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
    const alsoLine = page.locator(".checkin-also .checkin-line-btn");
    if (await alsoLine.count()) {
      const alsoFact = (await page.locator(".checkin-also li").first().locator("span").nth(1).textContent()).trim();
      await askVia(page, alsoLine.first());
      await expect(dock.locator(".ask-me").last()).toHaveText(question(alsoFact));
      await expect(dock.locator("[data-ask-insight]")).toHaveCount(2);
    }
  });
});
