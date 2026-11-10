import { devices, expect, test } from "@playwright/test";

import { postJson, reseedDemo } from "./helpers";

// "Add the usual shared ones to Splits" in Ask (docs/flows/ask-flow.md
// "Usually shared"). The model is stubbed with the X-Ask-Turn-Test-Reply
// header, so the real Worker reads the same list Splits shows. The card lists
// each entry with its usual split and saves only with its button, through
// POST /api/splits/expenses/add-usual; Undo takes them back.

const iPhone = devices["iPhone 12 Pro"].viewport;
const SHOP = `Ask Usual Shop ${Date.now()}`;
const daysAgo = (days) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
};

async function entry(page, days, amountMinor) {
  const created = await postJson(page, "/api/entries/create", {
    date: daysAgo(days), description: SHOP, accountName: "UOB One", categoryName: "Groceries", amountMinor, entryType: "expense", ownershipType: "direct", ownerName: "Tim"
  });
  return created.entryId;
}

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

test.describe("Ask, usually shared", () => {
  test.use({ viewport: iPhone });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.goto("/");
    await reseedDemo(page);
    await page.request.post("/api/ask/habits/setting", { data: { enabled: false } });
  });

  test("the card lists what would be added with its usual split; Save adds them and Undo takes them back", async ({ page }) => {
    const recent = [await entry(page, 4, 1_500), await entry(page, 11, 1_100)];
    for (const days of [100, 108, 116]) {
      const id = await entry(page, days, 2_000);
      await postJson(page, "/api/splits/expenses/from-entry", { entryId: id, splitGroupId: null });
    }
    const seen = await stubModel(page, [{ action: "add_usually_shared", usually_shared: { shop: null } }]);
    await page.goto("/ask");
    await send(page, "add the usual shared ones to splits");
    await expect.poll(() => seen.length).toBe(1);

    const card = page.locator('[data-change-draft="draft"][data-change-type="usually_shared"]');
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(card.locator('[data-change-field="group"]')).toContainText("Not on Splits");
    await expect(card.locator('[data-change-field="group"]')).toContainText("half each with Joyce");
    await expect(card.locator(`[data-change-entry="${recent[0]}"]`)).toContainText("half each with Joyce");
    await page.screenshot({ path: "test-results/ask-usually-shared-card.png" });

    const added = async () => (await (await page.request.get("/api/splits/usually-shared")).json()).groups.some((group) => group.shopName === SHOP);
    expect(await added()).toBe(true);
    await card.getByRole("button", { name: "Add 2" }).click();
    await expect(page.locator('[data-change-draft="saved"]')).toBeVisible();
    await expect.poll(added).toBe(false);
    await page.locator("[data-change-undo]").click();
    await expect(page.locator('[data-change-draft="undone"]')).toBeVisible();
    await expect.poll(added).toBe(true);
  });

  test("with nothing waiting Ask says so and shows no card", async ({ page }) => {
    const seen = await stubModel(page, [{ action: "add_usually_shared", usually_shared: { shop: null } }]);
    await page.goto("/ask");
    await send(page, "add the usual shared ones to splits");
    await expect.poll(() => seen.length).toBe(1);
    await expect(page.getByText("Nothing that you usually share is waiting to be added to Splits.")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-change-type="usually_shared"]')).toHaveCount(0);
  });
});
