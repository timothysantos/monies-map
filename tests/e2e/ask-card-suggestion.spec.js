import { devices, expect, test } from "@playwright/test";

import { gotoPageAfterApi, loadEntriesPage, loadSettingsPage, postJson, reseedDemo } from "./helpers";

// The Ask card's card question (docs/flows/ask-flow.md "Card suggestion"):
// "Past {shop} entries were on {card}. Was this on that card too?". The rule
// and its reads have their own tests (card-history-suggestion.test.mjs,
// card-suggestion-route.test.mjs); here the page is proved in a real browser:
// on a draft the server's answer is stubbed and Yes only picks the card until
// Save; on the Apple Pay card the real server answers from real history and
// Yes moves the saved entry, No leaves it.

const iPhone = devices["iPhone 12 Pro"].viewport;
const MONTH = "2025-10";

async function accountsByName(page) {
  const accounts = (await loadSettingsPage(page)).settingsPage.accounts;
  return (name) => accounts.find((account) => account.name === name);
}

test.describe("the Ask card's card question on a phone", () => {
  test.use({ viewport: iPhone });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.goto("/");
    await reseedDemo(page);
  });

  test("on a draft, Yes picks the suggested card and nothing is saved until Save; No keeps the card", async ({ page }) => {
    const account = await accountsByName(page);
    const suggested = account("UOB Lady's");
    const requests = [];
    await page.route("**/api/entries/card-suggestion", async (route) => {
      const request = route.request().postDataJSON();
      requests.push(request);
      const current = (await loadSettingsPage(page)).settingsPage.accounts.find((item) => item.id === request.accountId);
      const body = current && current.id !== suggested.id
        ? { accountId: suggested.id, accountName: suggested.name, currentAccountId: current.id, currentAccountName: current.name, merchant: request.description, entryCount: 4, matchedCount: 4 }
        : null;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, suggestion: body }) });
    });
    const description = `Card question ${Date.now()}`;
    await gotoPageAfterApi(page, `/entries?view=person-tim&month=${MONTH}`, "/api/entries-page", () => page.locator(".entries-fab:not(.splits-fab)"));
    await page.locator(".entries-fab:not(.splits-fab)").click();
    await expect(page.locator('[data-ask-card="draft"]')).toBeVisible();
    await page.getByRole("textbox", { name: "Amount" }).fill("9.90");
    await page.getByRole("textbox", { name: "What it was" }).fill(description);
    await page.getByLabel("Date", { exact: true }).fill("2025-10-16");

    await expect(page.locator(".ask-question")).toContainText(`Past ${description} entries were on UOB Lady's. Was this on that card too?`);
    const chips = page.getByRole("group", { name: "Suggestions" });
    await expect(chips.getByRole("button", { name: "Yes, UOB Lady's" })).toBeVisible();
    await expect(chips.getByRole("button", { name: /^No, keep / })).toBeVisible();
    expect(requests.at(-1)).toMatchObject({ description, date: "2025-10-16" });
    if (process.env.CARD_SUGGEST_SHOT_DIR) {
      await page.screenshot({ path: `${process.env.CARD_SUGGEST_SHOT_DIR}/question-phone.png` });
    }

    await chips.getByRole("button", { name: "Yes, UOB Lady's" }).click();
    await expect(page.locator(".ask-question")).toHaveCount(0);
    expect((await loadEntriesPage(page, { view: "household", month: MONTH })).monthPage.entries.some((entry) => entry.description === description)).toBe(false);

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator('[data-ask-card="saved"]')).toBeVisible();
    const saved = (await loadEntriesPage(page, { view: "household", month: MONTH })).monthPage.entries.filter((entry) => entry.description === description);
    expect(saved).toHaveLength(1);
    expect(saved[0].accountName).toBe("UOB Lady's");
  });

  test("on the Apple Pay card the real history asks, Yes moves the saved entry and No leaves it", async ({ page }) => {
    const account = await accountsByName(page);
    const uob = account("UOB One");
    const citi = account("Citi Rewards");
    const key = `mm_card_question_${Date.now()}`;
    await postJson(page, "/api/settings/shortcuts/save", { apiKey: key, defaultAccountPriorityIds: [uob.id] });
    for (const day of ["10", "11", "12"]) {
      await postJson(page, "/api/entries/create", {
        accountName: citi.name, categoryName: "Other", entryType: "expense", ownershipType: "direct", ownerName: "Tim",
        description: "Grab Ride", amountMinor: 1100, date: `2025-10-${day}`
      });
    }
    const makePurchase = async (requestId) => {
      const response = await page.request.post(`/api/shortcuts/entries/create?shortcut_token=${encodeURIComponent(key)}`, {
        data: { date: "2025-10-16", description: "Grab Ride", amount: "SGD 13.20", categoryName: "Food & Drinks", requestId }
      });
      expect(response.ok(), await response.text()).toBeTruthy();
      return response.json();
    };

    const kept = await makePurchase(`kept-${Date.now()}`);
    await page.goto(new URL(kept.openUrl).pathname + new URL(kept.openUrl).search);
    await expect(page.locator(".ask-question")).toHaveText("Past Grab Ride entries were on Citi Rewards. Was this on that card too?");
    const chips = page.getByRole("group", { name: "Suggestions" });
    await expect(chips.getByRole("button")).toHaveText(["Open this entry", "Yes, Citi Rewards", "No, keep UOB One"]);
    await chips.getByRole("button", { name: "No, keep UOB One" }).click();
    await expect(page.locator(".ask-question")).not.toContainText("Past Grab Ride");
    const afterNo = (await loadEntriesPage(page, { view: "household", month: MONTH })).monthPage.entries.find((entry) => entry.id === kept.entryId);
    expect(afterNo.accountName).toBe("UOB One");

    const moved = await makePurchase(`moved-${Date.now()}`);
    await page.goto(new URL(moved.openUrl).pathname + new URL(moved.openUrl).search);
    await page.getByRole("group", { name: "Suggestions" }).getByRole("button", { name: "Yes, Citi Rewards" }).click();
    await expect(page.getByText("Moved to Citi Rewards.")).toBeVisible();
    await expect(page.locator(".ask-question")).not.toContainText("Past Grab Ride");
    const afterYes = (await loadEntriesPage(page, { view: "household", month: MONTH })).monthPage.entries.find((entry) => entry.id === moved.entryId);
    expect(afterYes.accountName).toBe("Citi Rewards");
    expect(afterYes.amountMinor).toBe(1320);
    expect(afterYes.ownerName).toBe("Tim");
  });
});
