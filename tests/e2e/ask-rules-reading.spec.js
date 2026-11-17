import { devices, expect, test } from "@playwright/test";

import { reseedDemo } from "./helpers";

// Ask with AI off (the test Worker has none): what a message asks for is
// read by the rules (src/domain/ask-turn-rules.ts; docs/flows/ask-flow.md
// "Rules reading"), on a 390 px phone.
//
// A3: "Joyce paid me back $30" is the settle-up payment card, never an
//     expense card; "delete the lunch" says why and opens Entries.
// A2: on a saved entry, "make it Transport" and "note: team lunch" are change
//     cards for that entry, saved through the existing commands.
// A5: "dinner $80 split with Joyce" turns Splits on.
// A4: "it's Joyce's" on a card being filled sets its owner, never the view.

const MONTH = "2026-04";

async function send(page, text) {
  const message = page.getByRole("textbox", { name: "Message" });
  await message.fill(text);
  await message.press("Enter");
}

async function openAsk(page) {
  await page.goto(`/ask?month=${MONTH}&view=person-tim`);
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible({ timeout: 60_000 });
}

test.describe("Ask, rules reading", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: devices["iPhone 13"].isMobile });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.goto("/");
    await reseedDemo(page);
  });

  test("A3: a payment back is the settle-up payment card, never an expense; a delete says why and opens Entries", async ({ page }) => {
    const creates = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/entries/create")) creates.push(request.url());
    });
    await openAsk(page);
    await send(page, "Joyce paid me back $30");
    const payment = page.locator('[data-settlement-draft="draft"]');
    await expect(payment).toBeVisible();
    await expect(payment).toContainText("Joyce");
    await expect(payment).toContainText("$30.00");
    await expect(page.locator("[data-ask-card]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);

    await send(page, "delete the Koufu lunch");
    await expect(page).toHaveURL(/\/entries\?/);
    expect(creates).toEqual([]);
  });

  test("A2: on a saved entry, \"make it Transport\" and \"note: team lunch\" are change cards for that entry, saved with Save", async ({ page }) => {
    await openAsk(page);
    await send(page, "Koufu lunch $12.50 on UOB One");
    await expect(page.locator('[data-ask-card="draft"]')).toBeVisible();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator('[data-ask-card="saved"]')).toBeVisible();

    await send(page, "note: team lunch");
    const note = page.locator('[data-change-draft="draft"][data-change-type="entry_note"]');
    await expect(note).toContainText("team lunch");
    // Not a new $0 draft.
    await expect(page.locator('[data-ask-card="draft"]')).toHaveCount(0);
    await note.getByRole("button", { name: "Save" }).click();
    await expect(page.locator('[data-change-draft="saved"][data-change-type="entry_note"]')).toBeVisible();

    await send(page, "make it Transport");
    const category = page.locator('[data-change-draft="draft"][data-change-type="recategorise"]');
    await expect(category).toContainText("Transport");
    await category.getByRole("button", { name: "Save" }).click();
    await expect(page.locator('[data-change-draft="saved"][data-change-type="recategorise"]')).toBeVisible();
    await expect(page.locator('[data-ask-card="saved"]')).toContainText("Transport");
  });

  test("A5: \"dinner $80 split with Joyce\" turns the Splits switch on", async ({ page }) => {
    await openAsk(page);
    await send(page, "dinner $80 split with Joyce");
    const card = page.locator('[data-ask-card="draft"]');
    await expect(card).toBeVisible();
    await expect(page.getByRole("switch", { name: "Share with Joyce on Splits" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText("You didn't say how to split it, so I split it evenly.")).toBeVisible();
    await expect(page.getByRole("button", { name: "All Joyce's" })).toBeVisible();
  });

  test("A4: \"it's Joyce's\" on a card being filled makes the card Joyce's and never offers to switch the view", async ({ page }) => {
    await openAsk(page);
    await send(page, "Koufu lunch $12.50 on UOB One");
    const card = page.locator('[data-ask-card="draft"]');
    await expect(card.locator('[data-chip="owner"]')).toHaveText("Tim");
    await send(page, "it's Joyce's");
    await expect(card.locator('[data-chip="owner"]')).toHaveText("Joyce");
    await expect(page.getByRole("button", { name: /^Switch to/ })).toHaveCount(0);
    await expect(page).toHaveURL(/view=person-tim/);
  });
});
