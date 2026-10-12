import { devices, expect, test } from "@playwright/test";
import path from "node:path";

import { reseedDemo } from "./helpers";

// Desktop Ask (design.md "Desktop Ask", docs/flows/ask-flow.md "Desktop"):
// a one-line Ask field at the bottom right of every desktop page opens the
// Ask conversation beside the page. From 1,280 px it docks as a panel that
// pushes the page narrower (the header stays one row); from 761 to 1,279 px
// it is a popup over the page. It is the same conversation as the phone's
// Ask tab, it stays open across pages and a reload until closed, and its
// answers' links open the page beside it.

const iPhone = devices["iPhone 12 Pro"].viewport;
const RECEIPT_FIXTURE = path.resolve("tests/fixtures/ask/sample-receipt.png");

const field = (page) => page.getByRole("textbox", { name: "Ask", exact: true });
const message = (page) => page.getByRole("textbox", { name: "Message" });
const panel = (page) => page.getByRole("complementary", { name: /^(Ask|New entry|New expense|New income|New transfer|Saved)$/ });
const suggestions = (page) => page.getByRole("group", { name: "Suggestions" });
const answerCard = (page) => page.locator(".ask-dock .ask-answer").last();

async function trackedMonth(page) {
  const response = await page.request.get("/api/app-shell");
  const shell = await response.json();
  return shell.trackedMonths.at(-1);
}

async function openUsable(page, url) {
  await page.goto(url);
  await page.waitForFunction(() => window.__MONIES_MAP_ROUTE_WORK__?.usable === true, null, { timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
}

// The header: every visible tab, the "More pages" button and each period
// control reached by a press at its centre, the row's parts on one vertical
// centre, its height, and whether anything reaches under the panel.
function readLayout(page) {
  return page.evaluate(() => {
    const reaches = (element) => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return Boolean(hit && element.contains(hit));
    };
    const visible = (element) => Boolean(element?.offsetParent) && element.getBoundingClientRect().width > 0;
    const tabs = [...document.querySelectorAll("nav.tab-strip > .tab")].filter(visible);
    const controls = ['[aria-label="Previous period"]', ".period-display", '[aria-label="Next period"]', ".totals-visibility-toggle--header"]
      .map((selector) => document.querySelector(selector))
      .filter(visible);
    const middle = (element) => {
      const rect = element.getBoundingClientRect();
      return Math.round(rect.top + rect.height / 2);
    };
    const aside = document.querySelector(".ask-dock");
    const asideRect = aside?.getBoundingClientRect() ?? null;
    const header = document.querySelector(".control-bar").getBoundingClientRect();
    const shell = document.querySelector(".shell").getBoundingClientRect();
    const rowMiddles = [document.querySelector(".context-block .pill-row"), document.querySelector("nav.tab-strip"), ...controls].map(middle);
    return {
      tabNames: tabs.map((tab) => tab.getAttribute("aria-label") ?? tab.textContent.trim()),
      unreachable: [...tabs, ...controls].filter((element) => !reaches(element)).map((element) => element.textContent.trim() || element.getAttribute("aria-label")),
      oneRow: rowMiddles.every((value) => Math.abs(value - rowMiddles[0]) <= 2),
      headerHeight: Math.round(header.height),
      headerRight: Math.round(header.right),
      shellWidth: Math.round(shell.width),
      shellRight: Math.round(shell.right),
      aside: asideRect ? { left: Math.round(asideRect.left), top: Math.round(asideRect.top), right: Math.round(asideRect.right), bottom: Math.round(asideRect.bottom), width: Math.round(asideRect.width), height: Math.round(asideRect.height) } : null,
      pageScrollsSideways: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      focused: document.activeElement?.getAttribute("aria-label") ?? ""
    };
  });
}

test.describe("desktop Ask", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.goto("/");
    await reseedDemo(page);
  });

  test("the Ask field sits at the bottom right of Summary, Entries and Splits, beside the + or receipt button, and not on Ask itself", async ({ page }) => {
    const month = await trackedMonth(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const [url, button] of [
      [`/summary?view=household`, null],
      [`/entries?view=person-tim&month=${month}`, ".entries-fab:not(.splits-fab)"],
      [`/splits?view=person-tim&month=${month}`, ".splits-fab"]
    ]) {
      await openUsable(page, url);
      await expect(field(page), url).toBeVisible();
      await expect(field(page)).toHaveAttribute("placeholder", "Ask, or drop a receipt…");
      await expect(field(page)).toHaveAttribute("aria-keyshortcuts", "/");
      const box = await page.locator(".ask-dock-field").boundingBox();
      expect(box.y + box.height, url).toBeLessThanOrEqual(800 - 20);
      expect(box.y + box.height, url).toBeGreaterThan(800 - 60);
      expect(box.height, url).toBe(48);
      if (button) {
        // Beside the round button, on its vertical centre, never under it.
        const fab = await page.locator(button).boundingBox();
        expect(box.x + box.width, url).toBeLessThanOrEqual(fab.x - 8);
        expect(Math.abs((box.y + box.height / 2) - (fab.y + fab.height / 2)), url).toBeLessThanOrEqual(1);
      } else {
        expect(1280 - (box.x + box.width), url).toBe(22);
      }
    }
    // An open menu or popover near the bottom right is never under the
    // field: the field steps aside while one is open (More pages shows on
    // a 1,024 px window).
    await page.setViewportSize({ width: 1024, height: 800 });
    await expect(page.locator(".ask-dock-field")).toBeVisible();
    await page.getByRole("button", { name: "More pages" }).click();
    await expect(page.locator(".tab-overflow-popover")).toBeVisible();
    await expect(page.locator(".ask-dock-field")).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(page.locator(".ask-dock-field")).toBeVisible();
    // On /ask the page is Ask: no field, no panel.
    await openUsable(page, `/ask?view=household&month=${month}`);
    await expect(message(page)).toBeVisible();
    await expect(page.locator(".ask-dock-field, .ask-dock")).toHaveCount(0);
  });

  for (const width of [1280, 1440]) {
    test(`at ${width} px typing in the field opens the docked panel; the page narrows beside it and the header stays one row`, async ({ page }) => {
      const month = await trackedMonth(page);
      await page.setViewportSize({ width, height: 800 });
      await openUsable(page, `/entries?view=person-tim&month=${month}`);
      const before = await readLayout(page);
      expect(before.aside).toBeNull();

      await field(page).click();
      await page.keyboard.type("how much on bills?");
      await expect(panel(page)).toBeVisible();
      await expect(panel(page)).toHaveClass(/is-docked/);
      // The words carried into the conversation's message box, which has focus.
      await expect(message(page)).toHaveValue("how much on bills?");
      await expect(message(page)).toBeFocused();
      // The field hides once the panel is here.
      await expect(page.locator(".ask-dock-field")).toHaveCount(0);

      const after = await readLayout(page);
      // Full height at the right, 360 to 400 px wide.
      expect(after.aside.top).toBe(0);
      expect(after.aside.bottom).toBe(800);
      expect(after.aside.right).toBe(width);
      expect(after.aside.width).toBeGreaterThanOrEqual(360);
      expect(after.aside.width).toBeLessThanOrEqual(400);
      // The page narrows: nothing sits under the panel, nothing scrolls sideways.
      expect(after.shellRight).toBeLessThanOrEqual(after.aside.left);
      expect(after.headerRight).toBeLessThanOrEqual(after.aside.left);
      expect(after.shellWidth).toBeLessThan(before.shellWidth);
      expect(after.pageScrollsSideways).toBe(false);
      // The header keeps one row at its wide height: Imports, Settings and
      // FAQ move behind More pages, and every control is reachable.
      expect(after.headerHeight).toBe(before.headerHeight);
      expect(after.oneRow).toBe(true);
      expect(after.unreachable).toEqual([]);
      expect(after.tabNames).toEqual(["Summary", "Entries", "Splits", "More pages"]);
      // The + moves left beside the panel instead of under it.
      const fab = await page.locator(".entries-fab:not(.splits-fab)").boundingBox();
      expect(fab.x + fab.width).toBeLessThanOrEqual(after.aside.left);

      // Asking works as on the phone.
      await message(page).press("Enter");
      await expect(answerCard(page)).toHaveAttribute("data-ask-answer", /^\d+$/);
      await expect(answerCard(page).locator(".ask-answer-title")).toHaveText("Bills");
      await expect(suggestions(page).getByRole("button").first()).toHaveText("Open in Entries");
    });
  }

  test("at 1,024 px the field opens a popup over the page; Escape closes it and focus goes back to the field", async ({ page }) => {
    const month = await trackedMonth(page);
    await page.setViewportSize({ width: 1024, height: 768 });
    await openUsable(page, `/summary?view=household`);
    const before = await readLayout(page);
    // The header is one row at 1,024 px too.
    expect(before.oneRow).toBe(true);
    expect(before.unreachable).toEqual([]);
    expect(before.tabNames).toEqual(["Summary", "Entries", "Splits", "More pages"]);
    expect(before.headerHeight).toBe(70);

    await field(page).focus();
    await expect(panel(page)).toHaveClass(/is-popup/);
    await expect(message(page)).toBeFocused();
    const after = await readLayout(page);
    // About 410 × 560, anchored bottom right, over the page (which keeps its width).
    expect(after.aside.width).toBe(410);
    expect(after.aside.height).toBe(560);
    expect(1024 - after.aside.right).toBe(22);
    expect(768 - after.aside.bottom).toBe(24);
    expect(after.shellWidth).toBe(before.shellWidth);
    expect(await page.evaluate(() => document.body.dataset.askDock ?? "")).toBe("");
    // No expand control: the window is too narrow to dock.
    await expect(panel(page).getByRole("button", { name: "Dock Ask beside the page" })).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(panel(page)).toHaveCount(0);
    await expect(field(page)).toBeFocused();
    // Focus coming back did not reopen it.
    await page.waitForTimeout(300);
    await expect(panel(page)).toHaveCount(0);

    // Widened with the popup open, it stays a popup and offers the expand
    // control, which docks it.
    await field(page).click();
    await expect(panel(page)).toHaveClass(/is-popup/);
    await page.setViewportSize({ width: 1440, height: 800 });
    await expect(panel(page)).toHaveClass(/is-popup/);
    await panel(page).getByRole("button", { name: "Dock Ask beside the page" }).click();
    await expect(panel(page)).toHaveClass(/is-docked/);
    expect((await readLayout(page)).shellRight).toBeLessThanOrEqual((await readLayout(page)).aside.left);
    // Narrowed again, there is no room to push the page: a popup.
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(panel(page)).toHaveClass(/is-popup/);
    expect(month).toMatch(/^\d{4}-\d{2}$/);
  });

  test("Escape closes the docked panel only from inside it", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 800 });
    await openUsable(page, `/summary?view=household`);
    await field(page).click();
    await expect(message(page)).toBeFocused();
    // Focus on the page beside it: Escape leaves the panel alone.
    await page.locator("nav.tab-strip").getByRole("link", { name: "Summary" }).focus();
    await page.keyboard.press("Escape");
    await expect(panel(page)).toBeVisible();
    // Inside it: Escape closes it.
    await message(page).focus();
    await page.keyboard.press("Escape");
    await expect(panel(page)).toHaveCount(0);
    await expect(field(page)).toBeFocused();
  });

  test('"/" opens Ask from the page but types a slash in a field', async ({ page }) => {
    const month = await trackedMonth(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await openUsable(page, `/entries?view=person-tim&month=${month}`);
    const search = page.getByRole("searchbox").or(page.getByPlaceholder(/Merchant/)).first();
    await search.click();
    await page.keyboard.type("a/b", { delay: 100 });
    await expect(search).toHaveValue("a/b");
    await expect(panel(page)).toHaveCount(0);

    await page.locator("body").click({ position: { x: 5, y: 300 } });
    await page.keyboard.press("/");
    await expect(panel(page)).toBeVisible();
    await expect(message(page)).toBeFocused();
    await expect(message(page)).toHaveValue("");
    // Already open: "/" from the page goes back to the message box.
    await page.locator("nav.tab-strip").getByRole("link", { name: "Entries" }).focus();
    await page.keyboard.press("/");
    await expect(message(page)).toBeFocused();
  });

  test("words typed while Ask is still loading carry over to the message box", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 800 });
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    // Hold the Ask page's code (its own chunk) until the words are typed.
    await page.route(/ask-panel[^/]*\.(jsx|js)(\?.*)?$/, async (route) => {
      await held;
      await route.continue();
    });
    await openUsable(page, `/summary?view=household`);
    await field(page).click();
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).getByRole("status")).toHaveText("Loading...");
    // Mid-sentence, trailing space and all.
    await page.keyboard.type("grab ");
    await expect(field(page)).toHaveValue("grab ");
    release();
    await expect(message(page)).toBeFocused();
    await expect(message(page)).toHaveValue("grab ");
    await page.keyboard.type("rides");
    await expect(message(page)).toHaveValue("grab rides");
    await expect(page.locator(".ask-dock-field")).toHaveCount(0);
  });

  test("a receipt photo from the field's paperclip opens Ask and is read into a card", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 800 });
    await page.route("**/api/ai-assist/receipt-read", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        receipt: {
          source: "ai",
          merchant: { value: "TIONG BAHRU BAKERY", confidence: "high" },
          date: { value: "2026-04-21", confidence: "high" },
          total: { amountMinor: 3860, currency: "SGD", confidence: "high" },
          cardLast4: null,
          lineItems: [],
          questions: []
        },
        ai: { available: true }
      })
    }));
    await openUsable(page, `/summary?view=household`);
    // No file input waits on the page; the paperclip opens the photo picker.
    expect(await page.locator('input[type="file"]').count()).toBe(0);
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Add a receipt photo" }).click();
    await (await chooser).setFiles(RECEIPT_FIXTURE);
    await expect(panel(page)).toBeVisible();
    await expect(page.locator(".ask-dock .ask-me")).toHaveText(["Sent a receipt photo"]);
    await expect(page.getByRole("textbox", { name: "What it was" })).toHaveValue("TIONG BAHRU BAKERY");
  });

  test("Open in Entries opens the list beside the panel, which stays open across pages and a reload; Close returns to the field", async ({ page }) => {
    const month = await trackedMonth(page);
    await page.setViewportSize({ width: 1440, height: 800 });
    await openUsable(page, `/summary?view=person-tim&month=${month}`);
    await field(page).click();
    await message(page).fill("how much on bills?");
    await message(page).press("Enter");
    const answer = answerCard(page);
    await expect(answer).toHaveAttribute("data-ask-answer", /^\d+$/);
    const count = Number(await answer.getAttribute("data-ask-answer"));
    const amount = (await answer.locator(".ask-answer-amount").innerText()).trim();

    await suggestions(page).getByRole("button", { name: "Open in Entries" }).click();
    await expect(page).toHaveURL(/\/entries\?/);
    expect(new URL(page.url()).searchParams.get("entry_category")).toBe("Bills");
    // The list beside the panel equals the answer; the panel is still here.
    await expect(page.locator(".entry-row")).toHaveCount(count);
    await expect(page.locator(".entries-totals-item").first().locator("strong")).toHaveText(amount);
    await expect(panel(page)).toBeVisible();
    await expect(page.locator(".ask-dock .ask-me")).toHaveText(["how much on bills?"]);
    const layout = await readLayout(page);
    expect(layout.shellRight).toBeLessThanOrEqual(layout.aside.left);

    // Another page from the header: still open, same conversation.
    await page.locator("nav.tab-strip").getByRole("link", { name: "Splits" }).click();
    await expect(page).toHaveURL(/\/splits\?/);
    await expect(page.locator(".ask-dock .ask-me")).toHaveText(["how much on bills?"]);

    // A reload keeps it open, without taking focus from the page.
    await page.reload();
    await page.waitForFunction(() => window.__MONIES_MAP_ROUTE_WORK__?.usable === true, null, { timeout: 60_000 });
    await expect(panel(page)).toHaveClass(/is-docked/);
    await expect(page.locator(".ask-dock .ask-me")).toHaveText(["how much on bills?"]);
    await expect(message(page)).not.toBeFocused();

    // Close: back to the field, focused; the page takes its full width again.
    await panel(page).getByRole("button", { name: "Close Ask" }).click();
    await expect(panel(page)).toHaveCount(0);
    await expect(field(page)).toBeFocused();
    expect(await page.evaluate(() => document.body.dataset.askDock ?? "")).toBe("");
    await page.reload();
    await page.waitForFunction(() => window.__MONIES_MAP_ROUTE_WORK__?.usable === true, null, { timeout: 60_000 });
    await expect(field(page)).toBeVisible();
    await expect(panel(page)).toHaveCount(0);
  });

  for (const [width, layout] of [[1440, "is-docked"], [1024, "is-popup"]]) {
    test(`at ${width} px the Entries + opens the new entry card in Ask and Entries stays where it was`, async ({ page }) => {
      const description = `Dock + ${width} ${Date.now()}`;
      await page.setViewportSize({ width, height: 800 });
      await openUsable(page, "/entries?view=person-tim&month=2026-04");
      const before = page.url();
      // The month Entries shows (the shell may move the link to a tracked one).
      const month = new URL(before).searchParams.get("month");
      await page.locator(".entries-fab:not(.splits-fab)").click();
      await expect(panel(page)).toHaveClass(new RegExp(layout));
      await expect(page.getByRole("heading", { name: "New entry" })).toBeVisible();
      await expect(page.locator('.ask-dock [data-ask-card="draft"]')).toBeVisible();
      // The page beside it did not move.
      expect(page.url()).toBe(before);
      await expect(page.locator(".entry-row").first()).toBeVisible();
      await expect(suggestions(page).getByRole("button").first()).toHaveText("‹ Entries");

      await page.getByRole("textbox", { name: "What it was" }).fill(description);
      await page.getByRole("textbox", { name: "Amount" }).fill("12.50");
      await page.getByLabel("Date", { exact: true }).fill(`${month}-20`);
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.locator('.ask-dock [data-ask-card="saved"]')).toBeVisible();
      // The Entries list beside it shows the saved row.
      await expect(page.locator(".entry-row").filter({ hasText: description })).toBeVisible({ timeout: 20_000 });
      expect(new URL(page.url()).pathname).toBe("/entries");

      // The next + starts a new card.
      await page.locator(".entries-fab:not(.splits-fab)").click();
      await expect(page.locator('.ask-dock [data-ask-card="draft"]')).toBeVisible();
      await expect(page.getByRole("textbox", { name: "What it was" })).toHaveValue("");
    });
  }

  test("at 1,280 px the Splits receipt button opens the card in Ask with Splits on for the open group, and Splits stays", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openUsable(page, "/splits?view=person-tim&month=2025-10&split_group=split-group-baby-river");
    const before = page.url();
    await page.locator(".splits-fab").click();
    await expect(panel(page)).toHaveClass(/is-docked/);
    await expect(page.locator('.ask-dock [data-ask-card="draft"]')).toBeVisible();
    await expect(page.locator(".ask-dock").getByRole("switch")).toHaveAttribute("aria-checked", "true");
    await expect(page.locator(".ask-dock .ask-share small")).toHaveText("Baby River");
    await expect(suggestions(page).getByRole("button").first()).toHaveText("‹ Splits");
    expect(page.url()).toBe(before);
    // Back to the chat from the field: the chat, not the card.
    await panel(page).getByRole("button", { name: "Close Ask" }).click();
    await field(page).click();
    await expect(page.getByRole("heading", { name: "Ask", exact: true })).toBeVisible();
  });

  test("the panel and the phone's Ask tab are one conversation", async ({ page }) => {
    const month = await trackedMonth(page);
    await page.setViewportSize({ width: 1440, height: 800 });
    await openUsable(page, `/summary?view=person-tim&month=${month}`);
    await field(page).click();
    await message(page).fill("how much on bills?");
    await message(page).press("Enter");
    await expect(answerCard(page)).toHaveAttribute("data-ask-answer", /^\d+$/);
    await message(page).fill("and a kopi");

    // The same tab on a phone: no field or panel; the Ask tab has it all.
    await page.setViewportSize(iPhone);
    await expect(page.locator(".ask-dock, .ask-dock-field")).toHaveCount(0);
    await page.locator("nav.tab-strip").getByRole("link", { name: "Ask, conversation in progress" }).click();
    await expect(page).toHaveURL(/\/ask\?/);
    await expect(page.locator(".ask-me")).toHaveText(["how much on bills?"]);
    await expect(message(page)).toHaveValue("and a kopi");
    await message(page).fill("and a kopi, and a bun");

    // Back on the desktop: the panel (still open) shows the phone's words.
    await page.setViewportSize({ width: 1440, height: 800 });
    await page.locator("nav.tab-strip").getByRole("link", { name: "Summary" }).click();
    await expect(panel(page)).toBeVisible();
    await expect(page.locator(".ask-dock .ask-me")).toHaveText(["how much on bills?"]);
    await expect(message(page)).toHaveValue("and a kopi, and a bun");
  });
});
